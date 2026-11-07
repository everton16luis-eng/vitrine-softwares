// /api/v1/dr-plans — planos de recuperação de desastre, artefatos (cloud-init, Ansible) e exercícios.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound, conflict, validationError } from '@central/shared';
import type { Database, Tx } from '@central/database';
import { enrollmentCode, normalizeEnrollmentCode, sha256Hex, certFingerprint } from '@central/security';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { buildPlan, type DrInput, type DrTarget } from '../dr/plan.ts';
import { cloudInit, ansiblePlaybook } from '../dr/artifacts.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const Target = Type.Object({
  os_name: Type.String({ minLength: 2, maxLength: 60 }),
  os_version: Type.String({ minLength: 1, maxLength: 30 }),
  arch: Type.String({ pattern: '^(x64|x86_64|amd64|arm64|aarch64)$' }),
  memory_bytes: Type.Optional(Type.Integer({ minimum: 0 })),
  disk_bytes: Type.Optional(Type.Integer({ minimum: 0 })),
  provision_minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1440 })),
  dns_ttl_minutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 1440 }))
}, { additionalProperties: false });
const PlanInput = Type.Object({ server_id: Type.Integer({ minimum: 1 }), name: Type.String({ minLength: 2, maxLength: 120 }), target: Target }, { additionalProperties: false });
const ExerciseInput = Type.Object({
  kind: Type.Union([Type.Literal('simulado'), Type.Literal('real')]),
  outcome: Type.Union([Type.Literal('sucesso'), Type.Literal('parcial'), Type.Literal('falhou')]),
  started_at: Type.String({ format: 'date-time' }),
  finished_at: Type.String({ format: 'date-time' }),
  restore_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 50, uniqueItems: true })),
  notes: Type.String({ minLength: 5, maxLength: 5000 })
}, { additionalProperties: false });
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Monta a entrada do gerador a partir do banco (dentro do escopo do usuário). */
export async function loadDrInput(tx: Tx, serverId: number, target: DrTarget, now = new Date()): Promise<DrInput | null> {
  const s = await tx.one(`SELECT id, client_id, name, os_name, os_version, arch, memory_bytes,
      (SELECT sum((d->>'used')::bigint) FROM jsonb_array_elements(coalesce(last_metrics->'disks', '[]')) d) AS disk_used
    FROM servers WHERE id = $1 AND archived_at IS NULL`, [serverId]);
  if (!s) return null;
  // cada coleta pode trazer só algumas seções: pega a mais recente que tenha cada uma
  const section = (name: string) => tx.one(`SELECT collected_at, data->$2 AS v FROM server_inventory WHERE server_id = $1 AND data ? $2 ORDER BY collected_at DESC LIMIT 1`, [serverId, name]);
  const [sys, pk, sv] = [await section('sistema'), await section('pacotes'), await section('servicos')];
  const pkItems = pk?.v && !pk.v.indisponivel && Array.isArray(pk.v.items) ? pk.v.items : null;
  const svUnits = sv?.v && !sv.v.indisponivel && Array.isArray(sv.v.units) ? sv.v.units : null;
  const applications = await tx.many(`SELECT id, name, technology, install_dir, data_dirs, config_files, systemd_unit, domains, rpo_minutes, rto_minutes
    FROM applications WHERE server_id = $1 AND archived_at IS NULL ORDER BY id`, [serverId]);
  const databases = await tx.many(`SELECT id, name, engine, db_name, file_path, version, size_bytes FROM databases WHERE server_id = $1 AND archived_at IS NULL ORDER BY id`, [serverId]);
  const jobs = await tx.many(`SELECT j.id, j.name, j.kind, j.database_id, j.paths, j.enabled, j.last_success_at, p.schedule, p.timezone,
      (SELECT json_build_object('id', x.id, 'restic_id', x.restic_id, 'taken_at', x.taken_at, 'size_bytes', x.size_bytes) FROM backup_snapshots x
        WHERE x.job_id = j.id AND x.status = 'validado' ORDER BY x.taken_at DESC LIMIT 1) AS latest_valid
    FROM backup_jobs j JOIN backup_policies p ON p.id = j.policy_id WHERE j.server_id = $1 AND j.archived_at IS NULL ORDER BY j.id`, [serverId]);
  const history = await tx.many(`SELECT coalesce((r.result->>'bytes_restored')::bigint, x.size_bytes) AS bytes, extract(epoch FROM t.finished_at - t.started_at) AS seconds
    FROM restore_requests r JOIN agent_task_queue t ON t.id = r.task_id JOIN backup_snapshots x ON x.id = r.snapshot_id
    WHERE r.server_id = $1 AND r.status = 'concluido' AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL ORDER BY r.finished_at DESC LIMIT 20`, [serverId]);
  return {
    now,
    server: { id: Number(s.id), name: s.name, os_name: s.os_name, os_version: s.os_version, arch: s.arch, memory_bytes: s.memory_bytes == null ? null : Number(s.memory_bytes), disk_used_bytes: s.disk_used == null ? null : Number(s.disk_used) },
    inventory: { collected_at: sys?.collected_at ? new Date(sys.collected_at).toISOString() : null, packages: pkItems, services: svUnits },
    applications: applications.map((a) => ({ ...a, id: Number(a.id) })),
    databases: databases.map((d) => ({ ...d, id: Number(d.id), size_bytes: d.size_bytes == null ? null : Number(d.size_bytes) })),
    jobs: jobs.map((j) => ({ ...j, id: Number(j.id), database_id: j.database_id == null ? null : Number(j.database_id), last_success_at: j.last_success_at ? new Date(j.last_success_at).toISOString() : null,
      latest_valid: j.latest_valid ? { ...j.latest_valid, size_bytes: j.latest_valid.size_bytes == null ? null : Number(j.latest_valid.size_bytes) } : null })),
    restoreHistory: history.map((h) => ({ bytes: Number(h.bytes ?? 0), seconds: Number(h.seconds ?? 0) })),
    target
  };
}

export async function drRoutes(app: FastifyInstance, { db, config }: { db: Database; config: Config }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });
  const COLS = `p.id, p.public_id, p.client_id, p.server_id, s.name AS server_name, p.name, p.target, p.ready, p.rpo_minutes, p.rto_minutes, p.revision, p.target_server_id, p.generated_at, p.created_at,
    (SELECT max(e.finished_at) FROM dr_exercises e WHERE e.plan_id = p.id) AS last_exercise_at`;
  const getPlan = async (tx: Tx, id: number, lock = false) => tx.one(`SELECT p.*, s.name AS server_name FROM dr_plans p JOIN servers s ON s.id = p.server_id WHERE p.id = $1 AND p.archived_at IS NULL${lock ? ' FOR UPDATE OF p' : ''}`, [id]);

  r.get('/api/v1/dr-plans', { preValidation: requireAuth('dr.ver'), schema: { querystring: Type.Object({ server_id: Type.Optional(Type.Integer({ minimum: 1 })) }) } }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${COLS} FROM dr_plans p JOIN servers s ON s.id = p.server_id
      WHERE p.archived_at IS NULL AND ($1::bigint IS NULL OR p.server_id = $1) ORDER BY p.id DESC`, [req.query.server_id ?? null]))
  }));

  r.get('/api/v1/dr-plans/:id', { preValidation: requireAuth('dr.ver'), schema: { params: IdParams } }, async (req) => db.withScope(req.user!.scope, async (tx) => {
    const p = await getPlan(tx, req.params.id);
    if (!p) throw notFound('Plano de DR');
    const exercises = await tx.many(`SELECT public_id, plan_revision, kind, outcome, started_at, finished_at, measured_rto_minutes, measured_rpo_minutes, estimated_rto_minutes, restore_ids, notes, recorded_by, created_at
      FROM dr_exercises WHERE plan_id = $1 ORDER BY started_at DESC LIMIT 50`, [p.id]);
    const { plan, ...rest } = p;
    return { ...rest, plan, exercises };
  }));

  r.post('/api/v1/dr-plans', { preValidation: requireAuth('dr.planejar'), schema: { body: PlanInput } }, async (req, reply) => {
    const b = req.body;
    const row = await db.withScope(req.user!.scope, async (tx) => {
      const input = await loadDrInput(tx, b.server_id, b.target);
      if (!input) throw notFound('Servidor');
      const plan = buildPlan(input);
      const s = await tx.one('SELECT client_id FROM servers WHERE id = $1', [b.server_id]);
      const p = await tx.one(`INSERT INTO dr_plans (client_id, server_id, name, target, plan, ready, rpo_minutes, rto_minutes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, public_id, client_id`,
        [s!.client_id, b.server_id, b.name.trim(), JSON.stringify(b.target), JSON.stringify(plan), plan.ready, plan.rpo.projetado_min, plan.rto.estimado_min, req.user!.id]);
      await audit(tx, actor(req), { action: 'dr.plano_criar', entity: 'plano_dr', entityId: p!.id, clientId: p!.client_id, details: { servidor: b.server_id, pronto: plan.ready, criticos: plan.findings.filter((f) => f.severity === 'critico').length } });
      return { id: p!.id, public_id: p!.public_id, ready: plan.ready, plan };
    });
    return reply.code(201).send(row);
  });

  r.post('/api/v1/dr-plans/:id/regenerate', { preValidation: requireAuth('dr.planejar'), schema: { params: IdParams, body: Type.Optional(Type.Object({ target: Type.Optional(Target) }, { additionalProperties: false })) } }, async (req) => db.withScope(req.user!.scope, async (tx) => {
    const p = await getPlan(tx, req.params.id, true);
    if (!p) throw notFound('Plano de DR');
    const target = req.body?.target ?? p.target;
    const input = await loadDrInput(tx, Number(p.server_id), target);
    if (!input) throw conflict('O servidor de origem foi arquivado.');
    const plan = buildPlan(input);
    await tx.query(`UPDATE dr_plans SET target = $2, plan = $3, ready = $4, rpo_minutes = $5, rto_minutes = $6, revision = revision + 1, generated_at = now() WHERE id = $1`,
      [p.id, JSON.stringify(target), JSON.stringify(plan), plan.ready, plan.rpo.projetado_min, plan.rto.estimado_min]);
    await audit(tx, actor(req), { action: 'dr.plano_regenerar', entity: 'plano_dr', entityId: p.id, clientId: p.client_id, details: { revisao: p.revision + 1, pronto: plan.ready } });
    return { id: p.id, revision: p.revision + 1, ready: plan.ready, plan };
  }));

  r.post('/api/v1/dr-plans/:id/archive', { preValidation: requireAuth('dr.planejar'), schema: { params: IdParams } }, async (req) => db.withScope(req.user!.scope, async (tx) => {
    const p = await tx.one('UPDATE dr_plans SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
    if (!p) throw notFound('Plano de DR');
    await audit(tx, actor(req), { action: 'dr.plano_arquivar', entity: 'plano_dr', entityId: p.id, clientId: p.client_id });
    return { ok: true };
  }));

  /** Playbook Ansible (sem segredos). */
  r.get('/api/v1/dr-plans/:id/ansible', { preValidation: requireAuth('dr.ver'), schema: { params: IdParams } }, async (req, reply) => {
    const out = await db.withScope(req.user!.scope, async (tx) => {
      const p = await getPlan(tx, req.params.id);
      if (!p) throw notFound('Plano de DR');
      const apps = await tx.many('SELECT name, install_dir, data_dirs FROM applications WHERE server_id = $1 AND archived_at IS NULL ORDER BY id', [p.server_id]);
      await audit(tx, actor(req), { action: 'dr.ansible_baixar', entity: 'plano_dr', entityId: p.id, clientId: p.client_id, details: { revisao: p.revision } });
      return { yaml: ansiblePlaybook(p.plan, { applications: apps }), name: p.server_name };
    });
    return reply.header('content-type', 'application/yaml; charset=utf-8').header('content-disposition', `attachment; filename="dr-${String(out.name).replace(/[^A-Za-z0-9._-]/g, '_')}.yml"`).send(out.yaml);
  });

  /**
   * cloud-init para o servidor de destino. Cria (ou reutiliza) o cadastro do destino e gera um código
   * de registro novo, de uso único: por isso é POST e exige dr.executar.
   */
  r.post('/api/v1/dr-plans/:id/cloud-init', { preValidation: requireAuth('dr.executar'), schema: { params: IdParams, body: Type.Object({ hostname: Type.String({ pattern: HOSTNAME.source }), ttl_minutes: Type.Optional(Type.Integer({ minimum: 10, maximum: 1440 })) }, { additionalProperties: false }) }, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (!config.agentSource) throw validationError({ AGENT_SOURCE_REPO: 'Configure AGENT_SOURCE_REPO e AGENT_SOURCE_REF na central (origem fixada do agente).' }, 'Origem do agente não configurada.');
    const code = enrollmentCode();
    const ttl = req.body.ttl_minutes ?? 240;
    const out = await db.withScope(req.user!.scope, async (tx) => {
      const p = await getPlan(tx, req.params.id, true);
      if (!p) throw notFound('Plano de DR');
      if (!p.ready) throw conflict('O plano tem pendências críticas: resolva-as e regenere o plano antes de reconstruir.');
      let targetId = p.target_server_id ? Number(p.target_server_id) : null;
      if (targetId) {
        const ok = await tx.one('SELECT id FROM servers WHERE id = $1 AND archived_at IS NULL', [targetId]);
        if (!ok) targetId = null;
      }
      if (!targetId) {
        const name = `${p.server_name}-dr-${p.id}`.slice(0, 120);
        const s = await tx.one(`INSERT INTO servers (client_id, name, hostname, notes) VALUES ($1, $2, $3, $4)
          ON CONFLICT (client_id, name) DO UPDATE SET hostname = EXCLUDED.hostname RETURNING id`,
        [p.client_id, name, req.body.hostname, `Servidor de destino do plano de DR #${p.id} (${p.name}).`]);
        targetId = Number(s!.id);
        await tx.query('UPDATE dr_plans SET target_server_id = $2 WHERE id = $1', [p.id, targetId]);
      }
      await tx.query('UPDATE agent_enrollment_codes SET expires_at = now() WHERE server_id = $1 AND used_at IS NULL AND expires_at > now()', [targetId]);
      await tx.query(`INSERT INTO agent_enrollment_codes (server_id, client_id, code_hash, expires_at, created_by) VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5)`,
        [targetId, p.client_id, sha256Hex(normalizeEnrollmentCode(code)), ttl, req.user!.id]);
      await audit(tx, actor(req), { action: 'dr.cloud_init_gerar', entity: 'plano_dr', entityId: p.id, clientId: p.client_id, details: { destino: targetId, validade_min: ttl, revisao: p.revision } });
      return { p, targetId };
    });
    const ca = certFingerprint(readFileSync(path.join(config.gatewayDir, 'ca.pem'), 'utf8'));
    const text = cloudInit(out.p.plan, { hostname: req.body.hostname, gatewayUrl: config.gateway.publicUrl, caSha256: ca, enrollmentCode: code, agentSource: config.agentSource });
    return reply.code(201).header('content-type', 'text/cloud-config; charset=utf-8').header('x-dr-target-server', String(out.targetId)).send(text);
  });

  /** Registro de um exercício com tempos medidos (o RTO medido é a duração real). */
  r.post('/api/v1/dr-plans/:id/exercises', { preValidation: requireAuth('dr.executar'), schema: { params: IdParams, body: ExerciseInput } }, async (req, reply) => {
    const b = req.body;
    const started = new Date(b.started_at); const finished = new Date(b.finished_at);
    if (finished < started) throw validationError({ finished_at: 'Término antes do início.' });
    if (finished.getTime() > Date.now() + 5 * 60_000) throw validationError({ finished_at: 'Término no futuro.' });
    const row = await db.withScope(req.user!.scope, async (tx) => {
      const p = await getPlan(tx, req.params.id);
      if (!p) throw notFound('Plano de DR');
      const ids = b.restore_ids ?? [];
      let rpo: number | null = null;
      if (ids.length) {
        // as restaurações citadas precisam ser deste servidor (ou do destino do plano) e ter concluído
        const rs = await tx.many(`SELECT r.public_id, r.status, x.taken_at FROM restore_requests r JOIN backup_snapshots x ON x.id = r.snapshot_id
          WHERE r.public_id = ANY($1::uuid[]) AND r.client_id = $2`, [ids, p.client_id]);
        if (rs.length !== ids.length) throw validationError({ restore_ids: 'Restauração inexistente ou de outro cliente.' });
        if (rs.some((x) => x.status !== 'concluido')) throw validationError({ restore_ids: 'Só restaurações concluídas contam no exercício.' });
        // RPO medido: dados perdidos = início do exercício − ponto restaurado mais antigo
        rpo = Math.max(0, Math.round((started.getTime() - Math.min(...rs.map((x) => new Date(x.taken_at).getTime()))) / 60_000));
      }
      const e = await tx.one(`INSERT INTO dr_exercises (client_id, plan_id, plan_revision, kind, outcome, started_at, finished_at, measured_rto_minutes, measured_rpo_minutes, estimated_rto_minutes, restore_ids, notes, recorded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING public_id, measured_rto_minutes, measured_rpo_minutes, estimated_rto_minutes`,
      [p.client_id, p.id, p.revision, b.kind, b.outcome, started, finished, Math.round((finished.getTime() - started.getTime()) / 60_000), rpo, p.rto_minutes, ids, b.notes.trim(), req.user!.id]);
      await audit(tx, actor(req), { action: 'dr.exercicio_registrar', entity: 'plano_dr', entityId: p.id, clientId: p.client_id, details: { tipo: b.kind, resultado: b.outcome, rto_medido: e!.measured_rto_minutes } });
      return e;
    });
    return reply.code(201).send(row);
  });
}
