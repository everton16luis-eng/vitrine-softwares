// /api/v1 — códigos de instalação, agentes, revogação, tarefas e catálogo de operações.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnrollmentCodeRequest, TaskRequest, PageQuery, Uuid, OPERATIONS, OPERATION_NAMES, isOperationName } from '@central/contracts';
import { enrollmentCode, normalizeEnrollmentCode, sha256Hex, certFingerprint } from '@central/security';
import { notFound, conflict, validationError, forbidden, TASK_STATUS } from '@central/shared';
import type { Database } from '@central/database';
import type { Config } from '../config.ts';
import { can, requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import { createTask, cancelTask, type TaskSigner } from '../tasks/service.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const UuidParams = Type.Object({ id: Uuid });

export async function agentRoutes(app: FastifyInstance, { db, config, signer }: { db: Database; config: Config; signer: () => Promise<TaskSigner> }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  let caSha256: string | null = null;
  const caFingerprint = () => {
    if (!caSha256) caSha256 = certFingerprint(readFileSync(path.join(config.gatewayDir, 'ca.pem'), 'utf8'));
    return caSha256;
  };

  // ------------------------------------------------------------ código de instalação
  /**
   * Gera um código de uso único e curta duração para registrar o agente de um servidor.
   * O código só é mostrado nesta resposta (o banco guarda apenas o hash).
   */
  r.post('/api/v1/servers/:id/enrollment-codes', { preValidation: requireAuth('agentes.provisionar'), schema: { params: IdParams, body: EnrollmentCodeRequest } }, async (req, reply) => {
    const ttl = req.body.ttl_minutes ?? 30;
    const code = enrollmentCode();
    const out = await db.withScope(req.user!.scope, async (tx) => {
      const server = await tx.one(`SELECT s.id, s.client_id, s.name, c.status AS client_status FROM servers s JOIN clients c ON c.id = s.client_id
        WHERE s.id = $1 AND s.archived_at IS NULL`, [req.params.id]);
      if (!server) throw notFound('Servidor');
      if (server.client_status !== 'ativo') throw conflict('O cliente não está ativo.');
      // um código válido por vez: os anteriores ainda não usados deixam de valer
      await tx.query('UPDATE agent_enrollment_codes SET expires_at = now() WHERE server_id = $1 AND used_at IS NULL AND expires_at > now()', [server.id]);
      const row = await tx.one(`INSERT INTO agent_enrollment_codes (server_id, client_id, code_hash, expires_at, created_by)
        VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id, expires_at`,
      [server.id, server.client_id, sha256Hex(normalizeEnrollmentCode(code)), ttl, req.user!.id]);
      const replacing = await tx.one("SELECT public_id FROM agents WHERE server_id = $1 AND status <> 'revogado'", [server.id]);
      await audit(tx, actor(req), { action: 'agente.codigo_gerado', entity: 'servidor', entityId: server.id, clientId: server.client_id, details: { validade_min: ttl, substituira: replacing?.public_id ?? null } });
      return { expires_at: row!.expires_at, replacing: replacing?.public_id ?? null };
    });
    const fp = caFingerprint();
    return reply.code(201).send({
      code,
      expires_at: out.expires_at,
      gateway_url: config.gateway.publicUrl,
      ca_sha256: fp,
      replaces_agent: out.replacing,
      // o agente precisa estar instalado (ver docs/central-backup/fase-1.md); este comando apenas o registra
      command: `sudo central-agent enroll --url ${config.gateway.publicUrl} --ca-sha256 ${fp} --code ${code}`
    });
  });

  // ------------------------------------------------------------ agentes
  r.get('/api/v1/agents', { preValidation: requireAuth('agentes.ver'), schema: { querystring: Type.Object({ ...PageQuery.properties, client_id: Type.Optional(Type.Integer({ minimum: 1 })), include_revoked: Type.Optional(Type.Boolean()) }) } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const rows = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT a.id, a.public_id, a.status, a.version, a.protocol, a.last_heartbeat_at, a.clock_skew_s, a.pending_results,
        a.created_at, a.revoked_at, a.revoked_reason, s.id AS server_id, s.name AS server_name, s.connection_status, c.id AS client_id, c.legal_name AS client_name,
        (SELECT max(not_after) FROM agent_credentials k WHERE k.agent_id = a.id AND k.revoked_at IS NULL) AS cert_not_after
      FROM agents a JOIN servers s ON s.id = a.server_id JOIN clients c ON c.id = a.client_id
      WHERE ($1::bigint IS NULL OR a.id < $1) AND ($2::bigint IS NULL OR a.client_id = $2) AND ($3::boolean OR a.status <> 'revogado')
      ORDER BY a.id DESC LIMIT $4`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.client_id ?? null, req.query.include_revoked ?? false, limit]));
    return { items: rows, next_cursor: rows.length === limit ? String(rows[rows.length - 1]!.id) : null };
  });

  r.get('/api/v1/agents/:id', { preValidation: requireAuth('agentes.ver'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const a = await tx.one(`SELECT a.*, s.name AS server_name, s.connection_status, c.legal_name AS client_name
        FROM agents a JOIN servers s ON s.id = a.server_id JOIN clients c ON c.id = a.client_id WHERE a.public_id = $1`, [req.params.id]);
      if (!a) throw notFound('Agente');
      const credentials = await tx.many(`SELECT cert_serial, cert_fingerprint, not_before, not_after, revoked_at, revoked_reason, created_at
        FROM agent_credentials WHERE agent_id = $1 ORDER BY id DESC LIMIT 20`, [a.id]);
      return { ...a, credentials };
    });
  });

  /**
   * Revoga o agente: credenciais deixam de valer (o gateway recusa em até 15 s, tempo do cache),
   * tarefas ainda não entregues são canceladas e o servidor fica "sem agente".
   */
  r.post('/api/v1/agents/:id/revoke', {
    preValidation: requireAuth('agentes.revogar'),
    schema: { params: UuidParams, body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 300 }) }, { additionalProperties: false }) }
  }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const a = await tx.one("SELECT id, server_id, client_id, status FROM agents WHERE public_id = $1 FOR UPDATE", [req.params.id]);
      if (!a) throw notFound('Agente');
      if (a.status === 'revogado') throw conflict('O agente já está revogado.');
      await tx.query("UPDATE agents SET status = 'revogado', revoked_at = now(), revoked_by = $2, revoked_reason = $3 WHERE id = $1", [a.id, req.user!.id, req.body.reason]);
      const creds = await tx.query("UPDATE agent_credentials SET revoked_at = now(), revoked_reason = 'agente revogado' WHERE agent_id = $1 AND (revoked_at IS NULL OR revoked_at > now())", [a.id]);
      const tasks = await tx.many(`UPDATE agent_task_queue SET status = 'cancelado', error = 'Agente revogado.', finished_at = now(), lease_until = NULL
        WHERE agent_id = $1 AND status IN ('pendente', 'na_fila', 'aguardando_agente') RETURNING id`, [a.id]);
      await tx.query("UPDATE servers SET connection_status = 'sem_agente' WHERE id = $1", [a.server_id]);
      await audit(tx, actor(req), { action: 'agente.revogar', entity: 'agente', entityId: req.params.id, clientId: a.client_id,
        details: { motivo: req.body.reason, credenciais: creds.rowCount, tarefas_canceladas: tasks.length } });
      const running = await tx.one("SELECT count(*) AS n FROM agent_task_queue WHERE agent_id = $1 AND status IN ('executando', 'restaurando')", [a.id]);
      return { ok: true, tasks_cancelled: tasks.length, tasks_running: Number(running?.n ?? 0) };
    });
  });

  // ------------------------------------------------------------ catálogo e tarefas
  r.get('/api/v1/operations', { preValidation: requireAuth('agentes.ver') }, async (req) => ({
    items: OPERATION_NAMES.map((n) => {
      const op = OPERATIONS[n];
      return { name: op.name, version: op.version, internal: Boolean((op as { internal?: boolean }).internal), description: op.description, permission: op.permission, allowed: can(req.user, op.permission),
        timeout_s: op.timeoutSeconds, idempotent: op.idempotent, destructive: op.destructive, params_schema: op.params };
    })
  }));

  r.post('/api/v1/agents/:id/tasks', {
    preValidation: requireAuth('agentes.ver'),
    schema: { params: UuidParams, body: TaskRequest, headers: Type.Object({ 'idempotency-key': Type.Optional(Type.String({ pattern: '^[\\w:.-]{8,100}$' })) }) }
  }, async (req, reply) => {
    const op = req.body.operation;
    if (!isOperationName(op) || (OPERATIONS[op] as { internal?: boolean }).internal) throw validationError({ operation: 'Operação não existe no catálogo ou só é criada pela central.' }, 'Operação não permitida.');
    if (!can(req.user, OPERATIONS[op].permission)) throw forbidden();
    const s = await signer();
    const key = req.headers['idempotency-key'];
    const out = await db.withScope(req.user!.scope, async (tx) => {
      const a = await tx.one('SELECT id FROM agents WHERE public_id = $1', [req.params.id]);
      if (!a) throw notFound('Agente');
      return createTask(tx, s, { agentId: a.id, operation: op, params: req.body.params ?? {}, requestedBy: req.user!.id,
        idempotencyKey: key ? `user:${req.user!.id}:${key}` : undefined }, actor(req));
    });
    return reply.code(out.created ? 201 : 200).send(publicTask({ ...out.task, agent_public_id: req.params.id }));
  });

  const TaskQuery = Type.Object({ ...PageQuery.properties,
    status: Type.Optional(Type.Union(TASK_STATUS.map((s) => Type.Literal(s)))),
    agent_id: Type.Optional(Uuid),
    client_id: Type.Optional(Type.Integer({ minimum: 1 }))
  });
  r.get('/api/v1/tasks', { preValidation: requireAuth('agentes.ver'), schema: { querystring: TaskQuery } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const rows = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT t.*, a.public_id AS agent_public_id, s.name AS server_name, c.legal_name AS client_name
      FROM agent_task_queue t JOIN agents a ON a.id = t.agent_id JOIN servers s ON s.id = a.server_id JOIN clients c ON c.id = t.client_id
      WHERE ($1::bigint IS NULL OR t.id < $1) AND ($2::text IS NULL OR t.status = $2) AND ($3::uuid IS NULL OR a.public_id = $3) AND ($4::bigint IS NULL OR t.client_id = $4)
      ORDER BY t.id DESC LIMIT $5`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.status ?? null, req.query.agent_id ?? null, req.query.client_id ?? null, limit]));
    return { items: rows.map(publicTask), next_cursor: rows.length === limit ? String(rows[rows.length - 1]!.id) : null };
  });

  r.get('/api/v1/tasks/:id', { preValidation: requireAuth('agentes.ver'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const t = await tx.one(`SELECT t.*, a.public_id AS agent_public_id, s.name AS server_name, c.legal_name AS client_name
        FROM agent_task_queue t JOIN agents a ON a.id = t.agent_id JOIN servers s ON s.id = a.server_id JOIN clients c ON c.id = t.client_id WHERE t.public_id = $1`, [req.params.id]);
      if (!t) throw notFound('Tarefa');
      const logs = await tx.many('SELECT attempt, at, level, message FROM agent_task_logs WHERE task_id = $1 ORDER BY id LIMIT 2000', [t.id]);
      return { ...publicTask(t), logs };
    });
  });

  r.post('/api/v1/tasks/:id/cancel', { preValidation: requireAuth('tarefas.cancelar'), schema: { params: UuidParams } }, async (req) => {
    await db.withScope(req.user!.scope, (tx) => cancelTask(tx, req.params.id, actor(req)));
    return { ok: true };
  });
}

/** Representação pública: sem ids internos nem assinatura. */
function publicTask(t: Record<string, any>) {
  return {
    id: t.public_id, operation: t.operation, operation_version: t.operation_version, params: t.params, status: t.status,
    attempt: t.attempt, max_attempts: t.max_attempts, priority: t.priority, timeout_s: t.timeout_s,
    available_at: t.available_at, lease_until: t.lease_until, expires_at: t.expires_at, started_at: t.started_at, finished_at: t.finished_at,
    result: t.result, error: t.error, requested_by: t.requested_by, created_at: t.created_at, updated_at: t.updated_at,
    agent_id: t.agent_public_id, server_name: t.server_name, client_id: t.client_id, client_name: t.client_name
  };
}
