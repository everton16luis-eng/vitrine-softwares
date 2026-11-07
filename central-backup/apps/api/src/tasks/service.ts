// Fila de tarefas dos agentes — o PostgreSQL é a fonte da verdade.
//
// Garantias:
//   - catálogo fechado: só operações de @central/contracts, com parâmetros validados por esquema;
//   - idempotência: idempotency_key única (repetir o pedido devolve a mesma tarefa);
//   - concorrência: no máximo uma tarefa ativa por lock_key (índice único parcial); as demais
//     ficam "pendente" e sobem quando o lock é liberado;
//   - entrega com lease: a tarefa volta para a fila se o agente parar de dar sinal;
//   - uma tarefa só termina com o resultado do agente.
import { randomUUID } from 'node:crypto';
import { OPERATIONS, isOperationName, validate, type SignedTask, type TaskResult, type TaskProgress } from '@central/contracts';
import { signPayload, seal } from '@central/security';
import { badRequest, conflict, notFound, validationError, retryDelayMs, redact } from '@central/shared';
import { isUniqueViolation, type Tx } from '@central/database';
import { audit, type AuditActor } from '../audit.ts';

export interface TaskSigner { keyId: string; privatePem: string }

export interface CreateTaskInput {
  agentId: number;
  operation: string;
  params: unknown;
  requestedBy?: number | null;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  expiresInS?: number;
  origin?: { type: string; id: number };
  /** segredos em texto claro, só em memória: são selados para a chave do agente antes de gravar */
  secrets?: Record<string, string>;
}

const TASK_COLUMNS = `t.origin_type, t.origin_id, t.id, t.public_id, t.agent_id, t.client_id, t.operation, t.operation_version, t.params, t.signature, t.signing_key_id,
  t.issued_at, t.idempotency_key, t.lock_key, t.status, t.priority, t.attempt, t.max_attempts, t.timeout_s, t.available_at, t.lease_until,
  t.expires_at, t.started_at, t.finished_at, t.result, t.error, t.requested_by, t.created_at, t.updated_at`;

export async function createTask(tx: Tx, signer: TaskSigner, input: CreateTaskInput, actor: AuditActor) {
  if (!isOperationName(input.operation)) throw validationError({ operation: 'Operação não existe no catálogo.' }, 'Operação não permitida.');
  const spec = OPERATIONS[input.operation];
  const v = validate(spec.params, input.params ?? {});
  if (!v.ok) throw validationError(Object.fromEntries(Object.entries(v.errors).map(([k, m]) => [`params.${k}`, m])), 'Parâmetros inválidos para a operação.');

  const agent = await tx.one<{ id: number; public_id: string; client_id: number; server_id: number; status: string; enc_public_key: string | null }>(
    'SELECT id, public_id, client_id, server_id, status, enc_public_key FROM agents WHERE id = $1', [input.agentId]);
  if (!agent) throw notFound('Agente');
  if (agent.status !== 'ativo') throw conflict('O agente não está ativo.');
  const expected = [...(spec as { secrets?: readonly string[] }).secrets ?? []].sort();
  const given = Object.keys(input.secrets ?? {}).sort();
  if (given.some((k) => !expected.includes(k))) throw badRequest('Segredo não previsto para a operação.');

  const idempotencyKey = input.idempotencyKey ?? `manual:${randomUUID()}`;
  if (!/^[\w:.-]{4,200}$/.test(idempotencyKey)) throw badRequest('Chave de idempotência inválida.');
  const existing = await tx.one(`SELECT ${TASK_COLUMNS} FROM agent_task_queue t WHERE t.idempotency_key = $1`, [idempotencyKey]);
  if (existing) {
    if (existing.agent_id !== agent.id || existing.operation !== input.operation) throw conflict('Chave de idempotência já usada por outra tarefa.');
    return { task: existing, created: false };
  }

  const taskId = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (input.expiresInS ?? 24 * 3600) * 1000);
  let sealed: Record<string, string> | undefined;
  if (given.length) {
    if (!agent.enc_public_key) throw conflict('O agente ainda não informou a chave de cifragem; atualize o agente.');
    sealed = Object.fromEntries(Object.entries(input.secrets!).map(([k, val]) => [k, seal(val, agent.enc_public_key!, `task:${taskId}`)]));
  }
  const signed = signPayload({
    task_id: taskId, agent_id: agent.public_id, operation: spec.name, operation_version: spec.version, params: v.value,
    issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString(), timeout_s: spec.timeoutSeconds, ...(sealed ? { secrets: sealed } : {})
  }, signer.privatePem, signer.keyId);
  const lockKey = spec.lockKey({ agentId: agent.id, serverId: agent.server_id }, v.value as never);
  const insert = (status: string) => tx.one(
    `INSERT INTO agent_task_queue (public_id, agent_id, client_id, operation, operation_version, params, signature, signing_key_id, issued_at,
       idempotency_key, lock_key, status, priority, max_attempts, timeout_s, expires_at, requested_by, origin_type, origin_id, sealed_secrets)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [taskId, agent.id, agent.client_id, spec.name, spec.version, JSON.stringify(v.value), signed.signature, signed.key_id, issuedAt,
      idempotencyKey, lockKey, status, input.priority ?? 100, input.maxAttempts ?? (spec.idempotent ? 3 : 1), spec.timeoutSeconds, expiresAt,
      input.requestedBy ?? null, input.origin?.type ?? null, input.origin?.id ?? null, sealed ? JSON.stringify(sealed) : null]);

  // Tenta ocupar o lock; se outra tarefa do mesmo recurso estiver ativa, espera como "pendente".
  await tx.query('SAVEPOINT task_lock');
  let task;
  try {
    task = await insert('na_fila');
    await tx.query('RELEASE SAVEPOINT task_lock');
  } catch (err) {
    await tx.query('ROLLBACK TO SAVEPOINT task_lock');
    if (!isUniqueViolation(err, 'ux_task_lock_active')) throw err;
    task = await insert('pendente');
  }
  await audit(tx, actor, { action: 'tarefa.criar', entity: 'tarefa', entityId: taskId, clientId: agent.client_id, details: { operacao: spec.name, agente: agent.public_id, situacao: task!.status } });
  return { task: task!, created: true };
}

/** Entrega até `limit` tarefas prontas ao agente, com lease. */
export async function claimTasks(tx: Tx, agentId: number, { limit = 1, leaseS = 120 } = {}): Promise<SignedTask[]> {
  const rows = await tx.many(
    `UPDATE agent_task_queue t SET status = 'executando', attempt = t.attempt + 1, started_at = coalesce(t.started_at, now()),
       lease_until = now() + make_interval(secs => greatest($3::int, t.timeout_s + 30))
     WHERE t.id IN (
       SELECT id FROM agent_task_queue
       WHERE agent_id = $1 AND status = 'na_fila' AND available_at <= now() AND expires_at > now()
       ORDER BY priority, id FOR UPDATE SKIP LOCKED LIMIT $2)
     RETURNING t.public_id, t.operation, t.operation_version, t.params, t.signature, t.signing_key_id, t.issued_at, t.expires_at, t.timeout_s, t.attempt, t.sealed_secrets,
       (SELECT public_id FROM agents a WHERE a.id = t.agent_id) AS agent_public_id`,
    [agentId, limit, leaseS]);
  return rows.map((r) => ({
    payload: {
      task_id: r.public_id, agent_id: r.agent_public_id, operation: r.operation, operation_version: r.operation_version, params: r.params,
      issued_at: new Date(r.issued_at).toISOString(), expires_at: new Date(r.expires_at).toISOString(), timeout_s: r.timeout_s,
      ...(r.sealed_secrets ? { secrets: r.sealed_secrets } : {})
    },
    signature: r.signature, key_id: r.signing_key_id, attempt: r.attempt
  }));
}

async function lockedTaskOfAgent(tx: Tx, agentId: number, taskPublicId: string) {
  const task = await tx.one(`SELECT ${TASK_COLUMNS} FROM agent_task_queue t WHERE t.public_id = $1 FOR UPDATE`, [taskPublicId]);
  if (!task || task.agent_id !== agentId) throw notFound('Tarefa'); // nunca revela tarefa de outro agente
  return task;
}

async function insertLogs(tx: Tx, task: { id: number; client_id: number }, attempt: number, logs: TaskProgress['logs']) {
  for (const l of logs) {
    await tx.query('INSERT INTO agent_task_logs (task_id, client_id, attempt, at, level, message) VALUES ($1, $2, $3, $4, $5, $6)',
      [task.id, task.client_id, attempt, l.at, l.level, redact(l.message)]);
  }
}

export async function reportProgress(tx: Tx, agentId: number, taskPublicId: string, body: TaskProgress, leaseS = 120) {
  const task = await lockedTaskOfAgent(tx, agentId, taskPublicId);
  if (!['executando', 'restaurando'].includes(task.status) || task.attempt !== body.attempt) throw conflict('A tarefa não está mais em execução nesta tentativa.');
  await tx.query('UPDATE agent_task_queue SET lease_until = now() + make_interval(secs => greatest($2::int, timeout_s + 30)) WHERE id = $1', [task.id, leaseS]);
  await insertLogs(tx, task, body.attempt, body.logs);
}

/** Libera o lock: a próxima tarefa pendente do mesmo recurso entra na fila. */
async function promoteNext(tx: Tx, lockKey: string) {
  await tx.query(`UPDATE agent_task_queue SET status = 'na_fila', available_at = now()
    WHERE id = (SELECT id FROM agent_task_queue WHERE lock_key = $1 AND status = 'pendente' ORDER BY priority, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      AND NOT EXISTS (SELECT 1 FROM agent_task_queue WHERE lock_key = $1 AND status IN ('na_fila', 'aguardando_agente', 'executando', 'restaurando'))`, [lockKey]);
}

export type ResultHandler = (tx: Tx, task: Record<string, any>, result: TaskResult) => Promise<void>;

/**
 * Resultado enviado pelo agente. Idempotente: reenviar o mesmo resultado (ex.: depois de uma queda
 * de rede) não muda nada. Resultado de tentativa antiga é ignorado.
 */
export async function reportResult(tx: Tx, agentId: number, taskPublicId: string, body: TaskResult, handlers: Partial<Record<string, ResultHandler>>, actor: AuditActor) {
  const task = await lockedTaskOfAgent(tx, agentId, taskPublicId);
  if (body.attempt !== task.attempt) return { status: task.status as string, duplicate: true };
  if (['concluido', 'validado', 'falhou', 'cancelado'].includes(task.status)) return { status: task.status as string, duplicate: true };
  if (!['executando', 'restaurando'].includes(task.status)) throw conflict('A tarefa não está em execução.');

  await insertLogs(tx, task, body.attempt, body.logs);
  let status: string;
  let error: string | null = body.error ? redact(body.error) : null;
  let availableAt: Date | null = null;

  if (body.status === 'ok') {
    try {
      await handlers[task.operation]?.(tx, task, body);
      status = 'concluido';
    } catch (err) {
      status = 'falhou';
      error = `Resultado recusado pela central: ${(err as Error).message}`;
    }
  } else if (body.status !== 'recusada' && task.attempt < task.max_attempts && OPERATIONS[task.operation as keyof typeof OPERATIONS]?.idempotent) {
    status = 'na_fila';
    availableAt = new Date(Date.now() + retryDelayMs(task.attempt));
  } else {
    status = 'falhou';
  }

  const final = status !== 'na_fila';
  await tx.query(
    `UPDATE agent_task_queue SET status = $2, error = $3, result = $4, lease_until = NULL,
       available_at = coalesce($5, available_at), finished_at = CASE WHEN $6 THEN now() ELSE NULL END
     WHERE id = $1`,
    [task.id, status, error, body.result === undefined ? null : JSON.stringify(body.result), availableAt, final]);
  if (final) await promoteNext(tx, task.lock_key);
  await audit(tx, actor, { action: `tarefa.${status === 'na_fila' ? 'retentativa' : status}`, entity: 'tarefa', entityId: task.public_id, clientId: task.client_id,
    details: { operacao: task.operation, tentativa: task.attempt, resultado_agente: body.status, erro: error?.slice(0, 300) } });
  return { status, duplicate: false };
}

export async function cancelTask(tx: Tx, taskPublicId: string, actor: AuditActor) {
  const task = await tx.one(`SELECT ${TASK_COLUMNS} FROM agent_task_queue t WHERE t.public_id = $1 FOR UPDATE`, [taskPublicId]);
  if (!task) throw notFound('Tarefa');
  if (!['pendente', 'na_fila', 'aguardando_agente'].includes(task.status)) {
    throw conflict(['executando', 'restaurando'].includes(task.status)
      ? 'Cancelar uma tarefa em execução ainda não está implementado: aguarde o término ou o tempo limite.'
      : 'A tarefa já terminou.');
  }
  await tx.query("UPDATE agent_task_queue SET status = 'cancelado', finished_at = now(), lease_until = NULL WHERE id = $1", [task.id]);
  await promoteNext(tx, task.lock_key);
  await audit(tx, actor, { action: 'tarefa.cancelar', entity: 'tarefa', entityId: task.public_id, clientId: task.client_id, details: { operacao: task.operation } });
}

/**
 * Manutenção periódica (worker), segura para rodar em paralelo e após reinícios:
 *   - lease vencido → volta à fila com backoff (ou falha, esgotadas as tentativas);
 *   - tarefas vencidas → falham;
 *   - agentes sem sinal → offline, e suas tarefas passam a "aguardando agente";
 *   - agentes que voltaram → tarefas retornam à fila;
 *   - locks liberados → pendentes sobem.
 */
export async function maintenance(tx: Tx, { offlineAfterS = 120 } = {}) {
  const stats = { leaseExpired: 0, expired: 0, offline: 0, resumed: 0, promoted: 0 };
  const leased = await tx.many(`SELECT id, public_id, attempt, max_attempts, operation, lock_key, client_id FROM agent_task_queue
    WHERE status IN ('executando', 'restaurando') AND lease_until < now() FOR UPDATE SKIP LOCKED`);
  for (const t of leased) {
    const idempotent = OPERATIONS[t.operation as keyof typeof OPERATIONS]?.idempotent ?? false;
    const retry = idempotent && t.attempt < t.max_attempts;
    await tx.query(`UPDATE agent_task_queue SET status = $2, lease_until = NULL, available_at = $3,
        error = 'O agente parou de responder durante a execução (lease vencido).', finished_at = CASE WHEN $2 = 'falhou' THEN now() ELSE NULL END
      WHERE id = $1`, [t.id, retry ? 'na_fila' : 'falhou', new Date(Date.now() + retryDelayMs(t.attempt))]);
    await tx.query("INSERT INTO agent_task_logs (task_id, client_id, attempt, at, level, message) VALUES ($1, $2, $3, now(), 'warn', $4)",
      [t.id, t.client_id, t.attempt, retry ? 'Lease vencido: a tarefa voltou para a fila.' : 'Lease vencido e tentativas esgotadas.']);
    if (!retry) await promoteNext(tx, t.lock_key);
    stats.leaseExpired++;
  }

  const expired = await tx.many(`UPDATE agent_task_queue SET status = 'falhou', error = 'Prazo da tarefa expirou antes da execução.', finished_at = now()
    WHERE status IN ('pendente', 'na_fila', 'aguardando_agente') AND expires_at <= now() RETURNING lock_key`);
  for (const r of expired) await promoteNext(tx, r.lock_key);
  stats.expired = expired.length;

  const offline = await tx.many(`UPDATE servers s SET connection_status = 'offline'
    FROM agents a WHERE a.server_id = s.id AND a.status = 'ativo' AND s.connection_status = 'online'
      AND (a.last_heartbeat_at IS NULL OR a.last_heartbeat_at < now() - make_interval(secs => $1)) RETURNING a.id`, [offlineAfterS]);
  stats.offline = offline.length;

  await tx.query(`UPDATE agent_task_queue t SET status = 'aguardando_agente'
    FROM agents a JOIN servers s ON s.id = a.server_id
    WHERE t.agent_id = a.id AND t.status = 'na_fila' AND s.connection_status = 'offline'`);
  const resumed = await tx.many(`UPDATE agent_task_queue t SET status = 'na_fila'
    FROM agents a JOIN servers s ON s.id = a.server_id
    WHERE t.agent_id = a.id AND t.status = 'aguardando_agente' AND s.connection_status = 'online' AND a.status = 'ativo' RETURNING t.id`);
  stats.resumed = resumed.length;
  // tarefas de agentes revogados não serão entregues
  await tx.query(`UPDATE agent_task_queue t SET status = 'cancelado', error = 'Agente revogado.', finished_at = now()
    FROM agents a WHERE t.agent_id = a.id AND a.status = 'revogado' AND t.status IN ('pendente', 'na_fila', 'aguardando_agente')`);

  const waiting = await tx.many("SELECT DISTINCT lock_key FROM agent_task_queue WHERE status = 'pendente' AND expires_at > now()");
  for (const w of waiting) {
    const r = await tx.query(`UPDATE agent_task_queue SET status = 'na_fila', available_at = now()
      WHERE id = (SELECT id FROM agent_task_queue WHERE lock_key = $1 AND status = 'pendente' ORDER BY priority, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND NOT EXISTS (SELECT 1 FROM agent_task_queue WHERE lock_key = $1 AND status IN ('na_fila', 'aguardando_agente', 'executando', 'restaurando'))`, [w.lock_key]);
    stats.promoted += r.rowCount ?? 0;
  }
  return stats;
}
