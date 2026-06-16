import { useMemo } from 'react';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

const ZONE_PALETTE: Record<string, THREE.Color[]> = {
  centro: ['#7fb4d6', '#9fc6e0', '#6e8fae', '#b8d4e8'].map((c) => new THREE.Color(c)),
  comercial: ['#d6a26b', '#c98f5a', '#e0b483'].map((c) => new THREE.Color(c)),
  industrial: ['#8d8d96', '#7a7a85', '#9d9da6'].map((c) => new THREE.Color(c)),
  residencial: ['#d9c4a5', '#c4ad8d', '#e6d5b8', '#cbb59a'].map((c) => new THREE.Color(c)),
  // bairro nobre: tons claros de mármore/creme e telhados elegantes
  nobre: ['#efe9dc', '#f5efe2', '#e8dcc6', '#d8c9a8', '#f0e6d2'].map((c) => new THREE.Color(c)),
  // bairro boêmio: fachadas coloridas (galerias, bares, teatros)
  boemio: ['#c96b8e', '#7a5fb0', '#d99b4e', '#5fa6b0', '#b85f7a'].map((c) => new THREE.Color(c)),
};

/**
 * Todos os prédios da cidade em UM ÚNICO InstancedMesh (1 draw call para
 * ~4.000 prédios), com cor por instância via instanceColor.
 * Frustum culling do Three.js atua no conjunto; o custo por prédio é nulo
 * na CPU — é isso que sustenta 50+ FPS.
 */
export function Buildings() {
  const layout = useGenesis((s) => s.layout);

  const mesh = useMemo(() => {
    if (!layout) return null;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // ancora na base
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const im = new THREE.InstancedMesh(geo, mat, layout.buildings.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    layout.buildings.forEach((b, i) => {
      p.set(b.x, 0.1 + (b.elevation ?? 0), b.z); // assenta no relevo do terreno
      s.set(b.w, b.h, b.d);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      const palette = ZONE_PALETTE[b.zone] ?? ZONE_PALETTE.residencial;
      im.setColorAt(i, palette[b.id % palette.length]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    return im;
  }, [layout]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
