/**
 * Persistência de snapshots (lado cliente).
 * 1º tenta o backend (Node + PostgreSQL via /api); se indisponível,
 * cai para localStorage — a simulação nunca perde a capacidade de salvar.
 */

const LOCAL_KEY = 'genesis-city-snapshot';

export async function saveSnapshot(payload: string): Promise<string> {
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (res.ok) return 'PostgreSQL';
    throw new Error(`HTTP ${res.status}`);
  } catch {
    try {
      localStorage.setItem(LOCAL_KEY, payload);
      return 'localStorage (backend offline)';
    } catch (e) {
      throw new Error('snapshot grande demais para localStorage e backend offline');
    }
  }
}

export async function loadSnapshot(): Promise<string | null> {
  try {
    const res = await fetch('/api/load');
    if (res.ok) {
      const data = await res.json();
      if (data.payload) return data.payload as string;
    }
  } catch {
    // backend offline — tenta localStorage
  }
  return localStorage.getItem(LOCAL_KEY);
}
