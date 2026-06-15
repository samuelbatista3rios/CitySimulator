import { CONFIG, TICKS_PER_YEAR, TICKS_PER_MONTH } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem } from '../types';
import type { EconomySystem } from '../economy/economy';
import { remember } from '../agents/memory';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

export interface Platform {
  name: string;
  taxRate: number; // imposto sobre a folha
  minimumWage: number; // piso salarial
  socialSpending: number; // 0..1 do orçamento p/ saúde+educação+transferências
  policing: number; // 0..1 do orçamento p/ segurança
  businessSubsidy: number; // 0..1 do orçamento p/ socorrer empresas (anti-falência)
  publicJobs: number; // 0..1 — agressividade do programa de empregos públicos
}

const PLATFORMS: Platform[] = [
  { name: 'Progressista', taxRate: 0.20, minimumWage: CONFIG.BASE_SALARY * 0.95, socialSpending: 0.55, policing: 0.2, businessSubsidy: 0.1, publicJobs: 0.4 },
  { name: 'Centro',       taxRate: 0.14, minimumWage: CONFIG.BASE_SALARY * 0.75, socialSpending: 0.4, policing: 0.35, businessSubsidy: 0.25, publicJobs: 0.2 },
  { name: 'Liberal',      taxRate: 0.08, minimumWage: CONFIG.BASE_SALARY * 0.55, socialSpending: 0.2, policing: 0.3, businessSubsidy: 0.5, publicJobs: 0.05 },
  { name: 'Lei e Ordem',  taxRate: 0.15, minimumWage: CONFIG.BASE_SALARY * 0.7,  socialSpending: 0.2, policing: 0.7, businessSubsidy: 0.2, publicJobs: 0.1 },
  // Partido de RECUPERAÇÃO: surge forte em crises (subsídio + empregos públicos).
  { name: 'Reconstrução', taxRate: 0.16, minimumWage: CONFIG.BASE_SALARY * 0.7,  socialSpending: 0.25, policing: 0.25, businessSubsidy: 0.6, publicJobs: 0.6 },
];

/**
 * Governo municipal com POLÍTICA ECONÔMICA EMERGENTE.
 *
 * O prefeito é eleito pela população (voto guiado por personalidade, bolso e,
 * crucialmente, pela DOR ECONÔMICA do momento). Em crise, o eleitorado migra
 * para plataformas de recuperação (subsídio a empresas + empregos públicos), e
 * essas leis de fato reerguem a economia:
 *  - subsídio: socorre empresas no vermelho antes de falir (preserva empregos);
 *  - empregos públicos: o Estado contrata desempregados (piso de emprego);
 *  - imposto/salário mínimo: ajustam custo e renda.
 *
 * Eleições ordinárias a cada 4 anos — mas uma CRISE GRAVE (desemprego alto)
 * convoca ELEIÇÃO DE EMERGÊNCIA, deixando a democracia reagir antes do colapso.
 */
export class Government {
  policy: Platform = { ...PLATFORMS[1] };
  mayorId = -1;
  budget = 0;
  nextElectionTick = TICKS_PER_YEAR * 4;
  lastElectionTick = 0;

  // níveis de financiamento 0..1 derivados do gasto (lidos pelas instituições)
  policeFunding = 0.5;
  healthFunding = 0.5;
  eduFunding = 0.5;
  // economia
  subsidyAllocated = 0; // teto de subsídio disponibilizado à economia neste mês
  publicEmployees = new Set<number>();
  emergencyThisMonth = false;
  lastSubsidySpent = 0;

  constructor(
    private world: EcsWorld,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {}

  get taxRate(): number {
    return this.policy.taxRate;
  }
  get minimumWage(): number {
    return this.policy.minimumWage;
  }

  collect(taxes: number): void {
    this.budget += taxes;
  }

  /** Roda ANTES da economia: eleições, política econômica e gasto público. */
  monthlyCycle(tick: number, economy: EconomySystem): void {
    this.emergencyThisMonth = false;
    const { employed, adults, unemployedIds } = this.scanLabor();
    const unemploymentRate = adults > 0 ? (adults - employed) / adults : 0;

    // Eleição ordinária (4 anos) OU de emergência (crise grave, mín. 1 ano)
    const ordinary = tick >= this.nextElectionTick;
    const emergency =
      unemploymentRate > 0.22 && tick - this.lastElectionTick >= TICKS_PER_YEAR;
    if (ordinary || emergency) {
      this.holdElection(tick, unemploymentRate, emergency);
      this.lastElectionTick = tick;
      this.nextElectionTick = tick + TICKS_PER_YEAR * 4;
      if (emergency && !ordinary) this.emergencyThisMonth = true;
    }

    this.managePublicSector(economy, unemployedIds);
    this.spendBudget();
  }

  private scanLabor(): { employed: number; adults: number; unemployedIds: number[] } {
    const { hot } = this.world;
    let employed = 0, adults = 0;
    const unemployedIds: number[] = [];
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE || age >= CONFIG.RETIREMENT_AGE) continue;
      adults++;
      if (hot.companyId[i] !== -1 || hot.isOwner[i] || hot.publicJob[i]) employed++;
      else unemployedIds.push(i);
    }
    return { employed, adults, unemployedIds };
  }

  /** Eleição: o voto pesa a dor econômica atual (desemprego, bolso). */
  private holdElection(tick: number, cityUnemp: number, emergency: boolean): void {
    const { hot, cold } = this.world;
    const votes = new Array(PLATFORMS.length).fill(0);

    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;
      const c = cold[i];
      if (!c) continue;
      const p = c.personality;
      const meUnemployed = hot.companyId[i] === -1 && !hot.isOwner[i] && !hot.publicJob[i];
      let bestP = 0, bestScore = -Infinity;
      for (let k = 0; k < PLATFORMS.length; k++) {
        const pl = PLATFORMS[k];
        let s = 0;
        // ricos preferem imposto baixo; pobres, mais gasto social
        s += (hot.money[i] > 50_000 ? 1 : -1) * (0.2 - pl.taxRate) * 200;
        s += ((p.amabilidade + p.consciencia) / 200 - 0.5) * pl.socialSpending * 120;
        s += (p.abertura / 100 - 0.5) * (pl.name === 'Progressista' ? 80 : 0);
        s += (p.neuroticismo / 100 - 0.4) * pl.policing * 100;
        // DOR ECONÔMICA: desempregados e a cidade em crise valorizam recuperação
        const painWeight = (meUnemployed ? 1 : 0) * 90 + cityUnemp * 220;
        s += (pl.publicJobs + pl.businessSubsidy) * painWeight * 0.5;
        s += this.rng.gaussian() * 10;
        if (s > bestScore) { bestScore = s; bestP = k; }
      }
      votes[bestP]++;
    }

    let winner = 0;
    for (let k = 1; k < PLATFORMS.length; k++) if (votes[k] > votes[winner]) winner = k;
    const total = votes.reduce((a, b) => a + b, 0) || 1;
    const pct = Math.round((votes[winner] / total) * 100);
    this.policy = { ...PLATFORMS[winner] };

    if (this.mayorId !== -1 && hot.alive[this.mayorId]) hot.isMayor[this.mayorId] = 0;
    this.mayorId = this.pickMayor();
    if (this.mayorId !== -1) {
      hot.isMayor[this.mayorId] = 1;
      const cm = cold[this.mayorId];
      if (cm) {
        cm.professionTitle = 'Prefeito(a)';
        remember(cm, tick, 'promocao', `Eleito(a) Prefeito(a) pela ${this.policy.name}`);
      }
      const name = cm?.name ?? 'Independente';
      const tag = emergency ? '🚨 ELEIÇÃO DE EMERGÊNCIA' : '🗳️ ELEIÇÃO';
      this.feed({ tick, kind: 'global', text: `${tag}: ${name} eleito(a) prefeito(a) — ${this.policy.name} (${pct}%)` });
      this.feed({ tick, kind: 'global', text: `📜 NOVA LEI: imposto ${Math.round(this.policy.taxRate * 100)}% · sal. mín. $${Math.round(this.policy.minimumWage).toLocaleString('pt-BR')} · subsídio ${Math.round(this.policy.businessSubsidy * 100)}% · empregos públicos ${Math.round(this.policy.publicJobs * 100)}%` });
    }
  }

  private pickMayor(): number {
    const { hot, cold } = this.world;
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < 30 || age > 70) continue;
      const c = cold[i];
      if (!c) continue;
      const score = c.skills.lideranca * 0.5 + c.personality.extroversao * 0.3 +
        c.personality.consciencia * 0.2 + hot.intelligence[i] * 0.2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /**
   * Programa de empregos públicos: contrata desempregados conforme a plataforma
   * e o que o orçamento permite. É um piso de emprego contracíclico — sobe na
   * crise (mais desempregados) e encolhe na bonança (gente volta ao privado).
   */
  private managePublicSector(economy: EconomySystem, unemployedIds: number[]): void {
    const { hot } = this.world;
    // limpa quem morreu / saiu / foi preso / migrou ao privado
    for (const id of [...this.publicEmployees]) {
      if (!hot.alive[id] || hot.inJail[id] || hot.companyId[id] !== -1 || hot.isOwner[id]) {
        hot.publicJob[id] = 0;
        this.publicEmployees.delete(id);
      }
    }
    const monthlyWage = this.minimumWage * economy.wageLevel;
    // pode comprometer até 45% do caixa com folha pública
    const affordable = monthlyWage > 0 ? Math.floor((Math.max(0, this.budget) * 0.45) / monthlyWage) : 0;
    const desired = Math.round(this.policy.publicJobs * unemployedIds.length);
    const target = Math.min(desired, affordable + this.publicEmployees.size);

    const { cold } = this.world;
    // contrata
    let hires = 0;
    for (const id of unemployedIds) {
      if (this.publicEmployees.size >= target) break;
      hot.publicJob[id] = 1;
      this.publicEmployees.add(id);
      const c = cold[id];
      if (c) c.professionTitle = 'Servidor(a) público(a)';
      hires++;
    }
    // demite excedente (quando target cai — bonança/orçamento curto)
    if (this.publicEmployees.size > target) {
      let excess = this.publicEmployees.size - target;
      for (const id of [...this.publicEmployees]) {
        if (excess <= 0) break;
        hot.publicJob[id] = 0;
        this.publicEmployees.delete(id);
        const c = cold[id];
        if (c) c.professionTitle = 'Desempregado(a)';
        hot.nextThink[id] = 0; // volta a procurar emprego privado já
        excess--;
      }
    }
    // paga a folha pública (sai do caixa)
    let payroll = 0;
    for (const id of this.publicEmployees) {
      hot.money[id] += monthlyWage;
      payroll += monthlyWage;
    }
    this.budget -= payroll;
    if (hires > 50 && this.rng.chance(0.3)) {
      this.feed({ tick: 0, kind: 'economia', text: `🏛️ Governo abriu ${hires} vagas no setor público` });
    }
  }

  /** Aloca subsídio a empresas e gasta em serviços públicos. */
  private spendBudget(): void {
    const pop = Math.max(1, this.world.aliveCount);
    const available = Math.max(0, this.budget);
    // reserva para socorrer empresas (consumido dentro da economia)
    this.subsidyAllocated = Math.min(available * this.policy.businessSubsidy, available * 0.5);

    const forServices = Math.max(0, available - this.subsidyAllocated);
    const social = forServices * this.policy.socialSpending;
    const seguranca = forServices * this.policy.policing;
    const saude = social * 0.5, educacao = social * 0.3, transferencia = social * 0.2;
    this.budget -= seguranca + saude + educacao + transferencia;

    const lvl = (amount: number, ref: number) => Math.max(0, Math.min(1, amount / (pop * ref)));
    this.policeFunding = lvl(seguranca, 25);
    this.healthFunding = lvl(saude, 30);
    this.eduFunding = lvl(educacao, 20);

    if (transferencia > 0) {
      const { hot } = this.world;
      const grant = transferencia / Math.max(1, pop * 0.15);
      for (let i = 0; i < this.world.entityRange; i++) {
        if (!hot.alive[i]) continue;
        if (hot.money[i] < 800) {
          hot.money[i] += grant;
          hot.safety[i] = Math.min(100, hot.safety[i] + 3);
        }
      }
    }
  }

  /** Chamado pela economia ao consumir subsídio (deduz do caixa). */
  spendSubsidy(amount: number): void {
    this.budget -= amount;
    this.lastSubsidySpent += amount;
  }
  beginSubsidyMonth(): void {
    this.lastSubsidySpent = 0;
  }

  mayorName(): string | null {
    return this.mayorId === -1 ? null : this.world.cold[this.mayorId]?.name ?? null;
  }

  onDeath(id: number): void {
    if (id === this.mayorId) this.mayorId = -1;
    if (this.publicEmployees.delete(id)) this.world.hot.publicJob[id] = 0;
  }

  dump() {
    return {
      policy: this.policy, mayorId: this.mayorId, budget: this.budget,
      nextElectionTick: this.nextElectionTick, lastElectionTick: this.lastElectionTick,
      publicEmployees: [...this.publicEmployees],
    };
  }
  restore(d: ReturnType<Government['dump']>): void {
    this.policy = d.policy;
    this.mayorId = d.mayorId;
    this.budget = d.budget;
    this.nextElectionTick = d.nextElectionTick;
    this.lastElectionTick = d.lastElectionTick ?? 0;
    this.publicEmployees = new Set(d.publicEmployees ?? []);
  }
}
