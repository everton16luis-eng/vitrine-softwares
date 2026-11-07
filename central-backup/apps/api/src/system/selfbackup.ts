// Backup da própria central: dump do banco da central (pg_dump -Fc) direto para um repositório restic
// próprio (`--stdin-from-command`: dump que falha não vira snapshot), seguido de verificação
// (`restic check --read-data-subset` e `pg_restore --list` no dump guardado). A KEK NÃO entra neste
// backup: ela vai no kit de recuperação, guardado fora do servidor.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Database } from '@central/database';
import type { Config } from '../config.ts';
import { restic } from '../storage/restic.ts';
import { resticDump, pipeTo } from '../backups/verify.ts';
import { audit, SYSTEM } from '../audit.ts';
import { parseCron, nextRun } from '../backups/cron.ts';

const TAG = 'central-backup';
export const DUMP_NAME = 'central.dump';

/** Senha do repositório da central: criada uma vez (0400) e guardada no kit de recuperação. */
export function selfBackupPassword(config: Config) {
  const f = config.selfBackup.passwordFile;
  if (!existsSync(f)) {
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o400 });
    try { chmodSync(f, 0o400); } catch { /* Windows */ }
  }
  return readFileSync(f, 'utf8').trim();
}

/** Variáveis do backend do restic repassadas do ambiente da central (S3/B2/rest-server). */
function backendEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v && /^(AWS_|B2_|AZURE_|GOOGLE_|RESTIC_REST_)/.test(k))) as Record<string, string>;
}

function pgEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  const env: Record<string, string> = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1), PGAPPNAME: 'central-self-backup' };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

export async function runSelfBackup(db: Database, config: Config, trigger: 'agendado' | 'manual' = 'manual') {
  const repo = config.selfBackup.repository;
  if (!repo) throw new Error('SELF_BACKUP_REPOSITORY não configurado.');
  const password = selfBackupPassword(config);
  const env = backendEnv();
  const bin = config.tools.restic;
  const row = await db.system((tx) => tx.one("INSERT INTO system_backups (trigger) VALUES ($1) RETURNING id", [trigger]).catch((err) => {
    if (/ux_system_backups_running/.test(String(err.message ?? err)) || err.code === '23505') throw new Error('Já existe um backup da central em andamento.');
    throw err;
  }));
  const id = Number(row!.id);
  const details: Record<string, unknown> = {};
  try {
    if ((await restic(bin, ['cat', 'config'], { repo, password, env, timeoutMs: 60_000 })).code !== 0) {
      const init = await restic(bin, ['init'], { repo, password, env, timeoutMs: 120_000 });
      if (init.code !== 0) throw new Error(`restic init: ${init.stderr}`);
      details.repositorio_criado = true;
    }
    const pg = pgEnv(config.databaseUrl);
    const b = await restic(bin, ['backup', '--host', 'central', '--tag', TAG, '--stdin-filename', DUMP_NAME, '--stdin-from-command', '--',
      config.selfBackup.pgDump, '--format=custom', '--no-owner', '--no-privileges', '--dbname', pg.PGDATABASE!],
    { repo, password, env: { ...env, ...pg }, timeoutMs: 6 * 3600_000, known: pg.PGPASSWORD ? [pg.PGPASSWORD] : [] });
    if (b.code !== 0) throw new Error(`backup do banco da central falhou: ${b.stderr}`);
    const snaps = await restic(bin, ['snapshots', '--json', '--tag', TAG, '--latest', '1'], { repo, password, env });
    const list = JSON.parse(snaps.stdout || '[]') as { id: string; time: string; summary?: { total_bytes_processed?: number } }[];
    const snap = list.at(-1);
    if (!snap) throw new Error('snapshot não encontrado depois do backup.');
    // verificação: integridade do repositório (amostra) + conteúdo do dump
    const check = await restic(bin, ['check', '--read-data-subset=10%'], { repo, password, env, timeoutMs: 3600_000 });
    if (check.code !== 0) throw new Error(`restic check reprovou o repositório: ${check.stderr}`);
    const toc = await resticDump(bin, repo, password, env, [snap.id, `/${DUMP_NAME}`], (s) => pipeTo(config.tools.pgRestore, ['--list'], s));
    const tables = toc.split('\n').filter((l) => / TABLE (public|[a-z_]+) /.test(l) && !/ TABLE DATA /.test(l)).length;
    const objects = toc.split('\n').filter((l) => l && !l.startsWith(';')).length;
    if (tables === 0) throw new Error('o dump da central não tem tabelas.');
    details.objetos = objects;
    if (config.selfBackup.keepLast) {
      const f = await restic(bin, ['forget', '--tag', TAG, '--keep-last', String(config.selfBackup.keepLast), '--prune'], { repo, password, env, timeoutMs: 3600_000 });
      details.retencao = f.code === 0 ? 'ok' : `não aplicada: ${f.stderr.slice(0, 300)}`;
    }
    await db.system(async (tx) => {
      await tx.query("UPDATE system_backups SET status = 'validado', snapshot_id = $2, bytes = $3, tables = $4, details = $5, finished_at = now() WHERE id = $1",
        [id, snap.id, snap.summary?.total_bytes_processed ?? null, tables, JSON.stringify(details)]);
      await audit(tx, SYSTEM, { action: 'central.backup_validado', entity: 'sistema', entityId: id, details: { snapshot: snap.id.slice(0, 8), tabelas: tables } });
    });
    return { id, status: 'validado' as const, snapshot_id: snap.id, tables };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 2000);
    await db.system(async (tx) => {
      await tx.query("UPDATE system_backups SET status = 'falhou', error = $2, details = $3, finished_at = now() WHERE id = $1", [id, msg, JSON.stringify(details)]);
      await audit(tx, SYSTEM, { action: 'central.backup_falhou', entity: 'sistema', entityId: id, details: { erro: msg.slice(0, 300) } });
    });
    return { id, status: 'falhou' as const, error: msg };
  }
}

/** Worker: roda no horário configurado (uma vez por horário). */
export async function selfBackupDue(db: Database, config: Config, now = new Date()) {
  if (!config.selfBackup.repository) return false;
  const last = await db.system((tx) => tx.one('SELECT max(started_at) AS at FROM system_backups'));
  const cron = parseCron(config.selfBackup.schedule);
  const from = last?.at ? new Date(last.at) : new Date(now.getTime() - 2 * 86400_000);
  return nextRun(cron, config.selfBackup.timezone, from) <= now;
}
