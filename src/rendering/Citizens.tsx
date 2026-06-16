import { useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useGenesis } from '../state/store';

const MAX_RENDERED = 20000;
/** LOD: cidadãos além desta distância da câmera não são desenhados. */
const LOD_DISTANCE = 220;
/** Salto maior que isto = teleporte (snap), não um trajeto a pé (evita "atravessar" prédios). */
const SNAP_DISTANCE = 8;

const ACTIVITY_COLORS: THREE.Color[] = [
  new THREE.Color('#d8d8d8'), // ocioso
  new THREE.Color('#5b6ee1'), // dormindo
  new THREE.Color('#e1a95b'), // trabalhando
  new THREE.Color('#7fce7f'), // comendo
  new THREE.Color('#e15bb8'), // socializando
  new THREE.Color('#5bd6e1'), // estudando
  new THREE.Color('#e1d65b'), // diversão
  new THREE.Color('#b87fe1'), // comprando
  new THREE.Color('#9b9b9b'), // trânsito
  new THREE.Color('#e15b5b'), // procurando emprego
];

/**
 * Cidadãos: um InstancedMesh com até 20k cápsulas low-poly.
 * - posições interpoladas (lerp) na main thread entre frames do worker
 * - LOD por distância + culling de quem está dentro de prédios (feito no worker)
 * - clique = raycast no instanceId → consulta o worker pelos detalhes
 */
export function Citizens() {
  const frameRef = useGenesis((s) => s.frameRef);
  const selectCitizen = useGenesis((s) => s.selectCitizen);
  const { camera } = useThree();

  const mesh = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(0.32, 0.9, 2, 6);
    geo.translate(0, 0.8, 0);
    const mat = new THREE.MeshLambertMaterial();
    const im = new THREE.InstancedMesh(geo, mat, MAX_RENDERED);
    im.count = 0;
    im.frustumCulled = false; // culling manual por LOD abaixo
    return im;
  }, []);

  /** posições suavizadas por id de cidadão */
  const smooth = useRef(new Map<number, { x: number; z: number }>());
  // expõe as posições para a câmera "seguir" (lido em FollowCamera)
  (window as unknown as { __citizenPos?: Map<number, { x: number; z: number }> }).__citizenPos = smooth.current;
  /** mapeia instanceId renderizado -> citizen id (para o clique) */
  const instanceToCitizen = useRef(new Int32Array(MAX_RENDERED));
  /** id do cidadão sob o cursor (destaque) */
  const hovered = useRef(-1);

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const highlight = useMemo(() => new THREE.Color('#ffffff'), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const frame = frameRef.current;
    if (!frame) return;
    camera.getWorldPosition(camPos);
    const lerp = Math.min(1, delta * 4);
    const map = smooth.current;
    let rendered = 0;
    const seen = new Set<number>();

    for (let i = 0; i < frame.count && rendered < MAX_RENDERED; i++) {
      const id = frame.ids[i];
      const tx = frame.positions[i * 2];
      const tz = frame.positions[i * 2 + 1];
      seen.add(id);

      // LOD: pula quem está longe da câmera
      const dx = tx - camPos.x;
      const dz = tz - camPos.z;
      if (dx * dx + dz * dz > LOD_DISTANCE * LOD_DISTANCE) {
        map.delete(id);
        continue;
      }

      let p = map.get(id);
      if (!p) {
        p = { x: tx, z: tz };
        map.set(id, p);
      } else {
        // A posição lógica do cidadão "teleporta" para o destino (ir trabalhar,
        // casa, lazer...). Se interpolássemos sempre, ele deslizaria em linha reta
        // ATRAVESSANDO os prédios até um ponto distante. Em saltos grandes fazemos
        // snap (reaparece no destino); só suavizamos micro-movimentos na vizinhança.
        const ddx = tx - p.x;
        const ddz = tz - p.z;
        if (ddx * ddx + ddz * ddz > SNAP_DISTANCE * SNAP_DISTANCE) {
          p.x = tx;
          p.z = tz;
        } else {
          p.x += ddx * lerp;
          p.z += ddz * lerp;
        }
      }
      if (id === hovered.current) {
        // destaque: maior e branco
        tmpPos.set(p.x, 0.1, p.z);
        tmpScale.set(1.8, 1.8, 1.8);
        tmpM.compose(tmpPos, tmpQuat, tmpScale);
        mesh.setMatrixAt(rendered, tmpM);
        mesh.setColorAt(rendered, highlight);
      } else {
        tmpM.makeTranslation(p.x, 0.1, p.z);
        mesh.setMatrixAt(rendered, tmpM);
        mesh.setColorAt(rendered, ACTIVITY_COLORS[frame.activities[i]] ?? ACTIVITY_COLORS[0]);
      }
      instanceToCitizen.current[rendered] = id;
      rendered++;
    }

    // limpeza periódica do mapa de suavização
    if (map.size > frame.count * 2) {
      for (const k of map.keys()) if (!seen.has(k)) map.delete(k);
    }

    mesh.count = rendered;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && e.instanceId < mesh.count) {
      selectCitizen(instanceToCitizen.current[e.instanceId]);
    }
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && e.instanceId < mesh.count) {
      hovered.current = instanceToCitizen.current[e.instanceId];
      document.body.style.cursor = 'pointer';
    }
  };
  const onOut = () => {
    hovered.current = -1;
    document.body.style.cursor = 'auto';
  };

  return <primitive object={mesh} onClick={onClick} onPointerMove={onMove} onPointerOut={onOut} />;
}
