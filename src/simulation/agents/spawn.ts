import { CONFIG } from '../config';
import type { ColdData } from '../ecs/components';
import type { EcsWorld } from '../ecs/world';
import type { RNG } from '../rng';
import type { CityMap } from '../world/cityTypes';
import type { BigFive, EducationLevel, Sex } from '../types';
import { randomName, childName } from './names';
import { randomPersonality, inheritPersonality } from './personality';
import { initialSkills } from './skills';
import { randomHobby, assignReligion } from '../world/venues';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function educationFor(rng: RNG, intelligence: number, ageYears: number): EducationLevel {
  if (ageYears < 15) return 'fundamental';
  if (ageYears < 18) return 'medio';
  const roll = rng.next() * 100 + intelligence * 0.4;
  if (roll > 115) return 'pos';
  if (roll > 80) return 'superior';
  if (roll > 45) return 'medio';
  return 'fundamental';
}

function makeCold(name: string, sex: Sex, personality: BigFive, education: EducationLevel, skills: ColdData['skills']): ColdData {
  return {
    name,
    sex,
    personality,
    education,
    professionTitle: 'Desempregado(a)',
    skills,
    religiosidade: 0,
    religiao: null,
    hobby: null,
    memory: [],
    relationships: new Map(),
    goals: [],
    parents: [],
    children: [],
    currentPlan: [],
    jobHistory: [],
  };
}

const clampN = (v: number) => Math.max(0, Math.min(100, v));

/** Define fé e hobby de um cidadão a partir de personalidade + acaso. */
function endowCulture(rng: RNG, cold: ColdData): void {
  // religiosidade puxada por amabilidade/consciência + variação social
  cold.religiosidade = clampN(
    (cold.personality.amabilidade * 0.4 + cold.personality.consciencia * 0.3) + rng.gaussian() * 22,
  );
  cold.religiao = assignReligion(rng, cold.religiosidade);
  cold.hobby = randomHobby(rng, cold);
}

/** Cria um cidadão adulto/jovem da população inicial. */
export function spawnCitizen(world: EcsWorld, rng: RNG, city: CityMap, residenceId: number): number {
  const sex: Sex = rng.chance(0.5) ? 'M' : 'F';
  const personality = randomPersonality(rng);
  const intelligence = clamp(50 + rng.gaussian() * 16);
  const ageYears = Math.max(1, Math.min(85, 32 + rng.gaussian() * 16));
  const skills = initialSkills(rng, intelligence);
  const cold = makeCold(randomName(rng, sex), sex, personality, educationFor(rng, intelligence, ageYears), skills);
  endowCulture(rng, cold);

  const id = world.createEntity(cold);
  if (id === -1) return -1;
  const { hot } = world;
  const res = city.residences[residenceId];

  hot.ageDays[id] = ageYears * CONFIG.DAYS_PER_MONTH * CONFIG.MONTHS_PER_YEAR;
  hot.sexF[id] = sex === 'F' ? 1 : 0;
  hot.intelligence[id] = intelligence;
  hot.energy[id] = rng.range(60, 100);
  hot.happiness[id] = rng.range(40, 80);
  hot.health[id] = clamp(95 - ageYears * 0.4 + rng.range(-10, 10));
  hot.money[id] = rng.range(CONFIG.STARTING_MONEY_MIN, CONFIG.STARTING_MONEY_MAX) * (1 + ageYears / 40);
  hot.hunger[id] = rng.range(50, 100);
  hot.sleep[id] = rng.range(50, 100);
  hot.social[id] = rng.range(40, 90);
  hot.safety[id] = rng.range(60, 95);
  hot.fun[id] = rng.range(40, 90);
  hot.fulfillment[id] = rng.range(40, 70);
  hot.fame[id] = 0;
  hot.homeId[id] = residenceId;
  hot.posX[id] = res.x + rng.range(-2, 2);
  hot.posZ[id] = res.z + rng.range(-2, 2);
  hot.targetX[id] = hot.posX[id];
  hot.targetZ[id] = hot.posZ[id];
  hot.nextThink[id] = rng.int(0, CONFIG.THINK_INTERVAL_TICKS);
  res.occupants.push(id);
  if (rng.chance(0.25)) hot.ownsCar[id] = 1;
  if (rng.chance(0.3)) { hot.ownsHouse[id] = 1; res.ownerId = id; }
  return id;
}

/** Nascimento: filho herda características dos pais. */
export function spawnChild(world: EcsWorld, rng: RNG, city: CityMap, motherId: number, fatherId: number, tick: number): number {
  const { hot, cold } = world;
  const cm = cold[motherId];
  const cf = cold[fatherId];
  if (!cm || !cf) return -1;

  const sex: Sex = rng.chance(0.5) ? 'M' : 'F';
  const personality = inheritPersonality(rng, cm.personality, cf.personality);
  const intelligence = clamp(
    (hot.intelligence[motherId] + hot.intelligence[fatherId]) / 2 + rng.gaussian() * 10,
  );
  const skills = initialSkills(rng, intelligence * 0.4); // aptidões latentes
  const childCold = makeCold(childName(rng, sex, cf.name), sex, personality, 'fundamental', skills);
  childCold.parents = [motherId, fatherId];
  endowCulture(rng, childCold);
  // herda a religião de um dos pais (transmissão cultural)
  const parentReligion = cm.religiao ?? cf.religiao;
  if (parentReligion && rng.chance(0.7)) {
    childCold.religiao = parentReligion;
    childCold.religiosidade = clampN((cm.religiosidade + cf.religiosidade) / 2 + rng.gaussian() * 15);
  }

  const id = world.createEntity(childCold);
  if (id === -1) return -1;

  hot.ageDays[id] = 0;
  hot.sexF[id] = sex === 'F' ? 1 : 0;
  hot.intelligence[id] = intelligence;
  hot.energy[id] = 100;
  hot.happiness[id] = 80;
  hot.health[id] = 100;
  hot.money[id] = 0;
  hot.hunger[id] = 80;
  hot.sleep[id] = 80;
  hot.social[id] = 80;
  hot.safety[id] = 90;
  hot.fun[id] = 80;
  hot.fulfillment[id] = 60;
  hot.fame[id] = 0;
  const home = hot.homeId[motherId];
  hot.homeId[id] = home;
  const res = home !== -1 ? city.residences[home] : null;
  hot.posX[id] = res ? res.x : hot.posX[motherId];
  hot.posZ[id] = res ? res.z : hot.posZ[motherId];
  hot.targetX[id] = hot.posX[id];
  hot.targetZ[id] = hot.posZ[id];
  hot.nextThink[id] = tick + rng.int(1, CONFIG.THINK_INTERVAL_TICKS);
  if (res) res.occupants.push(id);

  cm.children.push(id);
  cf.children.push(id);
  return id;
}
