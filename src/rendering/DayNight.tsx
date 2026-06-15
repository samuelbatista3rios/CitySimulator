import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

/**
 * Ciclo dia/noite: o sol descreve um arco conforme a hora da simulação,
 * e a intensidade da luz/cor do céu acompanham (amanhecer, meio-dia,
 * entardecer, noite). Lê `stats.hour` (0..23) da simulação.
 */
export function DayNight() {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const sunPos = useRef(new THREE.Vector3(300, 400, 200));
  const skyRef = useRef<{ position: THREE.Vector3 }>(null);

  useFrame(() => {
    const stats = useGenesis.getState().stats;
    const hour = stats ? stats.hour + (stats.tick % 1) : 12;
    // ângulo solar: 6h nasce (leste), 18h se põe (oeste)
    const t = (hour - 6) / 12; // 0..1 durante o dia
    const dayAngle = t * Math.PI; // 0..π
    const isDay = hour >= 5 && hour <= 19; // crepúsculo incluído
    const elevation = Math.sin(dayAngle); // <0 à noite
    const x = Math.cos(dayAngle) * 400;
    const y = Math.max(-50, elevation * 450);
    const z = 200;
    sunPos.current.set(x, y, z);
    if (sunRef.current) {
      sunRef.current.position.copy(sunPos.current);
      const intensity = isDay ? 0.25 + Math.max(0, elevation) * 1.0 : 0.0;
      sunRef.current.intensity = intensity;
      // cor: alaranjada no nascer/pôr, branca ao meio-dia
      const warmth = 1 - Math.max(0, elevation);
      sunRef.current.color.setRGB(1, 1 - warmth * 0.35, 1 - warmth * 0.55);
    }
    if (ambRef.current) {
      // piso noturno mais alto (iluminação urbana) → cidade nunca fica em breu total
      ambRef.current.intensity = isDay ? 0.4 + Math.max(0, elevation) * 0.35 : 0.26;
    }
    if (skyRef.current) {
      skyRef.current.position.set(x, Math.max(1, y), z);
    }
  });

  return (
    <>
      <Sky ref={skyRef as never} sunPosition={[300, 400, 200]} turbidity={8} rayleigh={2} />
      <ambientLight ref={ambRef} intensity={0.5} />
      <directionalLight ref={sunRef} position={[300, 400, 200]} intensity={1.1} />
    </>
  );
}
