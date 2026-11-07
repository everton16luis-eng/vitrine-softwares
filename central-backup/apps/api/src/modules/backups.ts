// /api/v1 — políticas, jobs, execuções, snapshots e repositórios de backup.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { PageQuery, SAFE_PATH_PATTERN } from '@central/contracts';
import { notFound, conflict, validationError, forbidden } from '@central/shared';
import { isUniqueViolation, type Database, type Tx } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import type { SecretStore } from '../secrets.ts';
import type { TaskSigner } from '../tasks/service.ts';
import { ensureRepository, type DestinationRow } from '../storage/destinations.ts';
import { checkSchedule } from '../backups/cron.ts';
import { computeNextRun, startRun } from '../backups/service.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const UuidParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const Keep = Type.Integer({ minimum: 0, maximum: 1000 });
const Retention = Type.Object({
  keep_last: Type.Integer({ minimum: 1, maximum: 1000 }),
  keep_hourly: Type.Optional(Keep), keep_daily: Type.Optional(Keep), keep_weekly: Type.Optional(Keep), keep_monthly: Type.Optional(Keep), keep_yearly: Type.Optional(Keep)
}, { additionalProperties: false });
const PolicyInput = Type.Object({
  client_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  schedule: Type.String({ minLength: 9, maxLength: 100 }),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  retention: Retention,
  verify_subset_percent: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  limit_upload_kbps: Type.Optional(Type.Union([Type.Integer({ minimum: 64 }), Type.Null()])),
  /** teste automático de restauração a cada N dias (nulo = desligado) */
  restore_test_days: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]))
}, { additionalProperties: false });
const PolicyPatch = Type.Object({
  restore_test_days: PolicyInput.properties.restore_test_days,
  name: Type.Optional(PolicyInput.properties.name), schedule: Type.Optional(PolicyInput.properties.schedule), timezone: PolicyInput.properties.timezone,
  retention: Type.Optional(Retention), verify_subset_percent: PolicyInput.properties.verify_subset_percent, limit_upload_kbps: PolicyInput.properties.limit_upload_kbps
}, { additionalProperties: false });
const SafePath = Type.String({ minLength: 1, maxLength: 1024, pattern: SAFE_PATH_PATTERN });
const Exclude = Type.String({ minLength: 1, maxLength: 500, pattern: '^[^\\x00-\\x1f]+$' });
const JobInput = Type.Object({
  server_id: Type.Integer({ minimum: 1 }),
  policy_id: Type.Integer({ minimum: 1 }),
  destination_id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  kind: Type.Union([Type.Literal('arquivos'), Type.Literal('banco')]),
  application_id: Type.Optional(Type.Integer({ minimum: 1 })),
  database_id: Type.Optional(Type.Integer({ minimum: 1 })),
  paths: Type.Optional(Type.Array(SafePath, { maxItems: 50, uniqueItems: true })),
  excludes: Type.Optional(Type.Array(Exclude, { maxItems: 100 })),
  enabled: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const JobPatch = Type.Object({
  name: Type.Optional(JobInput.properties.name), policy_id: Type.Optional(JobInput.properties.policy_id),
  paths: JobInput.properties.paths, excludes: JobInput.properties.excludes, enabled: JobInput.properties.enabled
}, { additionalProperties: false });

const JOB_COLUMNS = `j.id, j.client_id, j.server_id, s.name AS server_name, j.policy_id, p.name AS policy_name, p.schedule, p.timezone, j.destination_id,
  j.repository_id, j.kind, j.name, j.application_id, j.database_id, j.paths, j.excludes, j.enabled, j.next_run_at, j.last_run_at, j.last_status,
  j.last_success_at, j.last_restore_test_at, j.last_restore_test_status, j.created_at, j.updated_at`;
const RUN_COLUMNS = `r.public_id AS id, r.job_id, j.name AS job_name, r.client_id, r.trigger, r.scheduled_for, r.status, r.started_at, r.finished_at,
  r.summary, r.error, r.created_at, t.public_id AS task_id, sn.restic_id AS snapshot`;
const SNAP_COLUMNS = `sn.id, sn.client_id, sn.job_id, j.name AS job_name, sn.repository_id, sn.restic_id, sn.taken_at, sn.paths, sn.stdin_filename, sn.files,
  sn.size_bytes, sn.added_bytes, sn.status, sn.verified_at, sn.verify_details, sn.verify_error, sn.legal_hold, sn.legal_hold_reason, sn.removed_at`;

export async function backupRoutes(app: FastifyInstance, deps: { db: Database; store: SecretStore; config: Config; signer: () => Promise<TaskSigner> }) {
  const { db, store, config } = deps;
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });
  const checkPolicy = (b: { schedule?: string; timezone?: string }) => {
    try { if (b.schedule) checkSchedule(b.schedule, b.timezone ?? 'America/Sao_Paulo'); } catch (err) { throw validationError({ schedule: (err as Error).message }); }
  };

  // ------------------------------------------------------------ políticas
  r.get('/api/v1/backup-policies', { preValidation: requireAuth('backups.ver') }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many('SELECT * FROM backup_policies WHERE archived_at IS NULL ORDER BY id'))
  }));

  r.post('/api/v1/backup-policies', { preValidation: requireAuth('backups.editar'), schema: { body: PolicyInput } }, async (req, reply) => {
    const b = req.body;
    if (b.client_id == null && req.user!.scope !== '*') throw forbidden('Políticas da empresa exigem acesso a todos os clientes.');
    checkPolicy(b);
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const p = await tx.one(`INSERT INTO backup_policies (client_id, name, schedule, timezone, retention, verify_subset_percent, limit_upload_kbps, restore_test_days)
          VALUES ($1, $2, $3, coalesce($4, 'America/Sao_Paulo'), $5, coalesce($6, 5), $7, $8) RETURNING *`,
        [b.client_id ?? null, b.name.trim(), b.schedule.trim().replace(/\s+/g, ' '), b.timezone ?? null, JSON.stringify(b.retention), b.verify_subset_percent ?? null, b.limit_upload_kbps ?? null, b.restore_test_days ?? null]);
        await audit(tx, actor(req), { action: 'politica.criar', entity: 'politica', entityId: p!.id, clientId: p!.client_id, details: { agenda: p!.schedule, retencao: b.retention } });
        return p;
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Já existe uma política com esse nome.');
      throw err;
    }
  });

  r.patch('/api/v1/backup-policies/:id', { preValidation: requireAuth('backups.editar'), schema: { params: IdParams, body: PolicyPatch } }, async (req) => {
    const b = req.body;
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM backup_policies WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Política');
      checkPolicy({ schedule: b.schedule ?? cur.schedule, timezone: b.timezone ?? cur.timezone });
      const p = await tx.one(`UPDATE backup_policies SET name = coalesce($2, name), schedule = coalesce($3, schedule), timezone = coalesce($4, timezone),
          retention = coalesce($5, retention), verify_subset_percent = coalesce($6, verify_subset_percent),
          limit_upload_kbps = CASE WHEN $7 THEN $8 ELSE limit_upload_kbps END,
          restore_test_days = CASE WHEN $9 THEN $10 ELSE restore_test_days END WHERE id = $1 RETURNING *`,
      [cur.id, b.name?.trim() ?? null, b.schedule?.trim().replace(/\s+/g, ' ') ?? null, b.timezone ?? null, b.retention ? JSON.stringify(b.retention) : null,
        b.verify_subset_percent ?? null, 'limit_upload_kbps' in b, b.limit_upload_kbps ?? null, 'restore_test_days' in b, b.restore_test_days ?? null]);
      if (b.schedule || b.timezone) {
        for (const j of await tx.many('SELECT id FROM backup_jobs WHERE policy_id = $1 AND archived_at IS NULL', [cur.id])) {
          await tx.query('UPDATE backup_jobs SET next_run_at = $2 WHERE id = $1', [j.id, computeNextRun(p!)]);
        }
      }
      await audit(tx, actor(req), { action: 'politica.alterar', entity: 'politica', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b) } });
      return p;
    });
  });

  // ------------------------------------------------------------ jobs
  r.get('/api/v1/backup-jobs', {
    preValidation: requireAuth('backups.ver'),
    schema: { querystring: Type.Object({ ...PageQuery.properties, server_id: Type.Optional(Type.Integer({ minimum: 1 })), client_id: Type.Optional(Type.Integer({ minimum: 1 })) }) }
  }, async (req) => {
    const limit = req.query.limit ?? 50;
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${JOB_COLUMNS} FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN backup_policies p ON p.id = j.policy_id
      WHERE j.archived_at IS NULL AND ($1::bigint IS NULL OR j.id < $1) AND ($2::bigint IS NULL OR j.server_id = $2) AND ($3::bigint IS NULL OR j.client_id = $3)
      ORDER BY j.id DESC LIMIT $4`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.server_id ?? null, req.query.client_id ?? null, limit]));
    return { items, next_cursor: items.length === limit ? String(items[items.length - 1]!.id) : null };
  });

  r.get('/api/v1/backup-jobs/:id', { preValidation: requireAuth('backups.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one(`SELECT ${JOB_COLUMNS} FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN backup_policies p ON p.id = j.policy_id WHERE j.id = $1`, [req.params.id]));
    if (!row) throw notFound('Job de backup');
    return row;
  });

  async function jobSources(tx: Tx, b: { kind: string; application_id?: number; database_id?: number; paths?: string[]; excludes?: string[] }, server: { id: number; client_id: number }) {
    let paths = b.paths ?? [];
    let excludes = b.excludes ?? [];
    if (b.application_id) {
      const a = await tx.one('SELECT * FROM applications WHERE id = $1 AND server_id = $2 AND archived_at IS NULL', [b.application_id, server.id]);
      if (!a) throw validationError({ application_id: 'Aplicação não encontrada neste servidor.' });
      if (!b.paths) paths = [...new Set<string>([...(a.install_dir ? [a.install_dir] : []), ...a.data_dirs, ...a.config_files])];
      if (!b.excludes) excludes = a.excludes;
    }
    if (b.kind === 'banco') {
      if (!b.database_id) throw validationError({ database_id: 'Informe o banco.' });
      const d = await tx.one('SELECT id FROM databases WHERE id = $1 AND server_id = $2 AND archived_at IS NULL', [b.database_id, server.id]);
      if (!d) throw validationError({ database_id: 'Banco não encontrado neste servidor.' });
      paths = [];
    } else {
      if (b.database_id) throw validationError({ database_id: 'Job de arquivos não leva banco.' });
      if (!paths.length) throw validationError({ paths: 'Informe ao menos um caminho (ou uma aplicação com diretórios cadastrados).' });
    }
    return { paths, excludes };
  }

  r.post('/api/v1/backup-jobs', { preValidation: requireAuth('backups.editar'), schema: { body: JobInput } }, async (req, reply) => {
    const b = req.body;
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const s = await tx.one('SELECT id, client_id FROM servers WHERE id = $1 AND archived_at IS NULL', [b.server_id]);
        if (!s) throw validationError({ server_id: 'Servidor não encontrado.' });
        const server = { id: Number(s.id), client_id: Number(s.client_id) };
        const policy = await tx.one('SELECT * FROM backup_policies WHERE id = $1 AND archived_at IS NULL', [b.policy_id]);
        if (!policy || (policy.client_id != null && Number(policy.client_id) !== server.client_id)) throw validationError({ policy_id: 'Política não encontrada para este cliente.' });
        const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1 AND archived_at IS NULL', [b.destination_id]) as DestinationRow | null;
        if (!dest || (dest.client_id != null && Number(dest.client_id) !== server.client_id)) throw validationError({ destination_id: 'Destino não encontrado para este cliente.' });
        if ((dest as unknown as { status: string }).status !== 'ok') throw conflict('Teste o destino com sucesso antes de usá-lo em um job.');
        const { paths, excludes } = await jobSources(tx, b, server);
        // repositório do servidor neste destino (criado e inicializado uma única vez)
        const access = await ensureRepository(tx, store, dest, server, config.tools.restic);
        const enabled = b.enabled ?? true;
        const j = await tx.one(`INSERT INTO backup_jobs (client_id, server_id, policy_id, destination_id, repository_id, kind, name, application_id, database_id, paths, excludes, enabled, next_run_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [server.client_id, server.id, policy.id, dest.id, access.repositoryId, b.kind, b.name.trim(), b.application_id ?? null, b.database_id ?? null,
          paths, excludes, enabled, enabled ? computeNextRun(policy) : null]);
        await audit(tx, actor(req), { action: 'job.criar', entity: 'job', entityId: j!.id, clientId: server.client_id, details: { tipo: b.kind, destino: dest.id, politica: policy.id } });
        return tx.one(`SELECT ${JOB_COLUMNS} FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN backup_policies p ON p.id = j.policy_id WHERE j.id = $1`, [j!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Já existe um job com esse nome neste servidor.');
      throw err;
    }
  });

  r.patch('/api/v1/backup-jobs/:id', { preValidation: requireAuth('backups.editar'), schema: { params: IdParams, body: JobPatch } }, async (req) => {
    const b = req.body;
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM backup_jobs WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Job de backup');
      const policy = await tx.one('SELECT * FROM backup_policies WHERE id = $1 AND archived_at IS NULL', [b.policy_id ?? cur.policy_id]);
      if (!policy || (policy.client_id != null && Number(policy.client_id) !== Number(cur.client_id))) throw validationError({ policy_id: 'Política não encontrada para este cliente.' });
      if (cur.kind === 'banco' && b.paths) throw validationError({ paths: 'Job de banco não leva caminhos.' });
      if (cur.kind === 'arquivos' && b.paths && !b.paths.length) throw validationError({ paths: 'Informe ao menos um caminho.' });
      const enabled = b.enabled ?? cur.enabled;
      await tx.query(`UPDATE backup_jobs SET name = coalesce($2, name), policy_id = $3, paths = coalesce($4, paths), excludes = coalesce($5, excludes), enabled = $6, next_run_at = $7 WHERE id = $1`,
        [cur.id, b.name?.trim() ?? null, policy.id, b.paths ?? null, b.excludes ?? null, enabled, enabled ? computeNextRun(policy) : null]);
      await audit(tx, actor(req), { action: 'job.alterar', entity: 'job', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b) } });
      return tx.one(`SELECT ${JOB_COLUMNS} FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN backup_policies p ON p.id = j.policy_id WHERE j.id = $1`, [cur.id]);
    });
  });

  r.post('/api/v1/backup-jobs/:id/archive', { preValidation: requireAuth('backups.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const row = await tx.one('UPDATE backup_jobs SET archived_at = now(), enabled = false, next_run_at = NULL WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!row) throw notFound('Job de backup');
      // os snapshots continuam no repositório e seguem a retenção da política
      await audit(tx, actor(req), { action: 'job.arquivar', entity: 'job', entityId: row.id, clientId: row.client_id });
      return { ok: true };
    });
  });

  r.post('/api/v1/backup-jobs/:id/run', { preValidation: requireAuth('backups.executar'), schema: { params: IdParams }, config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const out = await db.withScope(req.user!.scope, (tx) => startRun(tx, { store, signer: deps.signer }, req.params.id, { trigger: 'manual', requestedBy: req.user!.id }, actor(req)));
    return reply.code(202).send({ run_id: out.run!.public_id, status: out.run!.status });
  });

  // ------------------------------------------------------------ execuções
  r.get('/api/v1/backup-runs', {
    preValidation: requireAuth('backups.ver'),
    schema: { querystring: Type.Object({ limit: PageQuery.properties.limit, job_id: Type.Optional(Type.Integer({ minimum: 1 })), status: Type.Optional(Type.String({ maxLength: 30 })) }) }
  }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${RUN_COLUMNS} FROM backup_runs r JOIN backup_jobs j ON j.id = r.job_id
      LEFT JOIN agent_task_queue t ON t.id = r.task_id LEFT JOIN backup_snapshots sn ON sn.id = r.snapshot_id
      WHERE ($1::bigint IS NULL OR r.job_id = $1) AND ($2::text IS NULL OR r.status = $2) ORDER BY r.id DESC LIMIT $3`, [req.query.job_id ?? null, req.query.status ?? null, req.query.limit ?? 50]))
  }));

  r.get('/api/v1/backup-runs/:id', { preValidation: requireAuth('backups.ver'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const run = await tx.one(`SELECT ${RUN_COLUMNS}, r.task_id AS task_pk FROM backup_runs r JOIN backup_jobs j ON j.id = r.job_id
        LEFT JOIN agent_task_queue t ON t.id = r.task_id LEFT JOIN backup_snapshots sn ON sn.id = r.snapshot_id WHERE r.public_id = $1`, [req.params.id]);
      if (!run) throw notFound('Execução');
      const logs = run.task_pk ? await tx.many('SELECT attempt, at, level, message FROM agent_task_logs WHERE task_id = $1 ORDER BY id LIMIT 500', [run.task_pk]) : [];
      delete run.task_pk;
      return { ...run, logs };
    });
  });

  // ------------------------------------------------------------ snapshots
  r.get('/api/v1/snapshots', {
    preValidation: requireAuth('backups.ver'),
    schema: { querystring: Type.Object({ limit: PageQuery.properties.limit, job_id: Type.Optional(Type.Integer({ minimum: 1 })), status: Type.Optional(Type.String({ maxLength: 30 })) }) }
  }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${SNAP_COLUMNS} FROM backup_snapshots sn JOIN backup_jobs j ON j.id = sn.job_id
      WHERE ($1::bigint IS NULL OR sn.job_id = $1) AND ($2::text IS NULL OR sn.status = $2) ORDER BY sn.taken_at DESC LIMIT $3`, [req.query.job_id ?? null, req.query.status ?? null, req.query.limit ?? 50]))
  }));

  r.post('/api/v1/snapshots/:id/legal-hold', {
    preValidation: requireAuth('backups.reter'),
    schema: { params: IdParams, body: Type.Object({ hold: Type.Boolean(), reason: Type.String({ minLength: 5, maxLength: 500 }) }, { additionalProperties: false }) }
  }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      // espera uma retenção em andamento terminar (linha travada) e só então decide
      const row = await tx.one(`UPDATE backup_snapshots SET legal_hold = $2, legal_hold_reason = $3 WHERE id = $1 AND status <> 'removido' RETURNING id, client_id, restic_id`,
        [req.params.id, req.body.hold, req.body.hold ? req.body.reason : null]);
      if (!row) {
        const exists = await tx.one('SELECT status FROM backup_snapshots WHERE id = $1', [req.params.id]);
        if (!exists) throw notFound('Snapshot');
        throw conflict('O snapshot já foi removido pela retenção.');
      }
      await audit(tx, actor(req), { action: req.body.hold ? 'snapshot.reter' : 'snapshot.liberar', entity: 'snapshot', entityId: row.id, clientId: row.client_id, details: { motivo: req.body.reason } });
      return { ok: true, legal_hold: req.body.hold };
    });
  });

  r.post('/api/v1/snapshots/:id/verify', { preValidation: requireAuth('backups.executar'), schema: { params: IdParams } }, async (req, reply) => {
    await db.withScope(req.user!.scope, async (tx) => {
      const row = await tx.one(`UPDATE backup_snapshots SET status = 'nao_verificado', verify_attempts = 0 WHERE id = $1 AND status IN ('validado', 'falha_verificacao') RETURNING id, client_id`, [req.params.id]);
      if (!row) {
        const s = await tx.one('SELECT status FROM backup_snapshots WHERE id = $1', [req.params.id]);
        if (!s) throw notFound('Snapshot');
        throw conflict(s.status === 'removido' ? 'O snapshot foi removido.' : 'A verificação deste snapshot já está pendente.');
      }
      await audit(tx, actor(req), { action: 'snapshot.reverificar', entity: 'snapshot', entityId: row.id, clientId: row.client_id });
    });
    return reply.code(202).send({ status: 'nao_verificado' });
  });

  // ------------------------------------------------------------ repositórios
  r.get('/api/v1/repositories', { preValidation: requireAuth('armazenamento.ver') }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT r.id, r.client_id, r.server_id, s.name AS server_name, r.destination_id, d.name AS destination_name, r.tool,
        r.initialized_at, r.size_bytes, r.stats_at, r.last_check_at, r.last_check_ok, r.last_retention_at, r.retention_error,
        (SELECT count(*) FROM backup_snapshots sn WHERE sn.repository_id = r.id AND sn.status <> 'removido') AS snapshots
      FROM backup_repositories r JOIN servers s ON s.id = r.server_id JOIN backup_destinations d ON d.id = r.destination_id ORDER BY r.id`))
  }));
}
