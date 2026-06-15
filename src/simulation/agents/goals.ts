import type { HotComponents, ColdData } from '../ecs/components';
import type { RNG } from '../rng';
import type { Goal, GoalKind } from '../types';
import { ambition } from './personality';
import { CONFIG } from '../config';

/**
 * Objetivos de vida surgem dinamicamente conforme idade, situação financeira,
 * personalidade e estado civil. Reavaliado quando o agente "pensa".
 */
export function updateGoals(id: number, hot: HotComponents, cold: ColdData, rng: RNG, tick: number): void {
  const age = hot.ageDays[id] / (CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR);
  const money = hot.money[id];
  const amb = ambition(cold.personality);
  const has = (k: GoalKind) => cold.goals.some((g) => g.kind === k);
  const add = (kind: GoalKind, priority: number) => {
    if (!has(kind) && cold.goals.length < 5) {
      cold.goals.push({ kind, priority, progress: 0, createdTick: tick });
    }
  };

  if (age < CONFIG.ADULT_AGE) {
    add('estudar', 0.9);
    return;
  }

  // Emprego é a base de tudo (público conta como empregado)
  if (hot.companyId[id] === -1 && !hot.isOwner[id] && !hot.publicJob[id] && age < CONFIG.RETIREMENT_AGE) {
    add('arranjar_emprego', 1.0);
  }

  if (!hot.ownsCar[id] && money > CONFIG.CAR_PRICE * 0.4) add('comprar_carro', 0.5 + amb * 0.2);
  if (!hot.ownsHouse[id] && money > CONFIG.HOUSE_PRICE * 0.2) add('comprar_casa', 0.6 + amb * 0.3);
  if (hot.partnerId[id] === -1 && age >= 20 && age <= 55 && rng.chance(0.4)) add('casar', 0.55);
  if (!hot.isOwner[id] && amb > 0.62 && money > CONFIG.BUSINESS_STARTUP_COST * 0.5) {
    add('abrir_empresa', 0.7 + amb * 0.3);
  }
  // Talento esportivo + juventude → sonha em virar atleta profissional
  if (age < 30 && cold.skills.esporte > 45 && !hot.isOwner[id]) {
    add('virar_atleta', 0.55 + cold.skills.esporte / 200);
  }
  if (amb > 0.7) add('enriquecer', amb);
  if (cold.personality.abertura > 60 && cold.education !== 'pos') add('estudar', 0.4 + cold.personality.abertura / 250);
  if (hot.companyId[id] !== -1 && hot.jobLevel[id] < 3 && cold.personality.consciencia > 55) {
    add('promocao', 0.5);
  }

  // Atualiza progresso e remove concluídos
  for (const g of cold.goals) {
    switch (g.kind) {
      case 'comprar_carro': g.progress = Math.min(1, money / CONFIG.CAR_PRICE); break;
      case 'comprar_casa': g.progress = Math.min(1, money / CONFIG.HOUSE_PRICE); break;
      case 'abrir_empresa': g.progress = Math.min(1, money / CONFIG.BUSINESS_STARTUP_COST); break;
      case 'enriquecer': g.progress = Math.min(1, money / 1_000_000); break;
      case 'arranjar_emprego': g.progress = hot.companyId[id] !== -1 ? 1 : 0; break;
      case 'casar': g.progress = hot.partnerId[id] !== -1 ? 1 : 0; break;
      default: break;
    }
  }
  cold.goals = cold.goals
    .filter((g) => {
      if (g.kind === 'comprar_carro' && hot.ownsCar[id]) return false;
      if (g.kind === 'comprar_casa' && hot.ownsHouse[id]) return false;
      if (g.kind === 'arranjar_emprego' && (hot.companyId[id] !== -1 || hot.isOwner[id] || hot.publicJob[id])) return false;
      if (g.kind === 'casar' && hot.partnerId[id] !== -1) return false;
      if (g.kind === 'abrir_empresa' && hot.isOwner[id]) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority);
}

export function topGoal(cold: ColdData): Goal | null {
  return cold.goals[0] ?? null;
}
