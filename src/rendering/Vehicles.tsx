import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGenesis } from '../state/store';
import { CONFIG } from '../simulation/config';

const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#2c3e50', '#27ae60'].map(
  (c) => new THREE.Color(c),
);

/** Veículos autônomos: InstancedMesh de caixas orientadas pela direção. */
export function Vehicles() {
  const frameRef = useGenesis((s) => s.frameRef);

  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(2.0, 0.8, 1.0);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial();
    const im = new THREE.InstancedMesh(geo, mat, CONFIG.MAX_VEHICLES);
    im.count = 0;
    im.frustumCulled = false;
    return im;
  }, []);

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpS = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const axisY = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const n = Math.min(frame.vehicleCount, CONFIG.MAX_VEHICLES);
    for (let i = 0; i < n; i++) {
      const x = frame.vehiclePositions[i * 3];
      const z = frame.vehiclePositions[i * 3 + 1];
      const angle = frame.vehiclePositions[i * 3 + 2];
      tmpP.set(x, 0.1, z);
      tmpQ.setFromAxisAngle(axisY, -angle);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(i, tmpM);
      mesh.setColorAt(i, CAR_COLORS[i % CAR_COLORS.length]);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
