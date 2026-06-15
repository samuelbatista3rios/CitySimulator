/** Tipos compartilhados entre worker, simulação e UI. */

export type Sex = 'M' | 'F';

export interface BigFive {
  abertura: number; // O
  consciencia: number; // C
  extroversao: number; // E
  amabilidade: number; // A
  neuroticismo: number; // N
}

export type SkillName = 'programacao' | 'vendas' | 'lideranca' | 'engenharia' | 'arte' | 'esporte';
export const SKILL_NAMES: SkillName[] = ['programacao', 'vendas', 'lideranca', 'engenharia', 'arte', 'esporte'];

export type Sector = 'tecnologia' | 'comercio' | 'industria' | 'servicos' | 'cultura' | 'esporte';

/** Locais de lazer/realização espalhados pela cidade. */
export type VenueType = 'restaurante' | 'bar' | 'cinema' | 'teatro' | 'estadio' | 'ginasio' | 'templo';

export interface VenueMarker {
  type: VenueType;
  x: number;
  z: number;
}

export type EducationLevel = 'fundamental' | 'medio' | 'superior' | 'pos';

export type MemoryKind =
  | 'emprego'
  | 'demissao'
  | 'promocao'
  | 'casamento'
  | 'separacao'
  | 'filho'
  | 'amizade'
  | 'conflito'
  | 'compra_casa'
  | 'compra_carro'
  | 'abriu_empresa'
  | 'faliu'
  | 'formatura'
  | 'morte_parente';

export interface MemoryEvent {
  tick: number;
  kind: MemoryKind;
  text: string;
  otherId?: number;
}

export type RelationKind = 'amigo' | 'inimigo' | 'namoro' | 'casamento' | 'ex';

export interface Relationship {
  otherId: number;
  kind: RelationKind;
  strength: number; // -100..100
  sinceTick: number;
}

export type GoalKind =
  | 'comprar_carro'
  | 'comprar_casa'
  | 'casar'
  | 'abrir_empresa'
  | 'enriquecer'
  | 'estudar'
  | 'arranjar_emprego'
  | 'promocao'
  | 'virar_atleta';

export interface Goal {
  kind: GoalKind;
  priority: number;
  progress: number; // 0..1
  createdTick: number;
}

/** Estado de atividade do cidadão (componente "hot" no ECS). */
export const enum Activity {
  Idle = 0,
  Sleeping = 1,
  Working = 2,
  Eating = 3,
  Socializing = 4,
  Studying = 5,
  HavingFun = 6,
  Shopping = 7,
  Commuting = 8,
  JobHunting = 9,
}

export const ACTIVITY_LABELS: Record<number, string> = {
  0: 'Ocioso',
  1: 'Dormindo',
  2: 'Trabalhando',
  3: 'Comendo',
  4: 'Socializando',
  5: 'Estudando',
  6: 'Se divertindo',
  7: 'Comprando',
  8: 'Em trânsito',
  9: 'Procurando emprego',
};

export interface JobPosition {
  title: string;
  salary: number;
  skill: SkillName;
  minSkill: number;
  level: number; // 0 = júnior ... 3 = diretor
}

export interface CompanyView {
  id: number;
  name: string;
  sector: Sector;
  capital: number;
  employees: number;
  openPositions: number;
  bankrupt: boolean;
}

export type GlobalEventKind =
  | 'crise_economica'
  | 'crescimento_economico'
  | 'pandemia'
  | 'eleicoes'
  | 'avanco_tecnologico';

export interface GlobalEvent {
  kind: GlobalEventKind;
  label: string;
  startTick: number;
  durationTicks: number;
}

export interface CityStats {
  tick: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  populacao: number;
  pib: number;
  empregos: number;
  desemprego: number; // %
  empresas: number;
  empresasFalidas: number;
  criminalidade: number; // índice 0..100
  felicidadeMedia: number;
  educacaoMedia: number;
  saudeMedia: number;
  inflacao: number; // % a.m.
  salarioMedio: number;
  nascimentosAno: number;
  mortesAno: number;
  casamentosAno: number;
  eventoAtivo: string | null;
  fps: number; // ticks/s reais do worker
  // Governo & leis
  prefeito: string | null;
  plataforma: string | null;
  imposto: number; // %
  salarioMinimo: number;
  orcamentoPublico: number;
  proximaEleicaoAnos: number;
  // Instituições
  crimesAno: number;
  prisoesAno: number;
  presos: number;
  hospitais: number;
  escolas: number;
  delegacias: number;
  // Política econômica (emergente do governo eleito)
  empregosPublicos: number;
  subsidioEmpresas: number; // gasto em subsídio no mês
  medidaEmergencia: boolean; // eleição/medida extraordinária por crise
  // Cultura, fé e esporte
  realizacaoMedia: number; // satisfação de vida média 0..100
  atletas: number; // atletas profissionais
  religiosos: number; // % da população praticante
  // Finanças
  inadimplencia: number; // % da população com contas atrasadas
  scoreCreditoMedio: number;
}

export type InstitutionKind = 'hospital' | 'escola' | 'delegacia' | 'prefeitura';

export interface InstitutionMarker {
  kind: InstitutionKind;
  x: number;
  z: number;
}

export interface LoanView {
  kind: string;
  saldo: number;
  parcela: number;
  jurosAno: number;
}

/** Detalhe completo de um cidadão (sob demanda, ao clicar). */
export interface CitizenDetail {
  id: number;
  nome: string;
  sexo: Sex;
  idade: number;
  vivo: boolean;
  personalidade: BigFive;
  inteligencia: number;
  energia: number;
  felicidade: number;
  saude: number;
  dinheiro: number;
  habilidades: Record<SkillName, number>;
  profissao: string;
  empresa: string | null;
  escolaridade: EducationLevel;
  atividade: string;
  necessidades: { fome: number; sono: number; social: number; seguranca: number; diversao: number };
  realizacao: number; // 0..100 — satisfação de vida (lazer, fé, hobbies, fama)
  religiosidade: number; // 0..100
  religiao: string | null;
  hobby: string | null;
  fama: number; // 0..100 (atletas/artistas)
  objetivos: Goal[];
  amigos: { id: number; nome: string; forca: number }[];
  conjuge: { id: number; nome: string } | null;
  pais: { id: number; nome: string }[];
  filhos: { id: number; nome: string }[];
  memorias: MemoryEvent[];
  temCasaPropria: boolean;
  temCarro: boolean;
  planoAtual: string[];
  // Cidadania
  prefeito: boolean;
  preso: boolean;
  criminoso: boolean;
  scoreCredito: number;
  emprestimos: LoanView[];
  contasAtrasadas: number;
}

export interface FeedItem {
  tick: number;
  text: string;
  kind: 'global' | 'social' | 'economia' | 'vida';
}

// ---------- Mensagens worker <-> UI ----------

export interface CityLayoutMsg {
  blocks: { x: number; z: number; zone: string }[];
  buildings: {
    id: number;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    zone: string;
  }[];
  institutions: InstitutionMarker[];
  venues: VenueMarker[];
  worldSize: number;
  blockSpan: number;
}

export interface CitizenSearchResult {
  id: number;
  nome: string;
  idade: number;
  profissao: string;
}

export type WorkerOut =
  | { type: 'ready'; layout: CityLayoutMsg }
  | { type: 'stats'; stats: CityStats }
  | {
      type: 'frame';
      positions: Float32Array; // x,z intercalados por cidadão visível
      ids: Int32Array;
      activities: Uint8Array;
      count: number;
      vehiclePositions: Float32Array; // x,z,angle
      vehicleCount: number;
    }
  | { type: 'citizen'; detail: CitizenDetail | null }
  | { type: 'feed'; items: FeedItem[] }
  | { type: 'saved'; payload: string }
  | { type: 'companies'; companies: CompanyView[] }
  | { type: 'searchResults'; results: CitizenSearchResult[] }
  | { type: 'follow'; id: number; x: number; z: number };

export type WorkerIn =
  | { type: 'init'; seed: number; population: number }
  | { type: 'setSpeed'; ticksPerSecond: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'getCitizen'; id: number }
  | { type: 'save' }
  | { type: 'load'; payload: string }
  | { type: 'getCompanies' }
  | { type: 'search'; query: string }
  | { type: 'followCitizen'; id: number };
