import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem } from '../types';
import { remember } from '../agents/memory';
import { totalOpenings, type Company } from './companies';
import type { CareerSystem } from './careers';

/**
 * Macroeconomia mensal:
 * - folha de pagamento + impostos
 * - receita das empresas proporcional a funcionários × produtividade × demanda
 * - inflação dirigida por demanda agregada (consumo vs. oferta)
 * - falências (capital < 0 por 2 meses) e demissões em massa
 * - crescimento: empresas lucrativas abrem vagas
 */
export class EconomySystem {
  inflationMonthly = 0.003; // 0,3% a.m. inicial
  priceLevel = 1; // multiplicador de preços acumulado
  wageLevel = 1; // salários reajustam com atraso
  gdpThisMonth = 0;
  gdpLastMonth = 0;
  taxPool = 0;
  bankruptciesTotal = 0;
  /** multiplicador externo vindo de eventos globais (crise, boom...) */
  demandMultiplier = 1;

  // Definidos pelo Governo (leis em vigor) a cada mês, antes do ciclo.
  taxRate: number = CONFIG.TAX_RATE;
  minimumWage: number = CONFIG.BASE_SALARY * 0.7;
  // Banco para contas itemizadas + parcelas; callback de impostos p/ o governo.
  bank: import('./bank').Bank | null = null;
  onTaxesCollected: ((amount: number) => void) | null = null;
  // Subsídio público a empresas (anti-falência) — definido pelo governo eleito.
  subsidyPool = 0;
  onSubsidySpent: ((amount: number) => void) | null = null;

  private distress = new Map<number, number>(); // empresa -> meses no vermelho

  constructor(
    private world: EcsWorld,
    private companies: Company[],
    private careers: CareerSystem,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {}

  get foodPrice(): number {
    return CONFIG.BASE_PRICE_FOOD * this.priceLevel;
  }
  get funPrice(): number {
    return CONFIG.BASE_PRICE_FUN * this.priceLevel;
  }

  monthlyCycle(tick: number): void {
    const { hot, cold } = this.world;
    this.gdpLastMonth = this.gdpThisMonth;
    let wagesPaid = 0;
    let consumption = 0;

    // 1) Folha de pagamento
    for (const company of this.companies) {
      if (company.bankrupt) continue;
      let payroll = 0;
      for (const emp of company.employees) {
        if (!hot.alive[emp]) { company.employees.delete(emp); continue; }
        if (hot.inJail[emp]) continue; // preso não recebe
        // salário respeita o PISO definido por lei (salário mínimo)
        const gross = Math.max(
          company.positions[Math.max(0, hot.jobLevel[emp])].salary * this.wageLevel,
          this.minimumWage,
        );
        const tax = gross * this.taxRate;
        hot.money[emp] += gross - tax;
        this.taxPool += tax;
        this.onTaxesCollected?.(tax);
        payroll += gross;
      }
      // 2) Receita: produtividade média × demanda da economia
      const headcount = company.employees.size;
      const productivity = this.rng.range(0.85, 1.2);
      const revenue =
        headcount * CONFIG.BASE_SALARY * 1.7 * this.wageLevel * productivity * this.demandMultiplier;
      company.revenueThisMonth = revenue;
      company.capital += revenue - payroll - headcount * 200 * this.priceLevel; // custos fixos
      wagesPaid += payroll;

      // 2b) SUBSÍDIO PÚBLICO: governo socorre empresa no vermelho (anti-falência),
      //     conforme verba alocada pela plataforma eleita. Preserva empregos.
      if (company.capital < 0 && this.subsidyPool > 0 && headcount > 0) {
        const inject = Math.min(-company.capital + payroll * 0.2, this.subsidyPool);
        company.capital += inject;
        this.subsidyPool -= inject;
        this.onSubsidySpent?.(inject);
      }

      // 3) Saúde financeira
      if (company.capital < 0) {
        const months = (this.distress.get(company.id) ?? 0) + 1;
        this.distress.set(company.id, months);
        // demissão em massa: corta 30% do quadro antes de falir
        if (months === 1 && headcount > 2) {
          const toFire = Math.ceil(headcount * 0.3);
          let fired = 0;
          for (const emp of [...company.employees]) {
            if (fired >= toFire) break;
            if (hot.isOwner[emp]) continue;
            this.careers.fire(emp, tick, 'corte de custos');
            fired++;
          }
        }
        if (months >= 2) this.bankrupt(company, tick);
      } else {
        this.distress.delete(company.id);
        // 4) Crescimento: lucro alto → abre vagas
        if (company.capital > 100_000 * this.priceLevel && this.rng.chance(0.3)) {
          const level = this.rng.chance(0.7) ? 0 : 1;
          company.openings[level]++;
        }
      }
    }

    // 5) Custo de vida mensal: aluguel + contas itemizadas (água/luz/internet)
    //    e parcelas de financiamento — estas via Banco.
    const baseRent = 600 * this.priceLevel;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const ageYears = hot.ageDays[i] / 360;
      if (ageYears < CONFIG.ADULT_AGE) continue;
      const rent = hot.ownsHouse[i] || hot.inJail[i] ? 0 : baseRent;
      hot.money[i] -= rent;
      consumption += rent;
      // contas + empréstimos (inadimplência e score tratados no banco)
      if (this.bank && !hot.inJail[i]) {
        consumption += this.bank.chargeMonthly(i, this.priceLevel, tick);
      }
      // aposentadoria pública (sai do caixa de impostos)
      if (ageYears >= CONFIG.RETIREMENT_AGE && !hot.inJail[i]) {
        const pension = Math.max(this.minimumWage, CONFIG.BASE_SALARY * 0.8 * this.wageLevel) * 0.8;
        hot.money[i] += pension;
        this.taxPool -= pension;
      }
      // segurança financeira influencia a necessidade de segurança
      if (hot.money[i] < 0) {
        hot.safety[i] = Math.max(0, hot.safety[i] - 15);
        hot.money[i] = Math.max(hot.money[i], -8000); // limite de dívida
      }
    }

    // 6) Inflação — com "banco central": a pressão é normalizada e a oferta tem
    //    PISO (proporcional à população), para que um encolhimento de empresas
    //    não dispare hiperinflação. Banda estreita + reversão à meta (~0,3%/mês).
    const rawSupply = this.companies.reduce((s, c) => s + (c.bankrupt ? 0 : c.revenueThisMonth), 0);
    const supplyFloor = this.world.aliveCount * CONFIG.BASE_SALARY * 0.8;
    const supply = Math.max(rawSupply, supplyFloor);
    const demand = consumption + wagesPaid;
    const pressure = Math.max(-0.3, Math.min(0.3, demand / supply - 1));
    const target = 0.003; // meta de inflação ~0,3% a.m.
    this.inflationMonthly = this.inflationMonthly * 0.6 + (target + pressure * 0.01) * 0.4;
    this.inflationMonthly = Math.max(-0.005, Math.min(0.02, this.inflationMonthly)); // teto 2%/mês
    this.priceLevel *= 1 + this.inflationMonthly;
    // salário persegue preços com folga (real cai um pouco na inflação → alivia folha)
    this.wageLevel += (this.priceLevel - this.wageLevel) * 0.2;

    // 7) Reposição de empresas: empreendedorismo de mercado mantém uma BASE de
    //    empregos. Se há muita gente desempregada e poucas vagas, surgem novos
    //    negócios (entrada de mercado) — evita o deserto econômico sem "mão de Deus".
    this.replenishBusinesses(tick);

    this.gdpThisMonth = wagesPaid + consumption;
    this.careers.rebuildHiringIndex();
  }

  /**
   * Entrada de novos negócios no mercado. A economia real tem rotatividade:
   * empresas morrem e nascem. Aqui, quando a oferta de vagas está baixa frente à
   * força de trabalho, empreendedores/investidores abrem empresas que contratam.
   * É um mecanismo de mercado (não governamental) e tem custo: consome demanda.
   */
  private replenishBusinesses(tick: number): void {
    const active = this.companies.filter((c) => !c.bankrupt);
    const openings = active.reduce((s, c) => s + c.openings.reduce((a, b) => a + b, 0), 0);
    // alvo: ~1 empresa ativa para cada 20 habitantes
    const targetCompanies = Math.ceil(this.world.aliveCount / 20);
    const deficit = targetCompanies - active.length;
    if (deficit <= 0 && openings > this.world.aliveCount * 0.02) return;
    // abre algumas por mês (entrada gradual), proporcional ao déficit
    const toOpen = Math.min(40, Math.max(2, Math.ceil(deficit * 0.15)));
    this.onReplenish?.(toOpen, tick);
  }

  /** Fábrica de empresas nova fornecida pela simulação (tem acesso ao mapa). */
  onReplenish: ((count: number, tick: number) => void) | null = null;

  private bankrupt(company: Company, tick: number): void {
    const { hot, cold } = this.world;
    company.bankrupt = true;
    company.openings = company.openings.map(() => 0);
    this.bankruptciesTotal++;
    for (const emp of [...company.employees]) {
      if (hot.isOwner[emp] && hot.companyId[emp] === company.id) {
        hot.isOwner[emp] = 0;
        const c = cold[emp];
        if (c) remember(c, tick, 'faliu', `Sua empresa ${company.name} faliu`);
        hot.happiness[emp] = Math.max(0, hot.happiness[emp] - 25);
      }
      this.careers.fire(emp, tick, 'falência');
    }
    company.employees.clear();
    this.distress.delete(company.id);
    this.feed({ tick, kind: 'economia', text: `A empresa ${company.name} faliu 📉` });
  }

  /** Estatísticas auxiliares. */
  stats() {
    let active = 0;
    let openings = 0;
    for (const c of this.companies) {
      if (!c.bankrupt) {
        active++;
        openings += totalOpenings(c);
      }
    }
    return {
      activeCompanies: active,
      openings,
      bankrupt: this.bankruptciesTotal,
      inflation: this.inflationMonthly * 100,
      gdp: this.gdpThisMonth,
    };
  }
}
