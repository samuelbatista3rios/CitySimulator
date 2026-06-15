/**
 * Configuração global da simulação.
 * Tempo: 1 tick = 1 hora simulada. 24 ticks = 1 dia, 30 dias = 1 mês, 12 meses = 1 ano.
 */
export const CONFIG = {
  // População
  START_POPULATION: 10_000,
  MAX_CITIZENS: 100_000, // capacidade alocada nos typed arrays (escalável)
  START_RESIDENCES: 5_000,
  START_COMPANIES: 2_000,

  // Tempo
  TICKS_PER_DAY: 24,
  DAYS_PER_MONTH: 30,
  MONTHS_PER_YEAR: 12,

  // Cidade (grade de quarteirões)
  CITY_BLOCKS: 36, // 36x36 quarteirões
  BLOCK_SIZE: 12, // unidades de mundo por quarteirão
  ROAD_WIDTH: 4,
  AVENUE_EVERY: 6, // a cada 6 quarteirões, uma avenida

  // Economia
  BASE_SALARY: 1500,
  TAX_RATE: 0.12,
  BASE_PRICE_FOOD: 12,
  BASE_PRICE_FUN: 30,
  STARTING_MONEY_MIN: 500,
  STARTING_MONEY_MAX: 20_000,
  BUSINESS_STARTUP_COST: 25_000,
  HOUSE_PRICE: 120_000,
  CAR_PRICE: 35_000,

  // IA / agendamento
  THINK_INTERVAL_TICKS: 6, // cada cidadão replaneja a cada ~6h simuladas (escalonado)
  AGENT_UPDATE_SLICES: 6, // população dividida em fatias por tick para updates pesados

  // Necessidades (decaimento por hora)
  DECAY_HUNGER: 2.2,
  DECAY_SLEEP: 1.6,
  DECAY_SOCIAL: 0.9,
  DECAY_FUN: 1.1,
  DECAY_SAFETY: 0.2,

  // Ciclo de vida
  ADULT_AGE: 18,
  RETIREMENT_AGE: 65,
  MAX_AGE: 95,

  // Tráfego
  MAX_VEHICLES: 2_500,

  // Render / sync
  SYNC_HZ: 10, // envios de posições por segundo do worker para a UI
} as const;

export const TICKS_PER_MONTH = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

export const CITY_WORLD_SIZE = CONFIG.CITY_BLOCKS * (CONFIG.BLOCK_SIZE + CONFIG.ROAD_WIDTH);
