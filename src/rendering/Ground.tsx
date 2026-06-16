import { useMemo } from 'react';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

/** Cor do terraço de cada zona. */
const ZONE_GROUND: Record<string, string> = {
  parque: '#3a7d44',
  nobre: '#4f6b4a',
  boemio: '#6b5a7a',
  // construído (centro/comercial/industrial/residencial) usa o cinza padrão
};
const BUILT = '#56565e';

/**
 * Chão com RELEVO: cada quarteirão (exceto lago) é um terraço cuja altura segue
 * a elevação do terreno — dá topografia à cidade. As ruas (asfalto) ficam no
 * nível base; lagos são água rasa. Tudo num único InstancedMesh por desempenho.
 */
export function Ground() {
  const layout = useGenesis((s) => s.layout);

  const terrain = useMemo(() => {
    if (!layout) return null;
    const built = layout.blocks.filter((b) => b.zone !== 'lago');
    const size = layout.blockSpan - 2.8;
    const geo = new THREE.BoxGeometry(size, 1, size); // altura 1, escalada por instância
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, built.length));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const high = new THREE.Color('#cdbb9a'); // topos: tom terroso claro (relevo legível de cima)
    const maxElev = Math.max(1, ...built.map((b) => b.elevation ?? 0));
    built.forEach((b, i) => {
      const e = b.elevation ?? 0;
      const hgt = Math.max(0.16, e + 0.16);
      p.set(b.x, hgt / 2, b.z);
      s.set(1, hgt, 1);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      // tinge a cor da zona em direção ao tom de "topo" conforme a altura
      col.set(ZONE_GROUND[b.zone] ?? BUILT).lerp(high, Math.min(1, e / maxElev) * 0.7);
      im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    return im;
  }, [layout]);

  const lakeMatrices = useMemo(() => {
    if (!layout) return [] as THREE.Matrix4[];
    const m = new THREE.Matrix4();
    return layout.blocks
      .filter((b) => b.zone === 'lago')
      .map((b) => m.clone().makeTranslation(b.x, 0.06, b.z));
  }, [layout]);

  if (!layout || !terrain) return null;
  const size = layout.worldSize;

  return (
    <group>
      {/* asfalto base — as ruas são o próprio chão */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[size + 60, size + 60]} />
        <meshStandardMaterial color="#2b2b30" />
      </mesh>
      {/* terraços dos quarteirões (com relevo) */}
      <primitive object={terrain} />
      {/* lagos */}
      <LakeInstanced matrices={lakeMatrices} size={layout.blockSpan} />
    </group>
  );
}

function LakeInstanced({ matrices, size }: { matrices: THREE.Matrix4[]; size: number }) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(size, 0.12, size);
    const mat = new THREE.MeshStandardMaterial({ color: '#2a6f97', roughness: 0.15, metalness: 0.6 });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = matrices.length;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [matrices, size]);
  return <primitive object={mesh} />;
}
