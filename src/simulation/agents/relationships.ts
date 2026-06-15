import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { FeedItem } from '../types';
import { remember, hasConflictWith } from './memory';
import { sociability } from './personality';

/**
 * Sistema social: amizades, conflitos, namoro, casamento e separação.
 * Interações ocorrem quando agentes socializam; compatibilidade depende
 * de amabilidade e proximidade de personalidade.
 */
export class RelationshipSystem {
  marriagesThisYear = 0;

  constructor(
    private world: EcsWorld,
    private rng: RNG,
    private feed: (item: FeedItem) => void,
  ) {}

  /** Interação entre dois cidadãos que estão socializando. */
  interact(a: number, b: number, tick: number): void {
    const { hot, cold } = this.world;
    const ca = cold[a];
    const cb = cold[b];
    if (!ca || !cb || a === b) return;

    const compat = this.compatibility(a, b);
    const relA = ca.relationships.get(b);

    // Conflito: baixa compatibilidade + amabilidade baixa
    if (compat < 0.25 && this.rng.chance(0.3)) {
      this.adjust(a, b, -25, tick);
      remember(ca, tick, 'conflito', `Brigou com ${cb.name}`, b);
      remember(cb, tick, 'conflito', `Brigou com ${ca.name}`, a);
      hot.happiness[a] = Math.max(0, hot.happiness[a] - 5);
      hot.happiness[b] = Math.max(0, hot.happiness[b] - 5);
      return;
    }

    // Aproximação
    this.adjust(a, b, 4 + compat * 8, tick);
    const rel = ca.relationships.get(b);

    if (rel && rel.kind === 'amigo' && rel.strength > 30 && !relA) {
      remember(ca, tick, 'amizade', `Ficou amigo de ${cb.name}`, b);
      remember(cb, tick, 'amizade', `Ficou amigo de ${ca.name}`, a);
    }

    // Romance: solteiros, sexos opostos, forte amizade, idades compatíveis
    if (
      rel &&
      rel.strength > 50 &&
      hot.partnerId[a] === -1 &&
      hot.partnerId[b] === -1 &&
      hot.sexF[a] !== hot.sexF[b] &&
      !hasConflictWith(ca, b) &&
      compat > 0.5 &&
      this.rng.chance(0.25)
    ) {
      rel.kind = 'namoro';
      const rb = cb.relationships.get(a);
      if (rb) rb.kind = 'namoro';
      hot.partnerId[a] = b;
      hot.partnerId[b] = a;
    }
  }

  /** Avalia casais mensalmente: casamento ou separação. */
  monthlyCouples(tick: number): void {
    const { hot, cold } = this.world;
    for (let i = 0; i < this.world.entityRange; i++) {
      if (!hot.alive[i]) continue;
      const p = hot.partnerId[i];
      if (p === -1 || p < i || !hot.alive[p]) continue;
      const ci = cold[i];
      const cp = cold[p];
      if (!ci || !cp) continue;
      const rel = ci.relationships.get(p);
      if (!rel) continue;

      if (rel.kind === 'namoro' && rel.strength > 70 && this.rng.chance(0.3)) {
        rel.kind = 'casamento';
        const rb = cp.relationships.get(i);
        if (rb) rb.kind = 'casamento';
        remember(ci, tick, 'casamento', `Casou com ${cp.name}`, p);
        remember(cp, tick, 'casamento', `Casou com ${ci.name}`, i);
        hot.happiness[i] = Math.min(100, hot.happiness[i] + 15);
        hot.happiness[p] = Math.min(100, hot.happiness[p] + 15);
        // passam a morar juntos
        if (hot.homeId[i] !== -1) hot.homeId[p] = hot.homeId[i];
        this.marriagesThisYear++;
        this.feed({ tick, kind: 'social', text: `${ci.name} e ${cp.name} se casaram 💍` });
      } else if (rel.strength < -10 && this.rng.chance(0.4)) {
        // separação
        rel.kind = 'ex';
        const rb = cp.relationships.get(i);
        if (rb) rb.kind = 'ex';
        hot.partnerId[i] = -1;
        hot.partnerId[p] = -1;
        remember(ci, tick, 'separacao', `Separou-se de ${cp.name}`, p);
        remember(cp, tick, 'separacao', `Separou-se de ${ci.name}`, i);
        hot.happiness[i] = Math.max(0, hot.happiness[i] - 20);
        hot.happiness[p] = Math.max(0, hot.happiness[p] - 20);
        this.feed({ tick, kind: 'social', text: `${ci.name} e ${cp.name} se separaram` });
      } else {
        // desgaste/fortalecimento natural conforme felicidade do casal
        const mood = (hot.happiness[i] + hot.happiness[p]) / 2;
        const delta = mood > 50 ? 2 : -4;
        rel.strength = Math.max(-100, Math.min(100, rel.strength + delta));
        const rb = cp.relationships.get(i);
        if (rb) rb.strength = rel.strength;
      }
    }
  }

  compatibility(a: number, b: number): number {
    const ca = this.world.cold[a]!;
    const cb = this.world.cold[b]!;
    const pa = ca.personality;
    const pb = cb.personality;
    const dist =
      Math.abs(pa.abertura - pb.abertura) +
      Math.abs(pa.consciencia - pb.consciencia) +
      Math.abs(pa.extroversao - pb.extroversao);
    const kindness = (pa.amabilidade + pb.amabilidade) / 200;
    return Math.max(0, Math.min(1, kindness * 0.6 + (1 - dist / 300) * 0.4));
  }

  /** Chance de iniciar interação, vinda da extroversão. */
  wantsToSocialize(id: number): boolean {
    const c = this.world.cold[id];
    return c ? this.rng.chance(sociability(c.personality)) : false;
  }

  private adjust(a: number, b: number, delta: number, tick: number): void {
    const ca = this.world.cold[a]!;
    const cb = this.world.cold[b]!;
    const MAX_RELS = 40; // limite por agente (escalabilidade de memória)
    const get = (cold: typeof ca, other: number) => {
      let r = cold.relationships.get(other);
      if (!r) {
        if (cold.relationships.size >= MAX_RELS) {
          // esquece o vínculo mais fraco
          let weakest = -1;
          let min = Infinity;
          for (const [k, v] of cold.relationships) {
            if (v.kind === 'amigo' || v.kind === 'ex') {
              if (Math.abs(v.strength) < min) { min = Math.abs(v.strength); weakest = k; }
            }
          }
          if (weakest !== -1) cold.relationships.delete(weakest);
        }
        r = { otherId: other, kind: delta >= 0 ? 'amigo' : 'inimigo', strength: 0, sinceTick: tick };
        cold.relationships.set(other, r);
      }
      return r;
    };
    const ra = get(ca, b);
    const rb = get(cb, a);
    ra.strength = Math.max(-100, Math.min(100, ra.strength + delta));
    rb.strength = Math.max(-100, Math.min(100, rb.strength + delta));
    if (ra.strength < -20 && ra.kind === 'amigo') ra.kind = 'inimigo';
    if (rb.strength < -20 && rb.kind === 'amigo') rb.kind = 'inimigo';
    if (ra.strength > 10 && ra.kind === 'inimigo') ra.kind = 'amigo';
    if (rb.strength > 10 && rb.kind === 'inimigo') rb.kind = 'amigo';
  }
}
