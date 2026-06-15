/**
 * GOAP — Goal Oriented Action Planning.
 *
 * Cada ação declara precondições e efeitos sobre um estado simbólico do mundo
 * do agente. O planejador faz busca regressiva (do objetivo para o estado
 * atual) e devolve a sequência de ações. A escolha do OBJETIVO vem da
 * necessidade mais urgente (ponderada pela personalidade) ou do objetivo de
 * vida prioritário.
 */

export type WorldState = Record<string, boolean>;

export interface GoapAction {
  name: string;
  cost: number;
  pre: WorldState;
  effects: WorldState;
}

export const ACTIONS: GoapAction[] = [
  { name: 'Dormir',          cost: 1, pre: { emCasa: true },                       effects: { descansado: true } },
  { name: 'IrParaCasa',      cost: 1, pre: {},                                     effects: { emCasa: true } },
  { name: 'Comer',           cost: 1, pre: { temDinheiro: true },                  effects: { alimentado: true } },
  { name: 'Trabalhar',       cost: 2, pre: { temEmprego: true, descansado: true }, effects: { temDinheiro: true } },
  { name: 'ProcurarEmprego', cost: 3, pre: { adulto: true },                       effects: { temEmprego: true } },
  { name: 'Estudar',         cost: 2, pre: { descansado: true },                   effects: { qualificado: true } },
  { name: 'Socializar',      cost: 1, pre: { descansado: true },                   effects: { socializado: true } },
  { name: 'Divertir',        cost: 1, pre: { temDinheiro: true },                  effects: { divertido: true } },
  { name: 'Comprar',         cost: 1, pre: { temDinheiro: true },                  effects: { abastecido: true } },
  { name: 'Investir',        cost: 2, pre: { temDinheiro: true, qualificado: true }, effects: { investido: true } },
  { name: 'AbrirEmpresa',    cost: 5, pre: { temCapital: true, qualificado: true }, effects: { temEmprego: true, empresario: true } },
];

interface PlanNode {
  /** condições ainda não satisfeitas */
  open: WorldState;
  plan: string[];
  cost: number;
}

/**
 * Busca regressiva limitada (profundidade 5). Estados são pequenos (≤10 chaves),
 * então o plano sai em microssegundos — viável para milhares de agentes.
 */
export function plan(current: WorldState, goal: WorldState, maxDepth = 5): string[] | null {
  const satisfied = (open: WorldState) =>
    Object.entries(open).every(([k, v]) => (current[k] ?? false) === v);

  let frontier: PlanNode[] = [{ open: { ...goal }, plan: [], cost: 0 }];

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: PlanNode[] = [];
    for (const node of frontier) {
      if (satisfied(node.open)) return node.plan;
      // escolhe uma condição pendente e tenta ações que a produzem
      const pending = Object.entries(node.open).find(
        ([k, v]) => (current[k] ?? false) !== v,
      );
      if (!pending) return node.plan;
      const [key, want] = pending;
      for (const action of ACTIONS) {
        if (action.effects[key] !== want) continue;
        const open: WorldState = { ...node.open };
        delete open[key];
        // precondições da ação viram novas pendências
        for (const [pk, pv] of Object.entries(action.pre)) {
          if ((current[pk] ?? false) !== pv) open[pk] = pv;
        }
        next.push({ open, plan: [action.name, ...node.plan], cost: node.cost + action.cost });
      }
    }
    if (next.length === 0) return null;
    next.sort((a, b) => a.cost - b.cost);
    frontier = next.slice(0, 8); // beam search: mantém os 8 melhores
    // se o melhor já está satisfeito, retorna
    if (satisfied(frontier[0].open)) return frontier[0].plan;
  }
  const best = frontier.find((n) => satisfied(n.open));
  return best ? best.plan : null;
}
