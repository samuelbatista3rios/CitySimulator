import { CONFIG } from '../config';
import type { RNG } from '../rng';
import type { JobPosition, Sector, SkillName } from '../types';
import type { CityMap, Building } from '../world/cityTypes';
import { companyName } from '../agents/names';

export interface Company {
  id: number;
  name: string;
  sector: Sector;
  buildingId: number;
  x: number;
  z: number;
  capital: number;
  ownerId: number; // -1 = corporação sem dono-cidadão
  positions: JobPosition[]; // catálogo de cargos
  /** vagas abertas por nível */
  openings: number[];
  /** funcionários por id de cidadão */
  employees: Set<number>;
  bankrupt: boolean;
  revenueThisMonth: number;
  foundedTick: number;
}

const SECTOR_SKILL: Record<Sector, SkillName> = {
  tecnologia: 'programacao',
  comercio: 'vendas',
  industria: 'engenharia',
  servicos: 'lideranca',
  cultura: 'arte',
  esporte: 'esporte',
};

const SECTOR_TITLES: Record<Sector, string[]> = {
  tecnologia: ['Dev Júnior', 'Dev Pleno', 'Tech Lead', 'CTO'],
  comercio: ['Vendedor(a)', 'Supervisor(a)', 'Gerente de Loja', 'Diretor(a) Comercial'],
  industria: ['Operador(a)', 'Técnico(a)', 'Engenheiro(a)', 'Diretor(a) Industrial'],
  servicos: ['Assistente', 'Analista', 'Coordenador(a)', 'Diretor(a)'],
  cultura: ['Artista', 'Produtor(a)', 'Curador(a)', 'Diretor(a) Criativo'],
  esporte: ['Atleta amador(a)', 'Atleta profissional', 'Estrela do esporte', 'Lenda do esporte'],
};

const ZONE_SECTORS: Record<string, Sector[]> = {
  centro: ['tecnologia', 'servicos', 'comercio'],
  comercial: ['comercio', 'servicos', 'cultura'],
  industrial: ['industria', 'industria', 'tecnologia'],
};

export function makePositions(rng: RNG, sector: Sector, wageMultiplier: number): JobPosition[] {
  const titles = SECTOR_TITLES[sector];
  const skill = SECTOR_SKILL[sector];
  return titles.map((title, level) => ({
    title,
    skill,
    level,
    minSkill: 10 + level * 22,
    salary: Math.round(CONFIG.BASE_SALARY * Math.pow(2.1, level) * rng.range(0.85, 1.25) * wageMultiplier),
  }));
}

export function createCompany(
  rng: RNG,
  id: number,
  building: Building,
  sector: Sector,
  size: number,
  tick: number,
  ownerId = -1,
  wageMultiplier = 1,
): Company {
  return {
    id,
    name: companyName(rng, sector),
    sector,
    buildingId: building.id,
    x: building.x,
    z: building.z,
    capital: rng.range(50_000, 500_000) * (1 + size / 10),
    ownerId,
    positions: makePositions(rng, sector, wageMultiplier),
    openings: [Math.ceil(size * 0.55), Math.ceil(size * 0.3), Math.ceil(size * 0.12), Math.max(1, Math.round(size * 0.03))],
    employees: new Set(),
    bankrupt: false,
    revenueThisMonth: 0,
    foundedTick: tick,
  };
}

/** Gera as 2.000 empresas iniciais nos prédios comerciais/industriais/centro. */
export function generateCompanies(rng: RNG, city: CityMap): Company[] {
  const companies: Company[] = [];
  const pools: Building[] = [
    ...(city.byZone.get('centro') ?? []),
    ...(city.byZone.get('comercial') ?? []),
    ...(city.byZone.get('industrial') ?? []),
  ];
  let cid = 0;
  outer: for (let round = 0; round < 60; round++) {
    for (const bld of pools) {
      if (round >= bld.capacity) continue;
      if (cid >= CONFIG.START_COMPANIES) break outer;
      const sectors = ZONE_SECTORS[bld.zone] ?? (['servicos'] as Sector[]);
      const sector = rng.pick(sectors);
      const size = bld.zone === 'centro' ? rng.int(8, 40) : rng.int(2, 12);
      companies.push(createCompany(rng, cid++, bld, sector, size, 0));
    }
  }
  return companies;
}

export function totalOpenings(c: Company): number {
  return c.openings.reduce((a, b) => a + b, 0);
}

export function sectorSkill(sector: Sector): SkillName {
  return SECTOR_SKILL[sector];
}
