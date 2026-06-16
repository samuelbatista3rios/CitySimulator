import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { CityMap } from '../world/cityTypes';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/**
 * MERCADO IMOBILIÁRIO dinâmico.
 *
 * O preço dos imóveis deixa de ser fixo: um ÍNDICE city-wide se move conforme a
 * pressão de oferta×demanda (quantos querem comprar vs. unidades disponíveis) e a
 * RIQUEZA dos proprietários (gentrificação — bairros ricos valorizam). O índice é
 * uma valorização REAL, por cima da inflação geral (priceLevel). Cada imóvel ainda
 * tem seu valor de LOCALIZAÇÃO (centro vale mais que periferia).
 */
export class HousingMarket {
  /** índice de preços reais (1 = base); multiplica o valor de todos os imóveis */
  priceIndex = 1;
  /** preço médio efetivo do imóvel no último mês (para a UI) */
  avgPrice: number = CONFIG.HOUSE_PRICE;
  /** taxa de proprietários (0..1) — quantos adultos têm casa própria */
  ownershipRate = 0;

  constructor(
    private world: EcsWorld,
    private city: CityMap,
  ) {}

  /** Valor de mercado atual de uma residência (sem a inflação geral). */
  valueOf(residenceId: number): number {
    const r = this.city.residences[residenceId];
    if (!r) return CONFIG.HOUSE_PRICE;
    return r.price * r.locationValue * this.priceIndex;
  }

  /** Multiplicador de aluguel de uma residência (localização × índice). */
  rentFactor(residenceId: number): number {
    const r = this.city.residences[residenceId];
    return r ? r.locationValue * this.priceIndex : 1;
  }

  /** Atualização mensal do índice a partir de oferta, demanda e riqueza. */
  update(priceLevel: number): void {
    const { hot } = this.world;
    let aspiring = 0;     // adultos sem casa querendo comprar (demanda)
    let owners = 0, adults = 0;
    let ownerWealth = 0;
    const downpayment = CONFIG.HOUSE_PRICE * 0.2 * priceLevel * this.priceIndex;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;
      adults++;
      if (hot.ownsHouse[i]) {
        owners++;
        ownerWealth += hot.money[i];
      } else if (hot.money[i] > downpayment) {
        aspiring++; // tem entrada e ainda não comprou → comprador em potencial
      }
    }
    // unidades disponíveis para compra (sem dono-cidadão)
    let vacant = 0;
    for (const r of this.city.residences) if (r.ownerId === -1) vacant++;

    this.ownershipRate = adults > 0 ? owners / adults : 0;
    // pressão de demanda: compradores por unidade disponível (normalizada)
    const pressure = aspiring / Math.max(1, vacant);
    // gentrificação: riqueza média dos proprietários acima de um patamar valoriza
    const avgOwnerWealth = owners > 0 ? ownerWealth / owners : 0;
    const wealthPush = Math.min(0.01, Math.max(-0.005, (avgOwnerWealth / (60_000 * priceLevel) - 1) * 0.004));
    // variação mensal do índice (banda estreita → sem bolhas explosivas)
    const delta = Math.max(-0.02, Math.min(0.03, (pressure - 0.6) * 0.02 + wealthPush));
    this.priceIndex = Math.max(0.4, Math.min(6, this.priceIndex * (1 + delta)));

    // preço médio efetivo (amostra das residências)
    const sample = this.city.residences;
    let sum = 0;
    for (const r of sample) sum += r.price * r.locationValue * this.priceIndex;
    this.avgPrice = sample.length > 0 ? (sum / sample.length) * priceLevel : CONFIG.HOUSE_PRICE;
  }

  private premiumIds: number[] | null = null;
  private premium(): number[] {
    if (!this.premiumIds) {
      this.premiumIds = this.city.residences.filter((r) => r.premium).map((r) => r.id);
    }
    return this.premiumIds;
  }

  /** Move um cidadão para a residência `res` (atualiza ocupantes e posse). */
  private moveOne(id: number, resId: number, owns = false): void {
    const { hot } = this.world;
    const old = hot.homeId[id];
    if (old === resId) { if (owns) hot.ownsHouse[id] = 1; return; }
    if (old !== -1) {
      const o = this.city.residences[old];
      if (o) {
        const k = o.occupants.indexOf(id);
        if (k >= 0) o.occupants.splice(k, 1);
        if (o.ownerId === id) o.ownerId = -1;
      }
    }
    hot.homeId[id] = resId;
    this.city.residences[resId].occupants.push(id);
    if (owns) hot.ownsHouse[id] = 1;
  }

  /** Muda a FAMÍLIA (chefe + cônjuge + filhos) para a residência de luxo. */
  private moveHousehold(head: number, resId: number): void {
    const { hot, cold } = this.world;
    this.moveOne(head, resId, true);
    this.city.residences[resId].ownerId = head;
    const p = hot.partnerId[head];
    if (p !== -1 && hot.alive[p]) this.moveOne(p, resId, true);
    const c = cold[head];
    if (c) {
      for (const ch of c.children) {
        if (hot.alive[ch] && hot.ageDays[ch] / DAYS_PER_YEAR < 25) this.moveOne(ch, resId);
      }
    }
  }

  /**
   * Ordena a RIQUEZA no bairro nobre: os cidadãos mais ricos (e que podem pagar)
   * ocupam as residências de luxo vagas. Roda na inicialização (povoa o bairro) e
   * mensalmente (mantém o bairro nobre habitado pela elite conforme a riqueza muda).
   */
  sortWealthIntoNoble(priceLevel: number, limit = 25): void {
    const { hot } = this.world;
    const OCC = 3; // até uma família por mansão
    const vacancies = this.premium()
      .map((id) => this.city.residences[id])
      .filter((r) => r && r.occupants.length < OCC)
      .sort((a, b) => this.valueOf(a.id) - this.valueOf(b.id)); // mais baratas primeiro
    if (vacancies.length === 0) return;

    // candidatos: só os bem ricos (lista curta) que ainda não moram no bairro nobre
    const threshold = CONFIG.HOUSE_PRICE * 2 * priceLevel;
    const cand: number[] = [];
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      if (hot.ageDays[i] / DAYS_PER_YEAR < CONFIG.ADULT_AGE) continue;
      if (hot.money[i] < threshold) continue;
      const home = hot.homeId[i];
      if (home !== -1 && this.city.residences[home]?.premium) continue; // já é da elite
      cand.push(i);
    }
    cand.sort((a, b) => hot.money[b] - hot.money[a]); // mais ricos primeiro

    let moved = 0, ci = 0;
    for (const res of vacancies) {
      if (moved >= limit) break;
      while (res.occupants.length < OCC && ci < cand.length) {
        const id = cand[ci++];
        if (hot.money[id] < this.valueOf(res.id) * priceLevel * 0.35) continue; // entrada
        this.moveHousehold(id, res.id);
        moved++;
        break; // uma família por mansão por ciclo
      }
    }
  }

  /**
   * Povoa o bairro nobre na INICIALIZAÇÃO com as famílias mais ricas da cidade
   * ("old money"). Como a riqueza inicial é baixa, concede a essas famílias um
   * patrimônio compatível com o imóvel de luxo — elas são a elite estabelecida.
   */
  seedNoble(priceLevel: number): void {
    const { hot } = this.world;
    const OCC = 3;
    const cand: number[] = [];
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      if (hot.ageDays[i] / DAYS_PER_YEAR < CONFIG.ADULT_AGE) continue;
      cand.push(i);
    }
    cand.sort((a, b) => hot.money[b] - hot.money[a]); // mais ricos primeiro
    let ci = 0;
    for (const id of this.premium()) {
      const res = this.city.residences[id];
      if (!res || res.occupants.length >= OCC) continue;
      if (ci >= cand.length) break;
      const head = cand[ci++];
      // old money: garante patrimônio à altura do imóvel
      hot.money[head] = Math.max(hot.money[head], this.valueOf(res.id) * priceLevel * 0.6);
      this.moveHousehold(head, res.id);
    }
  }

  dump() {
    return { priceIndex: this.priceIndex };
  }
  restore(d: { priceIndex?: number } | undefined): void {
    if (d?.priceIndex) this.priceIndex = d.priceIndex;
  }
}
