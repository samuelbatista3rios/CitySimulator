import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

/**
 * Estádio de futebol com RELEVO de construção: arquibancada em "tigela"
 * (LatheGeometry) inclinada para fora, gramado central e rótulo flutuante.
 * Escala em X torna a planta oval, como um estádio de verdade.
 */
export function Stadium() {
  const layout = useGenesis((s) => s.layout);
  const st = layout?.stadium ?? null;

  const standsGeo = useMemo(() => {
    // perfil radial da arquibancada: sobe e se afasta do gramado
    const profile = [
      new THREE.Vector2(7.0, 0.3),
      new THREE.Vector2(7.3, 2.4),
      new THREE.Vector2(12.5, 9.5),
      new THREE.Vector2(13.4, 9.7),
      new THREE.Vector2(13.4, 0.3),
    ];
    return new THREE.LatheGeometry(profile, 48);
  }, []);

  if (!st) return null;

  return (
    <group position={[st.x, 0.1, st.z]} scale={[1.3, 1, 1]}>
      {/* arquibancada (tigela) */}
      <mesh geometry={standsGeo} castShadow={false} receiveShadow>
        <meshStandardMaterial color="#cfd4dc" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* anel superior (borda/cobertura) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 9.8, 0]}>
        <ringGeometry args={[12.6, 13.6, 48]} />
        <meshStandardMaterial color="#e8ebf0" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* gramado */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.35, 0]}>
        <circleGeometry args={[7, 48]} />
        <meshStandardMaterial color="#2f7d3a" roughness={1} />
      </mesh>
      {/* linha central do campo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <ringGeometry args={[1.2, 1.5, 32]} />
        <meshBasicMaterial color="#e9f5ec" />
      </mesh>
      {/* rótulo */}
      <Html position={[0, 13, 0]} center distanceFactor={160} zIndexRange={[10, 0]}>
        <div className="inst-marker" title="Estádio Municipal">⚽</div>
      </Html>
    </group>
  );
}
