import type { RNG } from '../rng';
import type { FeedItem, GlobalEvent, GlobalEventKind } from '../types';
import { TICKS_PER_MONTH } from '../config';
import type { EconomySystem } from '../economy/economy';
import type { LifecycleSystem } from '../agents/lifecycle';

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
    apply: (eco) => { eco.demandMultiplier *= 1.2; },
    revert: (eco) => { eco.demandMultiplier /= 1.2; },
  },
];

/** Eventos globais raros que alteram parâmetros macro por alguns meses. */
export class GlobalEventSystem {
  active: GlobalEvent | null = null;
  private activeDef: EventDef | null = null;

  constructor(
    private rng: RNG,
    private eco: EconomySystem,
    private life: LifecycleSystem,
    private feed: (item: FeedItem) => void,
  ) {}

  monthlyCycle(tick: number): void {
    if (this.active && this.activeDef) {
      if (tick >= this.active.startTick + this.active.durationTicks) {
        this.activeDef.revert(this.eco, this.life);
        this.feed({ tick, kind: 'global', text: `Fim do evento: ${this.active.label}` });
        this.active = null;
        this.activeDef = null;
      }
      return; // um evento global por vez
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
