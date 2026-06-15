import { useMemo } from 'react';
import * as THREE from 'three';
import { useGenesis } from '../state/store';
import type { VenueType } from '../simulation/types';

/** Cores por tipo de local de lazer (combinam com a legenda da UI). */
export const VENUE_COLORS: Record<VenueType, string> = {
  restaurante: '#e07a5f',
  bar: '#f2cc8f',
  cinema: '#9b5de5',
  teatro: '#f15bb5',
  estadio: '#43aa8b',
  ginasio: '#4ea8de',
  templo: '#f8f9fa',
};

/**
 * Marcadores de locais de lazer (restaurante, bar, cinema, teatro, estádio,
 * academia, templo) como octaedros flutuantes coloridos por tipo. Tudo num
 * único InstancedMesh (1 draw call) — não pesa no FPS mesmo com centenas.
 */
export function VenueMarkers() {
  const layout = useGenesis((s) => s.layout);

  const mesh = useMemo(() => {
    if (!layout || layout.venues.length === 0) return null;
    const geo = new THREE.OctahedronGeometry(1.1);
    const mat = new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 });
    const im = new THREE.InstancedMesh(geo, mat, layout.venues.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    layout.venues.forEach((v, i) => {
      m.makeTranslation(v.x, 7, v.z);
      im.setMatrixAt(i, m);
      color.set(VENUE_COLORS[v.type] ?? '#ffffff');
      im.setColorAt(i, color);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }, [layout]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
