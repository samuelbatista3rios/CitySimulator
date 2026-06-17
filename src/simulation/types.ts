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
  skill: SkillName; // habilidade principal do cargo
  minSkill: number;
  /** habilidade secundária exigida (ex.: liderança em cargos de gestão) */
  secondarySkill?: SkillName;
  minSecondary?: number;
  level: number; // 0 = júnior ... 3 = diretor
}

export interface CompanyPositionView {
  title: string;
  salary: number; // salário já ajustado pelo nível salarial atual da economia
  minSkill: number;
  filled: number; // funcionários nesse cargo
  open: number; // vagas abertas nesse cargo
}

/** Critério de ordenação do ranking de empresas. */
export type CompanySort = 'capital' | 'receita' | 'recentes';

export interface CompanyView {
  id: number;
  name: string;
  sector: Sector;
  capital: number;
  employees: number;
  openPositions: number;
  bankrupt: boolean;
  // Detalhes (exibidos ao expandir a empresa)
  ownerName: string | null; // dono-cidadão (ou null = corporação)
  revenue: number; // receita do último mês
  dividends: number; // dividendos pagos ao dono no último mês
  productivity: number; // produtividade efetiva (equipe × tecnologia)
  price: number; // preço relativo ao de referência do setor (1 = referência)
  techLevel: number; // nível tecnológico (≥1) acumulado via P&D
  foundedYear: number; // ano simulado de fundação
  avgSalary: number; // folha média por funcionário (ajustada)
  positions: CompanyPositionView[];
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
  consumoFamilias: number; // gasto de consumo das famílias no mês (vira receita)
  dividendos: number; // dividendos pagos aos donos no mês
  investimentoPED: number; // investimento das empresas em P&D no mês
  criminalidade: number; // índice 0..100
  felicidadeMedia: number;
  educacaoMedia: number;
  saudeMedia: number;
  inflacao: number; // % a.m.
  salarioMedio: number;
  nascimentosAno: number;
  mortesAno: number;
  casamentosAno: number;
  expectativaVida: number; // idade média ao falecer (anos)
  eventoAtivo: string | null;
  fps: number; // ticks/s reais do worker
  // Governo & leis
  prefeito: string | null;
  plataforma: string | null;
  aprovacao: number; // 0..100 — aprovação do prefeito
  imposto: number; // % — topo do imposto de renda progressivo
  impostoCorporativo: number; // % sobre o lucro das empresas
  impostoPropriedade: number; // % mensal (IPTU)
  arrecadacaoIR: number; // arrecadação do mês — imposto de renda
  arrecadacaoCorp: number; // arrecadação do mês — imposto corporativo
  arrecadacaoIPTU: number; // arrecadação do mês — IPTU
  salarioMinimo: number;
  orcamentoPublico: number;
  dividaPublica: number; // dívida soberana acumulada
  jurosDivida: number; // serviço da dívida (juros) no mês
  austeridade: boolean; // governo em corte de gastos por dívida alta
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
  politicasSociais: string[]; // rótulos das políticas sociais em vigor
  liberdadesCondicionais: number; // liberdades condicionais concedidas no ano
  penasProrrogadas: number; // penas estendidas pela revisão no ano
  // Cultura, fé e esporte
  realizacaoMedia: number; // satisfação de vida média 0..100
  atletas: number; // atletas profissionais
  religiosos: number; // % da população praticante
  // Finanças
  inadimplencia: number; // % da população com contas atrasadas
  scoreCreditoMedio: number;
  // Imobiliário
  indiceImobiliario: number; // índice de preços reais (1 = base)
  precoMedioImovel: number; // preço médio efetivo do imóvel
  taxaProprietarios: number; // % de adultos com casa própria
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
  /** desempenho no cargo atual 0..100 (alinhamento das habilidades à função) */
  desempenho: number | null;
  /** habilidades exigidas pelo cargo atual (para comparar com as do cidadão) */
  requisitos: { skill: SkillName; min: number; secondary?: SkillName; minSecondary?: number } | null;
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
  avos: { id: number; nome: string }[];
  pais: { id: number; nome: string }[];
  irmaos: { id: number; nome: string }[];
  filhos: { id: number; nome: string }[];
  netos: { id: number; nome: string }[];
  memorias: MemoryEvent[];
  temCasaPropria: boolean;
  valorImovel: number | null; // valor de mercado do imóvel (se proprietário)
  temCarro: boolean;
  planoAtual: string[];
  // Cidadania
  prefeito: boolean;
  preso: boolean;
  criminoso: boolean;
  fichaCriminal: number; // nº de condenações
  /** motivo da prisão atual (crime + pena + meses restantes), se preso */
  motivoPrisao: string | null;
  /** último crime registrado na ficha (rótulo), se houver */
  ultimoCrime: string | null;
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
  blocks: { x: number; z: number; zone: string; elevation: number }[];
  buildings: {
    id: number;
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    zone: string;
    elevation: number;
  }[];
  institutions: InstitutionMarker[];
  venues: VenueMarker[];
  worldSize: number;
  blockSpan: number;
  stadium: { x: number; z: number } | null;
  nobleCenter: { x: number; z: number } | null;
  boemioCenter: { x: number; z: number } | null;
}

export interface CitizenSearchResult {
  id: number;
  nome: string;
  idade: number;
  profissao: string;
}

/** Dados de distribuição/desigualdade e rankings (painel de monitoramento). */
export interface MonitorData {
  gini: number; // 0..1 — desigualdade de riqueza
  decis: number[]; // riqueza média por decil (10 valores)
  pobreza: number; // % de adultos abaixo da linha de subsistência
  piramide: { faixa: string; m: number; f: number }[]; // pirâmide etária por década
  escolaridade: { fundamental: number; medio: number; superior: number; pos: number };
  ricos: { id: number; nome: string; dinheiro: number; profissao: string }[];
  famosos: { id: number; nome: string; fama: number; profissao: string }[];
  proprietarios: { id: number; nome: string; imoveis: number; valor: number }[];
}

/** Valores por quarteirão (alinhados a layout.blocks) para mapas de calor. */
export interface HeatmapData {
  wealth: number[];
  happiness: number[];
  crime: number[];
  land: number[];
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
  | { type: 'monitor'; data: MonitorData }
  | { type: 'heatmap'; data: HeatmapData }
  | { type: 'follow'; id: number; x: number; z: number };

export type WorkerIn =
  | { type: 'init'; seed: number; population: number }
  | { type: 'setSpeed'; ticksPerSecond: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'getCitizen'; id: number }
  | { type: 'save' }
  | { type: 'load'; payload: string }
  | { type: 'getCompanies'; sort?: CompanySort }
  | { type: 'search'; query: string }
  | { type: 'getMonitor' }
  | { type: 'getHeatmap' }
  | { type: 'followCitizen'; id: number };
