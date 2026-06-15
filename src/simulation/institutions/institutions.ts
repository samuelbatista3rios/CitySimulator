import { CONFIG, TICKS_PER_MONTH } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { CityMap } from '../world/cityTypes';
import type { FeedItem, InstitutionMarker } from '../types';
import { remember } from '../agents/memory';
import type { Government } from '../government/government';
import type { CareerSystem } from '../economy/careers';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

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
      if (age >= 18 && c.education === 'medio' && this.rng.chance(0.03 * quality)) {
        c.education = 'superior';
        remember(c, tick, 'formatura', 'Concluiu o ensino superior');
      }
    }
  }

  /** Crime e polícia: autores, vítimas, prisões e reincidência. */
  private policing(tick: number, gov: Government): void {
    const { hot, cold } = this.world;
    const range = this.world.entityRange;
    const catchRate = 0.25 + gov.policeFunding * 0.6; // 0.25..0.85
    // taxa de crime base por habitante em risco neste mês
    for (let i = 0; i < range; i++) {
      if (!hot.alive[i] || hot.inJail[i]) continue;
      const c = cold[i];
      if (!c) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;

      // propensão ao crime: pobreza + desemprego + infelicidade + baixa amabilidade.
      // Acúmulo de fatores (não é "todo desempregado vira criminoso"), com uma
      // base pequena para haver criminalidade realista mesmo em tempos bons.
      const broke = hot.money[i] < 400 ? 1 : hot.money[i] < 1500 ? 0.5 : 0;
      const jobless = hot.companyId[i] === -1 && !hot.isOwner[i] ? 1 : 0;
      const unhappy = hot.happiness[i] < 30 ? 1 : 0;
      const meanness = (100 - c.personality.amabilidade) / 100;
      const factor = broke * 0.4 + jobless * 0.2 + unhappy * 0.2 + meanness * 0.2;
      const propensity = Math.max(0, factor - 0.28) * 0.03; // limiar + taxa baixa
      if (!this.rng.chance(propensity)) continue;

      // comete um crime contra uma vítima aleatória (furto)
      this.crimesThisYear++;
      const victim = this.rng.int(0, range - 1);
      let loot = 0;
      if (hot.alive[victim] && victim !== i && hot.money[victim] > 100) {
        loot = Math.min(hot.money[victim] * 0.3, 4000);
        hot.money[victim] -= loot;
        hot.money[i] += loot;
        hot.safety[victim] = Math.max(0, hot.safety[victim] - 20);
        hot.happiness[victim] = Math.max(0, hot.happiness[victim] - 8);
        const cv = cold[victim];
        if (cv) remember(cv, tick, 'conflito', 'Foi vítima de um furto');
      }
      remember(c, tick, 'conflito', 'Cometeu um crime');

      // polícia prende?
      if (this.rng.chance(catchRate)) {
        this.arrest(i, tick);
        if (this.rng.chance(0.04)) {
          this.feed({ tick, kind: 'social', text: `🚓 ${c.name} foi preso(a) por furto` });
        }
      }
    }
  }

  private arrest(id: number, tick: number): void {
    const { hot, cold } = this.world;
    if (hot.companyId[id] !== -1) this.careers.fire(id, tick, 'preso');
    hot.inJail[id] = 1;
    hot.building[id] = -3; // cadeia (culled do render de rua)
    const months = this.rng.int(1, 4); // penas mais curtas (evita superlotação)
    hot.jailUntil[id] = tick + months * TICKS_PER_MONTH;
    hot.happiness[id] = Math.max(0, hot.happiness[id] - 15);
    this.arrestsThisYear++;
    this.jailedCount++;
    const c = cold[id];
    if (c) remember(c, tick, 'conflito', `Foi preso(a) por ${months} meses`);
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
        hot.money[i] = Math.max(hot.money[i], 800); // auxílio mínimo
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
