// /api/v1/databases, /api/v1/applications e descoberta de bancos.
// Credenciais: só escrita (PUT …/credential); a API responde apenas se há credencial definida.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type, type Static } from 'typebox';
import { PageQuery, SAFE_PATH_PATTERN } from '@central/contracts';
import { notFound, conflict, validationError } from '@central/shared';
import { isUniqueViolation, type Database, type Tx } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import { createTask, type TaskSigner } from '../tasks/service.ts';
import type { SecretStore } from '../secrets.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);
const AbsPath = Type.String({ minLength: 1, maxLength: 1024, pattern: SAFE_PATH_PATTERN });
const Ident = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.@$-]+$' });
const Engine = Type.Union(['postgresql', 'mysql', 'mariadb', 'sqlite', 'mongodb'].map((e) => Type.Literal(e)));

const DatabaseInput = Type.Object({
  server_id: Type.Integer({ minimum: 1 }),
  engine: Engine,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  db_name: Type.Optional(Nullable(Ident)),
  host: Type.Optional(Nullable(Type.String({ maxLength: 253, pattern: '^[A-Za-z0-9.:-]+$' }))),
  port: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 65535 }))),
  socket_path: Type.Optional(Nullable(AbsPath)),
  file_path: Type.Optional(Nullable(AbsPath)),
  tech_user: Type.Optional(Nullable(Ident)),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 5000 })))
}, { additionalProperties: false });
const DatabasePatch = Type.Partial(Type.Omit(DatabaseInput, ['server_id', 'engine']), { additionalProperties: false });

const PathList = Type.Array(AbsPath, { maxItems: 100, uniqueItems: true });
const ApplicationInput = Type.Object({
  server_id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  technology: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
  version: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
  install_dir: Type.Optional(Nullable(AbsPath)),
  systemd_unit: Type.Optional(Nullable(Type.String({ pattern: '^[A-Za-z0-9@._-]+\\.service$', maxLength: 120 }))),
  data_dirs: Type.Optional(PathList),
  config_files: Type.Optional(PathList),
  excludes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300, pattern: '^[^\\x00-\\x1f]+$' }), { maxItems: 100 })),
  domains: Type.Optional(Type.Array(Type.String({ pattern: '^[A-Za-z0-9.-]{3,253}$' }), { maxItems: 50, uniqueItems: true })),
  database_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 50, uniqueItems: true })),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
  rpo_minutes: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 525_600 }))),
  rto_minutes: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 525_600 })))
}, { additionalProperties: false });
const ApplicationPatch = Type.Partial(Type.Omit(ApplicationInput, ['server_id']), { additionalProperties: false });

const DB_COLUMNS = `d.id, d.client_id, d.server_id, s.name AS server_name, d.engine, d.name, d.db_name, d.host, d.port, d.socket_path, d.file_path, d.tech_user,
  (d.credential_id IS NOT NULL) AS has_credential, d.version, d.size_bytes, d.connection_status, d.last_test_at, d.last_test_error, d.last_backup_at,
  d.notes, d.created_at, d.updated_at`;

function checkDatabaseShape(b: Partial<Static<typeof DatabaseInput>>, engine: string) {
  if (engine === 'sqlite') {
    if (!b.file_path) throw validationError({ file_path: 'Informe o caminho do arquivo SQLite.' });
    if (b.host || b.port || b.socket_path) throw validationError({ host: 'SQLite não usa host, porta ou socket.' });
  } else if (!b.db_name) throw validationError({ db_name: 'Informe o nome do banco.' });
}

export async function catalogRoutes(app: FastifyInstance, deps: { db: Database; store: SecretStore; signer: () => Promise<TaskSigner> }) {
  const { db, store } = deps;
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  async function activeAgent(tx: Tx, serverId: number) {
    const a = await tx.one("SELECT id FROM agents WHERE server_id = $1 AND status = 'ativo'", [serverId]);
    if (!a) throw conflict('O servidor não tem agente ativo.');
    return Number(a.id);
  }
  async function serverOf(tx: Tx, id: number) {
    const s = await tx.one('SELECT id, client_id FROM servers WHERE id = $1 AND archived_at IS NULL', [id]);
    if (!s) throw validationError({ server_id: 'Servidor não encontrado.' });
    return { id: Number(s.id), client_id: Number(s.client_id) };
  }

  // ------------------------------------------------------------ bancos
  r.get('/api/v1/databases', {
    preValidation: requireAuth('bancos.ver'),
    schema: { querystring: Type.Object({ ...PageQuery.properties, server_id: Type.Optional(Type.Integer({ minimum: 1 })), client_id: Type.Optional(Type.Integer({ minimum: 1 })) }) }
  }, async (req) => {
    const limit = req.query.limit ?? 50;
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${DB_COLUMNS} FROM databases d JOIN servers s ON s.id = d.server_id
      WHERE d.archived_at IS NULL AND ($1::bigint IS NULL OR d.id < $1) AND ($2::bigint IS NULL OR d.server_id = $2) AND ($3::bigint IS NULL OR d.client_id = $3)
      ORDER BY d.id DESC LIMIT $4`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.server_id ?? null, req.query.client_id ?? null, limit]));
    return { items, next_cursor: items.length === limit ? String(items[items.length - 1]!.id) : null };
  });

  r.post('/api/v1/databases', { preValidation: requireAuth('bancos.editar'), schema: { body: DatabaseInput } }, async (req, reply) => {
    const b = req.body;
    checkDatabaseShape(b, b.engine);
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const s = await serverOf(tx, b.server_id);
        const d = await tx.one(`INSERT INTO databases (client_id, server_id, engine, name, db_name, host, port, socket_path, file_path, tech_user, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [s.client_id, s.id, b.engine, b.name.trim(), b.db_name ?? null, b.host ?? null, b.port ?? null, b.socket_path ?? null, b.file_path ?? null, b.tech_user ?? null, b.notes ?? null]);
        await audit(tx, actor(req), { action: 'banco.criar', entity: 'banco', entityId: d!.id, clientId: s.client_id, details: { motor: b.engine, nome: b.name } });
        return tx.one(`SELECT ${DB_COLUMNS} FROM databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1`, [d!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Este banco já está cadastrado neste servidor.');
      throw err;
    }
  });

  r.get('/api/v1/databases/:id', { preValidation: requireAuth('bancos.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one(`SELECT ${DB_COLUMNS} FROM databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1`, [req.params.id]));
    if (!row) throw notFound('Banco');
    return row;
  });

  r.patch('/api/v1/databases/:id', { preValidation: requireAuth('bancos.editar'), schema: { params: IdParams, body: DatabasePatch } }, async (req) => {
    const b = req.body as Record<string, unknown>;
    const cols = Object.keys(b);
    if (!cols.length) throw validationError({}, 'Nada para alterar.');
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM databases WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Banco');
      checkDatabaseShape({ ...cur, ...b } as never, cur.engine);
      await tx.query(`UPDATE databases SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, connection_status = 'nao_testado' WHERE id = $1`, [cur.id, ...cols.map((c) => b[c])]);
      await audit(tx, actor(req), { action: 'banco.editar', entity: 'banco', entityId: cur.id, clientId: cur.client_id, details: { campos: cols } });
      return tx.one(`SELECT ${DB_COLUMNS} FROM databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1`, [cur.id]);
    });
  });

  r.post('/api/v1/databases/:id/archive', { preValidation: requireAuth('bancos.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const row = await tx.one('UPDATE databases SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!row) throw notFound('Banco');
      await audit(tx, actor(req), { action: 'banco.arquivar', entity: 'banco', entityId: row.id, clientId: row.client_id });
      return { ok: true };
    });
  });

  /** Só escrita: a senha é cifrada com a chave do cliente e nunca volta pela API. */
  r.put('/api/v1/databases/:id/credential', {
    preValidation: requireAuth('segredos.gerenciar'),
    schema: { params: IdParams, body: Type.Object({ password: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }) }
  }, async (req, reply) => {
    await db.withScope(req.user!.scope, async (tx) => {
      const d = await tx.one('SELECT id, client_id, credential_id, engine FROM databases WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!d) throw notFound('Banco');
      if (d.engine === 'sqlite') throw conflict('SQLite não usa senha.');
      if (d.credential_id) await store.replace(tx, Number(d.credential_id), req.body.password);
      else {
        const id = await store.put(tx, { clientId: Number(d.client_id), kind: 'db_password', value: req.body.password, createdBy: req.user!.id });
        await tx.query('UPDATE databases SET credential_id = $2 WHERE id = $1', [d.id, id]);
      }
      await tx.query("UPDATE databases SET connection_status = 'nao_testado' WHERE id = $1", [d.id]);
      await audit(tx, actor(req), { action: d.credential_id ? 'segredo.substituir' : 'segredo.definir', entity: 'banco', entityId: d.id, clientId: d.client_id });
    });
    return reply.code(204).send();
  });

  /** Teste real feito pelo agente do servidor; a senha vai selada para a chave dele. */
  r.post('/api/v1/databases/:id/test-connection', { preValidation: requireAuth('bancos.editar'), schema: { params: IdParams } }, async (req, reply) => {
    const signer = await deps.signer();
    const task = await db.withScope(req.user!.scope, async (tx) => {
      const d = await tx.one('SELECT * FROM databases WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
      if (!d) throw notFound('Banco');
      const agentId = await activeAgent(tx, Number(d.server_id));
      const secrets = d.credential_id ? { password: await store.reveal(tx, Number(d.credential_id)) } : undefined;
      const target = Object.fromEntries(Object.entries({
        engine: d.engine, host: d.host, port: d.port, socket_path: d.socket_path, db_name: d.db_name, user: d.tech_user, file_path: d.file_path
      }).filter(([, v]) => v != null));
      const out = await createTask(tx, signer, { agentId, operation: 'db.test_connection', params: { target }, secrets, requestedBy: req.user!.id, origin: { type: 'database', id: Number(d.id) } }, actor(req));
      return out.task;
    });
    return reply.code(202).send({ task_id: task.public_id, status: task.status });
  });

  r.post('/api/v1/servers/:id/discover-databases', { preValidation: requireAuth('bancos.editar'), schema: { params: IdParams } }, async (req, reply) => {
    const signer = await deps.signer();
    const task = await db.withScope(req.user!.scope, async (tx) => {
      const s = await serverOf(tx, req.params.id);
      const agentId = await activeAgent(tx, s.id);
      return (await createTask(tx, signer, { agentId, operation: 'db.discover', params: {}, requestedBy: req.user!.id, origin: { type: 'server', id: s.id } }, actor(req))).task;
    });
    return reply.code(202).send({ task_id: task.public_id, status: task.status });
  });

  // ------------------------------------------------------------ aplicações
  const APP_COLUMNS = `a.*, s.name AS server_name,
    coalesce((SELECT array_agg(database_id ORDER BY database_id) FROM application_databases ad WHERE ad.application_id = a.id), '{}') AS database_ids`;

  async function linkDatabases(tx: Tx, appId: number, clientId: number, serverId: number, ids: number[]) {
    if (ids.length) {
      const found = await tx.many('SELECT id FROM databases WHERE id = ANY($1) AND server_id = $2 AND archived_at IS NULL', [ids, serverId]);
      if (found.length !== ids.length) throw validationError({ database_ids: 'Bancos precisam existir e estar no mesmo servidor da aplicação.' });
    }
    await tx.query('DELETE FROM application_databases WHERE application_id = $1', [appId]);
    for (const id of ids) await tx.query('INSERT INTO application_databases (application_id, database_id, client_id) VALUES ($1, $2, $3)', [appId, id, clientId]);
  }

  r.get('/api/v1/applications', {
    preValidation: requireAuth('aplicacoes.ver'),
    schema: { querystring: Type.Object({ ...PageQuery.properties, server_id: Type.Optional(Type.Integer({ minimum: 1 })) }) }
  }, async (req) => {
    const limit = req.query.limit ?? 50;
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${APP_COLUMNS} FROM applications a JOIN servers s ON s.id = a.server_id
      WHERE a.archived_at IS NULL AND ($1::bigint IS NULL OR a.id < $1) AND ($2::bigint IS NULL OR a.server_id = $2) ORDER BY a.id DESC LIMIT $3`,
    [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.server_id ?? null, limit]));
    return { items, next_cursor: items.length === limit ? String(items[items.length - 1]!.id) : null };
  });

  r.post('/api/v1/applications', { preValidation: requireAuth('aplicacoes.editar'), schema: { body: ApplicationInput } }, async (req, reply) => {
    const b = req.body;
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const s = await serverOf(tx, b.server_id);
        const a = await tx.one(`INSERT INTO applications (client_id, server_id, name, technology, version, install_dir, systemd_unit, data_dirs, config_files, excludes, domains, notes, rpo_minutes, rto_minutes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [s.client_id, s.id, b.name.trim(), b.technology ?? null, b.version ?? null, b.install_dir ?? null, b.systemd_unit ?? null, b.data_dirs ?? [], b.config_files ?? [],
          b.excludes ?? [], b.domains ?? [], b.notes ?? null, b.rpo_minutes ?? null, b.rto_minutes ?? null]);
        await linkDatabases(tx, Number(a!.id), s.client_id, s.id, b.database_ids ?? []);
        await audit(tx, actor(req), { action: 'aplicacao.criar', entity: 'aplicacao', entityId: a!.id, clientId: s.client_id, details: { nome: b.name } });
        return tx.one(`SELECT ${APP_COLUMNS} FROM applications a JOIN servers s ON s.id = a.server_id WHERE a.id = $1`, [a!.id]);
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Já existe uma aplicação com esse nome neste servidor.');
      throw err;
    }
  });

  r.get('/api/v1/applications/:id', { preValidation: requireAuth('aplicacoes.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one(`SELECT ${APP_COLUMNS} FROM applications a JOIN servers s ON s.id = a.server_id WHERE a.id = $1`, [req.params.id]));
    if (!row) throw notFound('Aplicação');
    return row;
  });

  r.patch('/api/v1/applications/:id', { preValidation: requireAuth('aplicacoes.editar'), schema: { params: IdParams, body: ApplicationPatch } }, async (req) => {
    const { database_ids, ...rest } = req.body as Record<string, unknown> & { database_ids?: number[] };
    const cols = Object.keys(rest);
    if (!cols.length && !database_ids) throw validationError({}, 'Nada para alterar.');
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT id, client_id, server_id FROM applications WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Aplicação');
      if (cols.length) await tx.query(`UPDATE applications SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [cur.id, ...cols.map((c) => rest[c])]);
      if (database_ids) await linkDatabases(tx, Number(cur.id), Number(cur.client_id), Number(cur.server_id), database_ids);
      await audit(tx, actor(req), { action: 'aplicacao.editar', entity: 'aplicacao', entityId: cur.id, clientId: cur.client_id, details: { campos: [...cols, ...(database_ids ? ['database_ids'] : [])] } });
      return tx.one(`SELECT ${APP_COLUMNS} FROM applications a JOIN servers s ON s.id = a.server_id WHERE a.id = $1`, [cur.id]);
    });
  });

  r.post('/api/v1/applications/:id/archive', { preValidation: requireAuth('aplicacoes.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const row = await tx.one('UPDATE applications SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!row) throw notFound('Aplicação');
      await audit(tx, actor(req), { action: 'aplicacao.arquivar', entity: 'aplicacao', entityId: row.id, clientId: row.client_id });
      return { ok: true };
    });
  });
}
