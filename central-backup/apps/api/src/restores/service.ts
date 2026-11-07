// Restauração: criação da tarefa, andamento (backup de segurança → restauração) e resultado.
import { randomBytes } from 'node:crypto';
import type { Database, Tx } from '@central/database';
import { audit, SYSTEM } from '../audit.ts';
import { createTask } from '../tasks/service.ts';
import { repositoryAccess, type DestinationRow } from '../storage/destinations.ts';
import { dbTarget, type BackupDeps } from '../backups/service.ts';

/** Cria a tarefa do agente para uma solicitação já autorizada. */
export async function enqueueRestore(tx: Tx, deps: BackupDeps, restoreId: number) {
  const rr = await tx.one('SELECT * FROM restore_requests WHERE id = $1 FOR UPDATE', [restoreId]);
  if (!rr) throw new Error('solicitação de restauração inexistente');
  const snap = await tx.one('SELECT * FROM backup_snapshots WHERE id = $1', [rr.snapshot_id]);
  if (!snap || snap.status !== 'validado') throw new Error('o snapshot não está mais validado');
  const job = await tx.one('SELECT * FROM backup_jobs WHERE id = $1', [rr.job_id]);
  const agent = await tx.one("SELECT id FROM agents WHERE server_id = $1 AND status = 'ativo' ORDER BY id DESC LIMIT 1", [rr.server_id]);
  if (!agent) throw new Error('o servidor não tem agente ativo');
  const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1', [snap.repository_id]);
  const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo!.destination_id]) as DestinationRow;
  const access = await repositoryAccess(tx, deps.store, dest, repo!);
  const secrets: Record<string, string> = { repository: access.agentRepo, repo_password: access.password, repo_env: JSON.stringify(access.env) };
  const common = { restore_id: rr.public_id, job_id: Number(job!.id), snapshot: snap.restic_id };
  const o = rr.options as { includes?: string[]; target_dir?: string; new_name?: string; new_file?: string };
  let operation: 'restore.files' | 'restore.db';
  let params: Record<string, unknown>;
  if (rr.kind === 'arquivos') {
    operation = 'restore.files';
    params = { ...common, includes: o.includes ?? [], ...(o.target_dir ? { target_dir: o.target_dir } : {}), ...(rr.drill ? { discard: true } : {}) };
  } else {
    const d = await tx.one('SELECT * FROM databases WHERE id = $1', [job!.database_id]);
    if (d!.credential_id) secrets.password = await deps.store.reveal(tx, Number(d!.credential_id));
    operation = 'restore.db';
    params = { ...common, filename: snap.stdin_filename, target: dbTarget(d!), mode: rr.mode === 'producao' ? 'producao' : 'novo',
      ...(o.new_name ? { new_name: o.new_name } : {}), ...(o.new_file ? { new_file: o.new_file } : {}), ...(rr.drill ? { discard: true } : {}) };
  }
  const signer = await deps.signer();
  const { task } = await createTask(tx, signer, {
    agentId: Number(agent.id), operation, params, secrets, requestedBy: rr.approved_by ?? rr.requested_by ?? null, idempotencyKey: `restore:${rr.public_id}`,
    origin: { type: 'restore', id: Number(rr.id) }, maxAttempts: 1, expiresInS: 12 * 3600, priority: 20
  }, SYSTEM);
  await tx.query("UPDATE restore_requests SET status = 'na_fila', task_id = $2 WHERE id = $1", [rr.id, task.id]);
  return task;
}

/** Worker: backup de segurança validado → restauração; tarefas que falharam → solicitação falha. */
export async function progressRestores(db: Database, deps: BackupDeps) {
  let moved = 0;
  const waiting = await db.system((tx) => tx.many(`SELECT rr.id, r.status AS safety FROM restore_requests rr JOIN backup_runs r ON r.id = rr.safety_run_id WHERE rr.status = 'backup_seguranca'`));
  for (const w of waiting) {
    await db.system(async (tx) => {
      if (w.safety === 'validado') {
        await tx.query('SAVEPOINT rs');
        try { await enqueueRestore(tx, deps, Number(w.id)); await tx.query('RELEASE SAVEPOINT rs'); moved++; } catch (err) {
          await tx.query('ROLLBACK TO SAVEPOINT rs');
          await fail(tx, Number(w.id), `Não foi possível iniciar a restauração: ${(err as Error).message}`);
        }
      } else if (['falhou', 'cancelado', 'falha_verificacao'].includes(w.safety)) {
        await fail(tx, Number(w.id), `O backup de segurança não foi validado (${w.safety}); a produção não foi tocada.`);
      }
    });
  }
  await db.system(async (tx) => {
    await tx.query(`UPDATE restore_requests rr SET status = 'executando' FROM agent_task_queue t WHERE rr.task_id = t.id AND rr.status = 'na_fila' AND t.status = 'executando'`);
    const ended = await tx.many(`SELECT rr.id, t.status, t.error FROM restore_requests rr JOIN agent_task_queue t ON t.id = rr.task_id
      WHERE rr.status IN ('na_fila', 'executando') AND t.status IN ('falhou', 'cancelado')`);
    for (const e of ended) await fail(tx, Number(e.id), e.error ?? 'A tarefa de restauração falhou.', e.status === 'cancelado' ? 'cancelado' : 'falhou');
  });
  return moved;
}

async function fail(tx: Tx, id: number, error: string, status = 'falhou') {
  const r = await tx.one('UPDATE restore_requests SET status = $2, error = $3, finished_at = now() WHERE id = $1 RETURNING id, public_id, client_id, drill, job_id', [id, status, error.slice(0, 2000)]);
  if (r!.drill) await drillOutcome(tx, r!, false);
  await audit(tx, SYSTEM, { action: `restauracao.${status}`, entity: 'restauracao', entityId: r!.public_id, clientId: r!.client_id, details: { erro: error.slice(0, 300) } });
}

/** Tratador do resultado (registrado em tasks/handlers.ts). */
export async function restoreResult(tx: Tx, task: Record<string, any>, result: { result?: unknown }) {
  if (task.origin_type !== 'restore' || !task.origin_id) throw new Error('tarefa de restauração sem solicitação associada');
  const rr = await tx.one('SELECT * FROM restore_requests WHERE id = $1 AND task_id = $2 FOR UPDATE', [task.origin_id, task.id]);
  if (!rr) throw new Error('solicitação de restauração não encontrada');
  const r = (result.result ?? {}) as Record<string, any>;
  const out: Record<string, unknown> = { ...r };
  if (rr.kind === 'arquivos') {
    if (!Number.isFinite(r.files_restored)) throw new Error('resultado sem contagem de arquivos');
    const snap = await tx.one('SELECT files FROM backup_snapshots WHERE id = $1', [rr.snapshot_id]);
    const full = !(rr.options?.includes?.length);
    if (full && snap?.files != null) {
      out.conferencia = Number(snap.files) === Number(r.files_restored) ? 'ok' : `divergente: snapshot tem ${snap.files}, restaurados ${r.files_restored}`;
    }
  }
  if (rr.drill && r.discarded !== true) out.conferencia = 'o agente não confirmou o descarte do teste';
  const ok = out.conferencia === undefined || out.conferencia === 'ok';
  await tx.query(`UPDATE restore_requests SET status = $2, result = $3, error = $4, finished_at = now(),
      duration_s = (SELECT round(extract(epoch FROM now() - t.started_at)) FROM agent_task_queue t WHERE t.id = $5 AND t.started_at IS NOT NULL) WHERE id = $1`,
    [rr.id, ok ? 'concluido' : 'falhou', JSON.stringify(out), ok ? null : String(out.conferencia), task.id]);
  if (rr.drill) await drillOutcome(tx, rr, ok);
  await audit(tx, SYSTEM, { action: ok ? 'restauracao.concluir' : 'restauracao.falhou', entity: 'restauracao', entityId: rr.public_id, clientId: rr.client_id, details: { modo: rr.mode } });
}

async function drillOutcome(tx: Tx, rr: { id: unknown; job_id: unknown }, ok: boolean) {
  await tx.query('UPDATE backup_jobs SET last_restore_test_at = now(), last_restore_test_status = $2, last_restore_test_id = $3 WHERE id = $1', [rr.job_id, ok ? 'ok' : 'falhou', rr.id]);
}

/**
 * Testes periódicos de restauração: para cada job cuja política define `restore_test_days`, restaura o
 * snapshot validado mais recente num destino que não toca a produção (temporário do agente ou banco
 * cb_teste_xxxxxxxx), confere e descarta. No máximo `limit` por rodada, para não pesar nos servidores.
 */
export async function scheduleDrills(db: Database, deps: BackupDeps, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const due = await db.system((tx) => tx.many(`SELECT j.id, j.client_id, j.server_id, j.kind, j.database_id, d.engine,
      (SELECT x.id FROM backup_snapshots x WHERE x.job_id = j.id AND x.status = 'validado' ORDER BY x.taken_at DESC LIMIT 1) AS snapshot_id
    FROM backup_jobs j JOIN backup_policies p ON p.id = j.policy_id LEFT JOIN databases d ON d.id = j.database_id
    WHERE j.enabled AND j.archived_at IS NULL AND p.restore_test_days IS NOT NULL
      AND (j.last_restore_test_at IS NULL OR j.last_restore_test_at < $1::timestamptz - make_interval(days => p.restore_test_days))
      AND EXISTS (SELECT 1 FROM agents a WHERE a.server_id = j.server_id AND a.status = 'ativo')
      AND NOT EXISTS (SELECT 1 FROM restore_requests r WHERE r.job_id = j.id AND r.status IN ('aguardando_aprovacao', 'backup_seguranca', 'na_fila', 'executando'))
      AND NOT EXISTS (SELECT 1 FROM backup_runs b WHERE b.job_id = j.id AND b.status IN ('na_fila', 'executando'))
    ORDER BY j.last_restore_test_at NULLS FIRST, j.id LIMIT $2`, [now, opts.limit ?? 3]));
  let created = 0;
  for (const j of due) {
    if (!j.snapshot_id) continue; // sem snapshot validado não há o que testar (o alerta de backup cuida disso)
    await db.system(async (tx) => {
      const options = j.kind === 'banco' && j.engine !== 'sqlite' ? { new_name: `cb_teste_${randomBytes(4).toString('hex')}` } : {};
      const rr = await tx.one(`INSERT INTO restore_requests (client_id, server_id, job_id, snapshot_id, kind, mode, options, reason, status, drill)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'Teste periódico de restauração (automático)', 'na_fila', true) RETURNING id, public_id, job_id`,
      [j.client_id, j.server_id, j.id, j.snapshot_id, j.kind, j.kind === 'banco' ? 'novo_banco' : 'temporario', JSON.stringify(options)]);
      await audit(tx, SYSTEM, { action: 'restauracao.teste_agendado', entity: 'restauracao', entityId: rr!.public_id, clientId: j.client_id, details: { job: Number(j.id) } });
      await tx.query('SAVEPOINT dr');
      try { await enqueueRestore(tx, deps, Number(rr!.id)); await tx.query('RELEASE SAVEPOINT dr'); created++; } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT dr');
        await fail(tx, Number(rr!.id), `Não foi possível iniciar o teste: ${(err as Error).message}`);
      }
    });
  }
  return created;
}
