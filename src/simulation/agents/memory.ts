import type { ColdData } from '../ecs/components';
import type { MemoryEvent, MemoryKind } from '../types';

const MAX_MEMORIES = 60;

/**
 * Memória episódica: eventos marcantes da vida do cidadão.
 * Memórias antigas e pouco importantes são esquecidas (compactação),
 * mantendo custo O(1) por agente em populações de 100k.
 */
export function remember(
  cold: ColdData,
  tick: number,
  kind: MemoryKind,
  text: string,
  otherId?: number,
): void {
  const ev: MemoryEvent = { tick, kind, text, otherId };
  cold.memory.push(ev);
  if (cold.memory.length > MAX_MEMORIES) {
    // Esquece o evento menos importante mais antigo (mantém marcos de vida).
    const keep: MemoryKind[] = ['casamento', 'filho', 'compra_casa', 'abriu_empresa', 'formatura'];
    const idx = cold.memory.findIndex((m) => !keep.includes(m.kind));
    cold.memory.splice(idx === -1 ? 0 : idx, 1);
  }
}

export function recall(cold: ColdData, kind: MemoryKind): MemoryEvent[] {
  return cold.memory.filter((m) => m.kind === kind);
}

/** Já brigou com essa pessoa? Usado para evitar reaproximação imediata. */
export function hasConflictWith(cold: ColdData, otherId: number): boolean {
  return cold.memory.some((m) => m.kind === 'conflito' && m.otherId === otherId);
}
