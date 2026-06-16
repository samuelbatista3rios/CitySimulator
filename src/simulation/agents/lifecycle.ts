import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { CityMap } from '../world/cityTypes';
import type { FeedItem } from '../types';
import { remember } from './memory';
import { spawnChild } from './spawn';
import type { CareerSystem } from '../economy/careers';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/**
 * Ciclo de vida: envelhecimento, saúde, aposentadoria, morte e nascimentos.
 * Roda 1x por mês simulado (barato mesmo com 100k agentes).
 */
export class LifecycleSystem {
  birthsThisYear = 0;
  deathsThisYear = 0;
  marriagesThisYear = 0;
  healthMultiplier = 1; // alterado por pandemias
  /** acesso a saúde (0..1) — verba pública de saúde; reduz a mortalidade */
  healthcareAccess = 0.5;
  // expectativa de vida: idade média ao morrer (janela anual)
  private deathAgeSum = 0;
  private deathCount = 0;
  lifeExpectancy = 78;
  /** notifica outros sistemas (banco, governo, instituições) quando alguém morre */
  onDeath?: (id: number) => void;

  constructor(
    private world: EcsWorld,
    private city: CityMap,
    private careers: CareerSystem,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {}

  resetYearCounters(): void {
    // consolida a expectativa de vida do ano (média móvel suaviza o ruído anual)
    if (this.deathCount > 20) {
      this.lifeExpectancy = this.lifeExpectancy * 0.6 + (this.deathAgeSum / this.deathCount) * 0.4;
    }
    this.deathAgeSum = 0;
    this.deathCount = 0;
    this.birthsThisYear = 0;
    this.deathsThisYear = 0;
    this.marriagesThisYear = 0;
  }

  monthlyCycle(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const ageYears = hot.ageDays[i] / DAYS_PER_YEAR;

      // Saúde: degrada com idade e necessidades cronicamente baixas
      let healthDelta = 0.3; // recuperação basal
      if (ageYears > 50) healthDelta -= (ageYears - 50) * 0.025;
      if (hot.hunger[i] < 20) healthDelta -= 2;
      if (hot.sleep[i] < 20) healthDelta -= 1.5;
      healthDelta *= this.healthMultiplier;
      hot.health[i] = Math.max(0, Math.min(100, hot.health[i] + healthDelta));

      // Mortalidade: cresce com idade e saúde baixa, mas é AMORTECIDA pelo acesso
      // a saúde (verba pública) e pela RENDA (quem tem dinheiro acessa tratamento).
      // Resultado: desigualdade de saúde — pobres morrem mais cedo que ricos.
      const baseMortality =
        ageYears < 60 ? 0.0002 : Math.pow((ageYears - 55) / (CONFIG.MAX_AGE - 55), 3) * 0.06;
      const healthFactor = hot.health[i] < 30 ? 3 : hot.health[i] < 60 ? 1.5 : 1;
      const pandemic = this.healthMultiplier < 1 ? 2 : 1;
      const publicCare = 1 - this.healthcareAccess * 0.35; // até −35% com saúde bem financiada
      const wealthCare = hot.money[i] > 20_000 ? 0.8 : hot.money[i] < 500 ? 1.25 : 1;
      const mortality = baseMortality * healthFactor * pandemic * publicCare * wealthCare;
      if (hot.health[i] <= 0 || this.rng.chance(mortality)) {
        this.die(i, tick);
        continue;
      }

      // Aposentadoria
      if (ageYears >= CONFIG.RETIREMENT_AGE && hot.companyId[i] !== -1 && !hot.isOwner[i]) {
        this.careers.quit(i, tick, true);
        const c = cold[i];
        if (c) {
          c.professionTitle = 'Aposentado(a)';
          remember(c, tick, 'emprego', 'Se aposentou');
        }
      }

      // Formatura: jovens adultos concluem etapa de estudo
      const c = cold[i];
      if (c) {
        if (ageYears >= 15 && c.education === 'fundamental' && this.rng.chance(0.5)) {
          c.education = 'medio';
        } else if (ageYears >= 18 && ageYears <= 30 && c.education === 'medio') {
          // inteligência + abertura → faculdade
          if (this.rng.chance((hot.intelligence[i] + c.personality.abertura) / 800)) {
            c.education = 'superior';
            remember(c, tick, 'formatura', 'Se formou na faculdade');
          }
        }
      }
    }

    // Nascimentos: casais em idade fértil
    this.births(tick);
  }

  private births(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i] || !hot.sexF[i]) continue; // itera pelas mulheres
      const partner = hot.partnerId[i];
      if (partner === -1 || !hot.alive[partner]) continue;
      const c = cold[i];
      if (!c) continue;
      const rel = c.relationships.get(partner);
      if (!rel || rel.kind !== 'casamento') continue;
      const ageYears = hot.ageDays[i] / DAYS_PER_YEAR;
      if (ageYears < 20 || ageYears > 42) continue;
      if (c.children.length >= 3) continue;
      // chance mensal modulada pela situação financeira do casal
      const wealth = hot.money[i] + hot.money[partner];
      const p = 0.015 * (wealth > 5000 ? 1.2 : 0.7);
      if (!this.rng.chance(p)) continue;

      const childId = spawnChild(this.world, this.rng, this.city, i, partner, tick);
      if (childId === -1) continue;
      this.birthsThisYear++;
      const cc = cold[childId]!;
      const cp = cold[partner]!;
      remember(c, tick, 'filho', `Nasceu ${cc.name}`, childId);
      remember(cp, tick, 'filho', `Nasceu ${cc.name}`, childId);
      hot.happiness[i] = Math.min(100, hot.happiness[i] + 12);
      hot.happiness[partner] = Math.min(100, hot.happiness[partner] + 12);
      if (this.rng.chance(0.15)) {
        this.feed({ tick, kind: 'vida', text: `Nasceu ${cc.name}, filho(a) de ${c.name} 👶` });
      }
    }
  }

  die(id: number, tick: number): void {
    const { hot, cold } = this.world;
    const c = cold[id];
    this.deathsThisYear++;
    // amostra para a expectativa de vida (idade média ao falecer)
    this.deathAgeSum += hot.ageDays[id] / DAYS_PER_YEAR;
    this.deathCount++;
    this.onDeath?.(id);

    // notifica família
    if (c) {
      const partner = hot.partnerId[id];
      if (partner !== -1 && hot.alive[partner]) {
        const cp = cold[partner];
        if (cp) {
          remember(cp, tick, 'morte_parente', `${c.name} faleceu`);
          hot.partnerId[partner] = -1;
          hot.happiness[partner] = Math.max(0, hot.happiness[partner] - 30);
        }
      }
      // herança: divide dinheiro entre filhos vivos
      const heirs = c.children.filter((ch) => hot.alive[ch]);
      if (heirs.length > 0 && hot.money[id] > 0) {
        const share = hot.money[id] / heirs.length;
        for (const h of heirs) {
          hot.money[h] += share;
          const ch = cold[h];
          if (ch) remember(ch, tick, 'morte_parente', `${c.name} faleceu e deixou herança`);
        }
      }
      const ageYears = Math.floor(hot.ageDays[id] / DAYS_PER_YEAR);
      if (this.rng.chance(0.05)) {
        this.feed({ tick, kind: 'vida', text: `${c.name} faleceu aos ${ageYears} anos` });
      }
    }

    // sai do emprego e da residência
    if (hot.companyId[id] !== -1) this.careers.quit(id, tick, false);
    const home = hot.homeId[id];
    if (home !== -1) {
      const res = this.city.residences[home];
      const idx = res.occupants.indexOf(id);
      if (idx !== -1) res.occupants.splice(idx, 1);
      if (res.ownerId === id) res.ownerId = -1;
    }

    // Poda dos dados frios pesados do falecido: enquanto o slot não é reciclado
    // por um novo nascimento, ele continua sendo serializado no snapshot. Memória
    // episódica, relacionamentos, histórico de empregos e plano GOAP não têm mais
    // utilidade para quem morreu — mantemos só o essencial para a árvore familiar
    // (nome, sexo, pais/filhos). Isso evita que o save cresça sem limite (>512MB).
    if (c) {
      c.memory = [];
      c.relationships.clear();
      c.goals = [];
      c.currentPlan = [];
      c.jobHistory = [];
    }

    this.world.destroyEntity(id);
  }
}
