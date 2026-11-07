// pgBackRest: agenda (full e diff por cron), execução pela operação fechada e leitura do `info`.
// Um backup só conta como bom quando o `info` lista o backup sem erro, a stanza está com status 0 e
// o `check` do arquivamento de WAL passou.
import type { Database, Tx } from '@central/database';
import { audit, SYSTEM, type AuditActor } from '../audit.ts';
import { createTask } from '../tasks/service.ts';
import { parseCron, nextRun } from '../backups/cron.ts';
import type { BackupDeps } from '../backups/service.ts';

export interface PgbrBackup { label: string; type: string; start: string | null; stop: string | null; size: number | null; repo_size: number | null; error: boolean }
export interface PgbrSummary { ok: boolean; status_code: number | null; status_message: string; backups: PgbrBackup[]; last: PgbrBackup | null; wal_min: string | null; wal_max: string | null; db_version: string | null; problems: string[] }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ts = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v * 1000).toISOString() : null);

/** Resume a saída de `pgbackrest info --output=json` (formato documentado do pgBackRest 2.x). */
export function summarizeInfo(info: unknown, stanza: string, check = 'ok'): PgbrSummary {
  const problems: string[] = [];
  const list = Array.isArray(info) ? info : [];
  const st = list.find((x) => x && typeof x === 'object' && (x as { name?: unknown }).name === stanza) as Record<string, any> | undefined;
  if (!st) return { ok: false, status_code: null, status_message: 'stanza ausente no info', backups: [], last: null, wal_min: null, wal_max: null, db_version: null, problems: [`A stanza ${stanza} não aparece no "pgbackrest info".`] };
  const code = num(st.status?.code);
  const message = String(st.status?.message ?? '');
  if (code !== 0) problems.push(`Status da stanza: ${message || `código ${code}`}.`);
  const backups: PgbrBackup[] = (Array.isArray(st.backup) ? st.backup : []).map((b: Record<string, any>) => ({
    label: String(b.label ?? ''), type: String(b.type ?? ''), start: ts(b.timestamp?.start), stop: ts(b.timestamp?.stop),
    size: num(b.info?.size), repo_size: num(b.info?.repository?.size), error: b.error === true
  })).filter((b: PgbrBackup) => b.label);
  const last = backups.length ? backups[backups.length - 1]! : null;
  if (!last) problems.push('Nenhum backup na stanza.');
  else if (last.error) problems.push(`O backup ${last.label} foi gravado com erro (páginas com checksum inválido).`);
  const archive = (Array.isArray(st.archive) ? st.archive : []).at(-1) as Record<string, any> | undefined;
  if (check !== 'ok') problems.push(`check: ${check}`);
  const db = (Array.isArray(st.db) ? st.db : []).at(-1) as Record<string, any> | undefined;
  return { ok: problems.length === 0, status_code: code, status_message: message, backups, last, wal_min: archive?.min ?? null, wal_max: archive?.max ?? null, db_version: db?.version ? String(db.version) : null, problems };
}

export function nextPgbr(schedule: string | null, tz: string, after: Date) { return schedule ? nextRun(parseCron(schedule), tz, after) : null; }

/** Cria a execução e a tarefa. Um backup por stanza por vez. */
export async function startPgbrRun(tx: Tx, deps: BackupDeps, stanzaId: number, type: 'full' | 'diff' | 'incr' | 'info', trigger: 'agendado' | 'manual', requestedBy: number | null, actor: AuditActor = SYSTEM) {
  const s = await tx.one('SELECT * FROM pgbackrest_stanzas WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [stanzaId]);
  if (!s) throw new Error('stanza inexistente');
  if (await tx.one("SELECT 1 FROM pgbackrest_runs WHERE stanza_id = $1 AND status IN ('na_fila', 'executando')", [stanzaId])) return null;
  const agent = await tx.one("SELECT id FROM agents WHERE server_id = $1 AND status = 'ativo' ORDER BY id DESC LIMIT 1", [s.server_id]);
  if (!agent) throw new Error('o servidor não tem agente ativo');
  const run = await tx.one('INSERT INTO pgbackrest_runs (client_id, stanza_id, type, trigger, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [s.client_id, s.id, type, trigger, requestedBy]);
  const operation = type === 'info' ? 'pgbackrest.info' : 'pgbackrest.backup';
  const params = type === 'info' ? { run_id: Number(run!.id), stanza: s.stanza } : { run_id: Number(run!.id), stanza: s.stanza, type };
  const { task } = await createTask(tx, await deps.signer(), {
    agentId: Number(agent.id), operation, params, requestedBy, idempotencyKey: `pgbackrest:${run!.id}`,
    origin: { type: 'pgbackrest', id: Number(run!.id) }, maxAttempts: type === 'info' ? 2 : 1, expiresInS: 12 * 3600, priority: type === 'info' ? 40 : 30
  }, actor);
  await tx.query('UPDATE pgbackrest_runs SET task_id = $2 WHERE id = $1', [run!.id, task.id]);
  await audit(tx, actor, { action: `pgbackrest.${type === 'info' ? 'consultar' : 'backup'}`, entity: 'pgbackrest', entityId: s.id, clientId: s.client_id, details: { tipo: type, origem: trigger } });
  return { run_id: Number(run!.id), task_id: task.public_id };
}

/** Worker: dispara o que venceu (full tem precedência sobre diff no mesmo horário). */
export async function schedulePgbackrest(db: Database, deps: BackupDeps, now = new Date()) {
  const due = await db.system((tx) => tx.many(`SELECT id, full_schedule, diff_schedule, timezone, next_full_at, next_diff_at FROM pgbackrest_stanzas
    WHERE enabled AND archived_at IS NULL AND (next_full_at <= $1 OR next_diff_at <= $1)`, [now]));
  let started = 0;
  for (const s of due) {
    await db.system(async (tx) => {
      const full = s.next_full_at && new Date(s.next_full_at) <= now;
      await tx.query('SAVEPOINT pb');
      try {
        if (await startPgbrRun(tx, deps, Number(s.id), full ? 'full' : 'diff', 'agendado', null)) started++;
        await tx.query('RELEASE SAVEPOINT pb');
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT pb');
        await tx.query("UPDATE pgbackrest_stanzas SET status = 'erro', last_error = $2 WHERE id = $1", [s.id, `Agendamento: ${(err as Error).message}`]);
      }
      // o próximo horário anda mesmo se falhou (o alerta avisa; não fica disparando em laço)
      await tx.query('UPDATE pgbackrest_stanzas SET next_full_at = $2, next_diff_at = $3 WHERE id = $1', [s.id,
        full ? nextPgbr(s.full_schedule, s.timezone, now) : s.next_full_at,
        s.diff_schedule && (!s.next_diff_at || new Date(s.next_diff_at) <= now) ? nextPgbr(s.diff_schedule, s.timezone, now) : s.next_diff_at]);
    });
  }
  return started;
}

/** Tarefas que falharam no agente → execução falhou e stanza com erro. */
export async function reconcilePgbackrest(tx: Tx) {
  await tx.query(`UPDATE pgbackrest_runs r SET status = 'executando' FROM agent_task_queue t WHERE r.task_id = t.id AND r.status = 'na_fila' AND t.status = 'executando'`);
  const ended = await tx.many(`UPDATE pgbackrest_runs r SET status = CASE WHEN t.status = 'cancelado' THEN 'cancelado' ELSE 'falhou' END,
      error = coalesce(t.error, 'A tarefa do agente falhou.'), finished_at = now()
    FROM agent_task_queue t WHERE r.task_id = t.id AND r.status IN ('na_fila', 'executando') AND t.status IN ('falhou', 'cancelado')
    RETURNING r.stanza_id, r.status, r.error, r.type`);
  for (const r of ended) {
    if (r.status === 'falhou') await tx.query("UPDATE pgbackrest_stanzas SET status = 'erro', last_error = $2 WHERE id = $1", [r.stanza_id, String(r.error).slice(0, 1000)]);
  }
  return ended.length;
}

/** Tratador de pgbackrest.backup e pgbackrest.info (registrado em tasks/handlers.ts). */
export async function pgbackrestResult(tx: Tx, task: Record<string, any>, result: { result?: unknown }) {
  if (task.origin_type !== 'pgbackrest' || !task.origin_id) throw new Error('tarefa do pgBackRest sem execução associada');
  const run = await tx.one('SELECT * FROM pgbackrest_runs WHERE id = $1 AND task_id = $2 FOR UPDATE', [task.origin_id, task.id]);
  if (!run) throw new Error('execução do pgBackRest não encontrada');
  const s = await tx.one('SELECT * FROM pgbackrest_stanzas WHERE id = $1 FOR UPDATE', [run.stanza_id]);
  const r = (result.result ?? {}) as { info?: unknown; check?: string; type?: string };
  if (!Array.isArray(r.info)) throw new Error('resultado sem "pgbackrest info"');
  const sum = summarizeInfo(r.info, s!.stanza, typeof r.check === 'string' ? r.check : 'não executado');
  // backup: o último da lista precisa ser do tipo pedido e posterior ao início da execução
  if (run.type !== 'info') {
    const last = sum.last;
    if (!last || last.type !== run.type || !last.stop || new Date(last.stop) < new Date(run.created_at)) sum.problems.push(`O info não mostra o backup ${run.type} desta execução.`);
    sum.ok = sum.problems.length === 0;
  }
  const info = JSON.stringify(r.info).length > 500_000 ? null : JSON.stringify(r.info);
  await tx.query(`UPDATE pgbackrest_stanzas SET status = $2, last_error = $3, last_info = coalesce($4::jsonb, last_info), last_info_at = now(),
      last_backup_label = $5, last_backup_type = $6, last_backup_at = $7, last_backup_bytes = $8, wal_min = $9, wal_max = $10 WHERE id = $1`,
  [s!.id, sum.ok ? 'ok' : 'erro', sum.ok ? null : sum.problems.join(' ').slice(0, 1000), info, sum.last?.label ?? null, sum.last?.type ?? null, sum.last?.stop ?? null,
    sum.last?.repo_size ?? sum.last?.size ?? null, sum.wal_min, sum.wal_max]);
  await tx.query('UPDATE pgbackrest_runs SET status = $2, label = $3, error = $4, finished_at = now() WHERE id = $1',
    [run.id, sum.ok ? 'concluido' : 'falhou', run.type === 'info' ? null : sum.last?.label ?? null, sum.ok ? null : sum.problems.join(' ').slice(0, 1000)]);
  await audit(tx, SYSTEM, { action: sum.ok ? 'pgbackrest.concluir' : 'pgbackrest.falhou', entity: 'pgbackrest', entityId: s!.id, clientId: s!.client_id, details: { tipo: run.type, rotulo: sum.last?.label ?? null } });
}
