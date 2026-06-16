import type { RNG } from '../rng';
import type { FeedItem, GlobalEvent, GlobalEventKind } from '../types';
import { TICKS_PER_MONTH } from '../config';
import type { EconomySystem } from '../economy/economy';
import type { LifecycleSystem } from '../agents/lifecycle';

/** Ganchos opcionais para eventos que mexem em governo, empresas e imóveis. */
export interface EventHooks {
  spawnCompanies?: (n: number) => void;       // boom de startups
  failCompanies?: (fraction: number) => void; // onda de falências
  mergeCompanies?: () => string | null;        // megafusão (retorna nome resultante)
  housingShock?: (mult: number) => void;        // choque imobiliário
  approvalDelta?: (delta: number) => void;      // escândalo / boa notícia política
  budgetInject?: (amount: number) => void;      // pacote de estímulo
}

interface InstantEvent {
  monthlyChance: number;
  /** dispara o efeito e devolve a mensagem para o feed (ou null para abortar). */
  fire: (eco: EconomySystem, hooks: EventHooks, rng: RNG) => string | null;
}

/** Eventos INSTANTÂNEOS (sem duração): notícias de economia, leis e empresas. */
const INSTANT: InstantEvent[] = [
  // ---- Economia
  {
    monthlyChance: 0.012,
    fire: (eco) => { eco.priceLevel *= 1.04; return '⛽ Choque de energia: preços sobem de repente'; },
  },
  {
    monthlyChance: 0.010,
    fire: (eco, h) => { h.housingShock?.(1.15); return '🏠 Boom imobiliário: imóveis disparam de valor'; },
  },
  {
    monthlyChance: 0.008,
    fire: (eco, h) => { h.housingShock?.(0.88); return '📉 Estouro da bolha imobiliária: imóveis desvalorizam'; },
  },
  // ---- Leis / Governo
  {
    monthlyChance: 0.010,
    fire: (eco, h) => { h.budgetInject?.(eco.gdpThisMonth * 0.1 + 200_000); return '🏦 Pacote de estímulo: governo reforça o orçamento'; },
  },
  {
    monthlyChance: 0.009,
    fire: (eco, h) => { h.approvalDelta?.(-15); return '🗞️ Escândalo político abala a confiança no governo'; },
  },
  {
    monthlyChance: 0.008,
    fire: (eco, h) => { h.approvalDelta?.(10); return '🎉 Obra pública entregue: popularidade do governo sobe'; },
  },
  // ---- Empresas
  {
    monthlyChance: 0.012,
    fire: (eco, h, rng) => { h.spawnCompanies?.(rng.int(6, 14)); return '🚀 Boom de startups: uma leva de novas empresas abre as portas'; },
  },
  {
    monthlyChance: 0.008,
    fire: (eco, h) => { h.failCompanies?.(0.06); return '💥 Onda de falências atinge o mercado'; },
  },
  {
    monthlyChance: 0.010,
    fire: (eco, h) => { const n = h.mergeCompanies?.(); return n ? `🤝 Megafusão corporativa cria a gigante ${n}` : null; },
  },
];

interface EventDef {
  kind: GlobalEventKind;
  label: string;
  monthlyChance: number;
  durationMonths: [number, number];
  apply: (eco: EconomySystem, life: LifecycleSystem) => void;
  revert: (eco: EconomySystem, life: LifecycleSystem) => void;
}

const DEFS: EventDef[] = [
  {
    kind: 'crise_economica',
    label: '📉 Crise econômica — demanda em queda, desemprego sobe',
    monthlyChance: 0.015,
    durationMonths: [4, 10],
    apply: (eco) => { eco.demandMultiplier *= 0.6; },
    revert: (eco) => { eco.demandMultiplier /= 0.6; },
  },
  {
    kind: 'crescimento_economico',
    label: '📈 Boom econômico — consumo e contratações aquecidos',
    monthlyChance: 0.02,
    durationMonths: [4, 12],
    apply: (eco) => { eco.demandMultiplier *= 1.35; },
    revert: (eco) => { eco.demandMultiplier /= 1.35; },
  },
  {
    kind: 'pandemia',
    label: '🦠 Pandemia — saúde pública em alerta',
    monthlyChance: 0.005,
    durationMonths: [3, 8],
    apply: (eco, life) => { life.healthMultiplier = 0.4; eco.demandMultiplier *= 0.75; },
    revert: (eco, life) => { life.healthMultiplier = 1; eco.demandMultiplier /= 0.75; },
  },
  {
    kind: 'eleicoes',
    label: '🗳️ Eleições — novas políticas públicas em debate',
    monthlyChance: 0.012,
    durationMonths: [1, 2],
    apply: (eco) => { eco.demandMultiplier *= 1.05; },
    revert: (eco) => { eco.demandMultiplier /= 1.05; },
  },
  {
    kind: 'avanco_tecnologico',
    label: '🚀 Avanço tecnológico — produtividade em alta',
    monthlyChance: 0.012,
    durationMonths: [6, 18],
    // além de aquecer a demanda, o avanço acelera a conversão de P&D em tecnologia:
    // empresas que investiram em inovação capitalizam mais rápido.
    apply: (eco) => { eco.demandMultiplier *= 1.2; eco.rndMultiplier = 2.5; },
    revert: (eco) => { eco.demandMultiplier /= 1.2; eco.rndMultiplier = 1; },
  },
];

/** Eventos globais raros que alteram parâmetros macro por alguns meses. */
export class GlobalEventSystem {
  active: GlobalEvent | null = null;
  private activeDef: EventDef | null = null;
  /** ganchos para eventos de leis/empresas/imóveis (definidos pela simulação) */
  hooks: EventHooks = {};

  constructor(
    private rng: RNG,
    private eco: EconomySystem,
    private life: LifecycleSystem,
    private feed: (item: FeedItem) => void,
  ) {}

  monthlyCycle(tick: number): void {
    // Eventos INSTANTÂNEOS (notícias de economia/leis/empresas) podem ocorrer a
    // qualquer momento, em paralelo a um evento sustentado em andamento.
    for (const ev of INSTANT) {
      if (this.rng.chance(ev.monthlyChance)) {
        const text = ev.fire(this.eco, this.hooks, this.rng);
        if (text) this.feed({ tick, kind: 'global', text });
      }
    }

    if (this.active && this.activeDef) {
      if (tick >= this.active.startTick + this.active.durationTicks) {
        this.activeDef.revert(this.eco, this.life);
        this.feed({ tick, kind: 'global', text: `Fim do evento: ${this.active.label}` });
        this.active = null;
        this.activeDef = null;
      }
      return; // um evento sustentado por vez
    }
    for (const def of DEFS) {
      if (this.rng.chance(def.monthlyChance)) {
        const months = this.rng.int(def.durationMonths[0], def.durationMonths[1]);
        this.active = {
          kind: def.kind,
          label: def.label,
          startTick: tick,
          durationTicks: months * TICKS_PER_MONTH,
        };
        this.activeDef = def;
        def.apply(this.eco, this.life);
        this.feed({ tick, kind: 'global', text: `EVENTO GLOBAL: ${def.label}` });
        break;
      }
    }
  }
}
