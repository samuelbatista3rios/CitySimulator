import { CONFIG, TICKS_PER_MONTH } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { CityMap } from '../world/cityTypes';
import type { FeedItem, InstitutionMarker } from '../types';
import { remember } from '../agents/memory';
import type { Government } from '../government/government';
import type { CareerSystem } from '../economy/careers';
import type { EconomySystem } from '../economy/economy';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/** Tipos de crime, do menos ao mais grave (afeta pena, captura e dano à vítima). */
type CrimeKind = 'furto' | 'roubo' | 'fraude' | 'vandalismo';

function violentLabel(kind: CrimeKind): string {
  return kind === 'roubo' ? 'Cometeu um assalto' : 'Cometeu um furto';
}

/**
 * Instituições públicas e segurança:
 *  - HOSPITAIS: tratam cidadãos doentes (saúde baixa); capacidade × verba de saúde.
 *  - ESCOLAS: aceleram a escolaridade dos jovens; eficácia × verba de educação.
 *  - POLÍCIA/CRIME: cidadãos em risco (infelizes, pobres, desempregados, baixa
 *    amabilidade) podem cometer crimes contra vítimas; a polícia prende conforme
 *    a verba de segurança; presos vão para a cadeia por alguns meses.
 *
 * A criminalidade deixa de ser só um índice — vira eventos reais com autores,
 * vítimas, prisões e reincidência.
 */
export class InstitutionSystem {
  hospitals: InstitutionMarker[] = [];
  schools: InstitutionMarker[] = [];
  police: InstitutionMarker[] = [];
  cityHall: InstitutionMarker | null = null;

  crimesThisYear = 0;
  arrestsThisYear = 0;
  jailedCount = 0;

  constructor(
    private world: EcsWorld,
    private city: CityMap,
    private careers: CareerSystem,
    private economy: EconomySystem,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {
    this.designate();
  }

  /** Escolhe prédios para sediar instituições (1 por ~N habitantes). */
  private designate(): void {
    const centro = this.city.byZone.get('centro') ?? [];
    const comercial = this.city.byZone.get('comercial') ?? [];
    const pool = [...centro, ...comercial];
    const shuffled = [...pool].sort(() => this.rng.next() - 0.5);
    let idx = 0;
    const take = (n: number, into: InstitutionMarker[], kind: InstitutionMarker['kind']) => {
      for (let k = 0; k < n && idx < shuffled.length; k++, idx++) {
        into.push({ kind, x: shuffled[idx].x, z: shuffled[idx].z });
      }
    };
    // dimensiona para a população inicial (~10k): escalável com MAX_CITIZENS
    take(8, this.hospitals, 'hospital');
    take(14, this.schools, 'escola');
    take(10, this.police, 'delegacia');
    if (shuffled[idx]) this.cityHall = { kind: 'prefeitura', x: shuffled[idx].x, z: shuffled[idx].z };
  }

  markers(): InstitutionMarker[] {
    return [
      ...this.hospitals,
      ...this.schools,
      ...this.police,
      ...(this.cityHall ? [this.cityHall] : []),
    ];
  }

  monthlyCycle(tick: number, gov: Government): void {
    this.healthcare(gov);
    this.education(gov, tick);
    this.policing(tick, gov);
    this.releaseFromJail(tick);
  }

  /** Hospitais tratam os mais doentes, limitado por capacidade × verba. */
  private healthcare(gov: Government): void {
    const { hot } = this.world;
    const capacity = Math.round(this.hospitals.length * 60 * (0.4 + gov.healthFunding));
    // coleta doentes (saúde < 55) — amostra para não custar O(n log n) sempre
    const sick: number[] = [];
    for (let i = 0; i < this.world.entityRange; i++) {
      if (hot.alive[i] && !hot.inJail[i] && hot.health[i] < 55) sick.push(i);
      if (sick.length > capacity * 3) break;
    }
    sick.sort((a, b) => hot.health[a] - hot.health[b]); // mais graves primeiro
    const treated = Math.min(capacity, sick.length);
    for (let k = 0; k < treated; k++) {
      const id = sick[k];
      hot.health[id] = Math.min(100, hot.health[id] + 18 + gov.healthFunding * 12);
    }
  }

  /** Escolas aceleram a escolaridade dos jovens matriculados. */
  private education(gov: Government, tick: number): void {
    const { hot, cold } = this.world;
    const quality = 0.3 + gov.eduFunding; // 0.3..1.3
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < 6 || age > 24) continue;
      const c = cold[i];
      if (!c) continue;
      // matrícula impulsiona inteligência (capital humano) e chance de avançar etapa
      hot.intelligence[i] = Math.min(100, hot.intelligence[i] + 0.15 * quality);
      if (age >= 18 && c.education === 'medio') {
        // MOBILIDADE: filhos de famílias ricas avançam mais — mas ESCOLA BEM
        // FINANCIADA neutraliza a vantagem (igualdade de oportunidade). Em escola
        // sucateada, a origem familiar pesa muito; com boa verba, quase não pesa.
        let parentWealth = 0;
        for (const p of c.parents) parentWealth += hot.money[p] ?? 0;
        parentWealth = c.parents.length ? parentWealth / c.parents.length : 3000;
        const advantage = parentWealth > 20_000 ? 1.4 : parentWealth < 2000 ? 0.55 : 1;
        const factor = 1 + (advantage - 1) * (1 - Math.min(1, gov.eduFunding));
        if (this.rng.chance(0.03 * quality * factor)) {
          c.education = 'superior';
          remember(c, tick, 'formatura', 'Concluiu o ensino superior');
        }
      }
    }
  }

  /**
   * Crime e justiça: autores, vítimas, TIPOS de crime, REINCIDÊNCIA, JULGAMENTO
   * (condenação/absolvição) e o efeito da DESIGUALDADE. A pobreza relativa
   * (muita gente abaixo de ¼ da renda média) aquece o crime; reincidentes têm
   * maior propensão e penas mais longas; ricos sem escrúpulos cometem FRAUDE
   * (colarinho branco) contra o caixa público.
   */
  private policing(tick: number, gov: Government): void {
    const { hot, cold } = this.world;
    const range = this.world.entityRange;
    const catchBase = 0.2 + gov.policeFunding * 0.55; // eficiência policial

    // desigualdade: pobreza relativa à renda média eleva a criminalidade
    let adults = 0, wealthSum = 0;
    for (let i = 0; i < range; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      if (hot.ageDays[i] / DAYS_PER_YEAR < CONFIG.ADULT_AGE) continue;
      adults++; wealthSum += hot.money[i];
    }
    const meanWealth = wealthSum / Math.max(1, adults);
    let poor = 0;
    for (let i = 0; i < range; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      if (hot.ageDays[i] / DAYS_PER_YEAR < CONFIG.ADULT_AGE) continue;
      if (hot.money[i] < meanWealth * 0.25) poor++;
    }
    const inequalityMult = 1 + poor / Math.max(1, adults); // 1..2

    for (let i = 0; i < range; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const c = cold[i];
      if (!c) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;

      // Limiares de pobreza/riqueza acompanham a INFLAÇÃO (priceLevel) — senão,
      // após décadas, valores nominais fixos (R$400, R$50 mil) deixam de fazer
      // sentido e a calibração quebra (crime ia a 100 até em pleno boom).
      const pl = this.economy.priceLevel;
      const broke = hot.money[i] < 500 * pl ? 1 : hot.money[i] < 2000 * pl ? 0.5 : 0;
      const jobless = hot.companyId[i] === -1 && !hot.isOwner[i] && !hot.publicJob[i] ? 1 : 0;
      const unhappy = hot.happiness[i] < 22 ? 1 : 0; // só desespero, não tristeza leve
      const meanness = (100 - c.personality.amabilidade) / 100;
      const rich = hot.money[i] > 50_000 * pl ? 1 : 0;
      // a POBREZA REAL é o motor; infelicidade leve pesa pouco
      const factor = broke * 0.5 + jobless * 0.25 + unhappy * 0.1 + meanness * 0.15;
      let propensity = Math.max(0, factor - 0.34) * 0.025;
      // tentação de colarinho branco: rico, pouco escrupuloso, com caixa público gordo
      const fraudUrge = rich && meanness > 0.55 && gov.budget > 0 ? 0.015 * meanness : 0;
      propensity += fraudUrge;
      propensity *= inequalityMult;
      propensity *= 1 + Math.min(4, hot.criminalRecord[i]) * 0.25; // reincidência
      // teto: impede que desigualdade × reincidência se acumulem e estourem
      propensity = Math.min(propensity, 0.06);
      if (!this.rng.chance(propensity)) continue;

      // escolhe o TIPO de crime conforme o perfil
      const kind = this.chooseCrime(i, broke, rich, meanness, fraudUrge > 0);
      this.crimesThisYear++;
      this.commitCrime(i, kind, tick, gov);

      // PRISÃO requer flagrante/investigação + JULGAMENTO (condenação)
      const catchRate = catchBase * (kind === 'fraude' ? 0.5 : kind === 'vandalismo' ? 0.7 : 1);
      if (this.rng.chance(catchRate)) {
        const convictionOdds = 0.5 + gov.policeFunding * 0.3 + Math.min(4, hot.criminalRecord[i]) * 0.05;
        if (this.rng.chance(convictionOdds)) {
          this.arrest(i, tick, kind);
        } else if (this.rng.chance(0.03)) {
          this.feed({ tick, kind: 'social', text: `⚖️ ${c.name} foi absolvido(a) por falta de provas` });
        }
      }
    }
  }

  private chooseCrime(
    id: number, broke: number, rich: number, meanness: number, fraudPossible: boolean,
  ): CrimeKind {
    if (fraudPossible && this.rng.chance(0.6)) return 'fraude';
    if (broke >= 1 && this.rng.chance(0.45)) return 'roubo'; // desespero → violência
    if (meanness > 0.6 && rich === 0 && this.rng.chance(0.25)) return 'vandalismo';
    return 'furto';
  }

  /** Aplica os efeitos do crime conforme o tipo (loot, vítima, caixa público). */
  private commitCrime(id: number, kind: CrimeKind, tick: number, gov: Government): void {
    const { hot, cold } = this.world;
    const range = this.world.entityRange;
    const c = cold[id]!;
    if (kind === 'fraude') {
      // colarinho branco: desvia do caixa público (corrupção)
      const loot = Math.min(gov.budget * 0.02, 5000 * this.economy.priceLevel + hot.money[id] * 0.05);
      if (loot > 0) { gov.budget -= loot; hot.money[id] += loot; }
      remember(c, tick, 'conflito', 'Cometeu fraude contra o erário');
      if (this.rng.chance(0.05)) this.feed({ tick, kind: 'social', text: `💼 Esquema de corrupção desviou recursos públicos` });
      return;
    }
    if (kind === 'vandalismo') {
      // sem vítima direta: abala a sensação de segurança da vizinhança
      for (let k = 0; k < 4; k++) {
        const v = this.rng.int(0, range - 1);
        if (hot.alive[v]) hot.safety[v] = Math.max(0, hot.safety[v] - 8);
      }
      remember(c, tick, 'conflito', 'Cometeu vandalismo');
      return;
    }
    // furto / roubo: contra uma vítima
    const victim = this.rng.int(0, range - 1);
    if (hot.alive[victim] && victim !== id && hot.money[victim] > 100 * this.economy.priceLevel) {
      const violent = kind === 'roubo';
      const loot = Math.min(hot.money[victim] * (violent ? 0.5 : 0.3), (violent ? 8000 : 4000) * this.economy.priceLevel);
      hot.money[victim] -= loot;
      hot.money[id] += loot;
      hot.safety[victim] = Math.max(0, hot.safety[victim] - (violent ? 30 : 20));
      hot.happiness[victim] = Math.max(0, hot.happiness[victim] - (violent ? 12 : 8));
      if (violent) hot.health[victim] = Math.max(0, hot.health[victim] - 12); // violência fere
      const cv = cold[victim];
      if (cv) remember(cv, tick, 'conflito', violent ? 'Foi vítima de um assalto' : 'Foi vítima de um furto');
    }
    remember(c, tick, 'conflito', violentLabel(kind));
  }

  private arrest(id: number, tick: number, kind: CrimeKind): void {
    const { hot, cold } = this.world;
    if (hot.companyId[id] !== -1) this.careers.fire(id, tick, 'preso');
    hot.inJail[id] = 1;
    hot.building[id] = -3; // cadeia (culled do render de rua)
    hot.criminalRecord[id] = Math.min(255, hot.criminalRecord[id] + 1); // condenação
    // pena por gravidade + agravante de reincidência
    const base: Record<CrimeKind, [number, number]> = {
      furto: [1, 3], vandalismo: [1, 2], fraude: [3, 6], roubo: [4, 8],
    };
    const [lo, hi] = base[kind];
    const months = this.rng.int(lo, hi) + Math.min(6, hot.criminalRecord[id] - 1);
    hot.jailUntil[id] = tick + months * TICKS_PER_MONTH;
    hot.happiness[id] = Math.max(0, hot.happiness[id] - 15);
    this.arrestsThisYear++;
    this.jailedCount++;
    const c = cold[id];
    if (c) remember(c, tick, 'conflito', `Condenado(a) por ${kind} a ${months} meses`);
    if (this.rng.chance(0.04)) {
      this.feed({ tick, kind: 'social', text: `🚓 ${c?.name ?? 'Alguém'} foi condenado(a) por ${kind}` });
    }
  }

  private releaseFromJail(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || !hot.inJail[i]) continue;
      if (tick >= hot.jailUntil[i]) {
        hot.inJail[i] = 0;
        hot.building[i] = -1;
        hot.nextThink[i] = tick; // volta a decidir já
        this.jailedCount = Math.max(0, this.jailedCount - 1);
        const c = cold[i];
        if (c) remember(c, tick, 'emprego', 'Saiu da prisão e busca recomeçar');
        // ressocialização: auxílio-reinserção + reemprego imediato quebram o
        // ciclo pobreza→crime→prisão→pobreza que causava reincidência em massa.
        hot.happiness[i] = Math.min(100, hot.happiness[i] + 12);
        // auxílio-reinserção acompanha a inflação (senão vira pó após décadas e a
        // pessoa sai da prisão já "quebrada", reincidindo na hora)
        hot.money[i] = Math.max(hot.money[i], 1200 * this.economy.priceLevel);
        this.careers.tryGetJob(i, tick); // programa de reinserção no trabalho
      }
    }
  }

  resetYearCounters(): void {
    this.crimesThisYear = 0;
    this.arrestsThisYear = 0;
  }

  onDeath(id: number): void {
    if (this.world.hot.inJail[id]) this.jailedCount = Math.max(0, this.jailedCount - 1);
  }
}
