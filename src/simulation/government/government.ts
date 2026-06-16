import { CONFIG, TICKS_PER_YEAR, TICKS_PER_MONTH } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem } from '../types';
import type { EconomySystem } from '../economy/economy';
import { remember } from '../agents/memory';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

export interface Platform {
  name: string;
  taxRate: number; // nível do imposto de renda progressivo (dirige o topo marginal)
  corporateTax: number; // alíquota sobre o lucro das empresas
  propertyTax: number; // IPTU mensal: fração do valor do imóvel
  minimumWage: number; // piso salarial
  socialSpending: number; // 0..1 do orçamento p/ saúde+educação+transferências
  policing: number; // 0..1 do orçamento p/ segurança
  businessSubsidy: number; // 0..1 do orçamento p/ socorrer empresas (anti-falência)
  publicJobs: number; // 0..1 — agressividade do programa de empregos públicos
}

// Cada plataforma tem um MIX TRIBUTÁRIO próprio: progressistas taxam renda alta,
// lucro e patrimônio; liberais aliviam tudo; "lei e ordem" foca em arrecadar p/
// segurança. O IPTU é uma fração mensal pequena do valor do imóvel (HOUSE_PRICE).
const PLATFORMS: Platform[] = [
  { name: 'Progressista', taxRate: 0.20, corporateTax: 0.22, propertyTax: 0.0016, minimumWage: CONFIG.BASE_SALARY * 0.95, socialSpending: 0.55, policing: 0.2, businessSubsidy: 0.1, publicJobs: 0.4 },
  { name: 'Centro',       taxRate: 0.14, corporateTax: 0.15, propertyTax: 0.0010, minimumWage: CONFIG.BASE_SALARY * 0.75, socialSpending: 0.4, policing: 0.35, businessSubsidy: 0.25, publicJobs: 0.2 },
  { name: 'Liberal',      taxRate: 0.08, corporateTax: 0.08, propertyTax: 0.0005, minimumWage: CONFIG.BASE_SALARY * 0.55, socialSpending: 0.2, policing: 0.3, businessSubsidy: 0.5, publicJobs: 0.05 },
  { name: 'Lei e Ordem',  taxRate: 0.15, corporateTax: 0.16, propertyTax: 0.0012, minimumWage: CONFIG.BASE_SALARY * 0.7,  socialSpending: 0.2, policing: 0.7, businessSubsidy: 0.2, publicJobs: 0.1 },
  // Partido de RECUPERAÇÃO: surge forte em crises (subsídio + empregos públicos).
  { name: 'Reconstrução', taxRate: 0.16, corporateTax: 0.14, propertyTax: 0.0010, minimumWage: CONFIG.BASE_SALARY * 0.7,  socialSpending: 0.25, policing: 0.25, businessSubsidy: 0.6, publicJobs: 0.6 },
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
  /** aprovação do prefeito 0..100 — reage aos resultados da gestão (accountability) */
  approval = 50;
  /** sinaliza que a última eleição foi um RECALL (queda de aprovação) */
  recallThisMonth = false;

  // ---- Fiscal: dívida pública, juros e austeridade
  /** dívida pública acumulada (déficits viram dívida) */
  debt = 0;
  /** juros pagos sobre a dívida no mês (serviço da dívida) */
  debtInterest = 0;
  /** receita acumulada no mês corrente (impostos que entram no caixa) */
  private revenueAccum = 0;
  /** receita do mês anterior — base p/ razão dívida/receita e juros */
  lastMonthRevenue = 0;
  /** 1 = sem cortes; < 1 = austeridade (corta gasto discricionário) */
  austerity = 1;
  /** taxa de desemprego do último mês (0..1) — lida pela economia */
  unemploymentRate = 0;

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
  get corporateTax(): number {
    return this.policy.corporateTax;
  }
  get propertyTax(): number {
    return this.policy.propertyTax;
  }
  get minimumWage(): number {
    return this.policy.minimumWage;
  }

  collect(taxes: number): void {
    this.budget += taxes;
    this.revenueAccum += taxes; // contabiliza arrecadação do mês (base fiscal)
  }

  /** Roda ANTES da economia: eleições, política econômica e gasto público. */
  monthlyCycle(tick: number, economy: EconomySystem): void {
    this.emergencyThisMonth = false;
    this.recallThisMonth = false;
    const { employed, adults, unemployedIds } = this.scanLabor();
    const unemploymentRate = adults > 0 ? (adults - employed) / adults : 0;
    this.unemploymentRate = unemploymentRate;

    // Aprovação do prefeito reage aos resultados (antes de decidir eleição).
    this.updateApproval(unemploymentRate, economy);

    const enoughTime = tick - this.lastElectionTick >= TICKS_PER_YEAR;
    // Eleição ordinária (4 anos), de emergência (crise grave) ou RECALL
    // (aprovação despencou) — as duas últimas exigem ao menos 1 ano de mandato.
    const ordinary = tick >= this.nextElectionTick;
    const emergency = unemploymentRate > 0.22 && enoughTime;
    const recall = this.mayorId !== -1 && this.approval < 25 && enoughTime;
    if (ordinary || emergency || recall) {
      this.holdElection(tick, unemploymentRate, emergency || recall, recall && !ordinary && !emergency);
      this.lastElectionTick = tick;
      this.nextElectionTick = tick + TICKS_PER_YEAR * 4;
      if ((emergency || recall) && !ordinary) this.emergencyThisMonth = true;
    }

    this.managePublicSector(economy, unemployedIds);
    this.spendBudget();
    this.manageDebt();
  }

  /**
   * Atualiza a aprovação do prefeito. A população julga a gestão pelo que sente
   * no dia a dia: felicidade média, desemprego, inflação e saúde fiscal. É um
   * número suavizado (não pula de mês para mês) que dá ACCOUNTABILITY — prefeito
   * com boa entrega se reelege; com má entrega cai (e pode sofrer recall).
   */
  private updateApproval(unemploymentRate: number, economy: EconomySystem): void {
    if (this.mayorId === -1) { this.approval = 50; return; }
    const { hot } = this.world;
    let hapSum = 0, n = 0;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;
      hapSum += hot.happiness[i];
      n++;
    }
    const avgHappiness = n > 0 ? hapSum / n : 50;
    let target = 50;
    target += (avgHappiness - 50) * 0.8;          // humor da cidade pesa muito
    target -= unemploymentRate * 100 * 1.1;        // desemprego corrói a popularidade
    target -= Math.max(0, economy.inflationMonthly * 100 - 0.5) * 7; // inflação acima da meta
    target += this.budget > 0 ? 4 : -8;            // caixa no azul/vermelho
    target -= Math.min(15, this.debtToRevenue * 6); // dívida alta desgasta a gestão
    target = Math.max(0, Math.min(100, target));
    this.approval += (target - this.approval) * 0.34; // suavização
    this.approval = Math.max(0, Math.min(100, this.approval));
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
  private holdElection(tick: number, cityUnemp: number, emergency: boolean, recall = false): void {
    const { hot, cold } = this.world;
    const votes = new Array(PLATFORMS.length).fill(0);
    // INCUMBÊNCIA: a plataforma no poder é premiada/punida pela aprovação atual.
    const incumbent = this.mayorId !== -1 ? this.policy.name : null;
    const incumbencyBonus = (this.approval - 50) * 1.6;

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
        // voto retrospectivo: recompensa/pune quem está governando
        if (pl.name === incumbent) s += incumbencyBonus;
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
    this.recallThisMonth = recall;
    this.approval = 55; // novo mandato começa com leve "lua de mel"

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
      const tag = recall ? '📉 RECALL (aprovação baixa)'
        : emergency ? '🚨 ELEIÇÃO DE EMERGÊNCIA'
        : '🗳️ ELEIÇÃO';
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
    // austeridade encolhe o programa de empregos públicos quando a dívida aperta
    const desired = Math.round(this.policy.publicJobs * unemployedIds.length * this.austerity);
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
    // Gasto discricionário baseado na RECEITA ESPERADA (não só no caixa do mês):
    // permite DÉFICIT — em meses ruins o governo mantém serviços emitindo dívida.
    // A austeridade reduz esse teto quando a dívida já está alta.
    const available = Math.max(0, Math.max(this.budget, this.lastMonthRevenue) * this.austerity);
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
    // fecha a arrecadação do mês anterior (coletada durante o ciclo da economia)
    this.lastMonthRevenue = this.revenueAccum;
    this.revenueAccum = 0;
    // razão dívida/receita anual define a austeridade: acima de 1× a receita
    // anual, o governo corta gasto discricionário (piso de 40%).
    const annualRev = Math.max(1, this.lastMonthRevenue * 12);
    const ratio = this.debt / annualRev;
    this.austerity = ratio > 1 ? Math.max(0.4, 1 - (ratio - 1) * 0.4) : 1;
  }

  /** Razão dívida / receita anual estimada (indicador de saúde fiscal). */
  get debtToRevenue(): number {
    return this.debt / Math.max(1, this.lastMonthRevenue * 12);
  }

  /**
   * Serviço da dívida + financiamento de déficit. Roda ao fim do mês fiscal:
   * déficit (caixa negativo) vira DÍVIDA; a dívida cobra JUROS com prêmio de
   * risco que cresce com a razão dívida/receita; se não há caixa p/ os juros,
   * eles capitalizam (bola de neve); superávit AMORTIZA a dívida.
   */
  private manageDebt(): void {
    if (this.budget < 0) { this.debt += -this.budget; this.budget = 0; }
    const annualRev = Math.max(1, this.lastMonthRevenue * 12);
    const ratio = this.debt / annualRev;
    const monthlyRate = 0.003 + Math.min(0.02, ratio * 0.004); // 0,3%..~2,3% a.m.
    this.debtInterest = this.debt * monthlyRate;
    if (this.budget >= this.debtInterest) {
      this.budget -= this.debtInterest;
    } else {
      this.debt += this.debtInterest - this.budget; // capitaliza o que faltou
      this.budget = 0;
    }
    if (this.debt > 0 && this.budget > 0) {
      const pay = Math.min(this.debt, this.budget * 0.5); // metade do superávit amortiza
      this.debt -= pay;
      this.budget -= pay;
    }
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
      publicEmployees: [...this.publicEmployees], approval: this.approval,
      debt: this.debt, lastMonthRevenue: this.lastMonthRevenue,
    };
  }
  restore(d: ReturnType<Government['dump']>): void {
    // saves antigos podem não ter corporateTax/propertyTax — herda da plataforma
    // de mesmo nome (ou do Centro) para não gerar alíquotas indefinidas (NaN).
    const base = PLATFORMS.find((p) => p.name === d.policy?.name) ?? PLATFORMS[1];
    this.policy = { ...base, ...d.policy };
    this.mayorId = d.mayorId;
    this.budget = d.budget;
    this.nextElectionTick = d.nextElectionTick;
    this.lastElectionTick = d.lastElectionTick ?? 0;
    this.publicEmployees = new Set(d.publicEmployees ?? []);
    this.approval = d.approval ?? 50;
    this.debt = d.debt ?? 0;
    this.lastMonthRevenue = d.lastMonthRevenue ?? 0;
  }
}
