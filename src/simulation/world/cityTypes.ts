export type Zone =
  | 'residencial'
  | 'comercial'
  | 'industrial'
  | 'centro'
  | 'parque'
  | 'lago'
  | 'nobre'   // bairro nobre: residências de luxo para os mais ricos
  | 'boemio'; // bairro boêmio/cultural: arte, bares e teatros

export interface Block {
  bx: number; // coordenada em quarteirões
  bz: number;
  x: number; // centro em coordenadas de mundo
  z: number;
  zone: Zone;
  /** elevação do terreno (relevo) em unidades de mundo */
  elevation: number;
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
  /** elevação do terreno onde o prédio assenta (relevo) */
  elevation: number;
}

export interface Residence {
  id: number;
  buildingId: number;
  x: number;
  z: number;
  occupants: number[];
  ownerId: number; // -1 = alugada
  price: number; // valor base do imóvel (antes de localização/índice de mercado)
  /** multiplicador de localização (≈0,6 periferia .. ≈2,6 bairro nobre) */
  locationValue: number;
  /** residência de luxo no bairro nobre (reservada aos mais ricos) */
  premium: boolean;
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
  /** localização do estádio de futebol (centro de eventos esportivos) */
  stadium: { x: number; z: number } | null;
  /** centro do bairro nobre (para marcador/identificação no mapa) */
  nobleCenter: { x: number; z: number } | null;
  /** centro do bairro boêmio/cultural (para marcador no mapa) */
  boemioCenter: { x: number; z: number } | null;
  /** células de lago (chave "bx,bz") — usado pelo trânsito para não cruzar água */
  lakeCells: Set<string>;
  /** células do complexo do estádio (sem prédios; trânsito não cruza) */
  stadiumCells: Set<string>;
}
