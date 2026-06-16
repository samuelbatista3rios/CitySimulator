import { CONFIG } from '../config';
import type { RNG } from '../rng';

/**
 * Tráfego: veículos autônomos navegando pela malha viária.
 *
 * - Rotas em "L" (Manhattan) pelas ruas entre quarteirões.
 * - Semáforos por intersecção: eixo N-S e L-O alternam a cada SIGNAL_PERIOD.
 * - Congestionamento: densidade de veículos por segmento reduz a velocidade.
 *
 * Implementado em SoA para suportar milhares de veículos com custo mínimo.
 */
export class TrafficSystem {
  readonly cap = CONFIG.MAX_VEHICLES;
  active: Uint8Array = new Uint8Array(this.cap);
  x = new Float32Array(this.cap);
  z = new Float32Array(this.cap);
  angle = new Float32Array(this.cap);
  // rota em L: primeiro eixo X até cornerX, depois eixo Z até destino
  destX = new Float32Array(this.cap);
  destZ = new Float32Array(this.cap);
  phase = new Uint8Array(this.cap); // 0 = andando em X, 1 = andando em Z
  owner = new Int32Array(this.cap).fill(-1); // cidadão dono (-1 = livre)
  count = 0;

  private SIGNAL_PERIOD = 30; // em sub-passos de movimento
  private signalClock = 0;
  /** densidade por célula de grade (congestionamento) */
  private density: Uint16Array;
  private gridN: number;
  private cell: number;
  private half: number;
  /** células intrafegáveis (chave "gx,gz"): lago + complexo do estádio */
  private blocked = new Set<string>();

  constructor(private rng: RNG, worldSize: number, blockSpan: number) {
    this.gridN = Math.ceil(worldSize / blockSpan);
    this.cell = blockSpan;
    this.half = worldSize / 2;
    this.density = new Uint16Array(this.gridN * this.gridN);
  }

  /** Informa as células onde não pode haver trânsito (lago, estádio…). */
  setBlocked(cells: Set<string>): void {
    this.blocked = cells;
  }

  private isBlocked(gx: number, gz: number): boolean {
    return this.blocked.has(`${gx},${gz}`);
  }

  /**
   * A rota em "L" cruza o interior de uma área intrafegável (lago/estádio)? Uma
   * via só está "por dentro" quando os DOIS quarteirões que ela margeia são
   * bloqueados. Margear a borda (bloqueio de um lado só) é permitido.
   */
  private routeCrossesBlocked(sx: number, sz: number, dx: number, dz: number): boolean {
    const idx = (v: number) => Math.round((this.snapLine(v) + this.half) / this.cell);
    const csx = idx(sx), cdx = idx(dx), csz = idx(sz), cdz = idx(dz);
    // perna 1: horizontal na fronteira de linha csz (entre linhas csz-1 e csz)
    for (let c = Math.min(csx, cdx); c <= Math.max(csx, cdx); c++) {
      if (this.isBlocked(c, csz - 1) && this.isBlocked(c, csz)) return true;
    }
    // perna 2: vertical na fronteira de coluna cdx (entre colunas cdx-1 e cdx)
    for (let r = Math.min(csz, cdz); r <= Math.max(csz, cdz); r++) {
      if (this.isBlocked(cdx - 1, r) && this.isBlocked(cdx, r)) return true;
    }
    return false;
  }

  /** Despacha um veículo do cidadão `owner` de (x,z) até (dx,dz). */
  dispatch(owner: number, sx: number, sz: number, dx: number, dz: number): boolean {
    if (this.count >= this.cap) return false;
    // não despacha carro cuja rota cruzaria o interior do lago ou do estádio
    if (this.routeCrossesBlocked(sx, sz, dx, dz)) return false;
    let slot = -1;
    for (let i = 0; i < this.cap; i++) {
      if (!this.active[i]) { slot = i; break; }
    }
    if (slot === -1) return false;
    this.active[slot] = 1;
    // Rota em "L" sobre a malha viária: AMBAS as pernas correm sobre o eixo
    // central de uma rua. Snap de início e destino às linhas de via garante que
    // o carro nunca cruze o interior de um quarteirão.
    //  - fase 0: anda em X com z fixo na rua de partida  (snapLine(sz))
    //  - fase 1: anda em Z com x fixo na rua de destino  (snapLine(dx))
    this.x[slot] = this.snapLine(sx);
    this.z[slot] = this.snapLine(sz);
    this.destX[slot] = this.snapLine(dx);
    this.destZ[slot] = this.snapLine(dz);
    this.phase[slot] = 0;
    this.owner[slot] = owner;
    this.count++;
    return true;
  }

  /** Centro da rua mais próxima. Vias correm em g*span - half (entre quarteirões). */
  private snapLine(v: number): number {
    const k = Math.round((v + this.half) / this.cell);
    return k * this.cell - this.half;
  }

  /** Sub-passo de movimento (chamado várias vezes por tick para suavidade). */
  step(dt: number): void {
    this.signalClock = (this.signalClock + 1) % (this.SIGNAL_PERIOD * 2);
    const nsGreen = this.signalClock < this.SIGNAL_PERIOD;
    this.density.fill(0);

    // 1ª passada: densidade por célula
    for (let i = 0; i < this.cap; i++) {
      if (!this.active[i]) continue;
      const gx = Math.min(this.gridN - 1, Math.max(0, Math.floor((this.x[i] + this.half) / this.cell)));
      const gz = Math.min(this.gridN - 1, Math.max(0, Math.floor((this.z[i] + this.half) / this.cell)));
      this.density[gz * this.gridN + gx]++;
    }

    // 2ª passada: movimento
    const baseSpeed = 14; // unidades/s
    for (let i = 0; i < this.cap; i++) {
      if (!this.active[i]) continue;
      const gx = Math.min(this.gridN - 1, Math.max(0, Math.floor((this.x[i] + this.half) / this.cell)));
      const gz = Math.min(this.gridN - 1, Math.max(0, Math.floor((this.z[i] + this.half) / this.cell)));
      const congestion = this.density[gz * this.gridN + gx];
      const speed = (baseSpeed / (1 + congestion * 0.12)) * dt;

      const movingX = this.phase[i] === 0;
      // semáforo: ao cruzar intersecção no eixo com sinal vermelho, espera
      const nearIntersection =
        Math.abs(((this.x[i] + this.half) % this.cell) - this.cell / 2) > this.cell / 2 - 1.5 &&
        Math.abs(((this.z[i] + this.half) % this.cell) - this.cell / 2) > this.cell / 2 - 1.5;
      if (nearIntersection && (movingX ? nsGreen : !nsGreen)) continue; // vermelho p/ este eixo

      if (movingX) {
        const dx = this.destX[i] - this.x[i];
        if (Math.abs(dx) <= speed) {
          this.x[i] = this.destX[i];
          this.phase[i] = 1;
        } else {
          this.x[i] += Math.sign(dx) * speed;
          this.angle[i] = dx > 0 ? 0 : Math.PI;
        }
      } else {
        const dz = this.destZ[i] - this.z[i];
        if (Math.abs(dz) <= speed) {
          // chegou
          this.active[i] = 0;
          this.owner[i] = -1;
          this.count--;
        } else {
          this.z[i] += Math.sign(dz) * speed;
          this.angle[i] = dz > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      }
    }
  }

  /** Serializa posições para render (x, z, ângulo). */
  snapshot(): { data: Float32Array; count: number } {
    const data = new Float32Array(this.count * 3);
    let j = 0;
    for (let i = 0; i < this.cap && j < this.count; i++) {
      if (!this.active[i]) continue;
      data[j * 3] = this.x[i];
      data[j * 3 + 1] = this.z[i];
      data[j * 3 + 2] = this.angle[i];
      j++;
    }
    return { data, count: j };
  }
}
