import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { Ground } from './Ground';
import { Buildings } from './Buildings';
import { Citizens } from './Citizens';
import { Vehicles } from './Vehicles';
import { DayNight } from './DayNight';
import { InstitutionMarkers } from './InstitutionMarkers';
import { VenueMarkers } from './VenueMarkers';
import { Stadium } from './Stadium';
import { HeatmapOverlay } from './HeatmapOverlay';
import { useGenesis } from '../state/store';

/**
 * Câmera que segue um cidadão: quando `followId` está setado, lê a posição
 * suavizada exposta pela camada de cidadãos e desliza o alvo do MapControls
 * até ele (mantendo o ângulo/zoom atuais do usuário).
 */
function FollowCamera({ controls }: { controls: React.RefObject<MapControlsImpl> }) {
  const offset = useRef(new THREE.Vector3());
  useFrame(() => {
    const followId = useGenesis.getState().followId;
    const ctrl = controls.current;
    if (followId == null || !ctrl) return;
    const pos = (window as unknown as { __citizenPos?: Map<number, { x: number; z: number }> }).__citizenPos;
    const p = pos?.get(followId);
    if (!p) return;
    const target = ctrl.target;
    // mantém o deslocamento câmera↔alvo, recoloca o alvo sobre o cidadão
    offset.current.copy(ctrl.object.position).sub(target);
    target.lerp(new THREE.Vector3(p.x, 0.5, p.z), 0.12);
    ctrl.object.position.copy(target).add(offset.current);
    ctrl.update();
  });
  return null;
}

/** Cena 3D principal: câmera RTS, dia/noite, e os layers instanciados. */
export function CityScene() {
  const controls = useRef<MapControlsImpl>(null);
  return (
    <Canvas
      shadows={false}
      camera={{ position: [120, 140, 120], fov: 50, near: 1, far: 2500 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0, background: '#0b0e14' }}
    >
      <DayNight />
      <fog attach="fog" args={['#9fb0c0', 450, 1500]} />

      <Ground />
      <Buildings />
      <Stadium />
      <HeatmapOverlay />
      <Citizens />
      <Vehicles />
      <InstitutionMarkers />
      <VenueMarkers />

      <MapControls
        ref={controls as never}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={15}
        maxDistance={700}
        dampingFactor={0.08}
      />
      <FollowCamera controls={controls} />
    </Canvas>
  );
}
