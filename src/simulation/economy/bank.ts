import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem, LoanView } from '../types';
import { remember } from '../agents/memory';

export interface Loan {
  kind: 'hipoteca' | 'financiamento_carro';
  balance: number; // saldo devedor
  monthlyPayment: number;
  monthlyRate: number; // juros ao mês
  assetResidenceId: number; // para execução de garantia (hipoteca)
  missed: number;
}

/**
 * Banco: crédito, financiamento (hipoteca/carro), contas itemizadas
 * (água/luz/internet) e score de crédito. Quem não paga fica inadimplente,
 * perde pontos de crédito e pode ter o bem retomado (execução da garantia).
 */
export class Bank {
  private loans = new Map<number, Loan[]>();
  /** callback opcional: residência retomada volta ao mercado (ownerId = -1) */
  onForeclose?: (residenceId: number) => void;

  constructor(
    private world: EcsWorld,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {}

  loansOf(id: number): Loan[] {
    return this.loans.get(id) ?? [];
  }

  loanViews(id: number): LoanView[] {
    return this.loansOf(id).map((l) => ({
      kind: l.kind === 'hipoteca' ? 'Hipoteca' : 'Financiamento de carro',
      saldo: Math.round(l.balance),
      parcela: Math.round(l.monthlyPayment),
      jurosAno: Math.round((Math.pow(1 + l.monthlyRate, 12) - 1) * 1000) / 10,
    }));
  }

  /** Score 300..850 → taxa de juros mensal. Bom crédito paga menos juros. */
  private rateFor(id: number, base: number): number {
    const score = this.world.hot.creditScore[id];
    const risk = (700 - Math.max(300, Math.min(850, score))) / 400; // -0.375..1
    return Math.max(0.004, base * (1 + risk));
  }

  /** Pode tomar empréstimo? Precisa de renda (emprego) e crédito mínimo. */
  canBorrow(id: number): boolean {
    const { hot } = this.world;
    if (hot.inJail[id]) return false;
    const employed = hot.companyId[id] !== -1 || hot.isOwner[id] === 1;
    return employed && hot.creditScore[id] >= 480 && this.loansOf(id).length < 2;
  }

  /**
   * Financia a casa: entrada de 20%, restante em 240 parcelas (20 anos).
   * Retorna true se o financiamento foi aprovado e a entrada debitada.
   */
  financeHouse(id: number, price: number, residenceId: number, tick: number): boolean {
    const { hot, cold } = this.world;
    if (!this.canBorrow(id)) return false;
    const down = price * 0.2;
    if (hot.money[id] < down) return false;
    const principal = price - down;
    const rate = this.rateFor(id, 0.006); // ~7,4% a.a. base
    const n = 240;
    const payment = (principal * rate) / (1 - Math.pow(1 + rate, -n));
    // parcela não pode comprometer mais que ~40% de uma renda plausível
    if (payment > Math.max(hot.money[id] * 0.02, 1500)) return false;
    hot.money[id] -= down;
    this.addLoan(id, { kind: 'hipoteca', balance: principal, monthlyPayment: payment, monthlyRate: rate, assetResidenceId: residenceId, missed: 0 });
    const c = cold[id];
    if (c) remember(c, tick, 'compra_casa', `Financiou a casa própria (entrada de $${Math.round(down).toLocaleString('pt-BR')})`);
    return true;
  }

  /** Financia o carro: entrada de 20%, 48 parcelas. */
  financeCar(id: number, price: number, tick: number): boolean {
    const { hot, cold } = this.world;
    if (!this.canBorrow(id)) return false;
    const down = price * 0.2;
    if (hot.money[id] < down) return false;
    const principal = price - down;
    const rate = this.rateFor(id, 0.012); // carro tem juro maior
    const n = 48;
    const payment = (principal * rate) / (1 - Math.pow(1 + rate, -n));
    hot.money[id] -= down;
    this.addLoan(id, { kind: 'financiamento_carro', balance: principal, monthlyPayment: payment, monthlyRate: rate, assetResidenceId: -1, missed: 0 });
    const c = cold[id];
    if (c) remember(c, tick, 'compra_carro', 'Financiou um carro');
    return true;
  }

  private addLoan(id: number, loan: Loan): void {
    const arr = this.loans.get(id) ?? [];
    arr.push(loan);
    this.loans.set(id, arr);
  }

  /**
   * Cobrança mensal por cidadão: contas de consumo + parcelas de empréstimos.
   * Chamado de dentro do loop da economia (evita uma segunda varredura).
   * Retorna o total cobrado (entra no consumo agregado).
   */
  chargeMonthly(id: number, priceLevel: number, tick: number): number {
    const { hot, cold } = this.world;
    // contas itemizadas
    const agua = 35 * priceLevel;
    const luz = 70 * priceLevel * (hot.ownsHouse[id] ? 1.3 : 1);
    const internet = 55 * priceLevel;
    let total = agua + luz + internet;

    // parcelas
    const loans = this.loans.get(id);
    let allPaid = true;
    if (loans && loans.length) {
      for (const loan of loans) {
        total += loan.monthlyPayment;
      }
    }

    if (hot.money[id] >= total) {
      hot.money[id] -= total;
      // amortiza empréstimos
      if (loans) {
        for (const loan of loans) {
          const interest = loan.balance * loan.monthlyRate;
          loan.balance = Math.max(0, loan.balance + interest - loan.monthlyPayment);
          loan.missed = 0;
        }
      }
      // bom pagador sobe score; quita empréstimos zerados
      hot.creditScore[id] = Math.min(850, hot.creditScore[id] + 3);
      hot.unpaidMonths[id] = 0;
      if (loans) this.loans.set(id, loans.filter((l) => l.balance > 1));
    } else {
      // inadimplência
      allPaid = false;
      hot.money[id] -= total * 0.4; // paga o que dá
      hot.unpaidMonths[id] = Math.min(255, hot.unpaidMonths[id] + 1);
      hot.creditScore[id] = Math.max(300, hot.creditScore[id] - 25);
      hot.safety[id] = Math.max(0, hot.safety[id] - 8);
      hot.happiness[id] = Math.max(0, hot.happiness[id] - 4);
      if (loans) {
        for (const loan of loans) {
          loan.missed++;
          loan.balance += loan.balance * loan.monthlyRate; // juro corre
          // execução da garantia após 3 parcelas atrasadas
          if (loan.missed >= 3) this.foreclose(id, loan, tick);
        }
        this.loans.set(id, loans.filter((l) => l.missed < 3));
      }
    }
    return Math.max(0, total);
  }

  /** Retomada do bem por inadimplência. */
  private foreclose(id: number, loan: Loan, tick: number): void {
    const { hot, cold } = this.world;
    const c = cold[id];
    if (loan.kind === 'hipoteca') {
      hot.ownsHouse[id] = 0;
      this.onForeclose?.(loan.assetResidenceId); // devolve a residência ao mercado
      hot.creditScore[id] = Math.max(300, hot.creditScore[id] - 60);
      if (c) {
        remember(c, tick, 'faliu', 'Perdeu a casa por inadimplência (execução da hipoteca)');
        this.feed({ tick, kind: 'economia', text: `${c.name} perdeu a casa por inadimplência 🏚️` });
        hot.happiness[id] = Math.max(0, hot.happiness[id] - 20);
      }
    } else {
      hot.ownsCar[id] = 0;
      hot.creditScore[id] = Math.max(300, hot.creditScore[id] - 40);
      if (c) remember(c, tick, 'faliu', 'Teve o carro retomado pelo banco');
    }
  }

  onDeath(id: number): void {
    this.loans.delete(id);
  }

  stats(): { inadimplentes: number; scoreMedio: number; comEmprestimo: number } {
    const { hot } = this.world;
    let inad = 0, scoreSum = 0, alive = 0, withLoan = 0;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      alive++;
      scoreSum += hot.creditScore[i];
      if (hot.unpaidMonths[i] > 0) inad++;
      if (this.loans.has(i)) withLoan++;
    }
    return {
      inadimplentes: alive ? (inad / alive) * 100 : 0,
      scoreMedio: alive ? scoreSum / alive : 600,
      comEmprestimo: withLoan,
    };
  }

  /** Serialização. */
  dump(): [number, Loan[]][] {
    return [...this.loans.entries()];
  }
  restore(entries: [number, Loan[]][]): void {
    this.loans = new Map(entries);
  }
}
