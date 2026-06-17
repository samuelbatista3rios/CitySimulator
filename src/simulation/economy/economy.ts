import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem, Sector } from '../types';
import { remember } from '../agents/memory';
import { sectorSkill, totalOpenings, type Company } from './companies';
import type { CareerSystem } from './careers';

/** Valor numérico da escolaridade (capital humano) para a produtividade. */
const EDU_VALUE: Record<string, number> = { fundamental: 25, medio: 50, superior: 80, pos: 100 };

/**
 * Peso de cada setor na DEMANDA BASE (derivada da renda agregada). Garante que
 * setores menos "de balcão" (tecnologia, indústria, serviços) também tenham
 * mercado — representa demanda intermediária/B2B e do próprio Estado. O consumo
 * direto dos cidadãos entra por cima disto, deslocando o mix p/ setores de varejo.
 */
const SECTOR_BASE_WEIGHT: Record<Sector, number> = {
  tecnologia: 0.18, comercio: 0.22, industria: 0.20, servicos: 0.20, cultura: 0.10, esporte: 0.10,
};

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
  taxRate: number = CONFIG.TAX_RATE; // "nível" do imposto de renda (dirige o topo marginal)
  minimumWage: number = CONFIG.BASE_SALARY * 0.7;
  /** alíquota do imposto corporativo sobre o lucro das empresas (definida por lei) */
  corporateTaxRate = 0;
  /** IPTU mensal: fração do valor do imóvel cobrada de proprietários (definida por lei) */
  propertyTaxMonthly = 0;
  /** folga de mão de obra (taxa de desemprego 0..1) — gate do crescimento de vagas */
  laborSlack = 0.1;

  // Arrecadação do mês, por tributo (para a UI / transparência fiscal).
  incomeTaxThisMonth = 0;
  corpTaxThisMonth = 0;
  propertyTaxThisMonth = 0;
  // Banco para contas itemizadas + parcelas; callback de impostos p/ o governo.
  bank: import('./bank').Bank | null = null;
  onTaxesCollected: ((amount: number) => void) | null = null;
  // Subsídio público a empresas (anti-falência) — definido pelo governo eleito.
  subsidyPool = 0;
  onSubsidySpent: ((amount: number) => void) | null = null;
  /** fator de aluguel por residência (localização × índice imobiliário) */
  rentFactor: (homeId: number) => number = () => 1;

  private distress = new Map<number, number>(); // empresa -> meses no vermelho

  /** Demanda de consumo acumulada no mês por setor (gasto real dos cidadãos). */
  private sectorDemand: Record<Sector, number> = {
    tecnologia: 0, comercio: 0, industria: 0, servicos: 0, cultura: 0, esporte: 0,
  };
  /** Consumo total das famílias no mês (varejo/lazer) — para a UI/PIB. */
  consumerSpendThisMonth = 0;
  /** Dividendos pagos aos donos no mês (para a UI). */
  dividendsThisMonth = 0;
  /** Investimento total em P&D no mês (para a UI). */
  rndSpendThisMonth = 0;
  /** Eficiência da conversão de P&D em tecnologia (sobe em avanços tecnológicos). */
  rndMultiplier = 1;

  /**
   * Registra um gasto de consumo de um cidadão num setor. O dinheiro NÃO some:
   * vira demanda que, no fechamento do mês, é distribuída como RECEITA entre as
   * empresas daquele setor conforme a competitividade de cada uma.
   */
  spend(sector: Sector, amount: number): void {
    if (amount <= 0) return;
    this.sectorDemand[sector] += amount;
  }

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

  /**
   * Imposto de RENDA PROGRESSIVO sobre o salário bruto mensal. Em vez de uma
   * alíquota única, há faixas: as primeiras são isentas/leves e as mais altas
   * pagam o topo marginal. `taxRate` (definido pela lei vigente) dirige o topo —
   * plataformas liberais cobram menos, progressistas mais. Resultado: quem ganha
   * pouco quase nada paga; quem ganha muito paga proporcionalmente mais (e isso
   * também segura a concentração extrema de renda).
   */
  incomeTaxFor(gross: number): number {
    if (gross <= 0) return 0;
    const B = CONFIG.BASE_SALARY * this.wageLevel; // salário de referência atual
    const top = this.taxRate * 2; // topo marginal (Liberal ~16%, Centro ~28%, Progressista ~40%)
    // limite superior de cada faixa (em múltiplos de B) e fração do topo aplicada
    const bands: [number, number][] = [
      [1, 0],     // isento até 1×B
      [3, 0.45],  // 1–3×B
      [6, 0.65],  // 3–6×B
      [12, 0.85], // 6–12×B
      [Infinity, 1], // acima de 12×B paga o topo
    ];
    let tax = 0, prev = 0;
    for (const [mult, frac] of bands) {
      const cap = mult === Infinity ? gross : Math.min(gross, mult * B);
      if (cap > prev) tax += (cap - prev) * top * frac;
      prev = cap;
      if (cap >= gross) break;
    }
    return tax;
  }

  monthlyCycle(tick: number): void {
    const { hot, cold } = this.world;
    this.gdpLastMonth = this.gdpThisMonth;
    let wagesPaid = 0;
    let consumption = 0;
    this.incomeTaxThisMonth = 0;
    this.corpTaxThisMonth = 0;
    this.propertyTaxThisMonth = 0;

    this.dividendsThisMonth = 0;
    this.rndSpendThisMonth = 0;

    // ===== PASSO 1: folha de pagamento + competitividade de cada empresa =====
    // Produtividade vem da QUALIDADE DA EQUIPE (habilidade no setor + escolaridade
    // + felicidade), não de um número aleatório. Empresa com gente boa e feliz
    // performa melhor e captura mais mercado.
    const active: { c: Company; payroll: number; headcount: number; fixedCost: number; comp: number }[] = [];
    const sectorComp: Record<Sector, number> = { tecnologia: 0, comercio: 0, industria: 0, servicos: 0, cultura: 0, esporte: 0 };
    let totalPayroll = 0, totalFixed = 0;

    for (const company of this.companies) {
      if (company.bankrupt) continue;
      let payroll = 0;
      let teamQuality = 0, teamN = 0;
      const skillName = sectorSkill(company.sector);
      for (const emp of company.employees) {
        if (!hot.alive[emp]) { company.employees.delete(emp); continue; }
        if (hot.inJail[emp]) continue; // preso não recebe
        const gross = Math.max(
          company.positions[Math.max(0, hot.jobLevel[emp])].salary * this.wageLevel,
          this.minimumWage,
        );
        const tax = this.incomeTaxFor(gross); // IR PROGRESSIVO por faixas
        hot.money[emp] += gross - tax;
        this.taxPool += tax;
        this.onTaxesCollected?.(tax);
        this.incomeTaxThisMonth += tax;
        payroll += gross;
        const ce = cold[emp];
        if (ce) {
          teamQuality += ce.skills[skillName] * 0.5 + (EDU_VALUE[ce.education] ?? 40) * 0.3 + hot.happiness[emp] * 0.2;
          // LIDERANÇA dos cargos de gestão eleva (ou derruba) a produtividade da
          // equipe: um gestor alinhado à função multiplica o time; mal alinhado,
          // emperra. É o elo entre "habilidades de destaque" e desempenho real.
          const pos = company.positions[Math.max(0, hot.jobLevel[emp])];
          if (pos.secondarySkill) teamQuality += (ce.skills[pos.secondarySkill] - 45) * 0.12;
          teamN++;
        }
      }
      const headcount = company.employees.size;
      const fixedCost = headcount * 200 * this.priceLevel;
      const avgQ = teamN > 0 ? teamQuality / teamN : 45;
      // produtividade EFETIVA = qualidade da equipe × nível tecnológico (P&D)
      const productivity = (0.6 + (avgQ / 100) * 0.7) * company.techLevel; // 0,6..~2,1
      company.lastProductivity = productivity;
      // PREÇO entra no peso de mercado: clientes preferem barato (apelo) mas preço
      // alto rende mais por venda — peso ∝ preço×(1,6−0,8·preço), ótimo perto de 1.
      const priceWeight = company.price * Math.max(0.15, 1.6 - 0.8 * company.price);
      const comp = headcount * productivity * priceWeight * this.rng.range(0.9, 1.1);
      sectorComp[company.sector] += comp;
      active.push({ c: company, payroll, headcount, fixedCost, comp });
      totalPayroll += payroll;
      totalFixed += fixedCost;
      wagesPaid += payroll;
    }

    // ===== DEMANDA por setor = consumo real dos cidadãos + demanda base =====
    // A demanda base (B2B/Estado) é calibrada p/ a demanda agregada ficar ~20%
    // acima dos custos das empresas (margem modesta no agregado). O consumo das
    // famílias desloca o mix para os setores de varejo/lazer onde gastaram.
    const consumerTotal = (Object.values(this.sectorDemand) as number[]).reduce((a, b) => a + b, 0);
    const targetTotal = (totalPayroll + totalFixed) * 1.2;
    const baseNeeded = Math.max(0, targetTotal - consumerTotal);
    const mktDemand: Record<Sector, number> = { tecnologia: 0, comercio: 0, industria: 0, servicos: 0, cultura: 0, esporte: 0 };
    for (const s of Object.keys(mktDemand) as Sector[]) {
      mktDemand[s] = (this.sectorDemand[s] + baseNeeded * SECTOR_BASE_WEIGHT[s]) * this.demandMultiplier;
    }

    // ===== PASSO 2: receita por MARKET SHARE + capital, dividendos, falência =====
    for (const a of active) {
      const company = a.c;
      const share = sectorComp[company.sector] > 0 ? a.comp / sectorComp[company.sector] : 0;
      const revenue = mktDemand[company.sector] * share; // fatia do mercado do setor
      company.revenueThisMonth = revenue;
      const profit = revenue - a.payroll - a.fixedCost;
      let corpTax = 0;
      if (profit > 0 && this.corporateTaxRate > 0) {
        corpTax = profit * this.corporateTaxRate;
        this.taxPool += corpTax;
        this.onTaxesCollected?.(corpTax);
        this.corpTaxThisMonth += corpTax;
      }
      const netProfit = profit - corpTax;
      company.capital += netProfit;

      // DIVIDENDOS: empresa lucrativa distribui parte do lucro ao cidadão-dono.
      // É a renda realista do empreendedor — limitada pela performance da empresa.
      company.dividendsThisMonth = 0;
      if (netProfit > 0 && company.ownerId >= 0 && hot.alive[company.ownerId] && company.capital > 0) {
        const dividend = Math.min(netProfit * 0.35, company.capital * 0.15);
        if (dividend > 0) {
          company.capital -= dividend;
          hot.money[company.ownerId] += dividend;
          company.dividendsThisMonth = dividend;
          this.dividendsThisMonth += dividend;
        }
      }

      // INOVAÇÃO / P&D: empresa lucrativa reinveste parte do lucro em pesquisa.
      // O estoque de P&D eleva o nível tecnológico (produtividade) ao longo do
      // tempo — e rende mais rápido durante avanços tecnológicos (rndMultiplier).
      if (netProfit > 0 && company.capital > 0 && a.headcount > 0) {
        const rndSpend = Math.min(netProfit * 0.2, company.capital * 0.05);
        if (rndSpend > 0) {
          company.capital -= rndSpend;
          company.rnd += rndSpend;
          this.rndSpendThisMonth += rndSpend;
        }
      }
      // converte estoque de P&D em tecnologia (com teto e leve depreciação)
      const rndPerHead = company.rnd / Math.max(1, a.headcount) / (40_000 * this.priceLevel);
      const targetTech = 1 + Math.min(0.8, rndPerHead);
      company.techLevel += (targetTech - company.techLevel) * 0.08 * this.rndMultiplier;
      company.rnd *= 0.995; // conhecimento deprecia se não há reinvestimento

      // ESTRATÉGIA DE PREÇO (hill-climbing por lucro): se o lucro melhorou, mantém
      // a direção do último ajuste; se piorou, inverte. Emergem preços de mercado.
      if (profit < company.lastProfit) company.priceTrend = -company.priceTrend;
      company.price = Math.max(0.75, Math.min(1.35, company.price + company.priceTrend * 0.02));
      company.lastProfit = profit;

      // SUBSÍDIO PÚBLICO anti-falência (verba da plataforma eleita)
      if (company.capital < 0 && this.subsidyPool > 0 && a.headcount > 0) {
        const inject = Math.min(-company.capital + a.payroll * 0.2, this.subsidyPool);
        company.capital += inject;
        this.subsidyPool -= inject;
        this.onSubsidySpent?.(inject);
      }

      // saúde financeira: distress → demissão em massa → falência; ou crescimento
      if (company.capital < 0) {
        const months = (this.distress.get(company.id) ?? 0) + 1;
        this.distress.set(company.id, months);
        if (months === 1 && a.headcount > 2) {
          const toFire = Math.ceil(a.headcount * 0.3);
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
        // Crescimento: lucro alto abre vaga — MAS só quando há DESEMPREGADOS para
        // preencher (folga de mão de obra) e o quadro ainda não está cheio de
        // vagas. Assim o mercado se autorregula: pleno emprego → para de abrir
        // vagas vazias; com desemprego → contrata. Evita os dois extremos.
        if (
          company.capital > 100_000 * this.priceLevel &&
          this.laborSlack > 0.05 &&
          totalOpenings(company) < Math.max(1, a.headcount * 0.3) &&
          this.rng.chance(0.25)
        ) {
          const level = this.rng.chance(0.7) ? 0 : 1;
          company.openings[level]++;
        }
      }
    }

    // fecha o mês de consumo: guarda o total e zera os pools de demanda
    this.consumerSpendThisMonth = consumerTotal;
    for (const s of Object.keys(this.sectorDemand) as Sector[]) this.sectorDemand[s] = 0;

    // 5) Custo de vida mensal: aluguel + contas itemizadas (água/luz/internet)
    //    e parcelas de financiamento — estas via Banco.
    const baseRent = 600 * this.priceLevel;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const ageYears = hot.ageDays[i] / 360;
      if (ageYears < CONFIG.ADULT_AGE) continue;
      // aluguel varia com a localização e o índice do mercado imobiliário
      const rentMul = hot.homeId[i] !== -1 ? this.rentFactor(hot.homeId[i]) : 1;
      const rent = hot.ownsHouse[i] || hot.inJail[i] ? 0 : baseRent * rentMul;
      hot.money[i] -= rent;
      consumption += rent;
      // IPTU: proprietários pagam imposto sobre o valor do imóvel (vai ao caixa)
      if (hot.ownsHouse[i] && this.propertyTaxMonthly > 0 && !hot.inJail[i]) {
        const iptu = CONFIG.HOUSE_PRICE * this.priceLevel * this.propertyTaxMonthly;
        hot.money[i] -= iptu;
        consumption += iptu;
        this.taxPool += iptu;
        this.onTaxesCollected?.(iptu);
        this.propertyTaxThisMonth += iptu;
      }
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
      // CONSUMO DE LUXO (realismo de riqueza): patrimônio muito acima do custo de
      // vida não cresce indefinidamente — os mais ricos gastam parte do excedente
      // em bens e serviços de alto padrão, que viram RECEITA das empresas. Isso
      // drena a acumulação explosiva (evita fortunas irreais de dezenas de milhões)
      // sem confiscar: o dinheiro circula de volta para a economia.
      const luxThreshold = 150_000 * this.priceLevel;
      if (hot.money[i] > luxThreshold && !hot.inJail[i]) {
        // quanto maior a fortuna, maior a fração consumida (progressivo, teto 12%)
        const excess = hot.money[i] - luxThreshold;
        const rate = Math.min(0.12, 0.05 + excess / (4_000_000 * this.priceLevel));
        const lux = excess * rate;
        hot.money[i] -= lux;
        consumption += lux;
        this.spend('comercio', lux * 0.35);
        this.spend('servicos', lux * 0.3);
        this.spend('cultura', lux * 0.2);
        this.spend('esporte', lux * 0.15);
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

    this.gdpThisMonth = wagesPaid + consumption + this.consumerSpendThisMonth;
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
    // alvo: ~1 empresa ativa para cada 13 habitantes (acompanha a força de trabalho)
    const targetCompanies = Math.ceil(this.world.aliveCount / 13);
    const deficit = targetCompanies - active.length;
    if (deficit <= 0 && openings > this.world.aliveCount * 0.02) return;
    // abre algumas por mês (entrada gradual), proporcional ao déficit
    const toOpen = Math.min(40, Math.max(2, Math.ceil(deficit * 0.15)));
    this.onReplenish?.(toOpen, tick);
  }

  /** Fábrica de empresas nova fornecida pela simulação (tem acesso ao mapa). */
  onReplenish: ((count: number, tick: number) => void) | null = null;

  /** Falência forçada por evento (onda de falências). Público. */
  forceBankrupt(company: Company, tick: number): void {
    if (!company.bankrupt) this.bankrupt(company, tick);
  }

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
      consumoFamilias: this.consumerSpendThisMonth,
      dividendos: this.dividendsThisMonth,
      investimentoPED: this.rndSpendThisMonth,
    };
  }
}
