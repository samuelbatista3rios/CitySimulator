import { CONFIG, TICKS_PER_MONTH, TICKS_PER_YEAR } from './config';
import { RNG } from './rng';
import { EcsWorld } from './ecs/world';
import { generateCity } from './world/cityGenerator';
import type { CityMap } from './world/cityTypes';
import { spawnCitizen } from './agents/spawn';
import { needWeights } from './agents/personality';
import { updateGoals, topGoal } from './agents/goals';
import { plan, type WorldState } from './agents/goap';
import { practiceSkill, bestSkill } from './agents/skills';
import { remember } from './agents/memory';
import { RelationshipSystem } from './agents/relationships';
import { LifecycleSystem } from './agents/lifecycle';
import { generateCompanies, createCompany, sectorSkill, totalOpenings, type Company } from './economy/companies';
import { CareerSystem } from './economy/careers';
import { EconomySystem } from './economy/economy';
import { Bank } from './economy/bank';
import { Government } from './government/government';
import { InstitutionSystem } from './institutions/institutions';
import { GlobalEventSystem } from './events/globalEvents';
import { TrafficSystem } from './traffic/traffic';
import { buildVenues, chooseVenue, applyVenueVisit, VENUE_INFO, type Venue } from './world/venues';
import {
  Activity,
  ACTIVITY_LABELS,
  type CityStats,
  type CitizenDetail,
  type FeedItem,
  type CompanyView,
  type Sector,
} from './types';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/**
 * Núcleo da simulação (roda dentro do Web Worker).
 *
 * Pipeline por tick (1 hora simulada):
 *  1. needsSystem        — decaimento vetorizado das necessidades (toda a população)
 *  2. agentThinkSystem   — GOAP para a fatia de agentes com nextThink vencido
 *  3. activitySystem     — executa/conclui atividades em andamento
 *  4. (limite de dia)    — pequenas rotinas diárias
 *  5. (limite de mês)    — economia, carreiras, casais, ciclo de vida, eventos
 */
export class Simulation {
  rng: RNG;
  world: EcsWorld;
  city: CityMap;
  companies: Company[];
  careers: CareerSystem;
  economy: EconomySystem;
  bank: Bank;
  government: Government;
  institutions: InstitutionSystem;
  relationships: RelationshipSystem;
  lifecycle: LifecycleSystem;
  events: GlobalEventSystem;
  traffic: TrafficSystem;
  venues: Venue[];
  private venuesByType = new Map<string, Venue[]>();

  tick = 0;
  feedBuffer: FeedItem[] = [];
  /** agentes socializando no momento, para parear interações */
  private socializing: number[] = [];

  constructor(seed: number, population: number = CONFIG.START_POPULATION) {
    this.rng = new RNG(seed);
    this.world = new EcsWorld();
    this.city = generateCity(this.rng);
    this.venues = buildVenues(this.city.leisureSpots, this.rng);
    for (const v of this.venues) {
      const list = this.venuesByType.get(v.type) ?? [];
      list.push(v);
      this.venuesByType.set(v.type, list);
    }
    this.companies = generateCompanies(this.rng, this.city);
    this.createSportsClubs();

    const feed = (item: FeedItem) => {
      this.feedBuffer.push(item);
      if (this.feedBuffer.length > 100) this.feedBuffer.shift();
    };

    this.careers = new CareerSystem(this.world, this.companies, this.rng, feed);
    this.economy = new EconomySystem(this.world, this.companies, this.careers, this.rng, feed);
    this.bank = new Bank(this.world, this.rng, feed);
    this.government = new Government(this.world, this.rng, feed);
    this.institutions = new InstitutionSystem(this.world, this.city, this.careers, this.rng, feed);
    this.relationships = new RelationshipSystem(this.world, this.rng, feed);
    this.lifecycle = new LifecycleSystem(this.world, this.city, this.careers, this.rng, feed);
    this.events = new GlobalEventSystem(this.rng, this.economy, this.lifecycle, feed);
    this.traffic = new TrafficSystem(this.rng, this.city.worldSize, this.city.blockSpan);

    // Liga economia ↔ banco ↔ governo
    this.economy.bank = this.bank;
    this.economy.onTaxesCollected = (amt) => this.government.collect(amt);
    this.economy.onSubsidySpent = (amt) => this.government.spendSubsidy(amt);
    this.economy.onReplenish = (count, tick) => this.replenishCompanies(count, tick);
    this.bank.onForeclose = (resId) => {
      if (resId >= 0 && this.city.residences[resId]) this.city.residences[resId].ownerId = -1;
    };
    // Notificações de morte para os sistemas que mantêm estado por cidadão
    this.lifecycle.onDeath = (id) => {
      this.bank.onDeath(id);
      this.government.onDeath(id);
      this.institutions.onDeath(id);
    };

    this.populate(population);
  }

  private populate(population: number): void {
    const resCount = this.city.residences.length;
    for (let i = 0; i < population; i++) {
      const res = i % resCount; // ~2 pessoas por residência
      const id = spawnCitizen(this.world, this.rng, this.city, res);
      if (id === -1) break;
    }
    // Emprego inicial: ~90% dos adultos
    const { hot } = this.world;
    for (const id of this.world.aliveEntities()) {
      const age = hot.ageDays[id] / DAYS_PER_YEAR;
      if (age >= CONFIG.ADULT_AGE && age < CONFIG.RETIREMENT_AGE && this.rng.chance(0.9)) {
        this.careers.tryGetJob(id, 0);
      }
    }
  }

  // ---------------------------------------------------------------- tick

  step(): void {
    this.tick++;
    const hour = this.tick % CONFIG.TICKS_PER_DAY;

    this.needsSystem();
    this.agentThinkSystem();
    this.activitySystem(hour);

    if (this.tick % TICKS_PER_MONTH === 0) {
      // 1) Governo decide PRIMEIRO: eleições (podem trocar a lei), empregos
      //    públicos e alocação de subsídio.
      this.government.beginSubsidyMonth();
      this.government.monthlyCycle(this.tick, this.economy);
      // 2) Economia roda sob as leis vigentes (já possivelmente atualizadas).
      this.economy.taxRate = this.government.taxRate;
      this.economy.minimumWage = this.government.minimumWage;
      this.economy.subsidyPool = this.government.subsidyAllocated;
      this.economy.monthlyCycle(this.tick);
      this.institutions.monthlyCycle(this.tick, this.government); // saúde, educação, crime/polícia
      this.careers.monthlyCareerMoves(this.tick);
      this.relationships.monthlyCouples(this.tick);
      this.lifecycle.monthlyCycle(this.tick);
      this.events.monthlyCycle(this.tick);
    }
    if (this.tick % TICKS_PER_YEAR === 0) {
      this.lifecycle.resetYearCounters();
      this.relationships.marriagesThisYear = 0;
      this.institutions.resetYearCounters();
    }
  }

  /** Decaimento vetorizado: percorre typed arrays sem alocação. */
  private needsSystem(): void {
    const h = this.world.hot;
    const n = this.world.entityRange;
    for (let i = 0; i < n; i++) {
      if (!h.alive[i]) continue;
      h.ageDays[i] += 1 / CONFIG.TICKS_PER_DAY;
      h.hunger[i] = Math.max(0, h.hunger[i] - CONFIG.DECAY_HUNGER);
      h.sleep[i] = Math.max(0, h.sleep[i] - CONFIG.DECAY_SLEEP);
      h.social[i] = Math.max(0, h.social[i] - CONFIG.DECAY_SOCIAL);
      h.fun[i] = Math.max(0, h.fun[i] - CONFIG.DECAY_FUN);
      h.safety[i] = Math.min(100, Math.max(0, h.safety[i] - CONFIG.DECAY_SAFETY + (h.money[i] > 2000 ? 0.4 : 0)));
      // realização decai devagar, mas a FÉ e a FAMA dão um piso (conforto/propósito)
      const c = this.world.cold[i];
      const floor = c ? Math.max(c.religiosidade * 0.35, h.fame[i] * 0.5) : h.fame[i] * 0.5;
      h.fulfillment[i] = Math.max(floor, h.fulfillment[i] - 0.3);
      // felicidade = 70% necessidades + 30% realização de vida
      const needs = (h.hunger[i] + h.sleep[i] + h.social[i] + h.fun[i] + h.safety[i]) / 5;
      const target = needs * 0.7 + h.fulfillment[i] * 0.3;
      h.happiness[i] += (target - h.happiness[i]) * 0.02;
      // fome crônica corrói energia
      if (h.hunger[i] < 15) h.energy[i] = Math.max(0, h.energy[i] - 2);
    }
  }

  /** GOAP: replaneja agentes cuja hora de "pensar" chegou (escalonado). */
  private agentThinkSystem(): void {
    const { hot, cold } = this.world;
    const n = this.world.entityRange;
    for (let i = 0; i < n; i++) {
      if (!hot.alive[i] || hot.inJail[i] || hot.nextThink[i] > this.tick) continue;
      if (this.tick < hot.activityUntil[i]) continue; // ocupado
      const c = cold[i];
      if (!c) continue;
      hot.nextThink[i] = this.tick + CONFIG.THINK_INTERVAL_TICKS + this.rng.int(0, 3);

      updateGoals(i, hot, c, this.rng, this.tick);

      // ---- estado simbólico atual do agente
      const ageYears = hot.ageDays[i] / DAYS_PER_YEAR;
      const state: WorldState = {
        descansado: hot.sleep[i] > 35 && hot.energy[i] > 25,
        alimentado: hot.hunger[i] > 40,
        temDinheiro: hot.money[i] > this.economy.foodPrice * 4,
        temEmprego: hot.companyId[i] !== -1 || hot.isOwner[i] === 1 || hot.publicJob[i] === 1,
        socializado: hot.social[i] > 40,
        divertido: hot.fun[i] > 40,
        emCasa: hot.building[i] === -2, // -2 = em casa
        adulto: ageYears >= CONFIG.ADULT_AGE,
        qualificado: bestSkill(c).value > 45 || c.education === 'superior' || c.education === 'pos',
        temCapital: hot.money[i] >= CONFIG.BUSINESS_STARTUP_COST,
        abastecido: true,
        investido: false,
        empresario: hot.isOwner[i] === 1,
      };

      // ---- escolhe o objetivo GOAP: necessidade mais urgente ponderada
      const w = needWeights(c.personality);
      const urgencies: [string, number][] = [
        ['alimentado', (100 - hot.hunger[i]) * w.fome],
        ['descansado', (100 - hot.sleep[i]) * w.sono],
        ['socializado', (100 - hot.social[i]) * w.social],
        ['divertido', (100 - hot.fun[i]) * w.diversao],
        ['temDinheiro', (hot.money[i] < 1000 ? 90 : hot.money[i] < 5000 ? 50 : 10) * w.dinheiro],
      ];
      urgencies.sort((a, b) => b[1] - a[1]);

      let goal: WorldState;
      const life = topGoal(c);
      const mostUrgent = urgencies[0];
      // objetivos de vida só quando necessidades básicas estão ok
      if (mostUrgent[1] < 55 && life && ageYears >= CONFIG.ADULT_AGE) {
        switch (life.kind) {
          case 'arranjar_emprego': goal = { temEmprego: true }; break;
          case 'abrir_empresa': goal = state.temCapital ? { empresario: true } : { temDinheiro: true }; break;
          case 'estudar': goal = { qualificado: true }; break;
          case 'virar_atleta': goal = state.temEmprego ? { qualificado: true } : { temEmprego: true }; break;
          case 'enriquecer': goal = state.qualificado ? { investido: true } : { temDinheiro: true }; break;
          case 'casar': goal = { socializado: true }; break;
          default: goal = { temDinheiro: true };
        }
      } else {
        goal = { [mostUrgent[0]]: true };
      }

      const planned = plan(state, goal);
      c.currentPlan = planned ?? [];
      const action = planned?.[0];
      if (action) this.startAction(i, action, hour(this.tick));
      else hot.activity[i] = Activity.Idle;
    }
  }

  /** Inicia a primeira ação do plano: define atividade, duração e destino. */
  private startAction(i: number, action: string, hourOfDay: number): void {
    const { hot, cold } = this.world;
    const c = cold[i]!;
    const res = hot.homeId[i] !== -1 ? this.city.residences[hot.homeId[i]] : null;
    const goTo = (x: number, z: number, indoorCode: number) => {
      hot.targetX[i] = x;
      hot.targetZ[i] = z;
      const dist = Math.abs(x - hot.posX[i]) + Math.abs(z - hot.posZ[i]);
      // carro encurta o deslocamento e gera tráfego visível
      if (hot.ownsCar[i] && dist > 30 && this.traffic.count < CONFIG.MAX_VEHICLES * 0.95) {
        this.traffic.dispatch(i, hot.posX[i], hot.posZ[i], x, z);
      }
      hot.posX[i] = x; // posição lógica muda já; visual interpola na UI
      hot.posZ[i] = z;
      hot.building[i] = indoorCode;
    };

    switch (action) {
      case 'IrParaCasa':
        if (res) goTo(res.x, res.z, -2);
        hot.activity[i] = Activity.Commuting;
        hot.activityUntil[i] = this.tick + 1;
        break;
      case 'Dormir': {
        if (res) goTo(res.x, res.z, -2);
        hot.activity[i] = Activity.Sleeping;
        const hours = hourOfDay >= 21 || hourOfDay <= 5 ? 8 : 2;
        hot.activityUntil[i] = this.tick + hours;
        break;
      }
      case 'Comer': {
        hot.activity[i] = Activity.Eating;
        hot.activityUntil[i] = this.tick + 1;
        break;
      }
      case 'Trabalhar': {
        const compId = hot.companyId[i];
        if (compId !== -1) {
          const comp = this.companies[compId];
          goTo(comp.x, comp.z, comp.buildingId);
          hot.activity[i] = Activity.Working;
          hot.activityUntil[i] = this.tick + 8;
        }
        break;
      }
      case 'ProcurarEmprego':
        hot.activity[i] = Activity.JobHunting;
        hot.activityUntil[i] = this.tick + 2;
        break;
      case 'Estudar':
        hot.activity[i] = Activity.Studying;
        hot.activityUntil[i] = this.tick + 3;
        break;
      case 'Socializar': {
        const v = this.visitVenue(i);
        if (v) goTo(v.x, v.z, -1);
        hot.activity[i] = Activity.Socializing;
        hot.activityUntil[i] = this.tick + 2;
        this.socializing.push(i);
        break;
      }
      case 'Divertir': {
        const v = this.visitVenue(i);
        if (v) goTo(v.x, v.z, -1);
        hot.activity[i] = Activity.HavingFun;
        hot.activityUntil[i] = this.tick + 2;
        break;
      }
      case 'Comprar':
        hot.activity[i] = Activity.Shopping;
        hot.activityUntil[i] = this.tick + 1;
        break;
      case 'Investir':
        hot.activity[i] = Activity.Working;
        hot.activityUntil[i] = this.tick + 2;
        // investimento: retorno esperado positivo com variância
        {
          const amount = hot.money[i] * 0.1;
          hot.money[i] += amount * this.rng.range(-0.5, 0.8);
        }
        break;
      case 'AbrirEmpresa':
        this.foundCompany(i);
        hot.activityUntil[i] = this.tick + 4;
        break;
      default:
        hot.activity[i] = Activity.Idle;
        hot.activityUntil[i] = this.tick + 1;
    }
  }

  /** Conclui atividades cujo prazo venceu, aplicando efeitos. */
  private activitySystem(hourOfDay: number): void {
    const { hot, cold } = this.world;
    const n = this.world.entityRange;

    // pareia quem está socializando (interações sociais reais)
    if (this.socializing.length >= 2) {
      for (let k = 0; k + 1 < this.socializing.length; k += 2) {
        const a = this.socializing[k];
        const b = this.socializing[k + 1];
        if (hot.alive[a] && hot.alive[b]) this.relationships.interact(a, b, this.tick);
      }
      this.socializing.length = 0;
    }

    for (let i = 0; i < n; i++) {
      if (!hot.alive[i]) continue;
      const act = hot.activity[i];
      if (act === Activity.Idle) continue;

      // efeitos contínuos por hora de atividade
      switch (act) {
        case Activity.Sleeping:
          hot.sleep[i] = Math.min(100, hot.sleep[i] + 12);
          hot.energy[i] = Math.min(100, hot.energy[i] + 10);
          break;
        case Activity.Working: {
          hot.energy[i] = Math.max(0, hot.energy[i] - 4);
          const c = cold[i];
          const compId = hot.companyId[i];
          if (c && compId !== -1) {
            const sector = this.companies[compId].sector;
            // pratica a habilidade do setor enquanto trabalha
            practiceSkill(c, sectorSkill(sector), hot.intelligence[i], 1);
            // atletas e artistas de destaque ganham fama (eleva a realização)
            if ((sector === 'esporte' || sector === 'cultura') && hot.jobLevel[i] >= 1) {
              hot.fame[i] = Math.min(100, hot.fame[i] + 0.05 * hot.jobLevel[i]);
            }
          }
          break;
        }
        case Activity.Studying: {
          const c = cold[i];
          if (c) {
            hot.energy[i] = Math.max(0, hot.energy[i] - 2);
            // estuda a melhor aptidão (especialização)
            practiceSkill(c, bestSkill(c).name, hot.intelligence[i], 1.6);
          }
          break;
        }
        case Activity.Socializing:
          hot.social[i] = Math.min(100, hot.social[i] + 15);
          break;
        case Activity.HavingFun:
          // diversão sobe durante a atividade; o custo já foi pago no local (venue)
          hot.fun[i] = Math.min(100, hot.fun[i] + 18);
          break;
        default:
          break;
      }

      if (this.tick < hot.activityUntil[i]) continue;

      // efeitos de conclusão
      switch (act) {
        case Activity.Eating:
          hot.hunger[i] = Math.min(100, hot.hunger[i] + 55);
          hot.money[i] -= this.economy.foodPrice;
          break;
        case Activity.JobHunting:
          this.careers.tryGetJob(i, this.tick);
          break;
        case Activity.Shopping: {
          hot.money[i] -= this.economy.foodPrice * 3;
          hot.hunger[i] = Math.min(100, hot.hunger[i] + 20);
          // grandes compras guiadas por objetivos: à vista OU financiadas
          const c = cold[i];
          if (c) {
            const carPrice = CONFIG.CAR_PRICE * this.economy.priceLevel;
            if (!hot.ownsCar[i] && c.goals.some((g) => g.kind === 'comprar_carro')) {
              if (hot.money[i] > carPrice * 1.2) {
                hot.money[i] -= carPrice;
                hot.ownsCar[i] = 1;
                remember(c, this.tick, 'compra_carro', 'Comprou um carro à vista');
              } else if (this.bank.financeCar(i, carPrice, this.tick)) {
                hot.ownsCar[i] = 1; // financiado (entrada já debitada pelo banco)
              }
            } else if (!hot.ownsHouse[i] && hot.homeId[i] !== -1 &&
                c.goals.some((g) => g.kind === 'comprar_casa')) {
              const resH = this.city.residences[hot.homeId[i]];
              const price = resH.price * this.economy.priceLevel;
              if (resH.ownerId === -1) {
                if (hot.money[i] > price * 1.1) {
                  hot.money[i] -= price;
                  hot.ownsHouse[i] = 1;
                  resH.ownerId = i;
                  remember(c, this.tick, 'compra_casa', 'Comprou a casa própria à vista');
                  this.feedBuffer.push({ tick: this.tick, kind: 'vida', text: `${c.name} comprou a casa própria 🏠` });
                } else if (this.bank.financeHouse(i, price, resH.id, this.tick)) {
                  hot.ownsHouse[i] = 1;
                  resH.ownerId = i;
                  this.feedBuffer.push({ tick: this.tick, kind: 'vida', text: `${c.name} financiou a casa própria 🏠` });
                }
              }
            }
          }
          break;
        }
        default:
          break;
      }
      hot.activity[i] = Activity.Idle;
    }
  }

  /** Empreendedorismo: cria empresa nova num prédio comercial com vaga. */
  private foundCompany(i: number): void {
    const { hot, cold } = this.world;
    const c = cold[i];
    if (!c || hot.money[i] < CONFIG.BUSINESS_STARTUP_COST) return;
    const pool = [
      ...(this.city.byZone.get('comercial') ?? []),
      ...(this.city.byZone.get('centro') ?? []),
    ];
    if (pool.length === 0) return;
    const bld = pool[this.rng.int(0, pool.length - 1)];
    hot.money[i] -= CONFIG.BUSINESS_STARTUP_COST;
    const best = bestSkill(c);
    const sectorBySkill: Record<string, Sector> = {
      programacao: 'tecnologia', vendas: 'comercio', lideranca: 'servicos',
      engenharia: 'industria', arte: 'cultura', esporte: 'esporte',
    };
    const company = createCompany(
      this.rng, this.companies.length, bld, sectorBySkill[best.name] ?? 'servicos',
      this.rng.int(2, 6), this.tick, i,
    );
    company.capital = CONFIG.BUSINESS_STARTUP_COST * 0.9;
    this.companies.push(company);
    this.careers.openBusiness(i, company, this.tick);
  }

  /**
   * Cidadão escolhe um local de lazer (por personalidade/fé), vai até ele e
   * colhe a realização correspondente. Devolve a posição para o deslocamento.
   */
  private visitVenue(i: number): { x: number; z: number } | null {
    const cold = this.world.cold[i];
    if (!cold) return null;
    const type = chooseVenue(this.world.hot, cold, i, this.rng);
    const list = this.venuesByType.get(type);
    const v = list && list.length
      ? list[this.rng.int(0, list.length - 1)]
      : this.venues.length ? this.venues[this.rng.int(0, this.venues.length - 1)] : null;
    applyVenueVisit(this.world.hot, cold, i, type, this.economy.funPrice, this.economy.foodPrice);
    return v ? { x: v.x, z: v.z } : null;
  }

  /** Cria clubes esportivos: empregam os talentosos como atletas (bem pagos). */
  private createSportsClubs(): void {
    const pool = [
      ...(this.city.byZone.get('comercial') ?? []),
      ...(this.city.byZone.get('centro') ?? []),
    ];
    if (pool.length === 0) return;
    const n = Math.max(8, Math.round(this.city.residences.length / 350)); // ~14 clubes
    for (let k = 0; k < n; k++) {
      const bld = pool[this.rng.int(0, pool.length - 1)];
      const club = createCompany(this.rng, this.companies.length, bld, 'esporte', this.rng.int(6, 16), 0, -1, 1.8);
      this.companies.push(club);
    }
  }

  /** Entrada de novas empresas no mercado (rotatividade), com vagas abertas. */
  private replenishCompanies(count: number, tick: number): void {
    const pool = [
      ...(this.city.byZone.get('comercial') ?? []),
      ...(this.city.byZone.get('centro') ?? []),
      ...(this.city.byZone.get('industrial') ?? []),
    ];
    if (pool.length === 0) return;
    const sectors: Sector[] = ['tecnologia', 'comercio', 'industria', 'servicos', 'cultura'];
    for (let k = 0; k < count; k++) {
      const bld = pool[this.rng.int(0, pool.length - 1)];
      const sector = this.rng.pick(sectors);
      const size = this.rng.int(3, 10);
      const company = createCompany(this.rng, this.companies.length, bld, sector, size, tick);
      // capital inicial saudável para sobreviver aos primeiros meses
      company.capital = this.rng.range(80_000, 250_000) * this.economy.priceLevel;
      this.companies.push(company);
    }
    this.careers.rebuildHiringIndex();
  }

  // ---------------------------------------------------------------- consultas

  computeStats(realTPS: number): CityStats {
    const { hot, cold } = this.world;
    let employed = 0, adults = 0, happiness = 0, health = 0, eduScore = 0, salarySum = 0, salaryN = 0;
    let fulfillSum = 0, atletas = 0, religiosos = 0;
    const eduValue = { fundamental: 25, medio: 50, superior: 80, pos: 100 };
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      happiness += hot.happiness[i];
      health += hot.health[i];
      fulfillSum += hot.fulfillment[i];
      const c = cold[i];
      if (c) {
        eduScore += eduValue[c.education];
        if (c.religiosidade > 45) religiosos++;
      }
      const cid = hot.companyId[i];
      if (cid !== -1 && this.companies[cid]?.sector === 'esporte' && hot.jobLevel[i] >= 1) atletas++;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age >= CONFIG.ADULT_AGE && age < CONFIG.RETIREMENT_AGE) {
        adults++;
        if (hot.companyId[i] !== -1 || hot.isOwner[i]) {
          employed++;
          salarySum += this.careers.salaryOf(i) * this.economy.wageLevel;
          salaryN++;
        } else if (hot.publicJob[i]) {
          employed++;
          salarySum += this.government.minimumWage * this.economy.wageLevel;
          salaryN++;
        }
      }
    }
    const pop = this.world.aliveCount;
    const eco = this.economy.stats();
    const bankStats = this.bank.stats();
    const unemployment = adults > 0 ? ((adults - employed) / adults) * 100 : 0;
    const avgHappiness = pop > 0 ? happiness / pop : 0;
    // criminalidade: agora ancorada em CRIMES REAIS (por mil hab./ano) + pressão social
    const crimeRate = pop > 0 ? (this.institutions.crimesThisYear / pop) * 1000 : 0;
    const crime = Math.min(
      100,
      crimeRate * 1.2 + unemployment * 0.8 + Math.max(0, 45 - avgHappiness) * 0.8,
    );

    const t = this.tick;
    const yearsToElection = Math.max(0, (this.government.nextElectionTick - t) / TICKS_PER_YEAR);
    return {
      tick: t,
      year: Math.floor(t / TICKS_PER_YEAR) + 1,
      month: (Math.floor(t / TICKS_PER_MONTH) % 12) + 1,
      day: (Math.floor(t / CONFIG.TICKS_PER_DAY) % CONFIG.DAYS_PER_MONTH) + 1,
      hour: t % CONFIG.TICKS_PER_DAY,
      populacao: pop,
      pib: eco.gdp,
      empregos: employed,
      desemprego: unemployment,
      empresas: eco.activeCompanies,
      empresasFalidas: eco.bankrupt,
      criminalidade: crime,
      felicidadeMedia: avgHappiness,
      educacaoMedia: pop > 0 ? eduScore / pop : 0,
      saudeMedia: pop > 0 ? health / pop : 0,
      inflacao: eco.inflation,
      salarioMedio: salaryN > 0 ? salarySum / salaryN : 0,
      nascimentosAno: this.lifecycle.birthsThisYear,
      mortesAno: this.lifecycle.deathsThisYear,
      casamentosAno: this.relationships.marriagesThisYear,
      eventoAtivo: this.events.active?.label ?? null,
      fps: realTPS,
      // Governo & leis
      prefeito: this.government.mayorName(),
      plataforma: this.government.policy.name,
      imposto: this.government.taxRate * 100,
      salarioMinimo: this.government.minimumWage,
      orcamentoPublico: this.government.budget,
      proximaEleicaoAnos: yearsToElection,
      // Instituições
      crimesAno: this.institutions.crimesThisYear,
      prisoesAno: this.institutions.arrestsThisYear,
      presos: this.institutions.jailedCount,
      hospitais: this.institutions.hospitals.length,
      escolas: this.institutions.schools.length,
      delegacias: this.institutions.police.length,
      empregosPublicos: this.government.publicEmployees.size,
      subsidioEmpresas: this.government.lastSubsidySpent,
      medidaEmergencia: this.government.emergencyThisMonth,
      realizacaoMedia: pop > 0 ? fulfillSum / pop : 0,
      atletas,
      religiosos: pop > 0 ? (religiosos / pop) * 100 : 0,
      // Finanças
      inadimplencia: bankStats.inadimplentes,
      scoreCreditoMedio: bankStats.scoreMedio,
    };
  }

  citizenDetail(id: number): CitizenDetail | null {
    const { hot, cold } = this.world;
    const c = cold[id];
    if (!c) return null;
    const nameOf = (other: number) => cold[other]?.name ?? '—';
    const friends = [...c.relationships.values()]
      .filter((r) => r.kind === 'amigo' && r.strength > 10)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10)
      .map((r) => ({ id: r.otherId, nome: nameOf(r.otherId), forca: Math.round(r.strength) }));
    const partner = hot.partnerId[id];
    const compId = hot.companyId[id];
    return {
      id,
      nome: c.name,
      sexo: c.sex,
      idade: Math.floor(hot.ageDays[id] / DAYS_PER_YEAR),
      vivo: hot.alive[id] === 1,
      personalidade: c.personality,
      inteligencia: Math.round(hot.intelligence[id]),
      energia: Math.round(hot.energy[id]),
      felicidade: Math.round(hot.happiness[id]),
      saude: Math.round(hot.health[id]),
      dinheiro: Math.round(hot.money[id]),
      habilidades: Object.fromEntries(
        Object.entries(c.skills).map(([k, v]) => [k, Math.round(v)]),
      ) as CitizenDetail['habilidades'],
      profissao: c.professionTitle,
      empresa: compId !== -1 ? this.companies[compId].name : null,
      escolaridade: c.education,
      atividade: ACTIVITY_LABELS[hot.activity[id]] ?? 'Ocioso',
      necessidades: {
        fome: Math.round(hot.hunger[id]),
        sono: Math.round(hot.sleep[id]),
        social: Math.round(hot.social[id]),
        seguranca: Math.round(hot.safety[id]),
        diversao: Math.round(hot.fun[id]),
      },
      realizacao: Math.round(hot.fulfillment[id]),
      religiosidade: Math.round(c.religiosidade),
      religiao: c.religiao,
      hobby: c.hobby ? VENUE_INFO[c.hobby].label : null,
      fama: Math.round(hot.fame[id]),
      objetivos: c.goals,
      amigos: friends,
      conjuge: partner !== -1 ? { id: partner, nome: nameOf(partner) } : null,
      pais: c.parents.map((p) => ({ id: p, nome: nameOf(p) })),
      filhos: c.children.map((f) => ({ id: f, nome: nameOf(f) })),
      memorias: [...c.memory].reverse().slice(0, 25),
      temCasaPropria: hot.ownsHouse[id] === 1,
      temCarro: hot.ownsCar[id] === 1,
      planoAtual: c.currentPlan,
      prefeito: hot.isMayor[id] === 1,
      preso: hot.inJail[id] === 1,
      criminoso: c.memory.some((m) => m.text === 'Cometeu um crime'),
      scoreCredito: Math.round(hot.creditScore[id]),
      emprestimos: this.bank.loanViews(id),
      contasAtrasadas: hot.unpaidMonths[id],
    };
  }

  /** Busca por nome (case-insensitive) — para a barra de pesquisa da UI. */
  searchByName(query: string) {
    const { hot, cold } = this.world;
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { id: number; nome: string; idade: number; profissao: string }[] = [];
    for (let i = 0; i < this.world.entityRange && out.length < 30; i++) {
      if (!hot.alive[i]) continue;
      const c = cold[i];
      if (c && c.name.toLowerCase().includes(q)) {
        out.push({
          id: i,
          nome: c.name,
          idade: Math.floor(hot.ageDays[i] / DAYS_PER_YEAR),
          profissao: c.professionTitle,
        });
      }
    }
    return out;
  }

  /** Posição atual de um cidadão (para a câmera seguir). */
  citizenPosition(id: number): { x: number; z: number } | null {
    if (!this.world.hot.alive[id]) return null;
    return { x: this.world.hot.posX[id], z: this.world.hot.posZ[id] };
  }

  /** Layout estático da cidade (enviado uma vez ao cliente). */
  layoutData() {
    return {
      blocks: this.city.blocks.map((b) => ({ x: b.x, z: b.z, zone: b.zone })),
      buildings: this.city.buildings.map((b) => ({
        id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, zone: b.zone,
      })),
      institutions: this.institutions.markers(),
      venues: this.venues.map((v) => ({ type: v.type, x: v.x, z: v.z })),
      worldSize: this.city.worldSize,
      blockSpan: this.city.blockSpan,
    };
  }

  companyViews(): CompanyView[] {
    return this.companies
      .filter((c) => !c.bankrupt)
      .sort((a, b) => b.capital - a.capital)
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        name: c.name,
        sector: c.sector,
        capital: Math.round(c.capital),
        employees: c.employees.size,
        openPositions: totalOpenings(c),
        bankrupt: c.bankrupt,
      }));
  }

  drainFeed(): FeedItem[] {
    const items = this.feedBuffer;
    this.feedBuffer = [];
    return items;
  }

  /**
   * Monta o frame de render (posições visíveis + veículos). Cidadãos dentro de
   * prédios/cadeia (building !== -1) são culados; quem está na rua é projetado
   * para a calçada da via mais próxima. Reusado pelo Web Worker e pelo servidor.
   */
  frameData(maxRendered = 20000): {
    positions: Float32Array;
    ids: Int32Array;
    activities: Uint8Array;
    count: number;
    vehiclePositions: Float32Array;
    vehicleCount: number;
  } {
    const { hot } = this.world;
    const range = this.world.entityRange;
    let count = 0;
    for (let i = 0; i < range; i++) if (hot.alive[i] && hot.building[i] === -1) count++;
    const cap = Math.min(count, maxRendered);
    const positions = new Float32Array(cap * 2);
    const ids = new Int32Array(cap);
    const activities = new Uint8Array(cap);

    const span = this.city.blockSpan;
    const half = this.city.worldSize / 2;
    const SIDEWALK = 1.4;
    const SPREAD = span * 0.34;
    let j = 0;
    for (let i = 0; i < range && j < cap; i++) {
      if (!hot.alive[i] || hot.building[i] !== -1) continue;
      const px = hot.posX[i];
      const pz = hot.posZ[i];
      const roadX = Math.round((px + half) / span) * span - half;
      const roadZ = Math.round((pz + half) / span) * span - half;
      const jit = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
      let rx: number, rz: number;
      if (Math.abs(roadX - px) <= Math.abs(roadZ - pz)) {
        rx = roadX + (px >= roadX ? SIDEWALK : -SIDEWALK);
        rz = pz + jit * SPREAD;
      } else {
        rz = roadZ + (pz >= roadZ ? SIDEWALK : -SIDEWALK);
        rx = px + jit * SPREAD;
      }
      positions[j * 2] = rx;
      positions[j * 2 + 1] = rz;
      ids[j] = i;
      activities[j] = hot.activity[i];
      j++;
    }
    const veh = this.traffic.snapshot();
    return {
      positions, ids, activities, count: j,
      vehiclePositions: veh.data, vehicleCount: veh.count,
    };
  }
}

function hour(tick: number): number {
  return tick % CONFIG.TICKS_PER_DAY;
}
