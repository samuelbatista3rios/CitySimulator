import { CONFIG } from '../config';
import type { RNG } from '../rng';
import type { Block, Building, CityMap, Residence, Zone } from './cityTypes';

/**
 * Geração procedural da cidade em grade:
 * - centro comercial denso no meio (arranha-céus)
 * - anel comercial, malha residencial, indústria nas bordas
 * - parques espalhados e lagos em clusters orgânicos
 * - ruas entre todos os quarteirões; avenidas a cada AVENUE_EVERY
 */
export function generateCity(rng: RNG): CityMap {
  const N = CONFIG.CITY_BLOCKS;
  const span = CONFIG.BLOCK_SIZE + CONFIG.ROAD_WIDTH;
  const worldSize = N * span;
  const half = worldSize / 2;
  const center = (N - 1) / 2;

  // 1) Sementes de lagos (2-3 clusters orgânicos via random walk)
  const lakeCells = new Set<string>();
  const lakeCount = rng.int(2, 3);
  for (let l = 0; l < lakeCount; l++) {
    let cx = rng.int(4, N - 5);
    let cz = rng.int(4, N - 5);
    // evita o centro
    if (Math.abs(cx - center) < 6 && Math.abs(cz - center) < 6) cx += 8;
    const size = rng.int(4, 8);
    for (let i = 0; i < size; i++) {
      lakeCells.add(`${cx},${cz}`);
      cx = Math.min(N - 1, Math.max(0, cx + rng.int(-1, 1)));
      cz = Math.min(N - 1, Math.max(0, cz + rng.int(-1, 1)));
    }
  }

  // 2) Zoneamento por distância ao centro + ruído
  const blocks: Block[] = [];
  for (let bz = 0; bz < N; bz++) {
    for (let bx = 0; bx < N; bx++) {
      const dist = Math.max(Math.abs(bx - center), Math.abs(bz - center));
      let zone: Zone;
      if (lakeCells.has(`${bx},${bz}`)) {
        zone = 'lago';
      } else if (dist <= 3) {
        zone = 'centro';
      } else if (dist <= 5) {
        zone = rng.chance(0.6) ? 'comercial' : 'residencial';
      } else if (dist >= N / 2 - 3) {
        zone = rng.chance(0.55) ? 'industrial' : 'residencial';
      } else {
        zone = rng.chance(0.07) ? 'parque' : rng.chance(0.12) ? 'comercial' : 'residencial';
      }
      blocks.push({
        bx,
        bz,
        x: bx * span - half + span / 2,
        z: bz * span - half + span / 2,
        zone,
      });
    }
  }

  // 3) Prédios por quarteirão
  const buildings: Building[] = [];
  const byZone = new Map<Zone, Building[]>();
  const leisureSpots: { x: number; z: number }[] = [];
  let bId = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.zone === 'lago') continue;
    if (b.zone === 'parque') {
      leisureSpots.push({ x: b.x, z: b.z });
      continue;
    }
    const lots = b.zone === 'centro' ? 4 : b.zone === 'industrial' ? 2 : rng.int(4, 6);
    const grid = Math.ceil(Math.sqrt(lots));
    const lotSize = CONFIG.BLOCK_SIZE / grid;
    for (let l = 0; l < lots; l++) {
      const lx = l % grid;
      const lz = Math.floor(l / grid);
      const x = b.x - CONFIG.BLOCK_SIZE / 2 + lotSize * (lx + 0.5);
      const z = b.z - CONFIG.BLOCK_SIZE / 2 + lotSize * (lz + 0.5);
      let h: number, capacity: number;
      switch (b.zone) {
        case 'centro':
          h = rng.range(20, 60);
          capacity = Math.round(h / 4); // empresas por torre
          break;
        case 'comercial':
          h = rng.range(6, 18);
          capacity = rng.int(2, 5);
          break;
        case 'industrial':
          h = rng.range(5, 9);
          capacity = rng.int(1, 3);
          break;
        default: // residencial
          h = rng.chance(0.3) ? rng.range(9, 24) : rng.range(3, 6);
          capacity = h > 8 ? Math.round(h / 2.5) : 1; // prédio de aptos ou casa
      }
      const building: Building = {
        id: bId++,
        blockIndex: i,
        x,
        z,
        w: lotSize * 0.72,
        d: lotSize * 0.72,
        h,
        zone: b.zone,
        capacity,
      };
      buildings.push(building);
      const list = byZone.get(b.zone) ?? [];
      list.push(building);
      byZone.set(b.zone, list);
    }
    if (b.zone === 'centro' || b.zone === 'comercial') {
      if (rng.chance(0.25)) leisureSpots.push({ x: b.x, z: b.z });
    }
  }

  // 4) Residências: distribui START_RESIDENCES nas unidades habitacionais
  const residences: Residence[] = [];
  const resBuildings = byZone.get('residencial') ?? [];
  let rId = 0;
  outer: for (let round = 0; round < 50; round++) {
    for (const bld of resBuildings) {
      if (round >= bld.capacity) continue;
      if (rId >= CONFIG.START_RESIDENCES) break outer;
      residences.push({
        id: rId++,
        buildingId: bld.id,
        x: bld.x,
        z: bld.z,
        occupants: [],
        ownerId: -1,
        price: CONFIG.HOUSE_PRICE * rng.range(0.6, 1.8),
      });
    }
  }

  return { blocks, buildings, residences, byZone, worldSize, blockSpan: span, leisureSpots };
}
