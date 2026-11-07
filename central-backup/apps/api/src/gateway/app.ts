// Gateway dos agentes (/agent/v1). TLS terminado aqui, com certificado de cliente obrigatório em
// todas as rotas exceto /enroll e /ca.pem. O agente é identificado SEMPRE pelo certificado
// apresentado (serial conferido no banco a cada requisição, com cache curto), nunca pelo corpo.
//
// O gateway não tem a KEK nem a chave de assinatura de tarefas: entrega tarefas já assinadas.
import { storeMetrics } from '../monitoring/metrics.ts';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { TLSSocket } from 'node:tls';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import {
  EnrollRequest, HeartbeatRequest, TaskProgress, TaskResult, RenewRequest, InventoryUpload, AGENT_PROTOCOL_VERSION, Uuid
} from '@central/contracts';
import { signAgentCsr, sha256Hex, normalizeEnrollmentCode, agentIdFromSubject, certFingerprint, isSealPublicKey } from '@central/security';
import { AppError, forbidden, unauthorized } from '@central/shared';
import type { Database } from '@central/database';
import type { Config } from '../config.ts';
import type { GatewayMaterial } from '../keys.ts';
import { errorHandler } from '../http/errors.ts';
import { audit } from '../audit.ts';
import { claimTasks, reportProgress, reportResult } from '../tasks/service.ts';
import { resultHandlers } from '../tasks/handlers.ts';
import { storeInventory } from '../servers/inventory.ts';

interface AgentIdentity { id: number; publicId: string; serverId: number; clientId: number; credentialId: number; notAfter: Date }

declare module 'fastify' {
  interface FastifyRequest { agent?: AgentIdentity }
}

export async function buildGateway(deps: { db: Database; config: Config; material: GatewayMaterial; logger?: boolean; identityCacheMs?: number }): Promise<FastifyInstance> {
  const { db, config, material } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 4 * 1024 * 1024,
    https: { key: material.tlsKeyPem, cert: material.tlsCertPem, ca: material.caCertPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: false } }
  }).withTypeProvider<TypeBoxTypeProvider>();
  app.setErrorHandler(errorHandler);
  await app.register(rateLimit, { global: false });

  const caPair = { certPem: material.caCertPem, keyPem: material.caKeyPem };
  const caFingerprint = certFingerprint(material.caCertPem);

  // ------------------------------------------------------------ identidade do agente
  const cache = new Map<string, { at: number; identity: AgentIdentity | null }>();
  const CACHE_MS = deps.identityCacheMs ?? 15_000; // revogação vale em até CACHE_MS
  async function identify(req: FastifyRequest): Promise<AgentIdentity> {
    const socket = req.raw.socket as TLSSocket;
    if (!socket.authorized) throw unauthorized('Certificado de agente ausente ou inválido.');
    const cert = socket.getPeerCertificate();
    const serial = String(cert?.serialNumber ?? '').toLowerCase().replace(/^0+/, '');
    const publicId = agentIdFromSubject(`CN=${cert?.subject?.CN ?? ''}`);
    if (!serial || !publicId) throw unauthorized('Certificado sem identidade de agente.');
    const hit = cache.get(serial);
    let identity = hit && Date.now() - hit.at < CACHE_MS ? hit.identity : undefined;
    if (identity === undefined) {
      const row = await db.system((tx) => tx.one(`SELECT a.id, a.public_id, a.server_id, a.client_id, c.id AS credential_id, c.not_after
        FROM agent_credentials c JOIN agents a ON a.id = c.agent_id
        WHERE ltrim(c.cert_serial, '0') = $1 AND a.status = 'ativo'
          AND (c.revoked_at IS NULL OR c.revoked_at > now()) AND c.not_after > now() AND c.not_before <= now()`, [serial]));
      identity = row && row.public_id === publicId
        ? { id: row.id, publicId: row.public_id, serverId: row.server_id, clientId: row.client_id, credentialId: row.credential_id, notAfter: new Date(row.not_after) }
        : null;
      cache.set(serial, { at: Date.now(), identity });
      if (cache.size > 10_000) cache.clear();
    }
    if (!identity) throw forbidden('Credencial do agente revogada, vencida ou desconhecida.');
    return identity;
  }
  const auth = async (req: FastifyRequest) => { req.agent = await identify(req); };
  const actorOf = (req: FastifyRequest) => ({ type: 'agente' as const, id: req.agent?.id ?? null, ip: req.ip });

  // ------------------------------------------------------------ rotas públicas (sem certificado)
  app.get('/agent/v1/ca.pem', async (_req, reply) => reply.type('application/x-pem-file').header('X-CA-SHA256', caFingerprint).send(material.caCertPem));

  app.post('/agent/v1/enroll', {
    schema: { body: EnrollRequest },
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }
  }, async (req, reply) => {
    const codeHash = sha256Hex(normalizeEnrollmentCode(req.body.code));
    const result = await db.system(async (tx) => {
      const code = await tx.one(`SELECT e.id, e.server_id, e.client_id, e.expires_at, e.used_at FROM agent_enrollment_codes e
        JOIN servers s ON s.id = e.server_id AND s.archived_at IS NULL
        JOIN clients c ON c.id = e.client_id AND c.status = 'ativo'
        WHERE e.code_hash = $1 FOR UPDATE OF e`, [codeHash]);
      if (!code || code.used_at || new Date(code.expires_at) <= new Date()) return null;

      // Reinstalação: o agente anterior do servidor é revogado (o código foi gerado por alguém autorizado).
      const previous = await tx.many("UPDATE agents SET status = 'revogado', revoked_at = now(), revoked_reason = 'substituído por novo registro' WHERE server_id = $1 AND status <> 'revogado' RETURNING id, public_id", [code.server_id]);
      for (const p of previous) {
        await tx.query("UPDATE agent_credentials SET revoked_at = now(), revoked_reason = 'agente substituído' WHERE agent_id = $1 AND revoked_at IS NULL", [p.id]);
      }
      const encKey = req.body.encryption_public_key && isSealPublicKey(req.body.encryption_public_key) ? req.body.encryption_public_key : null;
      if (req.body.encryption_public_key && !encKey) throw new AppError('Chave de cifragem inválida (esperado X25519).', { status: 422, code: 'CHAVE_INVALIDA' });
      const agent = await tx.one<{ id: number; public_id: string }>(`INSERT INTO agents (server_id, client_id, version, protocol, status, last_heartbeat_at, enc_public_key)
        VALUES ($1, $2, $3, $4, 'ativo', now(), $5) RETURNING id, public_id`, [code.server_id, code.client_id, req.body.agent_version, AGENT_PROTOCOL_VERSION, encKey]);
      let issued;
      try {
        issued = await signAgentCsr(caPair, req.body.csr, { agentPublicId: agent!.public_id, days: config.agent.certDays });
      } catch (err) {
        throw new AppError((err as Error).message, { status: 422, code: 'CSR_INVALIDO' });
      }
      await tx.query(`INSERT INTO agent_credentials (agent_id, client_id, cert_serial, cert_fingerprint, not_before, not_after)
        VALUES ($1, $2, $3, $4, $5, $6)`, [agent!.id, code.client_id, issued.serial.replace(/^0+/, ''), issued.fingerprint, issued.notBefore, issued.notAfter]);
      await tx.query('UPDATE agent_enrollment_codes SET used_at = now(), used_by_agent_id = $2 WHERE id = $1', [code.id, agent!.id]);
      const f = req.body.facts;
      await tx.query(`UPDATE servers SET connection_status = 'online', last_seen_at = now(), hostname = $2, os_name = $3, os_version = $4, arch = $5 WHERE id = $1`,
        [code.server_id, f.hostname, f.os_name, f.os_version, f.arch]);
      await audit(tx, { type: 'agente', id: agent!.id, ip: req.ip }, {
        action: 'agente.registrar', entity: 'agente', entityId: agent!.public_id, clientId: code.client_id,
        details: { servidor_id: code.server_id, versao: req.body.agent_version, hostname: f.hostname, substituiu: previous.map((p) => p.public_id) }
      });
      const keys = await tx.many("SELECT key_id, public_pem FROM task_signing_keys_history WHERE retired_at IS NULL OR retired_at > now() - interval '7 days'");
      return { agent: agent!, issued, keys };
    });
    if (!result) {
      await db.system((tx) => tx.query('UPDATE agent_enrollment_codes SET failed_attempts = failed_attempts + 1 WHERE code_hash = $1', [codeHash]));
      throw new AppError('Código de instalação inválido, vencido ou já utilizado.', { status: 403, code: 'CODIGO_INVALIDO' });
    }
    return reply.code(201).send({
      agent_id: result.agent.public_id,
      certificate: result.issued.certPem,
      ca_certificate: material.caCertPem,
      task_signing_keys: Object.fromEntries(result.keys.map((k) => [k.key_id, k.public_pem])),
      heartbeat_interval_s: config.agent.heartbeatIntervalS
    });
  });

  // ------------------------------------------------------------ rotas autenticadas (mTLS)
  app.register(async (plain) => {
    const r = plain.withTypeProvider<TypeBoxTypeProvider>();
    r.addHook('onRequest', auth);

    r.post('/agent/v1/heartbeat', { schema: { body: HeartbeatRequest } }, async (req) => {
      const a = req.agent!;
      const skew = Math.round((Date.parse(req.body.clock) - Date.now()) / 1000);
      const hasTasks = await db.system(async (tx) => {
        await tx.query('UPDATE agents SET last_heartbeat_at = now(), version = $2, protocol = $3, clock_skew_s = $4, pending_results = $5 WHERE id = $1',
          [a.id, req.body.agent_version, req.body.protocol, skew, req.body.queue.pending_results]);
        // agentes antigos informam a chave de cifragem no heartbeat; só é aceita se ainda não houver uma
        const k = req.body.encryption_public_key;
        if (k && isSealPublicKey(k)) await tx.query('UPDATE agents SET enc_public_key = $2 WHERE id = $1 AND enc_public_key IS NULL', [a.id, k]);
        const before = await tx.one("SELECT connection_status FROM servers WHERE id = $1", [a.serverId]);
        await tx.query(`UPDATE servers SET connection_status = 'online', last_seen_at = now(), uptime_s = $2 WHERE id = $1`, [a.serverId, req.body.uptime_s]);
        if (req.body.metrics) await storeMetrics(tx, { id: a.serverId, client_id: a.clientId }, req.body.metrics);
        if (before?.connection_status === 'offline') {
          await tx.query("UPDATE agent_task_queue SET status = 'na_fila' WHERE agent_id = $1 AND status = 'aguardando_agente'", [a.id]);
          await audit(tx, actorOf(req), { action: 'servidor.online', entity: 'servidor', entityId: a.serverId, clientId: a.clientId });
        }
        return Boolean(await tx.one("SELECT 1 FROM agent_task_queue WHERE agent_id = $1 AND status = 'na_fila' AND available_at <= now() LIMIT 1", [a.id]));
      });
      return {
        next_interval_s: config.agent.heartbeatIntervalS,
        has_tasks: hasTasks,
        clock_skew_s: skew,
        renew_certificate: a.notAfter.getTime() - Date.now() < config.agent.renewBeforeDays * 86_400_000
      };
    });

    r.get('/agent/v1/tasks', { schema: { querystring: Type.Object({ wait: Type.Optional(Type.Integer({ minimum: 0, maximum: 30 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })) }) } }, async (req) => {
      const a = req.agent!;
      const deadline = Date.now() + (req.query.wait ?? 0) * 1000;
      for (;;) {
        const tasks = await db.system((tx) => claimTasks(tx, a.id, { limit: req.query.limit ?? 1, leaseS: config.agent.leaseS }));
        if (tasks.length || Date.now() >= deadline || req.raw.destroyed) return { tasks };
        await new Promise((res) => setTimeout(res, 1000));
      }
    });

    r.post('/agent/v1/tasks/:id/progress', { schema: { params: Type.Object({ id: Uuid }), body: TaskProgress } }, async (req) => {
      await db.system((tx) => reportProgress(tx, req.agent!.id, req.params.id, req.body, config.agent.leaseS));
      return { ok: true };
    });

    r.post('/agent/v1/tasks/:id/result', { schema: { params: Type.Object({ id: Uuid }), body: TaskResult } }, async (req) => {
      const out = await db.system((tx) => reportResult(tx, req.agent!.id, req.params.id, req.body, resultHandlers, actorOf(req)));
      return { ok: true, status: out.status, duplicate: out.duplicate };
    });

    r.post('/agent/v1/inventory', { schema: { body: InventoryUpload } }, async (req) => {
      const a = req.agent!;
      const out = await db.system((tx) => storeInventory(tx, { id: a.serverId, client_id: a.clientId }, req.body.collected_at, req.body.data));
      return { ok: true, hash: out.hash };
    });

    r.post('/agent/v1/certificates/renew', { schema: { body: RenewRequest }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
      const a = req.agent!;
      const issued = await signAgentCsr(caPair, req.body.csr, { agentPublicId: a.publicId, days: config.agent.certDays }).catch((err) => {
        throw new AppError((err as Error).message, { status: 422, code: 'CSR_INVALIDO' });
      });
      await db.system(async (tx) => {
        await tx.query(`INSERT INTO agent_credentials (agent_id, client_id, cert_serial, cert_fingerprint, not_before, not_after) VALUES ($1, $2, $3, $4, $5, $6)`,
          [a.id, a.clientId, issued.serial.replace(/^0+/, ''), issued.fingerprint, issued.notBefore, issued.notAfter]);
        // o certificado anterior continua válido por 24 h (sobreposição para a troca)
        await tx.query("UPDATE agent_credentials SET revoked_at = now() + interval '24 hours', revoked_reason = 'renovado' WHERE id = $1 AND revoked_at IS NULL", [a.credentialId]);
        await audit(tx, actorOf(req), { action: 'agente.renovar_certificado', entity: 'agente', entityId: a.publicId, clientId: a.clientId, details: { validade: issued.notAfter.toISOString() } });
      });
      return { certificate: issued.certPem, not_after: issued.notAfter.toISOString() };
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ type: 'about:blank', title: 'Rota não encontrada.', status: 404, code: 'NAO_ENCONTRADO' }));
  return app;
}
