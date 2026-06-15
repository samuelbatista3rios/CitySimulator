import pg from 'pg';

/**
 * Pool PostgreSQL. Configure via variáveis de ambiente:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (padrão: genesis_city)
 */
// Aceita tanto uma connection string única (DATABASE_URL — comum em Neon/Render/
// Railway) quanto variáveis PG* separadas. SSL ligado automaticamente para hosts
// gerenciados (a maioria exige).
const url = process.env.DATABASE_URL;
export const pool = url
  ? new pg.Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
      max: 10,
    })
  : new pg.Pool({
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? 'postgres',
      database: process.env.PGDATABASE ?? 'genesis_city',
      max: 10,
    });

export async function ping(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
