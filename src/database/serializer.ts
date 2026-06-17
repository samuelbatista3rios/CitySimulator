import { Simulation } from '../simulation/simulation';
import type { ColdData } from '../simulation/ecs/components';
import type { Relationship } from '../simulation/types';

/**
 * Serialização de snapshot completo da simulação (worker-side).
 * O payload JSON resultante é enviado ao backend (PostgreSQL) ou
 * salvo em localStorage como fallback.
 */

const HOT_FIELDS = [
  'alive', 'ageDays', 'sexF', 'intelligence', 'energy', 'happiness', 'health',
  'money', 'hunger', 'sleep', 'social', 'safety', 'fun', 'posX', 'posZ',
  'targetX', 'targetZ', 'activity', 'activityUntil', 'nextThink', 'homeId',
  'companyId', 'jobLevel', 'partnerId', 'ownsHouse', 'ownsCar', 'isOwner', 'building',
  'creditScore', 'inJail', 'jailUntil', 'isMayor', 'unpaidMonths', 'publicJob',
  'fulfillment', 'fame', 'criminalRecord', 'lastCrime', 'jailMonths',
] as const;

interface SavedCold extends Omit<ColdData, 'relationships'> {
  relationships: [number, Relationship][];
}

export function serialize(sim: Simulation, seed: number): string {
  const hot: Record<string, number[]> = {};
  const range = sim.world.entityRange;
  for (const f of HOT_FIELDS) {
    const src = (sim.world.hot as any)[f].subarray(0, range);
    // dinheiro é Float64 e pode acumular muitas casas decimais — arredondar reduz
    // drasticamente o tamanho da string JSON (ex.: "1234.5000000003" → "1235").
    hot[f] = f === 'money' ? Array.from(src, (v: number) => Math.round(v)) : Array.from(src);
  }
  const cold: (SavedCold | null)[] = sim.world.cold.slice(0, range).map((c) =>
    c ? { ...c, relationships: [...c.relationships.entries()] } : null,
  );
  const companies = sim.companies.map((c) => ({
    ...c,
    employees: [...c.employees],
  }));
  const residences = sim.city.residences.map((r) => ({
    id: r.id,
    occupants: r.occupants,
    ownerId: r.ownerId,
  }));
  return JSON.stringify({
    version: 1,
    seed,
    tick: sim.tick,
    entityRange: range,
    aliveCount: sim.world.aliveCount,
    hot,
    cold,
    companies,
    residences,
    economy: {
      inflationMonthly: sim.economy.inflationMonthly,
      priceLevel: sim.economy.priceLevel,
      wageLevel: sim.economy.wageLevel,
      taxPool: sim.economy.taxPool,
      bankruptciesTotal: sim.economy.bankruptciesTotal,
      demandMultiplier: sim.economy.demandMultiplier,
    },
    bank: sim.bank.dump(),
    government: sim.government.dump(),
    housing: sim.housing.dump(),
  });
}

/** Restaura uma simulação a partir do snapshot (recria a cidade pela seed). */
export function deserialize(payload: string): Simulation {
  const data = JSON.parse(payload);
  // population 0: vamos restaurar entidades manualmente
  const sim = new Simulation(data.seed, 0);
  sim.tick = data.tick;

  const range: number = data.entityRange;
  for (const f of HOT_FIELDS) {
    const arr = (sim.world.hot as any)[f];
    arr.set(data.hot[f]);
  }
  // reconstrói cold + freelist via createEntity não é trivial; setamos direto
  let alive = 0;
  for (let i = 0; i < range; i++) {
    const c: SavedCold | null = data.cold[i];
    sim.world.cold[i] = c
      ? { ...c, relationships: new Map(c.relationships) }
      : null;
    if (sim.world.hot.alive[i]) alive++;
  }
  (sim.world as any).highWater = range;
  sim.world.aliveCount = alive;
  const free: number[] = [];
  for (let i = 0; i < range; i++) if (!sim.world.hot.alive[i]) free.push(i);
  (sim.world as any).freeList = free;

  // empresas
  sim.companies.length = 0;
  for (const c of data.companies) {
    sim.companies.push({
      dividendsThisMonth: 0,
      lastProductivity: 1,
      price: 1,
      priceTrend: 1,
      lastProfit: 0,
      rnd: 0,
      techLevel: 1,
      ...c,
      employees: new Set(c.employees),
    });
  }
  sim.careers.rebuildHiringIndex();

  // residências (a geometria é determinística pela seed)
  for (const r of data.residences) {
    const res = sim.city.residences[r.id];
    if (res) {
      res.occupants = r.occupants;
      res.ownerId = r.ownerId;
    }
  }

  Object.assign(sim.economy, data.economy);
  if (data.bank) sim.bank.restore(data.bank);
  if (data.government) sim.government.restore(data.government);
  if (data.housing) sim.housing.restore(data.housing);
  return sim;
}
