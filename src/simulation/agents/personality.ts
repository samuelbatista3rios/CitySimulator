import type { RNG } from '../rng';
import type { BigFive } from '../types';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Gera personalidade Big Five ~ normal(50, 18). */
export function randomPersonality(rng: RNG): BigFive {
  return {
    abertura: clamp(50 + rng.gaussian() * 18),
    consciencia: clamp(50 + rng.gaussian() * 18),
    extroversao: clamp(50 + rng.gaussian() * 18),
    amabilidade: clamp(50 + rng.gaussian() * 18),
    neuroticismo: clamp(50 + rng.gaussian() * 18),
  };
}

/** Herança: média dos pais + variação genética. */
export function inheritPersonality(rng: RNG, a: BigFive, b: BigFive): BigFive {
  const mix = (x: number, y: number) => clamp((x + y) / 2 + rng.gaussian() * 10);
  return {
    abertura: mix(a.abertura, b.abertura),
    consciencia: mix(a.consciencia, b.consciencia),
    extroversao: mix(a.extroversao, b.extroversao),
    amabilidade: mix(a.amabilidade, b.amabilidade),
    neuroticismo: mix(a.neuroticismo, b.neuroticismo),
  };
}

/**
 * Pesos de necessidade modulados pela personalidade — é aqui que a
 * personalidade vira comportamento (extrovertidos pesam mais "social", etc).
 */
export function needWeights(p: BigFive) {
  return {
    fome: 1.0,
    sono: 1.0 + (p.neuroticismo - 50) / 250,
    social: 0.6 + p.extroversao / 90,
    seguranca: 0.6 + p.neuroticismo / 110,
    diversao: 0.5 + p.abertura / 120,
    dinheiro: 0.7 + p.consciencia / 130,
  };
}

/** Propensão a empreender / ambição, derivada da personalidade. */
export function ambition(p: BigFive): number {
  return (p.abertura * 0.4 + p.consciencia * 0.4 + p.extroversao * 0.2) / 100;
}

/** Sociabilidade: chance de iniciar interações. */
export function sociability(p: BigFive): number {
  return (p.extroversao * 0.7 + p.amabilidade * 0.3) / 100;
}
