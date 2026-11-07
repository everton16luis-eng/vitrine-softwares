// /api/v1/users, /api/v1/roles, /api/v1/me/password e /api/v1/audit.
//
// Contra escalada de privilégio: quem gerencia usuários só concede perfis cujas permissões ele mesmo
// tem, só concede clientes do próprio escopo e não altera os próprios perfis nem o próprio status.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { UserInput, PageQuery } from '@central/contracts';
import { hashPassword, verifyPassword, passwordProblem } from '@central/security';
import { notFound, conflict, validationError, forbidden, AppError } from '@central/shared';
import { isUniqueViolation, type Database, type Tx } from '@central/database';
import { requireAuth, type SessionUser } from '../http/auth.ts';
import { audit } from '../audit.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const UserPatch = Type.Object({
  name: Type.Optional(Type.String({ minLength: 2, maxLength: 150 })),
  status: Type.Optional(Type.Union([Type.Literal('ativo'), Type.Literal('bloqueado'), Type.Literal('desativado')])),
  roles: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 10, uniqueItems: true })),
  client_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 1000, uniqueItems: true }))
}, { additionalProperties: false });

async function checkGrant(tx: Tx, actor: SessionUser, roles: string[] | undefined, clientIds: number[] | undefined) {
  let roleIds: number[] = [];
  if (roles) {
    const rows = await tx.many(`SELECT r.id, r.code, coalesce(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS perms
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.code = ANY($1) GROUP BY r.id`, [roles]);
    const missing = roles.filter((c) => !rows.some((r) => r.code === c));
    if (missing.length) throw validationError({ roles: `Perfil inexistente: ${missing.join(', ')}` });
    const isAdmin = actor.roles.includes('admin');
    for (const r of rows) {
      if (r.code === 'admin' && !isAdmin) throw forbidden('Somente administradores concedem o perfil de administrador.');
      if (!isAdmin && (r.perms as string[]).some((p) => !actor.permissions.has(p))) throw forbidden(`O perfil "${r.code}" tem permissões que você não possui.`);
    }
    roleIds = rows.map((r) => Number(r.id));
  }
  if (clientIds) {
    if (actor.scope !== '*') {
      if (!clientIds.length) throw forbidden('Seu acesso é restrito: o novo usuário também precisa ser restrito a clientes do seu escopo.');
      const scope = actor.scope;
      if (clientIds.some((id) => !scope.includes(id))) throw forbidden('Você só pode conceder acesso a clientes do seu escopo.');
    }
    const found = await tx.many('SELECT id FROM clients WHERE id = ANY($1)', [clientIds]);
    if (found.length !== clientIds.length) throw validationError({ client_ids: 'Cliente inexistente na lista.' });
  } else if (actor.scope !== '*') {
    throw forbidden('Seu acesso é restrito: informe os clientes do novo usuário.');
  }
  return roleIds;
}

const USER_COLUMNS = `u.id, u.email, u.name, u.status, u.totp_enabled, u.last_login_at, u.locked_until, u.created_at,
  coalesce((SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles,
  coalesce((SELECT array_agg(client_id ORDER BY client_id) FROM user_client_scopes WHERE user_id = u.id), '{}') AS client_ids`;

export async function userRoutes(app: FastifyInstance, { db }: { db: Database }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });

  r.get('/api/v1/roles', { preValidation: requireAuth('usuarios.gerenciar') }, async () => {
    const items = await db.system((tx) => tx.many(`SELECT r.code, r.name, r.description, r.system,
      coalesce(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
      FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id GROUP BY r.id ORDER BY r.id`));
    return { items };
  });

  r.get('/api/v1/users', { preValidation: requireAuth('usuarios.gerenciar'), schema: { querystring: PageQuery } }, async (req) => {
    const limit = req.query.limit ?? 50;
    // gestor restrito vê apenas usuários restritos a clientes dentro do próprio escopo
    const scope = req.user!.scope === '*' ? null : [...req.user!.scope];
    const items = await db.system((tx) => tx.many(`SELECT ${USER_COLUMNS} FROM users u
      WHERE ($1::bigint IS NULL OR u.id < $1) AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%' OR u.name ILIKE '%' || $2 || '%')
        AND ($3::bigint[] IS NULL OR (EXISTS (SELECT 1 FROM user_client_scopes s WHERE s.user_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM user_client_scopes s WHERE s.user_id = u.id AND NOT s.client_id = ANY($3))))
      ORDER BY u.id DESC LIMIT $4`, [req.query.cursor ? Number(req.query.cursor) || null : null, req.query.q?.replace(/[%_\\]/g, '\\$&') || null, scope, limit]));
    return { items, next_cursor: items.length === limit ? String(items[items.length - 1]!.id) : null };
  });

  r.post('/api/v1/users', { preValidation: requireAuth('usuarios.gerenciar'), schema: { body: UserInput } }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const problem = passwordProblem(req.body.password, { email });
    if (problem) throw validationError({ password: problem });
    const hash = await hashPassword(req.body.password);
    try {
      const user = await db.system(async (tx) => {
        const roleIds = await checkGrant(tx, req.user!, req.body.roles, req.body.client_ids);
        const u = await tx.one('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, req.body.name.trim(), hash]);
        for (const id of roleIds) await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [u!.id, id]);
        for (const c of req.body.client_ids ?? []) await tx.query('INSERT INTO user_client_scopes (user_id, client_id) VALUES ($1, $2)', [u!.id, c]);
        await audit(tx, actor(req), { action: 'usuario.criar', entity: 'usuario', entityId: u!.id, details: { email, perfis: req.body.roles, clientes: req.body.client_ids ?? 'todos' } });
        return tx.one(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [u!.id]);
      });
      return reply.code(201).send(user);
    } catch (err) {
      if (isUniqueViolation(err, 'ux_users_email')) throw conflict('Já existe um usuário com este e-mail.');
      throw err;
    }
  });

  r.patch('/api/v1/users/:id', { preValidation: requireAuth('usuarios.gerenciar'), schema: { params: IdParams, body: UserPatch } }, async (req) => {
    const b = req.body;
    if (req.params.id === req.user!.id && (b.roles || b.status || b.client_ids)) throw forbidden('Você não pode alterar os próprios perfis, status ou escopo.');
    return db.system(async (tx) => {
      const target = await tx.one(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 FOR UPDATE`, [req.params.id]);
      if (!target) throw notFound('Usuário');
      // gestor restrito não mexe em usuários com acesso mais amplo que o dele
      await checkGrant(tx, req.user!, target.roles, target.client_ids.length ? target.client_ids : undefined);
      const roleIds = await checkGrant(tx, req.user!, b.roles, b.client_ids ?? (target.client_ids.length ? target.client_ids : undefined));
      if (b.name) await tx.query('UPDATE users SET name = $2 WHERE id = $1', [target.id, b.name.trim()]);
      if (b.status) {
        await tx.query('UPDATE users SET status = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [target.id, b.status]);
        if (b.status !== 'ativo') await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);
      }
      if (b.roles) {
        if (target.roles.includes('admin') && !b.roles.includes('admin')) {
          const admins = await tx.one("SELECT count(*) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.code = 'admin' AND u.status = 'ativo'");
          if (Number(admins?.n) <= 1) throw conflict('Este é o último administrador ativo.');
        }
        await tx.query('DELETE FROM user_roles WHERE user_id = $1', [target.id]);
        for (const id of roleIds) await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [target.id, id]);
      }
      if (b.client_ids) {
        await tx.query('DELETE FROM user_client_scopes WHERE user_id = $1', [target.id]);
        for (const c of b.client_ids) await tx.query('INSERT INTO user_client_scopes (user_id, client_id) VALUES ($1, $2)', [target.id, c]);
      }
      await audit(tx, actor(req), { action: 'usuario.editar', entity: 'usuario', entityId: target.id, details: { campos: Object.keys(b), perfis: b.roles, clientes: b.client_ids, status: b.status } });
      return tx.one(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [target.id]);
    });
  });

  /** Redefine o 2FA (celular perdido): o usuário configura de novo no próximo login. */
  r.post('/api/v1/users/:id/reset-mfa', { preValidation: requireAuth('usuarios.gerenciar'), schema: { params: IdParams } }, async (req) => {
    if (req.params.id === req.user!.id) throw forbidden('Peça a outro administrador para redefinir o seu 2FA.');
    await db.system(async (tx) => {
      const target = await tx.one(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 FOR UPDATE`, [req.params.id]);
      if (!target) throw notFound('Usuário');
      await checkGrant(tx, req.user!, target.roles, target.client_ids.length ? target.client_ids : undefined);
      await tx.query('UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_counter = -1 WHERE id = $1', [target.id]);
      await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [target.id]);
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);
      await audit(tx, actor(req), { action: 'usuario.mfa_redefinido', entity: 'usuario', entityId: target.id });
    });
    return { ok: true };
  });

  r.post('/api/v1/me/password', {
    preValidation: requireAuth(),
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: { body: Type.Object({ current_password: Type.String({ minLength: 1, maxLength: 256 }), new_password: Type.String({ minLength: 12, maxLength: 256 }) }, { additionalProperties: false }) }
  }, async (req) => {
    const u = await db.system((tx) => tx.one('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]));
    if (!u || !(await verifyPassword(u.password_hash, req.body.current_password))) {
      throw new AppError('Senha atual incorreta.', { status: 422, code: 'SENHA_INCORRETA', fields: { current_password: 'Senha atual incorreta.' } });
    }
    const problem = passwordProblem(req.body.new_password, { email: req.user!.email });
    if (problem) throw validationError({ new_password: problem });
    const hash = await hashPassword(req.body.new_password);
    await db.system(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [req.user!.id, hash]);
      // as outras sessões são encerradas
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [req.user!.id, req.user!.sessionId]);
      await audit(tx, actor(req), { action: 'usuario.senha_alterada', entity: 'usuario', entityId: req.user!.id });
    });
    return { ok: true };
  });

  // ------------------------------------------------------------ auditoria
  const AuditQuery = Type.Object({ ...PageQuery.properties,
    entity: Type.Optional(Type.String({ maxLength: 40 })),
    entity_id: Type.Optional(Type.String({ maxLength: 60 })),
    action: Type.Optional(Type.String({ maxLength: 60 })),
    client_id: Type.Optional(Type.Integer({ minimum: 1 }))
  });
  r.get('/api/v1/audit', { preValidation: requireAuth('auditoria.ver'), schema: { querystring: AuditQuery } }, async (req) => {
    const limit = req.query.limit ?? 50;
    const q = req.query;
    // RLS: usuário restrito vê eventos dos seus clientes e eventos sem cliente
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT l.id, l.at, l.actor_type, l.actor_id, u.email AS actor_email, host(l.ip) AS ip,
        l.action, l.entity, l.entity_id, l.client_id, l.details, l.hash
      FROM audit_logs l LEFT JOIN users u ON l.actor_type = 'usuario' AND u.id = l.actor_id
      WHERE ($1::bigint IS NULL OR l.id < $1) AND ($2::text IS NULL OR l.entity = $2) AND ($3::text IS NULL OR l.entity_id = $3)
        AND ($4::text IS NULL OR l.action LIKE $4 || '%') AND ($5::bigint IS NULL OR l.client_id = $5)
      ORDER BY l.id DESC LIMIT $6`, [q.cursor ? Number(q.cursor) || null : null, q.entity ?? null, q.entity_id ?? null, q.action?.replace(/[%_\\]/g, '\\$&') ?? null, q.client_id ?? null, limit]));
    return { items, next_cursor: items.length === limit ? String(items[items.length - 1]!.id) : null };
  });

  /** Recalcula a cadeia de hashes inteira. Só para quem enxerga todos os clientes. */
  r.get('/api/v1/audit/verify', { preValidation: requireAuth('auditoria.ver') }, async (req) => {
    if (req.user!.scope !== '*') throw forbidden('A verificação percorre toda a auditoria e exige acesso a todos os clientes.');
    const row = await db.system((tx) => tx.one('SELECT broken_id, checked FROM audit_verify()'));
    return { ok: row?.broken_id == null, checked: Number(row?.checked ?? 0), broken_id: row?.broken_id ?? null };
  });
}
