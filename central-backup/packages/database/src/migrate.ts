// Migrations versionadas (arquivos NNNN_nome.sql), aplicadas em ordem, cada uma numa transação,
// com checksum: alterar uma migration já aplicada é recusado (crie uma nova).
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Database } from './pool.ts';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate(db: Database, { log = console.log, dir = MIGRATIONS_DIR } = {}): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await db.owner(async (client) => {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query("SELECT pg_advisory_lock(hashtext('central_backup_migrations'))");
    try {
      const done = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version as string, r.checksum as string]));
      for (const file of files) {
        const sql = readFileSync(path.join(dir, file), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const version = file.replace(/\.sql$/, '');
        if (done.has(version)) {
          if (done.get(version) !== checksum) throw new Error(`A migration ${file} foi alterada depois de aplicada. Crie uma nova migration.`);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Falha na migration ${file}: ${(err as Error).message}`);
        }
        applied.push(version);
        log(`migration aplicada: ${file}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('central_backup_migrations'))");
    }
  });
  return applied;
}
