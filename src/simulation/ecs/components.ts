import { CONFIG } from '../config';
import type {
  BigFive,
  EducationLevel,
  Goal,
  MemoryEvent,
  Relationship,
  Sex,
  SkillName,
} from '../types';

/**
 * ECS híbrido (SoA + cold data):
 *
 * - Dados "quentes" (lidos/escritos todo tick para 10k–100k entidades) ficam em
 *   typed arrays Structure-of-Arrays: cache-friendly, sem GC, transferíveis.
 * - Dados "frios" (memória, relacionamentos, objetivos — acessados só quando o
 *   agente "pensa") ficam em objetos JS indexados pelo entity id.
 */
export class HotComponents {
  readonly capacity: number;

  // Identidade / ciclo de vida
  alive: Uint8Array;
  ageDays: Float32Array; // idade em dias simulados
  sexF: Uint8Array; // 1 = feminino

  // Atributos
  intelligence: Float32Array; // 0..100
  energy: Float32Array; // 0..100
  happiness: Float32Array; // 0..100
  health: Float32Array; // 0..100
  money: Float64Array;

  // Necessidades 0..100 (100 = plenamente satisfeita)
  hunger: Float32Array;
  sleep: Float32Array;
  social: Float32Array;
  safety: Float32Array;
  fun: Float32Array;
  /** realização/satisfação de vida 0..100 — lazer, fé, hobbies, fama */
  fulfillment: Float32Array;
  /** prestígio público 0..100 (atletas/artistas de destaque) */
  fame: Float32Array;

  // Posição e movimento (plano XZ)
  posX: Float32Array;
  posZ: Float32Array;
  targetX: Float32Array;
  targetZ: Float32Array;

  // Estado comportamental
  activity: Uint8Array; // enum Activity
  activityUntil: Int32Array; // tick em que a atividade termina
  nextThink: Int32Array; // próximo tick de replanejamento (GOAP)

  // Vínculos (índices; -1 = nenhum)
  homeId: Int32Array; // índice da residência
  companyId: Int32Array; // índice da empresa empregadora
  jobLevel: Int8Array; // nível do cargo (-1 = desempregado)
  partnerId: Int32Array; // cônjuge/namorado(a)
  ownsHouse: Uint8Array;
  ownsCar: Uint8Array;
  isOwner: Uint8Array; // dono de empresa
  building: Int32Array; // prédio onde está agora (-1 = na rua, -2 = casa, -3 = prisão)

  // Cidadania / finanças / justiça
  creditScore: Float32Array; // 300..850
  inJail: Uint8Array;
  jailUntil: Int32Array; // tick de soltura
  isMayor: Uint8Array; // prefeito eleito
  unpaidMonths: Uint8Array; // meses de contas atrasadas (inadimplência)
  publicJob: Uint8Array; // empregado no setor público (programa de empregos)
  criminalRecord: Uint8Array; // nº de condenações (ficha criminal → reincidência)

  constructor(capacity: number = CONFIG.MAX_CITIZENS) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.ageDays = new Float32Array(capacity);
    this.sexF = new Uint8Array(capacity);
    this.intelligence = new Float32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.happiness = new Float32Array(capacity);
    this.health = new Float32Array(capacity);
    this.money = new Float64Array(capacity);
    this.hunger = new Float32Array(capacity);
    this.sleep = new Float32Array(capacity);
    this.social = new Float32Array(capacity);
    this.safety = new Float32Array(capacity);
    this.fun = new Float32Array(capacity);
    this.fulfillment = new Float32Array(capacity).fill(50);
    this.fame = new Float32Array(capacity);
    this.posX = new Float32Array(capacity);
    this.posZ = new Float32Array(capacity);
    this.targetX = new Float32Array(capacity);
    this.targetZ = new Float32Array(capacity);
    this.activity = new Uint8Array(capacity);
    this.activityUntil = new Int32Array(capacity);
    this.nextThink = new Int32Array(capacity);
    this.homeId = new Int32Array(capacity).fill(-1);
    this.companyId = new Int32Array(capacity).fill(-1);
    this.jobLevel = new Int8Array(capacity).fill(-1);
    this.partnerId = new Int32Array(capacity).fill(-1);
    this.ownsHouse = new Uint8Array(capacity);
    this.ownsCar = new Uint8Array(capacity);
    this.isOwner = new Uint8Array(capacity);
    this.building = new Int32Array(capacity).fill(-1);
    this.creditScore = new Float32Array(capacity).fill(600);
    this.inJail = new Uint8Array(capacity);
    this.jailUntil = new Int32Array(capacity);
    this.isMayor = new Uint8Array(capacity);
    this.unpaidMonths = new Uint8Array(capacity);
    this.publicJob = new Uint8Array(capacity);
    this.criminalRecord = new Uint8Array(capacity);
  }
}

/** Dados frios por cidadão — só tocados quando o agente pensa ou na UI. */
export interface ColdData {
  name: string;
  sex: Sex;
  personality: BigFive;
  education: EducationLevel;
  professionTitle: string;
  skills: Record<SkillName, number>;
  /** 0..100 — quão religioso(a) é (frequenta o templo, busca conforto na fé) */
  religiosidade: number;
  religiao: string | null;
  /** atividade de lazer preferida (hobby), define onde busca realização */
  hobby: import('../types').VenueType | null;
  memory: MemoryEvent[];
  relationships: Map<number, Relationship>;
  goals: Goal[];
  parents: number[];
  children: number[];
  currentPlan: string[]; // plano GOAP atual (nomes das ações)
  jobHistory: { company: string; title: string; fromTick: number; toTick: number }[];
}
