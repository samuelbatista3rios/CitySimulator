import { CONFIG } from '../config';
import { HotComponents, type ColdData } from './components';

/**
 * EcsWorld: aloca/recicla entidades e mantém os stores de componentes.
 * Entity id = índice nos arrays SoA (estável durante a vida da entidade).
 */
export class EcsWorld {
  hot: HotComponents;
  cold: (ColdData | null)[];
  private freeList: number[] = [];
  private highWater = 0;
  aliveCount = 0;

  constructor(capacity: number = CONFIG.MAX_CITIZENS) {
    this.hot = new HotComponents(capacity);
    this.cold = new Array(capacity).fill(null);
  }

  createEntity(cold: ColdData): number {
    let id: number;
    if (this.freeList.length > 0) {
      id = this.freeList.pop()!;
    } else {
      if (this.highWater >= this.hot.capacity) return -1; // capacidade esgotada
      id = this.highWater++;
    }
    this.hot.alive[id] = 1;
    this.cold[id] = cold;
    this.aliveCount++;
    return id;
  }

  destroyEntity(id: number): void {
    if (!this.hot.alive[id]) return;
    this.hot.alive[id] = 0;
    this.hot.companyId[id] = -1;
    this.hot.jobLevel[id] = -1;
    this.hot.partnerId[id] = -1;
    this.aliveCount--;
    this.freeList.push(id);
    // Mantemos cold data para histórico/árvore familiar (nome de falecidos).
  }

  /** Maior índice já usado — itere até aqui, checando alive[]. */
  get entityRange(): number {
    return this.highWater;
  }

  *aliveEntities(): IterableIterator<number> {
    for (let i = 0; i < this.highWater; i++) {
      if (this.hot.alive[i]) yield i;
    }
  }
}
