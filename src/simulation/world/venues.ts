import type { HotComponents, ColdData } from '../ecs/components';
import type { RNG } from '../rng';
import type { VenueType, VenueMarker, Sector } from '../types';
import { practiceSkill } from '../agents/skills';

/** Setor econômico que recebe o gasto de cada tipo de local de lazer. */
export const VENUE_SECTOR: Record<VenueType, Sector | null> = {
  restaurante: 'comercio',
  bar: 'comercio',
  cinema: 'cultura',
  teatro: 'cultura',
  estadio: 'esporte',
  ginasio: 'esporte',
  templo: null, // fé é de graça — não gera receita de empresa
};

export interface Venue {
  type: VenueType;
  x: number;
  z: number;
}

export const VENUE_INFO: Record<VenueType, { emoji: string; label: string }> = {
  restaurante: { emoji: '🍽️', label: 'Restaurante' },
  bar: { emoji: '🍺', label: 'Bar' },
  cinema: { emoji: '🎬', label: 'Cinema' },
  teatro: { emoji: '🎭', label: 'Teatro' },
  estadio: { emoji: '🏟️', label: 'Estádio' },
  ginasio: { emoji: '🏋️', label: 'Academia' },
  templo: { emoji: '⛪', label: 'Templo' },
};

const RELIGIONS = ['Católica', 'Evangélica', 'Espírita', 'Budista', 'Umbanda', 'Judaica'];

/** Distribui tipos de local sobre os pontos de lazer da cidade, com variedade. */
export function buildVenues(spots: { x: number; z: number }[], rng: RNG): Venue[] {
  // pesos de quantos de cada tipo (variedade urbana)
  const weights: [VenueType, number][] = [
    ['restaurante', 5], ['bar', 4], ['cinema', 3], ['teatro', 2],
    ['estadio', 1], ['ginasio', 3], ['templo', 3],
  ];
  const bag: VenueType[] = [];
  for (const [t, w] of weights) for (let i = 0; i < w; i++) bag.push(t);
  return spots.map((s) => ({ type: rng.pick(bag), x: s.x, z: s.z }));
}

export function venueMarkers(venues: Venue[]): VenueMarker[] {
  return venues.map((v) => ({ type: v.type, x: v.x, z: v.z }));
}

export function assignReligion(rng: RNG, religiosidade: number): string | null {
  return religiosidade > 35 ? rng.pick(RELIGIONS) : null;
}

export function randomHobby(rng: RNG, cold: ColdData): VenueType {
  const p = cold.personality;
  const weighted: [VenueType, number][] = [
    ['restaurante', 1.5],
    ['bar', 0.5 + p.extroversao / 60],
    ['cinema', 0.6 + p.abertura / 80],
    ['teatro', 0.3 + (p.abertura * 0.7 + p.consciencia * 0.3) / 90],
    ['estadio', 0.4 + (p.extroversao + cold.skills.esporte) / 160],
    ['ginasio', 0.4 + (p.consciencia + cold.skills.esporte) / 130],
  ];
  let total = 0;
  for (const [, w] of weighted) total += w;
  let r = rng.next() * total;
  for (const [t, w] of weighted) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'restaurante';
}

/**
 * Escolhe para onde ir agora: religiosos buscam o templo quando a realização
 * está baixa (conforto na fé); senão, o hobby preferido com variação.
 */
export function chooseVenue(hot: HotComponents, cold: ColdData, id: number, rng: RNG): VenueType {
  if (cold.religiosidade > 45 && hot.fulfillment[id] < 55 && rng.chance(cold.religiosidade / 140)) {
    return 'templo';
  }
  if (rng.chance(0.55) && cold.hobby) return cold.hobby;
  return randomHobby(rng, cold);
}

/**
 * Aplica a visita: custo + efeitos em necessidades/realização/saúde/fé.
 * Cada tipo de local atende uma faceta diferente do bem-estar.
 */
export function applyVenueVisit(
  hot: HotComponents,
  cold: ColdData,
  id: number,
  type: VenueType,
  funPrice: number,
  foodPrice: number,
): number {
  const add = (arr: Float32Array, v: number) => (arr[id] = Math.min(100, arr[id] + v));
  let spent = 0;
  switch (type) {
    case 'restaurante':
      spent = foodPrice * 4;
      add(hot.hunger, 45); add(hot.fun, 10); add(hot.fulfillment, 8); add(hot.social, 8);
      break;
    case 'bar':
      spent = funPrice * 1.2;
      add(hot.social, 25); add(hot.fun, 18); add(hot.fulfillment, 10);
      break;
    case 'cinema':
      spent = funPrice;
      add(hot.fun, 22); add(hot.fulfillment, 12);
      break;
    case 'teatro':
      spent = funPrice * 1.6;
      add(hot.fun, 15); add(hot.fulfillment, 22);
      break;
    case 'estadio':
      spent = funPrice * 1.3;
      add(hot.fun, 26); add(hot.social, 15); add(hot.fulfillment, 16);
      break;
    case 'ginasio':
      spent = funPrice * 0.6;
      add(hot.fun, 8); add(hot.health, 6); add(hot.fulfillment, 14);
      // praticar esporte (pode virar talento → atleta profissional)
      practiceSkill(cold, 'esporte', hot.intelligence[id], 1.2);
      break;
    case 'templo':
      // fé é de graça e conforta: realização, segurança e ânimo
      add(hot.fulfillment, 26); add(hot.safety, 18); add(hot.social, 10);
      add(hot.happiness, 4);
      break;
  }
  hot.money[id] -= spent;
  return spent; // valor gasto (vira receita do setor correspondente)
}
