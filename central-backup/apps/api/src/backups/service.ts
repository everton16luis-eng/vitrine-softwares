// Execuções de backup: criação (manual/agendada), resultado do agente, conciliação de falhas e agenda.
import { conflict, notFound } from '@central/shared';
import type { Database, Tx } from '@central/database';
import { audit, SYSTEM, type AuditActor } from '../audit.ts';
import type { SecretStore } from '../secrets.ts';
import { createTask, type TaskSigner } from '../tasks/service.ts';
import { repositoryAccess, type DestinationRow } from '../storage/destinations.ts';
import { parseCron, nextRun } from './cron.ts';

export interface BackupDeps { store: SecretStore; signer: () => Promise<TaskSigner> }

const DUMP_EXT: Record<string, string> = { postgresql: 'dump', mysql: 'sql', mariadb: 'sql', mongodb: 'archive.gz', sqlite: 'sqlite' };

export function dumpFilename(d: { engine: string; db_name?: string | null; file_path?: string | null; id: number }) {
  const base = (d.db_name ?? d.file_path?.split(/[\\/]/).pop() ?? `banco-${d.id}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return `${d.engine}-${base}.${DUMP_EXT[d.engine]}`;
}

export function dbTarget(d: Record<string, any>) {
  return Object.fromEntries(Object.entries({
    engine: d.engine, host: d.host, port: d.port, socket_path: d.socket_path, db_name: d.db_name, user: d.tech_user, file_path: d.file_path
  }).filter(([, v]) => v != null));
}

export function computeNextRun(policy: { schedule: string; timezone: string }, after = new Date()) {
  return nextRun(parseCron(policy.schedule), policy.timezone, after);
}

/**
 * Cria a execução e a tarefa do agente. `scheduledFor` torna a execução agendada idempotente:
 * dois workers (ou um reinício) não disparam o mesmo horário duas vezes.
 */
export async function startRun(tx: Tx, deps: BackupDeps, jobId: number, opts: { trigger: 'agendado' | 'manual' | 'seguranca'; scheduledFor?: Date; requestedBy?: number | null }, actor: AuditActor) {
  const job = await tx.one(`SELECT j.*, p.limit_upload_kbps, p.archived_at AS policy_archived
    FROM backup_jobs j JOIN backup_policies p ON p.id = j.policy_id WHERE j.id = $1 AND j.archived_at IS NULL FOR UPDATE OF j`, [jobId]);
  if (!job) throw notFound('Job de backup');
  const agent = await tx.one("SELECT id FROM agents WHERE server_id = $1 AND status = 'ativo' ORDER BY id DESC LIMIT 1", [job.server_id]);
  if (!agent) throw conflict('O servidor não tem agente ativo.');
  const open = await tx.one("SELECT public_id FROM backup_runs WHERE job_id = $1 AND status IN ('na_fila', 'executando') LIMIT 1", [job.id]);
  if (open && opts.trigger !== 'agendado') throw conflict('Já existe uma execução deste job em andamento.');

  const run = await tx.one(`INSERT INTO backup_runs (client_id, job_id, trigger, scheduled_for, requested_by) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (job_id, scheduled_for) DO NOTHING RETURNING *`, [job.client_id, job.id, opts.trigger, opts.scheduledFor ?? null, opts.requestedBy ?? null]);
  if (!run) return { run: await tx.one('SELECT * FROM backup_runs WHERE job_id = $1 AND scheduled_for = $2', [job.id, opts.scheduledFor]), created: false };

  const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [job.destination_id]) as DestinationRow;
  const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1', [job.repository_id]);
  const access = await repositoryAccess(tx, deps.store, dest, repo!);
  const secrets: Record<string, string> = { repository: access.agentRepo, repo_password: access.password, repo_env: JSON.stringify(access.env) };
  const tags = [`job:${job.id}`, `cliente:${job.client_id}`, `execucao:${run.public_id}`];
  const common = { job_id: Number(job.id), tags, ...(job.limit_upload_kbps ? { limit_upload_kbps: Number(job.limit_upload_kbps) } : {}) };

  let operation: 'backup.files' | 'backup.db';
  let params: Record<string, unknown>;
  if (job.kind === 'banco') {
    const d = await tx.one('SELECT * FROM databases WHERE id = $1 AND archived_at IS NULL', [job.database_id]);
    if (!d) throw conflict('O banco do job foi arquivado.');
    if (d.engine !== 'sqlite' && !d.credential_id && d.tech_user) throw conflict('O banco não tem credencial cadastrada.');
    if (d.credential_id) secrets.password = await deps.store.reveal(tx, Number(d.credential_id));
    operation = 'backup.db';
    params = { ...common, target: dbTarget(d), filename: dumpFilename({ ...d, id: Number(d.id) }) };
  } else {
    operation = 'backup.files';
    params = { ...common, paths: job.paths, excludes: job.excludes };
  }
  const signer = await deps.signer();
  const { task } = await createTask(tx, signer, {
    agentId: Number(agent.id), operation, params, secrets, requestedBy: opts.requestedBy ?? null, idempotencyKey: `backup:${run.public_id}`,
    origin: { type: 'backup_run', id: Number(run.id) }, maxAttempts: 2, expiresInS: 12 * 3600, priority: opts.trigger === 'agendado' ? 100 : 50
  }, actor);
  await tx.query('UPDATE backup_runs SET task_id = $2 WHERE id = $1', [run.id, task.id]);
  await tx.query("UPDATE backup_jobs SET last_run_at = now(), last_status = 'na_fila' WHERE id = $1", [job.id]);
  await audit(tx, actor, { action: 'backup.iniciar', entity: 'execucao', entityId: run.public_id, clientId: job.client_id, details: { job: job.id, origem: opts.trigger } });
  return { run: { ...run, task_id: task.id }, created: true };
}

/** Jobs vencidos → execuções. Cada job é tratado na própria transação (falha em um não trava os outros). */
export async function scheduleDue(db: Database, deps: BackupDeps, now = new Date(), log: { warn?: (m: string) => void } = {}) {
  const due = await db.system((tx) => tx.many(`SELECT j.id FROM backup_jobs j WHERE j.enabled AND j.archived_at IS NULL AND j.next_run_at <= $1 ORDER BY j.next_run_at LIMIT 50`, [now]));
  let started = 0;
  for (const { id } of due) {
    await db.system(async (tx) => {
      const job = await tx.one(`SELECT j.id, j.next_run_at, p.schedule, p.timezone FROM backup_jobs j JOIN backup_policies p ON p.id = j.policy_id
        WHERE j.id = $1 AND j.enabled AND j.next_run_at <= $2 FOR UPDATE OF j SKIP LOCKED`, [id, now]);
      if (!job) return;
      const slot = new Date(job.next_run_at);
      // a próxima é calculada a partir de agora: depois de uma parada longa roda uma vez, não uma rajada
      await tx.query('UPDATE backup_jobs SET next_run_at = $2 WHERE id = $1', [job.id, computeNextRun(job, now)]);
      await tx.query('SAVEPOINT run_start');
      try {
        const out = await startRun(tx, deps, Number(job.id), { trigger: 'agendado', scheduledFor: slot }, SYSTEM);
        if (out.created) started++;
        await tx.query('RELEASE SAVEPOINT run_start');
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT run_start');
        const msg = (err as Error).message;
        await tx.query(`INSERT INTO backup_runs (client_id, job_id, trigger, scheduled_for, status, error, finished_at)
          SELECT client_id, id, 'agendado', $2, 'falhou', $3, now() FROM backup_jobs WHERE id = $1 ON CONFLICT DO NOTHING`, [job.id, slot, `Não foi possível iniciar: ${msg}`]);
        await tx.query("UPDATE backup_jobs SET last_status = 'falhou', last_run_at = now() WHERE id = $1", [job.id]);
        log.warn?.(`[agenda] job ${job.id}: ${msg}`);
      }
    });
  }
  return { started };
}

/** Execuções cuja tarefa falhou/foi cancelada; e as que começaram a rodar. */
export async function reconcileRuns(tx: Tx) {
  await tx.query(`UPDATE backup_runs r SET status = 'executando', started_at = coalesce(r.started_at, t.started_at)
    FROM agent_task_queue t WHERE r.task_id = t.id AND r.status = 'na_fila' AND t.status IN ('executando', 'restaurando')`);
  const ended = await tx.many(`UPDATE backup_runs r SET status = CASE WHEN t.status = 'cancelado' THEN 'cancelado' ELSE 'falhou' END,
      error = coalesce(t.error, 'A tarefa do agente falhou.'), finished_at = now()
    FROM agent_task_queue t WHERE r.task_id = t.id AND r.status IN ('na_fila', 'executando') AND t.status IN ('falhou', 'cancelado')
    RETURNING r.job_id, r.status, r.public_id, r.client_id`);
  for (const r of ended) {
    await tx.query('UPDATE backup_jobs SET last_status = $2 WHERE id = $1', [r.job_id, r.status]);
    await audit(tx, SYSTEM, { action: `backup.${r.status}`, entity: 'execucao', entityId: r.public_id, clientId: r.client_id });
  }
  return ended.length;
}

// ------------------------------------------------------------------ resultado do agente
const SNAPSHOT_ID = /^[0-9a-f]{64}$/;

/** Tratador do resultado de backup.files e backup.db (registrado em tasks/handlers.ts). */
export async function backupResult(tx: Tx, task: Record<string, any>, result: { result?: unknown; finished_at: string }) {
  const r = result.result as Record<string, any> | undefined;
  if (!r || typeof r.snapshot_id !== 'string' || !SNAPSHOT_ID.test(r.snapshot_id)) throw new Error('resultado sem identificador de snapshot válido');
  if (task.origin_type !== 'backup_run' || !task.origin_id) throw new Error('tarefa de backup sem execução associada');
  const run = await tx.one('SELECT * FROM backup_runs WHERE id = $1 AND task_id = $2 FOR UPDATE', [task.origin_id, task.id]);
  if (!run) throw new Error('execução de backup não encontrada');
  const job = await tx.one('SELECT * FROM backup_jobs WHERE id = $1', [run.job_id]);
  const num = (v: unknown) => (Number.isFinite(v) && Number(v) >= 0 ? Math.round(Number(v)) : null);
  const params = task.params as { filename?: string; paths?: string[] };
  const snap = await tx.one(`INSERT INTO backup_snapshots (client_id, repository_id, job_id, run_id, restic_id, taken_at, paths, stdin_filename, files, size_bytes, added_bytes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (repository_id, restic_id) DO UPDATE SET run_id = coalesce(backup_snapshots.run_id, EXCLUDED.run_id) RETURNING id`,
  [run.client_id, job!.repository_id, job!.id, run.id, r.snapshot_id, result.finished_at, params.paths ?? [], params.filename ?? null,
    num(r.total_files_processed), num(r.total_bytes_processed), num(r.data_added)]);
  const warn = r.incomplete ? `Backup parcial: ${Array.isArray(r.errors) ? r.errors.length : 'alguns'} item(ns) não puderam ser lidos.`
    : Array.isArray(r.missing_paths) && r.missing_paths.length ? `Caminhos inexistentes no servidor: ${r.missing_paths.join(', ')}` : null;
  const summary = Object.fromEntries(['files_new', 'files_changed', 'files_unmodified', 'total_files_processed', 'total_bytes_processed', 'data_added', 'duration_s', 'incomplete']
    .map((k) => [k, r[k]]).concat([['errors', Array.isArray(r.errors) ? r.errors.slice(0, 20).map((e: unknown) => String(e).slice(0, 300)) : []]]));
  await tx.query(`UPDATE backup_runs SET status = 'concluido', finished_at = now(), snapshot_id = $2, summary = $3, error = $4 WHERE id = $1`,
    [run.id, snap!.id, JSON.stringify(summary), warn]);
  // "concluido" ainda não é sucesso: o job só registra sucesso depois da verificação
  await tx.query("UPDATE backup_jobs SET last_status = 'concluido' WHERE id = $1", [job!.id]);
}
