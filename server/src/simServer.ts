import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Simulation } from '../../src/simulation/simulation';
import { serialize, deserialize } from '../../src/database/serializer';
import { CONFIG } from '../../src/simulation/config';
import type { WorkerIn } from '../../src/simulation/types';
import { persistSnapshot, loadLatestSnapshot } from './persistence';

/**
 * GENESIS CITY — SERVIDOR AUTORITATIVO 24/7
 *
 * A simulação inteira vive AQUI, num processo Node que nunca dorme. Os
 * navegadores/celulares conectam por WebSocket e recebem o estado da MESMA
 * cidade viva (frames binários de posição + estatísticas). O servidor autosalva
 * no PostgreSQL e retoma o último snapshot ao reiniciar.
 */

const SEED = Number(process.env.GENESIS_SEED ?? 1337);
const POP = Number(process.env.GENESIS_POP ?? CONFIG.START_POPULATION);
const PORT = Number(process.env.PORT ?? 4000);
const AUTOSAVE_MS = Number(process.env.AUTOSAVE_MIN ?? 5) * 60_000;
const SYNC_MS = 1000 / CONFIG.SYNC_HZ;

let sim: Simulation;
let seed = SEED;
let ticksPerSecond = 24;
let paused = false;

// ---- boot: retoma snapshot se existir, senão cria cidade nova
const resumed = await loadLatestSnapshot().catch(() => null);
if (resumed) {
  sim = deserialize(resumed);
  seed = JSON.parse(resumed).seed;
  console.log(`▶ Cidade retomada do snapshot (tick ${sim.tick}).`);
} else {
  sim = new Simulation(SEED, POP);
  console.log(`▶ Nova cidade gerada (seed ${SEED}, ${POP} habitantes).`);
}

// ---- loop da simulação (independente de haver espectadores)
let last = performance.now();
let acc = 0;
let tpsCounter = 0;
let tpsWindow = performance.now();
let measuredTPS = 0;
let lastFrame = 0;
let lastStats = 0;

setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (!paused) {
    acc += dt * ticksPerSecond;
    let steps = Math.min(64, Math.floor(acc));
    acc -= Math.floor(acc);
    while (steps-- > 0) { sim.step(); tpsCounter++; }
    sim.traffic.step(dt * Math.min(4, ticksPerSecond / 6 + 1));
  }

  if (now - tpsWindow >= 1000) {
    measuredTPS = tpsCounter / ((now - tpsWindow) / 1000);
    tpsCounter = 0; tpsWindow = now;
  }
  if (now - lastFrame >= SYNC_MS) { lastFrame = now; broadcastFrame(); }
  if (now - lastStats >= 1000) {
    lastStats = now;
    broadcastJSON({ type: 'stats', stats: sim.computeStats(measuredTPS) });
    const items = sim.drainFeed();
    if (items.length) broadcastJSON({ type: 'feed', items });
  }
}, 16);

// ---- autosave
setInterval(async () => {
  try {
    const id = await persistSnapshot(serialize(sim, seed));
    if (id) console.log(`💾 Autosave #${id} (tick ${sim.tick}).`);
  } catch (e) {
    console.error('Falha no autosave:', (e as Error).message);
  }
}, AUTOSAVE_MS);

// ---- WebSocket
const app = express();
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, tick: sim.tick, pop: sim.world.aliveCount, tps: measuredTPS }),
);
// serve o frontend buildado (se existir)
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.binaryType = 'arraybuffer';
  // envia o layout estático assim que conecta
  sendJSON(ws, { type: 'ready', layout: sim.layoutData() });
  sendJSON(ws, { type: 'stats', stats: sim.computeStats(measuredTPS) });

  ws.on('message', (raw) => {
    let msg: WorkerIn;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'setSpeed': ticksPerSecond = msg.ticksPerSecond; break;
      case 'pause': paused = true; break;
      case 'resume': paused = false; break;
      case 'getCitizen': sendJSON(ws, { type: 'citizen', detail: sim.citizenDetail(msg.id) }); break;
      case 'getCompanies': sendJSON(ws, { type: 'companies', companies: sim.companyViews() }); break;
      case 'search': sendJSON(ws, { type: 'searchResults', results: sim.searchByName(msg.query) }); break;
      case 'save':
        persistSnapshot(serialize(sim, seed))
          .then((id) => sendJSON(ws, { type: 'saved', payload: id ? `PostgreSQL #${id}` : 'banco offline' }))
          .catch((e) => sendJSON(ws, { type: 'saved', payload: `erro: ${(e as Error).message}` }));
        break;
      default: break;
    }
  });
});

function broadcastJSON(obj: unknown): void {
  const s = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(s);
}
function sendJSON(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/** Frame binário compacto (posições + veículos) — eficiente para celular. */
function broadcastFrame(): void {
  if (wss.clients.size === 0) return; // ninguém olhando → economiza CPU/banda
  const f = sim.frameData();
  const bytes = 8 + f.count * 8 + f.count * 4 + f.vehicleCount * 12 + f.count;
  const buf = new ArrayBuffer(bytes);
  const head = new Int32Array(buf, 0, 2);
  head[0] = f.count; head[1] = f.vehicleCount;
  let off = 8;
  new Float32Array(buf, off, f.count * 2).set(f.positions.subarray(0, f.count * 2)); off += f.count * 8;
  new Int32Array(buf, off, f.count).set(f.ids.subarray(0, f.count)); off += f.count * 4;
  new Float32Array(buf, off, f.vehicleCount * 3).set(f.vehiclePositions.subarray(0, f.vehicleCount * 3)); off += f.vehicleCount * 12;
  new Uint8Array(buf, off, f.count).set(f.activities.subarray(0, f.count));
  const view = Buffer.from(buf);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(view);
}

server.listen(PORT, () => {
  console.log(`🌆 Genesis City rodando 24/7 em :${PORT} (WebSocket + HTTP). Velocidade ${ticksPerSecond} ticks/s.`);
});
