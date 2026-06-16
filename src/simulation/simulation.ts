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
import { HousingMarket } from './economy/housing';
import { Government } from './government/government';
import { InstitutionSystem } from './institutions/institutions';
import { GlobalEventSystem } from './events/globalEvents';
import { TrafficSystem } from './traffic/traffic';
import { buildVenues, chooseVenue, applyVenueVisit, VENUE_INFO, VENUE_SECTOR, type Venue } from './world/venues';
import {
  Activity,
  ACTIVITY_LABELS,
  type CityStats,
  type CitizenDetail,
  type FeedItem,
  type CompanyView,
  type Sector,
  type MonitorData,
  type HeatmapData,
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
  housing: HousingMarket;
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
    // estádio de futebol: venue esportivo garantido no local designado da cidade
    if (this.city.stadium) {
      this.venues.push({ type: 'estadio', x: this.city.stadium.x, z: this.city.stadium.z });
    }
    for (const v of this.venues) {
      const list = this.venuesByType.get(v.type) ?? [];
      list.push(v);
      this.venuesByType.set(v.type, list);
    }
    this.companies = generateCompanies(this.rng, this.city, population);
    this.createSportsClubs();

    const feed = (item: FeedItem) => {
      this.feedBuffer.push(item);
      if (this.feedBuffer.length > 100) this.feedBuffer.shift();
    };

    this.careers = new CareerSystem(this.world, this.companies, this.rng, feed);
    this.economy = new EconomySystem(this.world, this.companies, this.careers, this.rng, feed);
    this.bank = new Bank(this.world, this.rng, feed);
    this.housing = new HousingMarket(this.world, this.city);
    this.economy.rentFactor = (homeId) => this.housing.rentFactor(homeId);
    this.government = new Government(this.world, this.rng, feed);
    this.institutions = new InstitutionSystem(this.world, this.city, this.careers, this.economy, this.rng, feed);
    this.relationships = new RelationshipSystem(this.world, this.rng, feed);
    this.lifecycle = new LifecycleSystem(this.world, this.city, this.careers, this.rng, feed);
    this.events = new GlobalEventSystem(this.rng, this.economy, this.lifecycle, feed);
    // Ganchos dos eventos instantâneos (leis/empresas/imóveis)
    this.events.hooks = {
      spawnCompanies: (n) => this.replenishCompanies(n, this.tick),
      failCompanies: (frac) => this.failWeakCompanies(frac, this.tick),
      mergeCompanies: () => this.mergeTwoCompanies(this.tick),
      housingShock: (mult) => { this.housing.priceIndex = Math.max(0.4, Math.min(6, this.housing.priceIndex * mult)); },
      approvalDelta: (d) => { this.government.approval = Math.max(0, Math.min(100, this.government.approval + d)); },
      budgetInject: (amt) => { this.government.budget += amt; },
    };
    this.traffic = new TrafficSystem(this.rng, this.city.worldSize, this.city.blockSpan);
    // trânsito não cruza o lago nem o complexo do estádio
    this.traffic.setBlocked(new Set([...this.city.lakeCells, ...this.city.stadiumCells]));

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
    // residências comuns (as de luxo do bairro nobre ficam vagas, reservadas
    // aos mais ricos — preenchidas depois por mobilidade residencial)
    const commonRes = this.city.residences.filter((r) => !r.premium).map((r) => r.id);
    const resCount = commonRes.length;
    for (let i = 0; i < population; i++) {
      const res = commonRes[i % resCount]; // ~2 pessoas por residência
      const id = spawnCitizen(this.world, this.rng, this.city, res);
      if (id === -1) break;
    }
    // Emprego inicial: contratação THOROUGH em várias rodadas — preenche as vagas
    // existentes de fato (antes uma passada rasa deixava ~20% de desemprego mesmo
    // com vagas sobrando). O que sobra é desemprego estrutural/friccional realista.
    const { hot } = this.world;
    const workers: number[] = [];
    for (const id of this.world.aliveEntities()) {
      const age = hot.ageDays[id] / DAYS_PER_YEAR;
      if (age >= CONFIG.ADULT_AGE && age < CONFIG.RETIREMENT_AGE) workers.push(id);
    }
    for (let round = 0; round < 4; round++) {
      let hired = 0;
      for (const id of workers) {
        if (hot.companyId[id] !== -1 || hot.isOwner[id]) continue;
        if (this.careers.tryGetJob(id, 0)) hired++;
      }
      this.careers.rebuildHiringIndex();
      if (hired === 0) break;
    }
    // povoa o bairro nobre com as famílias mais ricas no início ("old money")
    this.housing.seedNoble(this.economy.priceLevel);
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
      this.economy.corporateTaxRate = this.government.corporateTax;
      this.economy.propertyTaxMonthly = this.government.propertyTax;
      this.economy.minimumWage = this.government.minimumWage;
      this.economy.subsidyPool = this.government.subsidyAllocated;
      this.economy.laborSlack = this.government.unemploymentRate; // gate de crescimento de vagas
      this.housing.update(this.economy.priceLevel); // índice imobiliário (oferta×demanda)
      this.economy.monthlyCycle(this.tick);
      this.housing.sortWealthIntoNoble(this.economy.priceLevel); // mobilidade p/ o bairro nobre
      this.institutions.monthlyCycle(this.tick, this.government); // saúde, educação, crime/polícia
      this.careers.monthlyCareerMoves(this.tick);
      this.relationships.monthlyCouples(this.tick);
      this.lifecycle.healthcareAccess = this.government.healthFunding; // saúde pública ↓ mortalidade
      this.lifecycle.monthlyCycle(this.tick);
      this.events.monthlyCycle(this.tick);
      this.holdStadiumMatch(this.tick);
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
      // segurança privada do bairro nobre (condomínio fechado) eleva a sensação de segurança
      const home = h.homeId[i];
      const gated = home !== -1 && this.city.residences[home]?.premium ? 0.6 : 0;
      h.safety[i] = Math.min(100, Math.max(0, h.safety[i] - CONFIG.DECAY_SAFETY + (h.money[i] > 2000 ? 0.4 : 0) + gated));
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
          // atletas dos clubes esportivos trabalham/jogam NO ESTÁDIO
          if (comp.sector === 'esporte' && this.city.stadium) {
            goTo(this.city.stadium.x, this.city.stadium.z, comp.buildingId);
          } else {
            goTo(comp.x, comp.z, comp.buildingId);
          }
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
        // Investimento de mercado: RISCO REAL (retorno médio ~0) sobre uma base
        // LIMITADA. Antes o retorno tinha média positiva e era composto sobre todo
        // o patrimônio a cada ação → "impressora de dinheiro" que gerava fortunas
        // impossíveis. Agora o ganho esperado é ínfimo e o volatility drag impede
        // o crescimento exponencial descontrolado.
        {
          const exposable = Math.min(hot.money[i], 200_000 * this.economy.priceLevel);
          if (exposable > 0) {
            const amount = exposable * 0.1;
            hot.money[i] += amount * this.rng.range(-0.55, 0.55);
          }
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
          this.economy.spend('comercio', this.economy.foodPrice); // alimentação → comércio
          break;
        case Activity.JobHunting:
          this.careers.tryGetJob(i, this.tick);
          break;
        case Activity.Shopping: {
          hot.money[i] -= this.economy.foodPrice * 3;
          this.economy.spend('comercio', this.economy.foodPrice * 3); // varejo → comércio
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
              const price = this.housing.valueOf(resH.id) * this.economy.priceLevel;
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

  /**
   * Jogo no estádio: dois clubes se enfrentam. O vencedor sai pela força do
   * elenco (produtividade) + sorte; seus atletas ganham fama e ânimo, e os
   * torcedores (hobby estádio) curtem a partida. Aparece no feed da cidade.
   */
  private holdStadiumMatch(tick: number): void {
    if (!this.city.stadium) return;
    const clubs = this.companies.filter((c) => c.sector === 'esporte' && !c.bankrupt && c.employees.size > 0);
    if (clubs.length < 2 || !this.rng.chance(0.8)) return;
    const a = clubs[this.rng.int(0, clubs.length - 1)];
    let b = a;
    for (let g = 0; g < 6 && b === a; g++) b = clubs[this.rng.int(0, clubs.length - 1)];
    if (b === a) return;

    const sa = a.lastProductivity * this.rng.range(0.7, 1.3);
    const sb = b.lastProductivity * this.rng.range(0.7, 1.3);
    const win = sa >= sb ? a : b;
    const lose = win === a ? b : a;
    this.feedBuffer.push({ tick, kind: 'social', text: `⚽ Jogo no estádio: ${a.name} x ${b.name} — vitória do ${win.name}` });

    const { hot, cold } = this.world;
    for (const emp of win.employees) {
      hot.fame[emp] = Math.min(100, hot.fame[emp] + 2);
      hot.fulfillment[emp] = Math.min(100, hot.fulfillment[emp] + 5);
      hot.happiness[emp] = Math.min(100, hot.happiness[emp] + 4);
    }
    for (const emp of lose.employees) hot.happiness[emp] = Math.max(0, hot.happiness[emp] - 2);
    // torcida: quem tem o estádio como hobby aproveita o espetáculo
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const c = cold[i];
      if (c && c.hobby === 'estadio') {
        hot.fun[i] = Math.min(100, hot.fun[i] + 6);
        hot.fulfillment[i] = Math.min(100, hot.fulfillment[i] + 4);
      }
    }
  }

  /** Empreendedorismo: cria empresa nova num prédio comercial com vaga. */
  private foundCompany(i: number): void {
    const { hot, cold } = this.world;
    const c = cold[i];
    if (!c || hot.money[i] < CONFIG.BUSINESS_STARTUP_COST) return;
    // Saturação de mercado: não abre nova empresa se já há firmas demais para a
    // mão de obra (mantém empresas com quadro saudável em vez de vagas vazias).
    let active = 0;
    for (const co of this.companies) if (!co.bankrupt) active++;
    if (active >= this.world.aliveCount / 11) return;
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
    const spent = applyVenueVisit(this.world.hot, cold, i, type, this.economy.funPrice, this.economy.foodPrice);
    // o gasto de lazer vira receita do setor correspondente (comércio/cultura/esporte)
    const sector = VENUE_SECTOR[type];
    if (sector) this.economy.spend(sector, spent);
    return v ? { x: v.x, z: v.z } : null;
  }

  /** Cria clubes esportivos: empregam os talentosos como atletas (bem pagos). */
  private createSportsClubs(): void {
    let pool = [
      ...(this.city.byZone.get('comercial') ?? []),
      ...(this.city.byZone.get('centro') ?? []),
    ];
    if (pool.length === 0) return;
    const n = Math.max(8, Math.round(this.city.residences.length / 350)); // ~14 clubes
    // clubes se instalam PERTO DO ESTÁDIO (polo esportivo da cidade)
    const st = this.city.stadium;
    if (st) {
      pool = [...pool].sort(
        (a, b) => Math.hypot(a.x - st.x, a.z - st.z) - Math.hypot(b.x - st.x, b.z - st.z),
      );
    }
    for (let k = 0; k < n; k++) {
      // os primeiros clubes ficam junto ao estádio; os demais espalham
      const bld = st && k < Math.min(pool.length, Math.ceil(n * 0.6))
        ? pool[k % pool.length]
        : pool[this.rng.int(0, pool.length - 1)];
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

  /** Onda de falências: quebra uma fração das empresas mais frágeis (menor capital). */
  private failWeakCompanies(fraction: number, tick: number): void {
    const active = this.companies.filter((c) => !c.bankrupt);
    if (active.length === 0) return;
    active.sort((a, b) => a.capital - b.capital);
    const n = Math.max(1, Math.floor(active.length * fraction));
    for (let k = 0; k < n; k++) this.economy.forceBankrupt(active[k], tick);
  }

  /** Megafusão: uma empresa absorve outra do mesmo setor (capital + quadro). */
  private mergeTwoCompanies(tick: number): string | null {
    const { hot } = this.world;
    const active = this.companies.filter((c) => !c.bankrupt && c.employees.size > 0);
    if (active.length < 2) return null;
    const a = active[this.rng.int(0, active.length - 1)];
    const sameSector = active.filter((c) => c !== a && c.sector === a.sector);
    const candidates = sameSector.length ? sameSector : active.filter((c) => c !== a);
    if (candidates.length === 0) return null;
    const b = candidates[this.rng.int(0, candidates.length - 1)];
    // 'a' absorve 'b': transfere capital e funcionários
    a.capital += b.capital;
    for (const emp of b.employees) {
      hot.companyId[emp] = a.id;
      a.employees.add(emp);
    }
    b.employees.clear();
    b.bankrupt = true;
    b.openings = b.openings.map(() => 0);
    this.careers.rebuildHiringIndex();
    return a.name;
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
    // criminalidade: ancorada em crimes reais (por mil hab./ano), com escala
    // calibrada para que 100 = colapso real (e não furto miúdo cotidiano).
    // ~25 crimes/mil/ano (cidade tranquila) → ~15; ~120/mil (caos) → ~100.
    const crimeRate = pop > 0 ? (this.institutions.crimesThisYear / pop) * 1000 : 0;
    const crime = Math.min(
      100,
      crimeRate * 0.55 + unemployment * 0.6 + Math.max(0, 35 - avgHappiness) * 0.4,
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
      consumoFamilias: eco.consumoFamilias,
      dividendos: eco.dividendos,
      investimentoPED: eco.investimentoPED,
      criminalidade: crime,
      felicidadeMedia: avgHappiness,
      educacaoMedia: pop > 0 ? eduScore / pop : 0,
      saudeMedia: pop > 0 ? health / pop : 0,
      inflacao: eco.inflation,
      salarioMedio: salaryN > 0 ? salarySum / salaryN : 0,
      nascimentosAno: this.lifecycle.birthsThisYear,
      mortesAno: this.lifecycle.deathsThisYear,
      casamentosAno: this.relationships.marriagesThisYear,
      expectativaVida: this.lifecycle.lifeExpectancy,
      eventoAtivo: this.events.active?.label ?? null,
      fps: realTPS,
      // Governo & leis
      prefeito: this.government.mayorName(),
      plataforma: this.government.policy.name,
      aprovacao: this.government.mayorId !== -1 ? this.government.approval : 0,
      imposto: this.government.taxRate * 2 * 100, // topo marginal do IR progressivo
      impostoCorporativo: this.government.corporateTax * 100,
      impostoPropriedade: this.government.propertyTax * 100,
      arrecadacaoIR: this.economy.incomeTaxThisMonth,
      arrecadacaoCorp: this.economy.corpTaxThisMonth,
      arrecadacaoIPTU: this.economy.propertyTaxThisMonth,
      salarioMinimo: this.government.minimumWage,
      orcamentoPublico: this.government.budget,
      dividaPublica: this.government.debt,
      jurosDivida: this.government.debtInterest,
      austeridade: this.government.austerity < 0.999,
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
      // Imobiliário
      indiceImobiliario: this.housing.priceIndex,
      precoMedioImovel: this.housing.avgPrice,
      taxaProprietarios: this.housing.ownershipRate * 100,
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
      avos: this.kin(id, 'avos').map((k) => ({ id: k, nome: nameOf(k) })),
      pais: c.parents.map((p) => ({ id: p, nome: nameOf(p) })),
      irmaos: this.kin(id, 'irmaos').map((k) => ({ id: k, nome: nameOf(k) })),
      filhos: c.children.map((f) => ({ id: f, nome: nameOf(f) })),
      netos: this.kin(id, 'netos').map((k) => ({ id: k, nome: nameOf(k) })),
      memorias: [...c.memory].reverse().slice(0, 25),
      temCasaPropria: hot.ownsHouse[id] === 1,
      valorImovel: hot.ownsHouse[id] && hot.homeId[id] !== -1
        ? Math.round(this.housing.valueOf(hot.homeId[id]) * this.economy.priceLevel)
        : null,
      temCarro: hot.ownsCar[id] === 1,
      planoAtual: c.currentPlan,
      prefeito: hot.isMayor[id] === 1,
      preso: hot.inJail[id] === 1,
      criminoso: hot.criminalRecord[id] > 0 || c.memory.some((m) => m.text.startsWith('Cometeu')),
      fichaCriminal: hot.criminalRecord[id],
      scoreCredito: Math.round(hot.creditScore[id]),
      emprestimos: this.bank.loanViews(id),
      contasAtrasadas: hot.unpaidMonths[id],
    };
  }

  /** Parentesco estendido (avós, irmãos, netos) percorrendo pais/filhos. */
  private kin(id: number, rel: 'avos' | 'irmaos' | 'netos'): number[] {
    const cold = this.world.cold;
    const c = cold[id];
    if (!c) return [];
    const out: number[] = [];
    const seen = new Set<number>([id]);
    const push = (x: number) => { if (!seen.has(x)) { seen.add(x); out.push(x); } };
    if (rel === 'avos') {
      for (const p of c.parents) { const cp = cold[p]; if (cp) for (const gp of cp.parents) push(gp); }
    } else if (rel === 'irmaos') {
      for (const p of c.parents) { const cp = cold[p]; if (cp) for (const sib of cp.children) push(sib); }
    } else {
      for (const ch of c.children) { const cc = cold[ch]; if (cc) for (const gc of cc.children) push(gc); }
    }
    return out;
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
      blocks: this.city.blocks.map((b) => ({ x: b.x, z: b.z, zone: b.zone, elevation: b.elevation })),
      buildings: this.city.buildings.map((b) => ({
        id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, zone: b.zone, elevation: b.elevation,
      })),
      institutions: this.institutions.markers(),
      venues: this.venues.map((v) => ({ type: v.type, x: v.x, z: v.z })),
      worldSize: this.city.worldSize,
      blockSpan: this.city.blockSpan,
      stadium: this.city.stadium,
      nobleCenter: this.city.nobleCenter,
      boemioCenter: this.city.boemioCenter,
    };
  }

  companyViews(sort: import('./types').CompanySort = 'capital'): CompanyView[] {
    const { hot, cold } = this.world;
    const wage = this.economy.wageLevel;
    const cmp =
      sort === 'receita' ? (a: Company, b: Company) => b.revenueThisMonth - a.revenueThisMonth
      : sort === 'recentes' ? (a: Company, b: Company) => b.foundedTick - a.foundedTick
      : (a: Company, b: Company) => b.capital - a.capital;
    return this.companies
      .filter((c) => !c.bankrupt)
      .sort(cmp)
      .slice(0, 50)
      .map((c) => {
        // headcount por nível de cargo
        const filled = c.positions.map(() => 0);
        for (const emp of c.employees) {
          const lvl = Math.max(0, Math.min(c.positions.length - 1, hot.jobLevel[emp]));
          filled[lvl]++;
        }
        const positions = c.positions.map((p, lvl) => ({
          title: p.title,
          salary: Math.round(p.salary * wage),
          minSkill: p.minSkill,
          filled: filled[lvl],
          open: c.openings[lvl] ?? 0,
        }));
        const payroll = positions.reduce((s, p) => s + p.salary * p.filled, 0);
        const headcount = c.employees.size;
        return {
          id: c.id,
          name: c.name,
          sector: c.sector,
          capital: Math.round(c.capital),
          employees: headcount,
          openPositions: totalOpenings(c),
          bankrupt: c.bankrupt,
          ownerName: c.ownerId >= 0 ? cold[c.ownerId]?.name ?? null : null,
          revenue: Math.round(c.revenueThisMonth),
          dividends: Math.round(c.dividendsThisMonth),
          productivity: c.lastProductivity,
          price: c.price,
          techLevel: c.techLevel,
          foundedYear: Math.floor(c.foundedTick / TICKS_PER_YEAR) + 1,
          avgSalary: headcount > 0 ? Math.round(payroll / headcount) : 0,
          positions,
        };
      });
  }

  drainFeed(): FeedItem[] {
    const items = this.feedBuffer;
    this.feedBuffer = [];
    return items;
  }

  /** Distribuição/desigualdade + rankings (painel de monitoramento, sob demanda). */
  monitorData(): MonitorData {
    const { hot, cold } = this.world;
    const wealth: number[] = [];
    const pm = new Array(10).fill(0), pf = new Array(10).fill(0);
    const escolaridade = { fundamental: 0, medio: 0, superior: 0, pos: 0 };
    const all: { id: number; money: number; fame: number }[] = [];
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      const bucket = Math.min(9, Math.floor(age / 10));
      if (hot.sexF[i]) pf[bucket]++; else pm[bucket]++;
      const c = cold[i];
      if (c) escolaridade[c.education]++;
      if (age >= CONFIG.ADULT_AGE) {
        wealth.push(hot.money[i]);
        all.push({ id: i, money: hot.money[i], fame: hot.fame[i] });
      }
    }
    wealth.sort((a, b) => a - b);
    const n = wealth.length || 1;
    const total = wealth.reduce((s, v) => s + Math.max(0, v), 0) || 1;
    // Gini (sobre riqueza não-negativa)
    let cum = 0;
    for (let i = 0; i < wealth.length; i++) cum += (i + 1) * Math.max(0, wealth[i]);
    const gini = Math.max(0, Math.min(1, (2 * cum) / (n * total) - (n + 1) / n));
    // decis (riqueza média por décimo)
    const decis: number[] = [];
    for (let d = 0; d < 10; d++) {
      const a = Math.floor((d * n) / 10), b = Math.floor(((d + 1) * n) / 10);
      let s = 0; for (let k = a; k < b; k++) s += wealth[k];
      decis.push(b > a ? s / (b - a) : 0);
    }
    const pobreza = (wealth.filter((w) => w < 1500 * this.economy.priceLevel).length / n) * 100;

    const nameOf = (id: number) => cold[id]?.name ?? '—';
    const profOf = (id: number) => cold[id]?.professionTitle ?? '—';
    const ricos = [...all].sort((a, b) => b.money - a.money).slice(0, 10)
      .map((r) => ({ id: r.id, nome: nameOf(r.id), dinheiro: Math.round(r.money), profissao: profOf(r.id) }));
    const famosos = [...all].filter((r) => r.fame > 1).sort((a, b) => b.fame - a.fame).slice(0, 10)
      .map((r) => ({ id: r.id, nome: nameOf(r.id), fama: Math.round(r.fame), profissao: profOf(r.id) }));

    // proprietários: nº de imóveis e valor total por dono-cidadão
    const owned = new Map<number, { imoveis: number; valor: number }>();
    for (const r of this.city.residences) {
      if (r.ownerId < 0 || !hot.alive[r.ownerId]) continue;
      const e = owned.get(r.ownerId) ?? { imoveis: 0, valor: 0 };
      e.imoveis++;
      e.valor += this.housing.valueOf(r.id) * this.economy.priceLevel;
      owned.set(r.ownerId, e);
    }
    const proprietarios = [...owned.entries()]
      .sort((a, b) => b[1].valor - a[1].valor).slice(0, 10)
      .map(([id, e]) => ({ id, nome: nameOf(id), imoveis: e.imoveis, valor: Math.round(e.valor) }));

    const faixas = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90+'];
    const piramide = faixas.map((faixa, i) => ({ faixa, m: pm[i], f: pf[i] }));
    return { gini, decis, pobreza, piramide, escolaridade, ricos, famosos, proprietarios };
  }

  /** Valores agregados por quarteirão para mapas de calor (alinhado a city.blocks). */
  heatmapData(): HeatmapData {
    const { hot } = this.world;
    const N = CONFIG.CITY_BLOCKS;
    const span = this.city.blockSpan;
    const half = this.city.worldSize / 2;
    const len = this.city.blocks.length;
    const wSum = new Float64Array(len), hSum = new Float64Array(len), cSum = new Float64Array(len);
    const cnt = new Uint32Array(len);
    const blockOf = (x: number, z: number) => {
      const bx = Math.min(N - 1, Math.max(0, Math.floor((x + half) / span)));
      const bz = Math.min(N - 1, Math.max(0, Math.floor((z + half) / span)));
      return bz * N + bx;
    };
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const idx = blockOf(hot.posX[i], hot.posZ[i]);
      wSum[idx] += hot.money[i];
      hSum[idx] += hot.happiness[i];
      cSum[idx] += hot.criminalRecord[i];
      cnt[idx]++;
    }
    const wealth = new Array(len).fill(0);
    const happiness = new Array(len).fill(0);
    const crime = new Array(len).fill(0);
    for (let i = 0; i < len; i++) {
      if (cnt[i] > 0) {
        wealth[i] = wSum[i] / cnt[i];
        happiness[i] = hSum[i] / cnt[i];
        crime[i] = cSum[i]; // densidade de ficha criminal (soma)
      }
    }
    // valor do solo por quarteirão (média das residências do bloco)
    const landSum = new Float64Array(len), landCnt = new Uint32Array(len);
    for (const r of this.city.residences) {
      const idx = blockOf(r.x, r.z);
      landSum[idx] += this.housing.valueOf(r.id) * this.economy.priceLevel;
      landCnt[idx]++;
    }
    const land = new Array(len).fill(0);
    for (let i = 0; i < len; i++) if (landCnt[i] > 0) land[i] = landSum[i] / landCnt[i];
    return { wealth, happiness, crime, land };
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
