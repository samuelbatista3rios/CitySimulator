/// <reference lib="webworker" />
import { Simulation } from '../simulation/simulation';
import { serialize, deserialize } from '../database/serializer';
import { CONFIG } from '../simulation/config';
import { Activity, type WorkerIn, type WorkerOut } from '../simulation/types';

/**
 * Web Worker da simulação: o mundo inteiro roda aqui, fora da main thread.
 * A UI recebe apenas:
 *  - frames de posição (typed arrays transferíveis, zero-copy)
 *  - estatísticas (1x/s)
 *  - detalhes de cidadão sob demanda
 */

let sim: Simulation | null = null;
let seed = 0;
let ticksPerSecond = 24; // velocidade padrão: 1 dia/s
let paused = false;
let tickAccumulator = 0;
let lastTime = 0;
let tpsCounter = 0;
let tpsWindowStart = 0;
let measuredTPS = 0;
let loopHandle: ReturnType<typeof setInterval> | null = null;
let lastStatsSent = 0;
let lastFrameSent = 0;

const post = (msg: WorkerOut, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

function startLoop(): void {
  if (loopHandle) clearInterval(loopHandle);
  lastTime = performance.now();
  tpsWindowStart = lastTime;
  loopHandle = setInterval(loop, 16);
}

function loop(): void {
  if (!sim || paused) { lastTime = performance.now(); return; }
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;

  // ticks da simulação conforme velocidade escolhida
  tickAccumulator += dt * ticksPerSecond;
  let steps = Math.min(64, Math.floor(tickAccumulator)); // teto anti-espiral
  tickAccumulator -= Math.floor(tickAccumulator);
  while (steps-- > 0) {
    sim.step();
    tpsCounter++;
  }

  // tráfego: sub-passos contínuos (suavidade independe da velocidade do tick)
  sim.traffic.step(dt * Math.min(4, ticksPerSecond / 6 + 1));

  if (now - tpsWindowStart >= 1000) {
    measuredTPS = tpsCounter / ((now - tpsWindowStart) / 1000);
    tpsCounter = 0;
    tpsWindowStart = now;
  }

  // frames de posição (SYNC_HZ por segundo)
  if (now - lastFrameSent >= 1000 / CONFIG.SYNC_HZ) {
    lastFrameSent = now;
    sendFrame();
  }
  // estatísticas + feed (1x/s)
  if (now - lastStatsSent >= 1000) {
    lastStatsSent = now;
    post({ type: 'stats', stats: sim.computeStats(measuredTPS) });
    const items = sim.drainFeed();
    if (items.length > 0) post({ type: 'feed', items });
  }
}

/** Envia posições só de cidadãos NA RUA (LOD lógico: quem está em prédio não renderiza boneco). */
function sendFrame(): void {
  if (!sim) return;
  const f = sim.frameData();
  post(
    {
      type: 'frame',
      positions: f.positions,
      ids: f.ids,
      activities: f.activities,
      count: f.count,
      vehiclePositions: f.vehiclePositions,
      vehicleCount: f.vehicleCount,
    },
    [f.positions.buffer, f.ids.buffer, f.activities.buffer, f.vehiclePositions.buffer],
  );
}

function sendLayout(): void {
  if (!sim) return;
  post({ type: 'ready', layout: sim.layoutData() });
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      seed = msg.seed;
      sim = new Simulation(msg.seed, msg.population);
      sendLayout();
      startLoop();
      break;
    case 'setSpeed':
      ticksPerSecond = msg.ticksPerSecond;
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      break;
    case 'getCitizen':
      if (sim) post({ type: 'citizen', detail: sim.citizenDetail(msg.id) });
      break;
    case 'getCompanies':
      if (sim) post({ type: 'companies', companies: sim.companyViews() });
      break;
    case 'search':
      if (sim) post({ type: 'searchResults', results: sim.searchByName(msg.query) });
      break;
    case 'followCitizen':
      if (sim) {
        const pos = sim.citizenPosition(msg.id);
        if (pos) post({ type: 'follow', id: msg.id, x: pos.x, z: pos.z });
      }
      break;
    case 'save':
      if (sim) post({ type: 'saved', payload: serialize(sim, seed) });
      break;
    case 'load':
      sim = deserialize(msg.payload);
      seed = JSON.parse(msg.payload).seed;
      sendLayout();
      startLoop();
      break;
  }
};
