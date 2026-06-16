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

  // 1b) BAIRRO NOBRE: cluster de quarteirões no anel intermediário, deslocado para
  //     um canto agradável (à beira d'água quando possível), longe da indústria.
  const ang = rng.next() * Math.PI * 2;
  const ncx = Math.min(N - 4, Math.max(3, Math.round(center + Math.cos(ang) * N * 0.3)));
  const ncz = Math.min(N - 4, Math.max(3, Math.round(center + Math.sin(ang) * N * 0.3)));
  const nobleCells = new Set<string>();
  for (let dx = 0; dx < 4; dx++) {
    for (let dz = 0; dz < 4; dz++) {
      const bx = ncx - 1 + dx, bz = ncz - 1 + dz;
      if (!lakeCells.has(`${bx},${bz}`)) nobleCells.add(`${bx},${bz}`);
    }
  }
  // ESTÁDIO: do lado oposto ao bairro nobre, num ponto livre de lago.
  let stcx = Math.min(N - 3, Math.max(2, Math.round(center - Math.cos(ang) * N * 0.32)));
  let stcz = Math.min(N - 3, Math.max(2, Math.round(center - Math.sin(ang) * N * 0.32)));
  while (lakeCells.has(`${stcx},${stcz}`)) stcx = Math.min(N - 3, stcx + 1);
  const stadiumKey = `${stcx},${stcz}`;
  // complexo do estádio ocupa um terreno 3×3 (sem prédios, sem trânsito interno)
  const stadiumCells = new Set<string>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bx = stcx + dx, bz = stcz + dz;
      if (bx >= 0 && bx < N && bz >= 0 && bz < N && !lakeCells.has(`${bx},${bz}`)) {
        stadiumCells.add(`${bx},${bz}`);
      }
    }
  }
  let stadium: { x: number; z: number } | null = null;

  // 1c) BAIRRO BOÊMIO/CULTURAL: outro cluster aleatório, em ângulo distinto.
  const ang2 = ang + Math.PI * (0.55 + rng.next() * 0.6);
  const bcx = Math.min(N - 3, Math.max(3, Math.round(center + Math.cos(ang2) * N * 0.26)));
  const bcz = Math.min(N - 3, Math.max(3, Math.round(center + Math.sin(ang2) * N * 0.26)));
  const boemioCells = new Set<string>();
  for (let dx = 0; dx < 3; dx++) {
    for (let dz = 0; dz < 3; dz++) {
      const bx = bcx - 1 + dx, bz = bcz - 1 + dz;
      const key = `${bx},${bz}`;
      if (!lakeCells.has(key) && !nobleCells.has(key) && !stadiumCells.has(key)) boemioCells.add(key);
    }
  }

  // TERRENO PLANO: a cidade é em grade (lotes + ruas); relevo em caixas por bloco
  // ficava com cara de "bloquinhos". Mantemos o plano (visual limpo). O campo de
  // elevação fica disponível na estrutura, mas zerado.

  // 2) Zoneamento por distância ao centro + ruído
  const blocks: Block[] = [];
  for (let bz = 0; bz < N; bz++) {
    for (let bx = 0; bx < N; bx++) {
      const dist = Math.max(Math.abs(bx - center), Math.abs(bz - center));
      const key = `${bx},${bz}`;
      let zone: Zone;
      if (lakeCells.has(key)) {
        zone = 'lago';
      } else if (nobleCells.has(key)) {
        zone = 'nobre';
      } else if (boemioCells.has(key)) {
        zone = 'boemio';
      } else if (dist <= 3) {
        zone = 'centro';
      } else if (dist <= 5) {
        zone = rng.chance(0.6) ? 'comercial' : 'residencial';
      } else if (dist >= N / 2 - 3) {
        zone = rng.chance(0.55) ? 'industrial' : 'residencial';
      } else {
        zone = rng.chance(0.07) ? 'parque' : rng.chance(0.12) ? 'comercial' : 'residencial';
      }
      const bx0 = bx * span - half + span / 2;
      const bz0 = bz * span - half + span / 2;
      if (key === stadiumKey) stadium = { x: bx0, z: bz0 };
      const elevation = 0; // terreno plano
      blocks.push({ bx, bz, x: bx0, z: bz0, zone, elevation });
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
    // terreno do estádio: sem prédios (a arena 3D ocupa o espaço)
    if (stadiumCells.has(`${b.bx},${b.bz}`)) continue;
    if (b.zone === 'parque') {
      leisureSpots.push({ x: b.x, z: b.z });
      continue;
    }
    const lots = b.zone === 'centro' ? 4
      : b.zone === 'industrial' ? 2
      : b.zone === 'nobre' ? rng.int(2, 3) // mansões em lotes amplos
      : b.zone === 'boemio' ? rng.int(3, 5)
      : rng.int(4, 6);
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
        case 'nobre':
          h = rng.range(5, 11); // mansões/sobrados de luxo (baixa densidade)
          capacity = 1; // uma residência de luxo por lote
          break;
        case 'boemio':
          h = rng.range(8, 20); // prédios médios coloridos (galerias, bares, teatros)
          capacity = rng.int(2, 4);
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
        w: lotSize * (b.zone === 'nobre' ? 0.82 : 0.72), // mansões ocupam mais o lote
        d: lotSize * (b.zone === 'nobre' ? 0.82 : 0.72),
        h,
        zone: b.zone,
        capacity,
        elevation: b.elevation, // assenta no relevo do quarteirão
      };
      buildings.push(building);
      const list = byZone.get(b.zone) ?? [];
      list.push(building);
      byZone.set(b.zone, list);
    }
    if (b.zone === 'centro' || b.zone === 'comercial') {
      if (rng.chance(0.25)) leisureSpots.push({ x: b.x, z: b.z });
    }
    // o bairro nobre tem lazer/cultura de sobra (restaurantes, teatros, clubes)
    if (b.zone === 'nobre' && rng.chance(0.6)) leisureSpots.push({ x: b.x, z: b.z });
    // o bairro boêmio é polo cultural: muitos bares, teatros e cinemas
    if (b.zone === 'boemio' && rng.chance(0.85)) leisureSpots.push({ x: b.x, z: b.z });
  }
  // pontos de lazer ao redor do estádio (bares, restaurantes do entorno)
  if (stadium) {
    leisureSpots.push({ x: stadium.x + span, z: stadium.z });
    leisureSpots.push({ x: stadium.x - span, z: stadium.z });
  }

  // 4) Residências: comuns (zona residencial) + de LUXO (bairro nobre)
  const residences: Residence[] = [];
  const resBuildings = byZone.get('residencial') ?? [];
  const nobleBuildings = byZone.get('nobre') ?? [];
  const maxDist = worldSize * 0.5;
  let rId = 0;
  outer: for (let round = 0; round < 50; round++) {
    for (const bld of resBuildings) {
      if (round >= bld.capacity) continue;
      if (rId >= CONFIG.START_RESIDENCES) break outer;
      // valor de localização: imóveis mais próximos do centro valem mais
      const dist = Math.hypot(bld.x, bld.z);
      const locationValue = Math.max(0.6, Math.min(1.8, 1.75 - (dist / maxDist) * 1.2));
      residences.push({
        id: rId++,
        buildingId: bld.id,
        x: bld.x,
        z: bld.z,
        occupants: [],
        ownerId: -1,
        price: CONFIG.HOUSE_PRICE * rng.range(0.6, 1.4),
        locationValue,
        premium: false,
      });
    }
  }
  // Residências de LUXO do bairro nobre: caras, valorizadas, reservadas aos ricos.
  for (const bld of nobleBuildings) {
    residences.push({
      id: rId++,
      buildingId: bld.id,
      x: bld.x,
      z: bld.z,
      occupants: [],
      ownerId: -1,
      price: CONFIG.HOUSE_PRICE * rng.range(2.5, 5),
      locationValue: rng.range(2.0, 2.6),
      premium: true,
    });
  }

  const nobleCenter = { x: ncx * span - half + span / 2, z: ncz * span - half + span / 2 };
  const boemioCenter = boemioCells.size
    ? { x: bcx * span - half + span / 2, z: bcz * span - half + span / 2 }
    : null;

  return {
    blocks, buildings, residences, byZone, worldSize, blockSpan: span,
    leisureSpots, stadium, nobleCenter, boemioCenter, lakeCells, stadiumCells,
  };
}
