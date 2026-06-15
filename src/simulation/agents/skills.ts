import type { ColdData } from '../ecs/components';
import type { RNG } from '../rng';
import { SKILL_NAMES, type SkillName } from '../types';

/** Habilidades iniciais conforme inteligência e educação. */
export function initialSkills(rng: RNG, intelligence: number): Record<SkillName, number> {
  const base = intelligence * 0.3;
  const skills = {} as Record<SkillName, number>;
  for (const s of SKILL_NAMES) {
    skills[s] = Math.max(0, Math.min(100, base + rng.range(-10, 25)));
  }
  return skills;
}

/**
 * Aprendizado com retornos decrescentes: praticar evolui a habilidade;
 * quanto maior o nível, mais lento o ganho. Inteligência acelera.
 */
export function practiceSkill(cold: ColdData, skill: SkillName, intelligence: number, hours: number): number {
  const current = cold.skills[skill];
  const gain = hours * 0.15 * (1 + intelligence / 120) * (1 - current / 110);
  cold.skills[skill] = Math.min(100, current + Math.max(0.01, gain));
  return gain;
}

export function bestSkill(cold: ColdData): { name: SkillName; value: number } {
  let best: SkillName = SKILL_NAMES[0];
  for (const s of SKILL_NAMES) if (cold.skills[s] > cold.skills[best]) best = s;
  return { name: best, value: cold.skills[best] };
}
