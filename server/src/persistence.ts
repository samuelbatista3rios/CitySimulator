import { pool, ping } from './db';

const DAYS_PER_YEAR = 360;

/**
 * Persiste um snapshot completo (JSONB) + espelho analítico relacional.
 * Usado pelo autosave do servidor. Tolerante a banco ausente (no-op + aviso).
 */
export async function persistSnapshot(payload: string): Promise<number | null> {
  if (!(await ping())) return null; // sem banco → ignora (a sim continua em memória)
  const data = JSON.parse(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await client.query(
      `INSERT INTO snapshots (sim_tick, seed, population, payload)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [data.tick, data.seed, data.aliveCount, payload],
    );
    const snapshotId = snap.rows[0].id;

    const hot = data.hot;
    let values: unknown[] = [];
    let rows: string[] = [];
    let n = 0;
    const flush = async () => {
      if (n === 0) return;
      await client.query(
        `INSERT INTO citizens (snapshot_id, citizen_id, name, sex, age, money, happiness, health, profession, education, company_id, alive)
         VALUES ${rows.join(',')}`,
        values,
      );
      rows = []; values = []; n = 0;
    };
    for (let i = 0; i < data.entityRange; i++) {
      if (!hot.alive[i] || !data.cold[i]) continue;
      const c = data.cold[i];
      const b = n * 12;
      rows.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`,
      );
      values.push(
        snapshotId, i, c.name, c.sex, Math.floor(hot.ageDays[i] / DAYS_PER_YEAR),
        hot.money[i], hot.happiness[i], hot.health[i], c.professionTitle,
        c.education, hot.companyId[i] === -1 ? null : hot.companyId[i], hot.alive[i] === 1,
      );
      n++;
      if (n === 500) await flush();
    }
    await flush();

    for (const comp of data.companies) {
      await client.query(
        `INSERT INTO companies (snapshot_id, company_id, name, sector, capital, employees, bankrupt)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshotId, comp.id, comp.name, comp.sector, comp.capital, comp.employees.length, comp.bankrupt],
      );
    }
    await client.query('COMMIT');
    return snapshotId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Carrega o snapshot mais recente (para retomar a cidade ao subir o servidor). */
export async function loadLatestSnapshot(): Promise<string | null> {
  if (!(await ping())) return null;
  const res = await pool.query(`SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 1`);
  if (res.rows.length === 0) return null;
  return JSON.stringify(res.rows[0].payload);
}
