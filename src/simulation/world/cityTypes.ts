export type Zone =
  | 'residencial'
  | 'comercial'
  | 'industrial'
  | 'centro'
  | 'parque'
  | 'lago';

export interface Block {
  bx: number; // coordenada em quarteirões
  bz: number;
  x: number; // centro em coordenadas de mundo
  z: number;
  zone: Zone;
}

export interface Building {
  id: number;
  blockIndex: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  zone: Zone;
  /** capacidade: unidades habitacionais (residencial) ou empresas (comercial/industrial) */
  capacity: number;
}

export interface Residence {
  id: number;
  buildingId: number;
  x: number;
  z: number;
  occupants: number[];
  ownerId: number; // -1 = alugada
  price: number;
}

export interface CityMap {
  blocks: Block[];
  buildings: Building[];
  residences: Residence[];
  /** prédios por zona para buscas rápidas */
  byZone: Map<Zone, Building[]>;
  worldSize: number;
  blockSpan: number; // BLOCK_SIZE + ROAD_WIDTH
  /** posições de lazer (parques/centros) */
  leisureSpots: { x: number; z: number }[];
}
