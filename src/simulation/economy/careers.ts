import { CONFIG } from '../config';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem, JobPosition, SkillName } from '../types';
import { SKILL_NAMES } from '../types';
import type { ColdData } from '../ecs/components';
import { remember } from '../agents/memory';
import { bestSkill, practiceSkill } from '../agents/skills';
import { sectorSkill, totalOpenings, type Company } from './companies';

const DAYS_PER_YEAR = CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;

/** Candidato atende aos requisitos (habilidade principal + secundária) do cargo? */
export function meetsRequirements(cold: ColdData, pos: JobPosition): boolean {
  if (cold.skills[pos.skill] < pos.minSkill) return false;
  if (pos.secondarySkill && cold.skills[pos.secondarySkill] < (pos.minSecondary ?? 0)) return false;
  return true;
}

/**
 * Desempenho no cargo 0..100: quão alinhadas estão as habilidades do cidadão às
 * exigidas pela função (principal + secundária). É isso que diz se alguém "vai
 * bem ou mal" naquele emprego — um Tech Lead com ótima programação mas pouca
 * liderança rende abaixo do esperado.
 */
export function jobPerformance(cold: ColdData, pos: JobPosition): number {
  const primary = Math.min(1.4, cold.skills[pos.skill] / Math.max(20, pos.minSkill + 20));
  let score = primary;
  let weight = 1;
  if (pos.secondarySkill) {
    const sec = Math.min(1.4, cold.skills[pos.secondarySkill] / Math.max(20, (pos.minSecondary ?? 20) + 20));
    score += sec * 0.7;
    weight += 0.7;
  }
  return Math.max(0, Math.min(100, (score / weight) * 100));
}

/**
 * Mercado de trabalho: contratação, promoção, demissão voluntária,
 * troca de empresa e demissão por falência.
 */
export class CareerSystem {
  /** índice de vagas: empresas com vagas abertas, reconstruído ao mudar */
  private hiring: Company[] = [];

  constructor(
    private world: EcsWorld,
    private companies: Company[],
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {
    this.rebuildHiringIndex();
  }

  rebuildHiringIndex(): void {
    this.hiring = this.companies.filter((c) => !c.bankrupt && totalOpenings(c) > 0);
  }

  /** Tenta empregar o cidadão. Retorna true se conseguiu. */
  tryGetJob(id: number, tick: number): boolean {
    const { hot, cold } = this.world;
    const c = cold[id];
    if (!c || this.hiring.length === 0) return false;

    // amostra algumas empresas e escolhe a melhor oferta compatível
    let best: { company: Company; level: number; score: number } | null = null;
    const tries = Math.min(8, this.hiring.length);
    for (let t = 0; t < tries; t++) {
      const comp = this.hiring[this.rng.int(0, this.hiring.length - 1)];
      if (comp.bankrupt) continue;
      for (let level = comp.openings.length - 1; level >= 0; level--) {
        if (comp.openings[level] <= 0) continue;
        const pos = comp.positions[level];
        if (meetsRequirements(c, pos)) {
          // melhores candidatos (mais aderentes ao cargo) preferem ofertas melhores
          const score = pos.salary * (1 + jobPerformance(c, pos) / 200);
          if (!best || score > best.score) best = { company: comp, level, score };
          break;
        }
      }
    }
    if (!best) return false;

    this.hire(id, best.company, best.level, tick);
    return true;
  }

  hire(id: number, company: Company, level: number, tick: number): void {
    const { hot, cold } = this.world;
    const c = cold[id]!;
    if (hot.companyId[id] !== -1) this.quit(id, tick, false);
    company.openings[level]--;
    company.employees.add(id);
    hot.companyId[id] = company.id;
    hot.jobLevel[id] = level;
    c.professionTitle = company.positions[level].title;
    c.jobHistory.push({ company: company.name, title: c.professionTitle, fromTick: tick, toTick: -1 });
    // histórico cresce ao longo de décadas; mantém só os mais recentes (save enxuto)
    if (c.jobHistory.length > 16) c.jobHistory.splice(0, c.jobHistory.length - 16);
    remember(c, tick, 'emprego', `Começou como ${c.professionTitle} na ${company.name}`);
    if (totalOpenings(company) === 0) this.rebuildHiringIndex();
  }

  quit(id: number, tick: number, voluntary: boolean): void {
    const { hot, cold } = this.world;
    const c = cold[id];
    const compId = hot.companyId[id];
    if (compId === -1 || !c) return;
    const company = this.companies[compId];
    company.employees.delete(id);
    if (!company.bankrupt) {
      company.openings[Math.max(0, hot.jobLevel[id])]++;
      this.rebuildHiringIndex();
    }
    const last = c.jobHistory[c.jobHistory.length - 1];
    if (last && last.toTick === -1) last.toTick = tick;
    hot.companyId[id] = -1;
    hot.jobLevel[id] = -1;
    c.professionTitle = 'Desempregado(a)';
    remember(c, tick, 'demissao', voluntary ? `Pediu demissão da ${company.name}` : `Saiu da ${company.name}`);
  }

  fire(id: number, tick: number, reason: string): void {
    const { cold, hot } = this.world;
    const c = cold[id];
    const compId = hot.companyId[id];
    if (compId === -1 || !c) return;
    const company = this.companies[compId];
    company.employees.delete(id);
    const last = c.jobHistory[c.jobHistory.length - 1];
    if (last && last.toTick === -1) last.toTick = tick;
    hot.companyId[id] = -1;
    hot.jobLevel[id] = -1;
    c.professionTitle = 'Desempregado(a)';
    remember(c, tick, 'demissao', `Foi demitido(a) da ${company.name} (${reason})`);
    hot.happiness[id] = Math.max(0, hot.happiness[id] - 15);
  }

  /** Avaliação mensal: promoções e trocas de emprego por insatisfação. */
  monthlyCareerMoves(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const compId = hot.companyId[i];
      if (compId === -1) continue;
      const c = cold[i];
      if (!c) continue;
      const company = this.companies[compId];
      const level = hot.jobLevel[i];
      const skill = c.skills[sectorSkill(company.sector)];

      // Promoção: precisa atender aos requisitos do próximo nível (técnica E
      // liderança, nos cargos de gestão) + vaga aberta. Quem domina só a parte
      // técnica fica barrado até desenvolver a liderança exigida.
      if (level < company.positions.length - 1) {
        const next = company.positions[level + 1];
        if (meetsRequirements(c, next) && company.openings[level + 1] > 0 && this.rng.chance(0.35)) {
          company.openings[level + 1]--;
          company.openings[level]++;
          hot.jobLevel[i] = level + 1;
          c.professionTitle = next.title;
          remember(c, tick, 'promocao', `Promovido(a) a ${next.title} na ${company.name}`);
          hot.happiness[i] = Math.min(100, hot.happiness[i] + 10);
          if (this.rng.chance(0.1)) {
            this.feed({ tick, kind: 'economia', text: `${c.name} foi promovido(a) a ${next.title}` });
          }
          continue;
        }
      }

      // Insatisfação → pedir demissão / trocar de empresa
      const underpaid = skill > company.positions[level].minSkill + 30;
      if ((hot.happiness[i] < 25 || underpaid) && this.rng.chance(0.15)) {
        const hadJob = company.name;
        this.quit(i, tick, true);
        // tenta recolocação imediata (troca de empresa)
        if (this.tryGetJob(i, tick)) {
          const newComp = this.companies[hot.companyId[i]];
          if (newComp.name !== hadJob && this.rng.chance(0.05)) {
            this.feed({ tick, kind: 'economia', text: `${c.name} trocou a ${hadJob} pela ${newComp.name}` });
          }
        }
      }
    }
  }

  /**
   * Evolução e ATROFIA mensal de habilidades. Habilidades não são estáticas:
   *  - quem trabalha desenvolve a competência do setor e, em cargos de gestão, a
   *    LIDERANÇA exigida (experiência prática → abre caminho para promoção);
   *  - habilidades que ninguém pratica enferrujam devagar, regredindo a um piso
   *    ligado à inteligência (talento latente). Assim o destaque de cada um reflete
   *    o que de fato exercita — estudo e trabalho fazem subir; ócio faz cair.
   */
  monthlySkillDrift(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const c = cold[i];
      if (!c) continue;
      const age = hot.ageDays[i] / DAYS_PER_YEAR;
      if (age < CONFIG.ADULT_AGE) continue;
      const intel = hot.intelligence[i];
      const floor = intel * 0.12; // talento latente preservado
      const employed = hot.companyId[i] !== -1 || hot.isOwner[i] === 1;
      const compId = hot.companyId[i];
      const usedSkill = compId !== -1 ? sectorSkill(this.companies[compId].sector) : null;
      const pos = compId !== -1 ? this.companies[compId].positions[Math.max(0, hot.jobLevel[i])] : null;
      // experiência: prática on-the-job da função (principal + secundária de gestão)
      if (employed && usedSkill) practiceSkill(c, usedSkill, intel, 0.6);
      if (pos?.secondarySkill) practiceSkill(c, pos.secondarySkill, intel, 0.5);
      // atrofia das demais habilidades (não exercitadas neste cargo)
      for (const s of SKILL_NAMES) {
        if (s === usedSkill || s === pos?.secondarySkill) continue;
        const v = c.skills[s];
        if (v > floor) c.skills[s] = Math.max(floor, v - 0.35);
      }
    }
  }

  salaryOf(id: number): number {
    const { hot } = this.world;
    const compId = hot.companyId[id];
    if (compId === -1) return 0;
    const level = hot.jobLevel[id];
    return this.companies[compId].positions[Math.max(0, level)].salary;
  }

  /** Cidadão abre o próprio negócio. */
  openBusiness(id: number, company: Company, tick: number): void {
    const { hot, cold } = this.world;
    const c = cold[id]!;
    if (hot.companyId[id] !== -1) this.quit(id, tick, true);
    hot.isOwner[id] = 1;
    hot.companyId[id] = company.id;
    hot.jobLevel[id] = 3;
    c.professionTitle = `Fundador(a) da ${company.name}`;
    company.employees.add(id);
    remember(c, tick, 'abriu_empresa', `Abriu a empresa ${company.name}`);
    this.feed({ tick, kind: 'economia', text: `${c.name} abriu a empresa ${company.name} 🏢` });
    this.rebuildHiringIndex();
  }
}
