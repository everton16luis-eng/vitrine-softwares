// /api/v1/pgbackrest-stanzas — backup físico do PostgreSQL com o pgBackRest do servidor.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound, conflict, validationError } from '@central/shared';
import { isUniqueViolation, type Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import { checkSchedule, isValidTimeZone } from '../backups/cron.ts';
import type { BackupDeps } from '../backups/service.ts';
import { startPgbrRun, nextPgbr, summarizeInfo } from '../pgbackrest/service.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const Stanza = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' });
const Cron = Type.String({ minLength: 9, maxLength: 100 });
const Input = Type.Object({
  server_id: Type.Integer({ minimum: 1 }),
  database_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  stanza: Stanza,
  full_schedule: Cron,
  diff_schedule: Type.Optional(Type.Union([Cron, Type.Null()])),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  enabled: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const Patch = Type.Object({
  full_schedule: Type.Optional(Cron), diff_schedule: Input.properties.diff_schedule, timezone: Input.properties.timezone, enabled: Input.properties.enabled
}, { additionalProperties: false });
const COLS = `x.id, x.client_id, x.server_id, s.name AS server_name, x.database_id, x.stanza, x.full_schedule, x.diff_schedule, x.timezone, x.enabled, x.next_full_at, x.next_diff_at,
  x.status, x.last_error, x.last_info_at, x.last_backup_label, x.last_backup_type, x.last_backup_at, x.last_backup_bytes, x.wal_min, x.wal_max, x.created_at`;

function checkCrons(b: { full_schedule?: string; diff_schedule?: string | null; timezone?: string }, curTz = 'America/Sao_Paulo') {
  const errs: Record<string, string> = {};
  const tz = b.timezone ?? curTz;
  if (!isValidTimeZone(tz)) errs.timezone = 'Fuso horário desconhecido.';
  else for (const k of ['full_schedule', 'diff_schedule'] as const) {
    const v = b[k];
    if (v) { try { checkSchedule(v, tz); } catch (err) { errs[k] = (err as Error).message; } }
  }
  if (Object.keys(errs).length) throw validationError(errs);
}

export async function pgbackrestRoutes(app: FastifyInstance, { db, deps }: { db: Database; deps: BackupDeps }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  r.get('/api/v1/pgbackrest-stanzas', { preValidation: requireAuth('backups.ver'), schema: { querystring: Type.Object({ server_id: Type.Optional(Type.Integer({ minimum: 1 })) }) } }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${COLS} FROM pgbackrest_stanzas x JOIN servers s ON s.id = x.server_id
      WHERE x.archived_at IS NULL AND ($1::bigint IS NULL OR x.server_id = $1) ORDER BY x.id`, [req.query.server_id ?? null]))
  }));

  r.get('/api/v1/pgbackrest-stanzas/:id', { preValidation: requireAuth('backups.ver'), schema: { params: IdParams } }, async (req) => db.withScope(req.user!.scope, async (tx) => {
    const x = await tx.one(`SELECT ${COLS}, x.last_info FROM pgbackrest_stanzas x JOIN servers s ON s.id = x.server_id WHERE x.id = $1 AND x.archived_at IS NULL`, [req.params.id]);
    if (!x) throw notFound('Stanza');
    const runs = await tx.many('SELECT id, type, trigger, status, label, error, created_at, finished_at FROM pgbackrest_runs WHERE stanza_id = $1 ORDER BY id DESC LIMIT 50', [x.id]);
    const { last_info, ...rest } = x;
    return { ...rest, summary: last_info ? summarizeInfo(last_info, x.stanza, x.status === 'erro' && /check:/.test(x.last_error ?? '') ? 'falhou' : 'ok') : null, runs };
  }));

  r.post('/api/v1/pgbackrest-stanzas', { preValidation: requireAuth('backups.editar'), schema: { body: Input } }, async (req, reply) => {
    const b = req.body;
    checkCrons(b);
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const s = await tx.one('SELECT id, client_id FROM servers WHERE id = $1 AND archived_at IS NULL', [b.server_id]);
        if (!s) throw notFound('Servidor');
        if (b.database_id) {
          const d = await tx.one('SELECT engine FROM databases WHERE id = $1 AND server_id = $2 AND archived_at IS NULL', [b.database_id, s.id]);
          if (!d) throw validationError({ database_id: 'Banco inexistente neste servidor.' });
          if (d.engine !== 'postgresql') throw validationError({ database_id: 'pgBackRest é só para PostgreSQL.' });
        }
        const tz = b.timezone ?? 'America/Sao_Paulo';
        const now = new Date();
        const x = await tx.one(`INSERT INTO pgbackrest_stanzas (client_id, server_id, database_id, stanza, full_schedule, diff_schedule, timezone, enabled, next_full_at, next_diff_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8, true), $9, $10) RETURNING id, client_id`,
        [s.client_id, s.id, b.database_id ?? null, b.stanza, b.full_schedule.trim(), b.diff_schedule?.trim() ?? null, tz, b.enabled ?? null, nextPgbr(b.full_schedule, tz, now), nextPgbr(b.diff_schedule ?? null, tz, now)]);
        await audit(tx, actor(req), { action: 'pgbackrest.cadastrar', entity: 'pgbackrest', entityId: x!.id, clientId: x!.client_id, details: { stanza: b.stanza } });
        return tx.one(`SELECT ${COLS} FROM pgbackrest_stanzas x JOIN servers s ON s.id = x.server_id WHERE x.id = $1`, [x!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Essa stanza já está cadastrada neste servidor.');
      throw err;
    }
  });

  r.patch('/api/v1/pgbackrest-stanzas/:id', { preValidation: requireAuth('backups.editar'), schema: { params: IdParams, body: Patch } }, async (req) => {
    const b = req.body;
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM pgbackrest_stanzas WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Stanza');
      checkCrons(b, cur.timezone);
      const full = b.full_schedule ?? cur.full_schedule;
      const diff = 'diff_schedule' in b ? b.diff_schedule ?? null : cur.diff_schedule;
      const tz = b.timezone ?? cur.timezone;
      const now = new Date();
      await tx.query(`UPDATE pgbackrest_stanzas SET full_schedule = $2, diff_schedule = $3, timezone = $4, enabled = coalesce($5, enabled), next_full_at = $6, next_diff_at = $7 WHERE id = $1`,
        [cur.id, full, diff, tz, b.enabled ?? null, nextPgbr(full, tz, now), nextPgbr(diff, tz, now)]);
      await audit(tx, actor(req), { action: 'pgbackrest.alterar', entity: 'pgbackrest', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b) } });
      return tx.one(`SELECT ${COLS} FROM pgbackrest_stanzas x JOIN servers s ON s.id = x.server_id WHERE x.id = $1`, [cur.id]);
    });
  });

  r.post('/api/v1/pgbackrest-stanzas/:id/archive', { preValidation: requireAuth('backups.editar'), schema: { params: IdParams } }, async (req) => db.withScope(req.user!.scope, async (tx) => {
    const x = await tx.one('UPDATE pgbackrest_stanzas SET archived_at = now(), enabled = false WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
    if (!x) throw notFound('Stanza');
    await audit(tx, actor(req), { action: 'pgbackrest.arquivar', entity: 'pgbackrest', entityId: x.id, clientId: x.client_id });
    return { ok: true };
  }));

  /** Backup manual (full/diff/incr) ou consulta do estado (info + check). */
  r.post('/api/v1/pgbackrest-stanzas/:id/run', { preValidation: requireAuth('backups.executar'), schema: { params: IdParams, body: Type.Object({ type: Type.Union([Type.Literal('full'), Type.Literal('diff'), Type.Literal('incr'), Type.Literal('info')]) }, { additionalProperties: false }) } }, async (req, reply) => {
    const out = await db.withScope(req.user!.scope, async (tx) => {
      const x = await tx.one('SELECT id FROM pgbackrest_stanzas WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
      if (!x) throw notFound('Stanza');
      try { return await startPgbrRun(tx, deps, Number(x.id), req.body.type, 'manual', req.user!.id, actor(req)); } catch (err) { throw conflict((err as Error).message); }
    });
    if (!out) throw conflict('Já existe uma execução em andamento para esta stanza.');
    return reply.code(202).send(out);
  });
}
