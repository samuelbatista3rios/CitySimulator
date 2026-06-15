import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db';

/** Aplica o schema.sql no banco. Uso: npm run db:init */
const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'schema.sql'), 'utf8');

const sql = schema;
pool
  .query(sql)
  .then(() => {
    console.log('✔ Schema do Genesis City aplicado.');
    return pool.end();
  })
  .catch((err) => {
    console.error('Erro ao aplicar schema:', err.message);
    process.exit(1);
  });
