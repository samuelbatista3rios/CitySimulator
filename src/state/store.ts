import { create } from 'zustand';
import type {
  CityLayoutMsg,
  CityStats,
  CitizenDetail,
  CitizenSearchResult,
  CompanyView,
  CompanySort,
  FeedItem,
  MonitorData,
  HeatmapData,
  WorkerIn,
  WorkerOut,
} from '../simulation/types';
import { saveSnapshot, loadSnapshot } from '../database/saveSystem';

/** Ponto histórico para os gráficos de tendência. */
export interface HistoryPoint {
  ano: number; mes: number;
  pib: number; desemprego: number; inflacao: number; populacao: number;
  aprovacao: number; divida: number; imob: number; felicidade: number;
}
export interface Alert { id: string; text: string; level: 'warn' | 'bad' }
export type HeatmapMetric = 'none' | 'wealth' | 'happiness' | 'crime' | 'land';

const HISTORY_CAP = 360;

/** Deriva alertas automáticos do estado atual da cidade. */
function deriveAlerts(s: CityStats): Alert[] {
  const out: Alert[] = [];
  if (s.desemprego > 18) out.push({ id: 'desemp', text: `Desemprego alto: ${s.desemprego.toFixed(0)}%`, level: 'bad' });
  if (s.inflacao > 1.5) out.push({ id: 'infl', text: `Inflação alta: ${s.inflacao.toFixed(1)}%/mês`, level: 'bad' });
  if (s.criminalidade > 50) out.push({ id: 'crime', text: `Criminalidade elevada: ${s.criminalidade.toFixed(0)}`, level: 'bad' });
  if (s.prefeito && s.aprovacao < 25) out.push({ id: 'recall', text: `Aprovação crítica: ${s.aprovacao.toFixed(0)}% (risco de recall)`, level: 'bad' });
  if (s.austeridade) out.push({ id: 'auster', text: 'Austeridade fiscal (cortes de gasto)', level: 'warn' });
  if (s.eventoAtivo && /crise|pandemia/i.test(s.eventoAtivo)) out.push({ id: 'evt', text: s.eventoAtivo, level: 'warn' });
  if (s.inadimplencia > 30) out.push({ id: 'inad', text: `Inadimplência alta: ${s.inadimplencia.toFixed(0)}%`, level: 'warn' });
  return out;
}

export interface FrameData {
  positions: Float32Array;
  ids: Int32Array;
  activities: Uint8Array;
  count: number;
  vehiclePositions: Float32Array;
  vehicleCount: number;
}

interface GenesisState {
  worker: Worker | null;
  socket: WebSocket | null;
  layout: CityLayoutMsg | null;
  stats: CityStats | null;
  /** frame mais recente — lido imperativamente pelo render loop (sem re-render React) */
  frameRef: { current: FrameData | null };
  feed: FeedItem[];
  selectedCitizen: CitizenDetail | null;
  companies: CompanyView[];
  showCompanies: boolean;
  companySort: CompanySort;
  showLaws: boolean;
  paused: boolean;
  speed: number;
  saving: boolean;
  saveMessage: string | null;
  searchResults: CitizenSearchResult[];
  // Monitoramento
  history: HistoryPoint[];
  alerts: Alert[];
  monitor: MonitorData | null;
  showMonitor: boolean;
  heatmap: HeatmapData | null;
  heatmapMetric: HeatmapMetric;
  /** id do cidadão que a câmera está seguindo (lido pelo render loop) */
  followId: number | null;
  /** painel ativo no modo celular (abas inferiores); null = só o mapa */
  mobilePanel: 'stats' | 'laws' | 'empresas' | 'busca' | 'monitor' | null;

  boot: (seed?: number, population?: number) => void;
  send: (msg: WorkerIn) => void;
  setSpeed: (tps: number) => void;
  togglePause: () => void;
  selectCitizen: (id: number) => void;
  closeCitizen: () => void;
  refreshCitizen: () => void;
  save: () => void;
  load: () => Promise<void>;
  toggleCompanies: () => void;
  refreshCompanies: () => void;
  setCompanySort: (s: CompanySort) => void;
  toggleLaws: () => void;
  toggleMonitor: () => void;
  refreshMonitor: () => void;
  setHeatmapMetric: (m: HeatmapMetric) => void;
  refreshHeatmap: () => void;
  search: (query: string) => void;
  clearSearch: () => void;
  follow: (id: number) => void;
  stopFollow: () => void;
  openMobilePanel: (p: 'stats' | 'laws' | 'empresas' | 'busca' | 'monitor') => void;
}

/** Decodifica um frame binário vindo do servidor (WebSocket) em FrameData. */
function parseBinaryFrame(buf: ArrayBuffer): FrameData {
  const head = new Int32Array(buf, 0, 2);
  const count = head[0];
  const vehicleCount = head[1];
  let off = 8;
  const positions = new Float32Array(buf, off, count * 2); off += count * 8;
  const ids = new Int32Array(buf, off, count); off += count * 4;
  const vehiclePositions = new Float32Array(buf, off, vehicleCount * 3); off += vehicleCount * 12;
  const activities = new Uint8Array(buf, off, count);
  return { positions, ids, activities, count, vehiclePositions, vehicleCount };
}

export const useGenesis = create<GenesisState>((set, get) => ({
  worker: null,
  socket: null,
  layout: null,
  stats: null,
  frameRef: { current: null },
  feed: [],
  selectedCitizen: null,
  companies: [],
  showCompanies: false,
  companySort: 'capital',
  showLaws: false,
  paused: false,
  speed: 24,
  saving: false,
  saveMessage: null,
  searchResults: [],
  history: [],
  alerts: [],
  monitor: null,
  showMonitor: false,
  heatmap: null,
  heatmapMetric: 'none',
  followId: null,
  mobilePanel: null,

  boot: (seed = 1337, population = 10_000) => {
    get().worker?.terminate();
    get().socket?.close();

    // Mensagens vindas da simulação (worker OU servidor) — tratamento comum.
    // Produção (build servido pelo servidor): conecta ao MESMO host via WebSocket.
    // Dev local: usa o Web Worker no navegador. Override opcional: VITE_SERVER_WS.
    const sameOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const wsUrl =
      (import.meta.env.VITE_SERVER_WS as string | undefined) ||
      (import.meta.env.PROD ? sameOrigin : undefined);
    const handle = (msg: WorkerOut) => {
      switch (msg.type) {
        case 'ready': set({ layout: msg.layout }); break;
        case 'stats':
          set((s) => {
            const st = msg.stats;
            const point: HistoryPoint = {
              ano: st.year, mes: st.month, pib: st.pib, desemprego: st.desemprego,
              inflacao: st.inflacao, populacao: st.populacao, aprovacao: st.aprovacao,
              divida: st.dividaPublica, imob: st.indiceImobiliario, felicidade: st.felicidadeMedia,
            };
            const history = [...s.history, point];
            if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
            return { stats: st, history, alerts: deriveAlerts(st) };
          });
          break;
        case 'monitor': set({ monitor: msg.data }); break;
        case 'heatmap': set({ heatmap: msg.data }); break;
        case 'frame':
          get().frameRef.current = {
            positions: msg.positions, ids: msg.ids, activities: msg.activities,
            count: msg.count, vehiclePositions: msg.vehiclePositions, vehicleCount: msg.vehicleCount,
          };
          break;
        case 'citizen': set({ selectedCitizen: msg.detail }); break;
        case 'feed': set((s) => ({ feed: [...msg.items.reverse(), ...s.feed].slice(0, 40) })); break;
        case 'companies': set({ companies: msg.companies }); break;
        case 'searchResults': set({ searchResults: msg.results }); break;
        case 'saved':
          if (wsUrl) {
            // servidor já salvou: payload é o status
            set({ saving: false, saveMessage: msg.payload });
          } else {
            saveSnapshot(msg.payload)
              .then((where) => set({ saving: false, saveMessage: `Salvo em ${where}` }))
              .catch((err) => set({ saving: false, saveMessage: `Erro ao salvar: ${err}` }));
          }
          break;
      }
    };

    if (wsUrl) {
      // ---- MODO SERVIDOR 24/7 (deploy): lê a MESMA cidade viva via WebSocket
      const socket = new WebSocket(wsUrl);
      socket.binaryType = 'arraybuffer';
      socket.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') handle(JSON.parse(e.data) as WorkerOut);
        else get().frameRef.current = parseBinaryFrame(e.data as ArrayBuffer);
      };
      socket.onclose = () => set({ saveMessage: 'Conexão com o servidor caiu — reconectando…' });
      set({ socket, worker: null, paused: false });
    } else {
      // ---- MODO LOCAL (dev): a simulação roda num Web Worker no navegador
      const worker = new Worker(new URL('../workers/simWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<WorkerOut>) => handle(e.data);
      worker.postMessage({ type: 'init', seed, population } satisfies WorkerIn);
      set({ worker, socket: null, paused: false });
    }
  },

  send: (msg) => {
    const { worker, socket } = get();
    if (worker) worker.postMessage(msg);
    else if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  },

  setSpeed: (tps) => {
    get().send({ type: 'setSpeed', ticksPerSecond: tps });
    set({ speed: tps });
  },

  togglePause: () => {
    const paused = !get().paused;
    get().send({ type: paused ? 'pause' : 'resume' });
    set({ paused });
  },

  selectCitizen: (id) => get().send({ type: 'getCitizen', id }),
  closeCitizen: () => set({ selectedCitizen: null }),
  refreshCitizen: () => {
    const sel = get().selectedCitizen;
    if (sel) get().send({ type: 'getCitizen', id: sel.id });
  },

  save: () => {
    set({ saving: true, saveMessage: null });
    get().send({ type: 'save' });
  },

  load: async () => {
    const payload = await loadSnapshot();
    if (payload) {
      get().send({ type: 'load', payload });
      set({ saveMessage: 'Snapshot carregado', selectedCitizen: null });
    } else {
      set({ saveMessage: 'Nenhum snapshot encontrado' });
    }
  },

  toggleCompanies: () => {
    const show = !get().showCompanies;
    if (show) get().send({ type: 'getCompanies', sort: get().companySort });
    set({ showCompanies: show });
  },
  refreshCompanies: () => get().send({ type: 'getCompanies', sort: get().companySort }),
  setCompanySort: (s) => {
    set({ companySort: s });
    get().send({ type: 'getCompanies', sort: s });
  },

  toggleLaws: () => set((s) => ({ showLaws: !s.showLaws })),

  toggleMonitor: () => {
    const show = !get().showMonitor;
    if (show) get().send({ type: 'getMonitor' });
    set({ showMonitor: show });
  },
  refreshMonitor: () => get().send({ type: 'getMonitor' }),
  setHeatmapMetric: (m) => {
    set({ heatmapMetric: m });
    if (m !== 'none') get().send({ type: 'getHeatmap' });
  },
  refreshHeatmap: () => {
    if (get().heatmapMetric !== 'none') get().send({ type: 'getHeatmap' });
  },

  search: (query) => {
    if (query.trim().length < 2) {
      set({ searchResults: [] });
      return;
    }
    get().send({ type: 'search', query });
  },
  clearSearch: () => set({ searchResults: [] }),
  follow: (id) => set({ followId: id }),
  stopFollow: () => set({ followId: null }),

  // Abas do celular: abre um painel por vez e sincroniza os toggles existentes.
  openMobilePanel: (p) => {
    const next = get().mobilePanel === p ? null : p;
    if (next === 'empresas') get().send({ type: 'getCompanies', sort: get().companySort });
    if (next === 'monitor') get().send({ type: 'getMonitor' });
    set({
      mobilePanel: next,
      showLaws: next === 'laws',
      showCompanies: next === 'empresas',
      showMonitor: next === 'monitor',
    });
  },
}));

// Acesso ao store no console em desenvolvimento (depuração).
if (import.meta.env.DEV) {
  (window as unknown as { __genesis: typeof useGenesis }).__genesis = useGenesis;
}
