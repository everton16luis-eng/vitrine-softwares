// /api/v1/clients e /api/v1/servers. Todas as consultas rodam com o escopo de clientes do usuário
// (RLS): um usuário restrito simplesmente não enxerga — nem por ID — recursos de outros clientes.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { isIP } from 'node:net';
import { ClientInput, ClientPatch, ServerInput, ServerPatch, PageQuery } from '@central/contracts';
import { notFound, conflict, validationError } from '@central/shared';
import { isUniqueViolation, type Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const cursorOf = (rows: { id: number }[], limit: number) => (rows.length === limit ? String(rows[rows.length - 1]!.id) : null);

function cnpjDigits(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) throw validationError({ cnpj: 'CNPJ inválido.' });
  const calc = (len: number) => {
    let sum = 0; let w = len - 7;
    for (let i = 0; i < len; i++) { sum += Number(d[i]) * w--; if (w < 2) w = 9; }
    const r = sum % 11; return r < 2 ? 0 : 11 - r;
  };
  if (calc(12) !== Number(d[12]) || calc(13) !== Number(d[13])) throw validationError({ cnpj: 'CNPJ inválido.' });
  return d;
}

export async function recordRoutes(app: FastifyInstance, { db }: { db: Database }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  // ------------------------------------------------------------ clientes
  r.get('/api/v1/clients', { preValidation: requireAuth('clientes.ver'), schema: { querystring: Type.Object({ ...PageQuery.properties, status: Type.Optional(Type.String({ maxLength: 20 })) }) } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const rows = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT c.*, (SELECT count(*) FROM servers s WHERE s.client_id = c.id AND s.archived_at IS NULL) AS servers
      FROM clients c
      WHERE ($1::bigint IS NULL OR c.id < $1) AND ($2::text IS NULL OR c.legal_name ILIKE '%' || $2 || '%' OR c.trade_name ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR c.status = $3) AND c.archived_at IS NULL
      ORDER BY c.id DESC LIMIT $4`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.q?.replace(/[%_\\]/g, '\\$&') || null, req.query.status ?? null, limit]));
    return { items: rows, next_cursor: cursorOf(rows, limit) };
  });

  r.post('/api/v1/clients', { preValidation: requireAuth('clientes.editar'), schema: { body: ClientInput } }, async (req, reply) => {
    const b = req.body;
    const cnpj = cnpjDigits(b.cnpj);
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const c = await tx.one(`INSERT INTO clients (legal_name, trade_name, cnpj, tech_contact, email, phone, notes, status, rpo_minutes, rto_minutes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 'ativo'), $9, $10) RETURNING *`,
        [b.legal_name.trim(), b.trade_name ?? null, cnpj, b.tech_contact ?? null, b.email ?? null, b.phone ?? null, b.notes ?? null, b.status ?? null, b.rpo_minutes ?? null, b.rto_minutes ?? null]);
        await audit(tx, actor(req), { action: 'cliente.criar', entity: 'cliente', entityId: c!.id, clientId: c!.id, details: { nome: c!.legal_name } });
        return c;
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err, 'ux_clients_cnpj')) throw conflict('Já existe um cliente com este CNPJ.');
      if ((err as { code?: string }).code === '42501') throw conflict('Seu acesso é restrito a clientes específicos; peça a um administrador para cadastrar.');
      throw err;
    }
  });

  r.get('/api/v1/clients/:id', { preValidation: requireAuth('clientes.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one('SELECT * FROM clients WHERE id = $1', [req.params.id]));
    if (!row) throw notFound('Cliente');
    return row;
  });

  r.patch('/api/v1/clients/:id', { preValidation: requireAuth('clientes.editar'), schema: { params: IdParams, body: ClientPatch } }, async (req) => {
    const b = { ...req.body } as Record<string, unknown>;
    if ('cnpj' in b) b.cnpj = cnpjDigits(b.cnpj as string | null);
    const cols = Object.keys(b);
    if (!cols.length) throw validationError({}, 'Nada para alterar.');
    try {
      return await db.withScope(req.user!.scope, async (tx) => {
        const row = await tx.one(`UPDATE clients SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [req.params.id, ...cols.map((c) => b[c])]);
        if (!row) throw notFound('Cliente');
        await audit(tx, actor(req), { action: 'cliente.editar', entity: 'cliente', entityId: row.id, clientId: row.id, details: { campos: cols } });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'ux_clients_cnpj')) throw conflict('Já existe um cliente com este CNPJ.');
      throw err;
    }
  });

  /** Exclusão lógica: o histórico (servidores, tarefas, auditoria) é preservado. */
  r.post('/api/v1/clients/:id/archive', { preValidation: requireAuth('clientes.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const active = await tx.one("SELECT count(*) AS n FROM agents WHERE client_id = $1 AND status = 'ativo'", [req.params.id]);
      if (Number(active?.n) > 0) throw conflict('Revogue os agentes ativos do cliente antes de arquivá-lo.');
      const row = await tx.one("UPDATE clients SET archived_at = now(), status = 'encerrado' WHERE id = $1 AND archived_at IS NULL RETURNING id, legal_name", [req.params.id]);
      if (!row) throw notFound('Cliente');
      await audit(tx, actor(req), { action: 'cliente.arquivar', entity: 'cliente', entityId: row.id, clientId: row.id });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ servidores
  const ServerQuery = Type.Object({ ...PageQuery.properties,
    client_id: Type.Optional(Type.Integer({ minimum: 1 })),
    status: Type.Optional(Type.Union([Type.Literal('sem_agente'), Type.Literal('online'), Type.Literal('offline'), Type.Literal('degradado')]))
  });
  r.get('/api/v1/servers', { preValidation: requireAuth('servidores.ver'), schema: { querystring: ServerQuery } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const rows = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT s.id, s.public_id, s.client_id, c.legal_name AS client_name, s.name, s.hostname, s.ip_addresses,
        s.os_name, s.os_version, s.arch, s.connection_status, s.last_seen_at, a.version AS agent_version, a.public_id AS agent_id
      FROM servers s JOIN clients c ON c.id = s.client_id
      LEFT JOIN agents a ON a.server_id = s.id AND a.status = 'ativo'
      WHERE s.archived_at IS NULL AND ($1::bigint IS NULL OR s.id < $1) AND ($2::bigint IS NULL OR s.client_id = $2)
        AND ($3::text IS NULL OR s.connection_status = $3) AND ($4::text IS NULL OR s.name ILIKE '%' || $4 || '%' OR s.hostname ILIKE '%' || $4 || '%')
      ORDER BY s.id DESC LIMIT $5`,
    [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.client_id ?? null, req.query.status ?? null, req.query.q?.replace(/[%_\\]/g, '\\$&') || null, limit]));
    return { items: rows, next_cursor: cursorOf(rows, limit) };
  });

  const checkIps = (ips: string[] | undefined) => {
    for (const ip of ips ?? []) if (!isIP(ip)) throw validationError({ ip_addresses: `Endereço IP inválido: ${ip}` });
  };

  r.post('/api/v1/servers', { preValidation: requireAuth('servidores.editar'), schema: { body: ServerInput } }, async (req, reply) => {
    checkIps(req.body.ip_addresses);
    try {
      const row = await db.withScope(req.user!.scope, async (tx) => {
        const client = await tx.one("SELECT id, status FROM clients WHERE id = $1 AND archived_at IS NULL", [req.body.client_id]);
        if (!client) throw validationError({ client_id: 'Cliente não encontrado.' });
        const s = await tx.one(`INSERT INTO servers (client_id, name, hostname, ip_addresses, provider, notes) VALUES ($1, $2, $3, $4::inet[], $5, $6) RETURNING *`,
          [req.body.client_id, req.body.name.trim(), req.body.hostname ?? null, req.body.ip_addresses ?? [], req.body.provider ?? null, req.body.notes ?? null]);
        await audit(tx, actor(req), { action: 'servidor.criar', entity: 'servidor', entityId: s!.id, clientId: s!.client_id, details: { nome: s!.name } });
        return s;
      });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Este cliente já tem um servidor com esse nome.');
      throw err;
    }
  });

  r.get('/api/v1/servers/:id', { preValidation: requireAuth('servidores.ver'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const s = await tx.one(`SELECT s.*, c.legal_name AS client_name FROM servers s JOIN clients c ON c.id = s.client_id WHERE s.id = $1`, [req.params.id]);
      if (!s) throw notFound('Servidor');
      const agent = await tx.one(`SELECT a.public_id, a.version, a.status, a.last_heartbeat_at, a.clock_skew_s, a.pending_results, a.created_at,
          (SELECT max(not_after) FROM agent_credentials c WHERE c.agent_id = a.id AND c.revoked_at IS NULL) AS cert_not_after
        FROM agents a WHERE a.server_id = $1 AND a.status <> 'revogado'`, [s.id]);
      const inventory = await tx.one('SELECT collected_at, received_at, hash FROM server_inventory WHERE server_id = $1 ORDER BY collected_at DESC LIMIT 1', [s.id]);
      return { ...s, agent, last_inventory: inventory };
    });
  });

  r.get('/api/v1/servers/:id/inventory', { preValidation: requireAuth('servidores.ver'), schema: { params: IdParams } }, async (req) => {
    const row = await db.withScope(req.user!.scope, (tx) => tx.one('SELECT collected_at, received_at, data FROM server_inventory WHERE server_id = $1 ORDER BY collected_at DESC LIMIT 1', [req.params.id]));
    if (!row) throw notFound('Inventário');
    return row;
  });

  r.patch('/api/v1/servers/:id', { preValidation: requireAuth('servidores.editar'), schema: { params: IdParams, body: ServerPatch } }, async (req) => {
    checkIps(req.body.ip_addresses);
    const b = req.body as Record<string, unknown>;
    const cols = Object.keys(b);
    if (!cols.length) throw validationError({}, 'Nada para alterar.');
    try {
      return await db.withScope(req.user!.scope, async (tx) => {
        const row = await tx.one(`UPDATE servers SET ${cols.map((c, i) => `${c} = $${i + 2}${c === 'ip_addresses' ? '::inet[]' : ''}`).join(', ')}
          WHERE id = $1 AND archived_at IS NULL RETURNING *`, [req.params.id, ...cols.map((c) => b[c])]);
        if (!row) throw notFound('Servidor');
        await audit(tx, actor(req), { action: 'servidor.editar', entity: 'servidor', entityId: row.id, clientId: row.client_id, details: { campos: cols } });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Este cliente já tem um servidor com esse nome.');
      throw err;
    }
  });

  r.post('/api/v1/servers/:id/archive', { preValidation: requireAuth('servidores.editar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const active = await tx.one("SELECT 1 FROM agents WHERE server_id = $1 AND status = 'ativo'", [req.params.id]);
      if (active) throw conflict('Revogue o agente do servidor antes de arquivá-lo.');
      const row = await tx.one('UPDATE servers SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!row) throw notFound('Servidor');
      await audit(tx, actor(req), { action: 'servidor.arquivar', entity: 'servidor', entityId: row.id, clientId: row.client_id });
      return { ok: true };
    });
  });
}
