// /api/v1/storage — destinos de backup. Credenciais de acesso só de escrita.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { validate } from '@central/contracts';
import { notFound, conflict, validationError, forbidden } from '@central/shared';
import { isUniqueViolation, type Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import type { SecretStore } from '../secrets.ts';
import { checkConfig, testDestination, S3Credentials, type DestinationRow } from '../storage/destinations.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const DestinationInput = Type.Object({
  client_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  kind: Type.Union([Type.Literal('local_rest'), Type.Literal('s3')]),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  config: Type.Record(Type.String(), Type.Unknown()),
  immutable: Type.Optional(Type.Boolean()),
  capacity_bytes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]))
}, { additionalProperties: false });
const DestinationPatch = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 120 })),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  immutable: Type.Optional(Type.Boolean()),
  capacity_bytes: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]))
}, { additionalProperties: false });

const COLUMNS = `id, client_id, kind, name, config, (access_secret_id IS NOT NULL) AS has_credential, immutable, capacity_bytes, status,
  last_check_at, last_check_error, created_at, updated_at,
  (SELECT count(*) FROM backup_repositories r WHERE r.destination_id = backup_destinations.id) AS repositories`;

export async function storageRoutes(app: FastifyInstance, { db, store, config }: { db: Database; store: SecretStore; config: Config }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  r.get('/api/v1/storage', { preValidation: requireAuth('armazenamento.ver') }, async (req) => {
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${COLUMNS} FROM backup_destinations WHERE archived_at IS NULL ORDER BY id`));
    return { items };
  });

  r.post('/api/v1/storage', { preValidation: requireAuth('armazenamento.editar'), schema: { body: DestinationInput } }, async (req, reply) => {
    const b = req.body;
    if (b.client_id == null && req.user!.scope !== '*') throw forbidden('Destinos da empresa exigem acesso a todos os clientes.');
    const cfg = checkConfig(b.kind, b.config);
    if (b.kind === 'local_rest' && !b.immutable) throw validationError({ immutable: 'O destino local usa rest-server em modo append-only: marque como imutável.' });
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        if (b.client_id != null && !(await tx.one('SELECT 1 FROM clients WHERE id = $1', [b.client_id]))) throw validationError({ client_id: 'Cliente não encontrado.' });
        const d = await tx.one(`INSERT INTO backup_destinations (client_id, kind, name, config, immutable, capacity_bytes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [b.client_id ?? null, b.kind, b.name.trim(), JSON.stringify(cfg), b.immutable ?? false, b.capacity_bytes ?? null]);
        await audit(tx, actor(req), { action: 'destino.criar', entity: 'destino', entityId: d!.id, clientId: b.client_id ?? null, details: { tipo: b.kind, nome: b.name } });
        return tx.one(`SELECT ${COLUMNS} FROM backup_destinations WHERE id = $1`, [d!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Já existe um destino com esse nome.');
      throw err;
    }
  });

  r.get('/api/v1/storage/:id', { preValidation: requireAuth('armazenamento.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one(`SELECT ${COLUMNS} FROM backup_destinations WHERE id = $1`, [req.params.id]));
    if (!row) throw notFound('Destino');
    return row;
  });

  r.patch('/api/v1/storage/:id', { preValidation: requireAuth('armazenamento.editar'), schema: { params: IdParams, body: DestinationPatch } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM backup_destinations WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Destino');
      const b = req.body;
      if (b.config) {
        const repos = await tx.one('SELECT count(*) AS n FROM backup_repositories WHERE destination_id = $1', [cur.id]);
        if (Number(repos?.n) > 0) throw conflict('O destino já tem repositórios: crie um destino novo em vez de mudar o endereço.');
      }
      if (cur.kind === 'local_rest' && b.immutable === false) throw validationError({ immutable: 'O destino local é sempre imutável (append-only).' });
      const cfg = b.config ? checkConfig(cur.kind, b.config) : cur.config;
      await tx.query(`UPDATE backup_destinations SET name = coalesce($2, name), config = $3, immutable = coalesce($4, immutable),
        capacity_bytes = CASE WHEN $6 THEN $5 ELSE capacity_bytes END, status = CASE WHEN $7 THEN 'nao_testado' ELSE status END WHERE id = $1`,
      [cur.id, b.name?.trim() ?? null, JSON.stringify(cfg), b.immutable ?? null, b.capacity_bytes ?? null, 'capacity_bytes' in b, Boolean(b.config)]);
      await audit(tx, actor(req), { action: 'destino.editar', entity: 'destino', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b) } });
      return tx.one(`SELECT ${COLUMNS} FROM backup_destinations WHERE id = $1`, [cur.id]);
    });
  });

  r.put('/api/v1/storage/:id/credential', {
    preValidation: requireAuth('armazenamento.editar'),
    schema: { params: IdParams, body: S3Credentials }
  }, async (req, reply) => {
    const v = validate(S3Credentials, req.body);
    if (!v.ok) throw validationError(v.errors);
    await db.withScope(req.user!.scope, async (tx) => {
      const d = await tx.one('SELECT id, client_id, kind, access_secret_id FROM backup_destinations WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!d) throw notFound('Destino');
      if (d.kind !== 's3') throw conflict('Este tipo de destino não usa credencial de acesso.');
      const value = JSON.stringify(v.value);
      if (d.access_secret_id) await store.replace(tx, Number(d.access_secret_id), value);
      else {
        const id = await store.put(tx, { clientId: d.client_id == null ? null : Number(d.client_id), kind: 's3_access', value, createdBy: req.user!.id });
        await tx.query('UPDATE backup_destinations SET access_secret_id = $2 WHERE id = $1', [d.id, id]);
      }
      await tx.query("UPDATE backup_destinations SET status = 'nao_testado' WHERE id = $1", [d.id]);
      await audit(tx, actor(req), { action: d.access_secret_id ? 'segredo.substituir' : 'segredo.definir', entity: 'destino', entityId: d.id, clientId: d.client_id });
    });
    return reply.code(204).send();
  });

  /** Teste real de escrita e leitura com restic no destino. */
  r.post('/api/v1/storage/:id/test', { preValidation: requireAuth('armazenamento.editar'), schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const d = await tx.one('SELECT * FROM backup_destinations WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
      if (!d) throw notFound('Destino');
      const result = await testDestination(tx, store, d as DestinationRow, config.tools.restic);
      const cap = (result.details as { capacity_bytes?: number }).capacity_bytes;
      await tx.query(`UPDATE backup_destinations SET status = $2, last_check_at = now(), last_check_error = $3, capacity_bytes = coalesce(capacity_bytes, $4) WHERE id = $1`,
        [d.id, result.ok ? 'ok' : 'erro', result.error, cap ?? null]);
      await audit(tx, actor(req), { action: 'destino.testar', entity: 'destino', entityId: d.id, clientId: d.client_id, details: { resultado: result.ok ? 'ok' : 'erro' } });
      return result;
    });
  });

  r.post('/api/v1/storage/:id/archive', { preValidation: requireAuth('armazenamento.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const n = await tx.one('SELECT count(*) AS n FROM backup_repositories WHERE destination_id = $1', [req.params.id]);
      if (Number(n?.n) > 0) throw conflict('O destino guarda repositórios de backup e não pode ser arquivado enquanto eles existirem.');
      const row = await tx.one('UPDATE backup_destinations SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!row) throw notFound('Destino');
      await audit(tx, actor(req), { action: 'destino.arquivar', entity: 'destino', entityId: row.id, clientId: row.client_id });
      return { ok: true };
    });
  });
}
