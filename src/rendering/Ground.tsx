import { useMemo } from 'react';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

const ZONE_COLORS: Record<string, string> = {
  parque: '#3a7d44',
  lago: '#2a6f97',
};

/** Chão, malha viária (ruas + avenidas), parques e lagos. */
export function Ground() {
  const layout = useGenesis((s) => s.layout);

  const { parkMatrices, lakeMatrices, roadGeometry } = useMemo(() => {
    if (!layout) return { parkMatrices: [], lakeMatrices: [], roadGeometry: null };
    const parks: THREE.Matrix4[] = [];
    const lakes: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (const b of layout.blocks) {
      if (b.zone === 'parque') {
        parks.push(m.clone().makeTranslation(b.x, 0.02, b.z));
      } else if (b.zone === 'lago') {
        lakes.push(m.clone().makeTranslation(b.x, 0.01, b.z));
      }
    }
    return { parkMatrices: parks, lakeMatrices: lakes, roadGeometry: null };
  }, [layout]);

  if (!layout) return null;
  const size = layout.worldSize;
  const blockSize = layout.blockSpan - 4; // BLOCK_SIZE

  return (
    <group>
      {/* asfalto base — as ruas são o próprio chão */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[size + 60, size + 60]} />
        <meshStandardMaterial color="#2b2b30" />
      </mesh>
      {/* calçadas dos quarteirões */}
      <BlockPads layout={layout} blockSize={blockSize} />
      {/* parques */}
      <Instanced matrices={parkMatrices} color={ZONE_COLORS.parque} size={blockSize} height={0.25} />
      {/* lagos */}
      <Instanced matrices={lakeMatrices} color={ZONE_COLORS.lago} size={layout.blockSpan} height={0.12} metal />
    </group>
  );
}

function BlockPads({ layout, blockSize }: { layout: NonNullable<ReturnType<typeof useGenesis.getState>['layout']>; blockSize: number }) {
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (const b of layout.blocks) {
      if (b.zone === 'lago' || b.zone === 'parque') continue;
      out.push(m.clone().makeTranslation(b.x, 0.05, b.z));
    }
    return out;
  }, [layout]);
  return <Instanced matrices={matrices} color="#56565e" size={blockSize + 1.2} height={0.1} />;
}

function Instanced({
  matrices,
  color,
  size,
  height,
  metal = false,
}: {
  matrices: THREE.Matrix4[];
  color: string;
  size: number;
  height: number;
  metal?: boolean;
}) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(size, height, size);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: metal ? 0.15 : 0.95,
      metalness: metal ? 0.6 : 0,
    });
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = matrices.length;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [matrices, color, size, height, metal]);
  return <primitive object={mesh} />;
}
