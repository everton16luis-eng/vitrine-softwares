// /api/v1 — prévia de snapshot e restaurações.
//   temporario / caminho / novo_banco: não tocam em produção; quem tem `restauracoes.solicitar` pede e já vai para a fila.
//   producao (só bancos): quem pede tem `restaurar.producao` e digita o nome do servidor; OUTRA pessoa com
//   `restauracoes.aprovar` + `restaurar.producao` aprova digitando o nome de novo; a central faz um backup de
//   segurança do estado atual e só restaura depois de ele ser VALIDADO.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { SAFE_PATH_PATTERN } from '@central/contracts';
import { notFound, conflict, validationError, forbidden } from '@central/shared';
import { isUniqueViolation, type Database } from '@central/database';
import { requireAuth, can } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import type { SecretStore } from '../secrets.ts';
import type { TaskSigner } from '../tasks/service.ts';
import { cancelTask } from '../tasks/service.ts';
import { repositoryAccess, type DestinationRow } from '../storage/destinations.ts';
import { restic } from '../storage/restic.ts';
import { startRun } from '../backups/service.ts';
import { enqueueRestore } from '../restores/service.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const UuidParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const SafePath = Type.String({ minLength: 1, maxLength: 1024, pattern: SAFE_PATH_PATTERN });
const RestoreInput = Type.Object({
  snapshot_id: Type.Integer({ minimum: 1 }),
  mode: Type.Union([Type.Literal('temporario'), Type.Literal('caminho'), Type.Literal('novo_banco'), Type.Literal('producao')]),
  includes: Type.Optional(Type.Array(SafePath, { maxItems: 50 })),
  target_dir: Type.Optional(SafePath),
  new_name: Type.Optional(Type.String({ pattern: '^[a-z][a-z0-9_]{2,62}$' })),
  new_file: Type.Optional(SafePath),
  reason: Type.String({ minLength: 5, maxLength: 1000 }),
  confirmation: Type.Optional(Type.String({ maxLength: 200 }))
}, { additionalProperties: false });

const COLUMNS = `rr.public_id AS id, rr.client_id, rr.server_id, s.name AS server_name, rr.job_id, j.name AS job_name, rr.snapshot_id, sn.restic_id AS snapshot,
  sn.taken_at AS snapshot_taken_at, rr.kind, rr.mode, rr.options, rr.reason, rr.status, rr.requested_by, ru.email AS requested_by_email, rr.drill, rr.duration_s,
  rr.approved_by, au.email AS approved_by_email, rr.approved_at, rr.decision_note, sr.public_id AS safety_run, rr.result, rr.error, rr.created_at, rr.finished_at`;
const FROM = `FROM restore_requests rr JOIN servers s ON s.id = rr.server_id JOIN backup_jobs j ON j.id = rr.job_id JOIN backup_snapshots sn ON sn.id = rr.snapshot_id
  LEFT JOIN users ru ON ru.id = rr.requested_by LEFT JOIN users au ON au.id = rr.approved_by LEFT JOIN backup_runs sr ON sr.id = rr.safety_run_id`;

export async function restoreRoutes(app: FastifyInstance, deps: { db: Database; store: SecretStore; config: Config; signer: () => Promise<TaskSigner> }) {
  const { db, store, config } = deps;
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });
  const backupDeps = { store, signer: deps.signer };

  /** Prévia: conteúdo de um diretório do snapshot (não recursivo), lido pela central. */
  r.get('/api/v1/snapshots/:id/files', {
    preValidation: requireAuth('restauracoes.solicitar'),
    schema: { params: IdParams, querystring: Type.Object({ path: Type.Optional(SafePath) }, { additionalProperties: false }) },
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req) => {
    const ctx = await db.withScope(req.user!.scope, async (tx) => {
      const sn = await tx.one("SELECT * FROM backup_snapshots WHERE id = $1 AND status <> 'removido'", [req.params.id]);
      if (!sn) throw notFound('Snapshot');
      const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1', [sn.repository_id]);
      const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo!.destination_id]) as DestinationRow;
      return { sn, access: await repositoryAccess(tx, store, dest, repo!) };
    });
    const dir = req.query.path ?? '/';
    const out = await restic(config.tools.restic, ['ls', '--json', ctx.sn.restic_id, dir], { repo: ctx.access.maintenanceRepo, password: ctx.access.password, env: ctx.access.maintenanceEnv, timeoutMs: 120_000 });
    if (out.code !== 0) throw conflict(`Não foi possível ler o snapshot: ${out.stderr.slice(0, 300)}`);
    const items: { name: string; path: string; type: string; size: number | null; mtime: string | null }[] = [];
    for (const line of out.stdout.split('\n')) {
      if (!line.startsWith('{') || items.length >= 1000) continue;
      try {
        const n = JSON.parse(line);
        if (n.struct_type !== 'node' && n.message_type !== 'node') continue;
        items.push({ name: n.name, path: n.path, type: n.type, size: n.size ?? null, mtime: n.mtime ?? null });
      } catch { /* linha inválida */ }
    }
    return { snapshot: ctx.sn.restic_id, path: dir, kind: ctx.sn.stdin_filename ? 'dump' : 'arquivos', items, truncated: items.length >= 1000 };
  });

  r.get('/api/v1/restores', { preValidation: requireAuth('restauracoes.solicitar'), schema: { querystring: Type.Object({ status: Type.Optional(Type.String({ maxLength: 30 })) }) } }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${COLUMNS} ${FROM} WHERE ($1::text IS NULL OR rr.status = $1) ORDER BY rr.id DESC LIMIT 100`, [req.query.status ?? null]))
  }));

  r.get('/api/v1/restores/:id', { preValidation: requireAuth('restauracoes.solicitar'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const row = await tx.one(`SELECT ${COLUMNS}, rr.task_id AS task_pk ${FROM} WHERE rr.public_id = $1`, [req.params.id]);
      if (!row) throw notFound('Restauração');
      const logs = row.task_pk ? await tx.many('SELECT attempt, at, level, message FROM agent_task_logs WHERE task_id = $1 ORDER BY id LIMIT 500', [row.task_pk]) : [];
      delete row.task_pk;
      return { ...row, logs };
    });
  });

  r.post('/api/v1/restores', { preValidation: requireAuth('restauracoes.solicitar'), schema: { body: RestoreInput }, config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = req.body;
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const sn = await tx.one(`SELECT sn.*, j.kind, j.server_id, j.database_id, s.name AS server_name FROM backup_snapshots sn
          JOIN backup_jobs j ON j.id = sn.job_id JOIN servers s ON s.id = j.server_id WHERE sn.id = $1`, [b.snapshot_id]);
        if (!sn) throw notFound('Snapshot');
        if (sn.status !== 'validado') throw conflict('Só é possível restaurar um snapshot validado.');
        const options: Record<string, unknown> = {};
        if (sn.kind === 'arquivos') {
          if (b.mode === 'producao') throw conflict('Restaurar arquivos por cima da produção exige o auxiliar privilegiado, que esta versão não inclui. Restaure em diretório temporário ou novo.');
          if (b.mode === 'novo_banco') throw validationError({ mode: 'Snapshot de arquivos: use temporário ou caminho.' });
          if (b.mode === 'caminho' && !b.target_dir) throw validationError({ target_dir: 'Informe o diretório de destino (novo ou vazio).' });
          if (b.includes?.length) options.includes = b.includes;
          if (b.mode === 'caminho') options.target_dir = b.target_dir;
        } else {
          if (b.mode === 'temporario' || b.mode === 'caminho') throw validationError({ mode: 'Snapshot de banco: use novo_banco ou producao.' });
          const d = await tx.one('SELECT engine, db_name FROM databases WHERE id = $1', [sn.database_id]);
          if (b.mode === 'novo_banco') {
            if (d!.engine === 'sqlite') { if (b.new_file) options.new_file = b.new_file; }
            else {
              const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '');
              options.new_name = b.new_name ?? `${String(d!.db_name).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)}_restaurado_${stamp}`.replace(/^[^a-z]/, 'r');
              if (options.new_name === d!.db_name) throw validationError({ new_name: 'O banco novo precisa ter nome diferente do original.' });
            }
          }
        }
        const prod = b.mode === 'producao';
        if (prod) {
          if (!can(req.user, 'restaurar.producao')) throw forbidden('Restaurar por cima da produção exige a permissão restaurar.producao.');
          if (b.confirmation !== sn.server_name) throw validationError({ confirmation: `Digite o nome do servidor (${sn.server_name}) para confirmar.` });
        }
        const rr = await tx.one(`INSERT INTO restore_requests (client_id, server_id, job_id, snapshot_id, kind, mode, options, reason, status, requested_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, public_id`,
        [sn.client_id, sn.server_id, sn.job_id, sn.id, sn.kind, b.mode, JSON.stringify(options), b.reason, prod ? 'aguardando_aprovacao' : 'na_fila', req.user!.id]);
        await audit(tx, actor(req), { action: 'restauracao.solicitar', entity: 'restauracao', entityId: rr!.public_id, clientId: sn.client_id, details: { modo: b.mode, snapshot: sn.restic_id.slice(0, 8), motivo: b.reason } });
        if (!prod) await enqueueRestore(tx, backupDeps, Number(rr!.id));
        return tx.one(`SELECT ${COLUMNS} ${FROM} WHERE rr.id = $1`, [rr!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Já existe uma restauração de produção em andamento para este job.');
      throw err;
    }
  });

  r.post('/api/v1/restores/:id/approve', {
    preValidation: requireAuth('restauracoes.aprovar'),
    schema: { params: UuidParams, body: Type.Object({ confirmation: Type.String({ maxLength: 200 }), note: Type.Optional(Type.String({ maxLength: 1000 })) }, { additionalProperties: false }) }
  }, async (req) => {
    if (!can(req.user, 'restaurar.producao')) throw forbidden('Aprovar restauração de produção exige a permissão restaurar.producao.');
    return db.withScope(req.user!.scope, async (tx) => {
      const rr = await tx.one(`SELECT rr.*, s.name AS server_name FROM restore_requests rr JOIN servers s ON s.id = rr.server_id WHERE rr.public_id = $1 FOR UPDATE OF rr`, [req.params.id]);
      if (!rr) throw notFound('Restauração');
      if (rr.status !== 'aguardando_aprovacao') throw conflict('A restauração não está aguardando aprovação.');
      if (Number(rr.requested_by) === req.user!.id) throw forbidden('Quem solicitou não pode aprovar a própria restauração.');
      if (req.body.confirmation !== rr.server_name) throw validationError({ confirmation: `Digite o nome do servidor (${rr.server_name}) para confirmar.` });
      // backup de segurança do estado atual: a restauração só começa depois de ele ser validado
      const { run } = await startRun(tx, backupDeps, Number(rr.job_id), { trigger: 'seguranca', requestedBy: req.user!.id }, actor(req));
      await tx.query(`UPDATE restore_requests SET status = 'backup_seguranca', approved_by = $2, approved_at = now(), decision_note = $3, safety_run_id = $4 WHERE id = $1`,
        [rr.id, req.user!.id, req.body.note ?? null, run!.id]);
      await audit(tx, actor(req), { action: 'restauracao.aprovar', entity: 'restauracao', entityId: rr.public_id, clientId: rr.client_id, details: { backup_seguranca: run!.public_id } });
      return tx.one(`SELECT ${COLUMNS} ${FROM} WHERE rr.id = $1`, [rr.id]);
    });
  });

  r.post('/api/v1/restores/:id/reject', {
    preValidation: requireAuth('restauracoes.aprovar'),
    schema: { params: UuidParams, body: Type.Object({ note: Type.String({ minLength: 3, maxLength: 1000 }) }, { additionalProperties: false }) }
  }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const rr = await tx.one("UPDATE restore_requests SET status = 'recusado', decision_note = $2, finished_at = now() WHERE public_id = $1 AND status = 'aguardando_aprovacao' RETURNING id, public_id, client_id", [req.params.id, req.body.note]);
      if (!rr) throw conflict('A restauração não está aguardando aprovação.');
      await audit(tx, actor(req), { action: 'restauracao.recusar', entity: 'restauracao', entityId: rr.public_id, clientId: rr.client_id, details: { motivo: req.body.note } });
      return tx.one(`SELECT ${COLUMNS} ${FROM} WHERE rr.id = $1`, [rr.id]);
    });
  });

  r.post('/api/v1/restores/:id/cancel', { preValidation: requireAuth('restauracoes.solicitar'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const rr = await tx.one('SELECT rr.*, t.public_id AS task_public FROM restore_requests rr LEFT JOIN agent_task_queue t ON t.id = rr.task_id WHERE rr.public_id = $1 FOR UPDATE OF rr', [req.params.id]);
      if (!rr) throw notFound('Restauração');
      if (Number(rr.requested_by) !== req.user!.id && !can(req.user, 'restauracoes.aprovar')) throw forbidden();
      if (!['aguardando_aprovacao', 'backup_seguranca', 'na_fila'].includes(rr.status)) throw conflict('A restauração já começou ou terminou e não pode ser cancelada.');
      if (rr.task_public) await cancelTask(tx, rr.task_public, actor(req));
      await tx.query("UPDATE restore_requests SET status = 'cancelado', finished_at = now() WHERE id = $1", [rr.id]);
      await audit(tx, actor(req), { action: 'restauracao.cancelar', entity: 'restauracao', entityId: rr.public_id, clientId: rr.client_id });
      return { ok: true };
    });
  });
}
