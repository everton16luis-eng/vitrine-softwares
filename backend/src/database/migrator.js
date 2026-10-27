import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../database/migrations');

const LOCK_ID = 727_001; // advisory lock para impedir migrations concorrentes

/**
 * Aplica, em ordem, os arquivos NNN_nome.sql ainda não registrados em schema_migrations.
 * Cada migration roda em sua própria transação.
 */
export async function runMigrations({ log = console.log } = {}) {
  const client = await getPool().connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      versao     VARCHAR(20) PRIMARY KEY,
      nome       VARCHAR(200) NOT NULL,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT versao FROM schema_migrations');
    const done = new Set(rows.map((r) => r.versao));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3,}_[\w-]+\.sql$/.test(f)).sort();
    for (const file of files) {
      const versao = file.split('_')[0];
      if (done.has(versao)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (versao, nome) VALUES ($1, $2)', [versao, file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`[migrate] aplicada ${file}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `Falha na migration ${file}: ${err.message}`;
        throw err;
      }
    }
    if (!applied.length) log('[migrate] banco já está atualizado.');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
