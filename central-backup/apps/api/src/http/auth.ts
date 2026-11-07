// Sessões do painel: cookie HttpOnly + SameSite=Strict com token aleatório (só o hash fica no banco),
// token CSRF obrigatório em métodos que alteram estado, expiração por inatividade e absoluta.
// Uma sessão só acessa o sistema depois do segundo fator (TOTP) — antes disso, apenas /auth/*.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomToken, sha256Hex } from '@central/security';
import { forbidden, unauthorized, AppError } from '@central/shared';
import type { Database, Scope } from '@central/database';
import type { Config } from '../config.ts';

export const SESSION_COOKIE = 'cb_session';

export interface SessionUser {
  sessionId: string;
  id: number;
  email: string;
  name: string;
  csrf: string;
  mfaVerified: boolean;
  totpEnabled: boolean;
  roles: string[];
  permissions: Set<string>;
  scope: Scope;
}

declare module 'fastify' {
  interface FastifyRequest { user?: SessionUser }
}

export function can(user: SessionUser | undefined, permission: string) {
  return Boolean(user && (user.roles.includes('admin') || user.permissions.has(permission)));
}

export async function createSession(db: Database, config: Config, userId: number, req: FastifyRequest, reply: FastifyReply, { mfaVerified = false } = {}) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await db.system((tx) => tx.query(`INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, mfa_verified_at, expires_at)
    VALUES ($1, $2, $3, $4::inet, $5, $6, now() + make_interval(hours => $7))`,
  [sha256Hex(token), userId, csrf, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), mfaVerified ? new Date() : null, config.session.absoluteHours]));
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.panel.secureCookies, sameSite: 'strict', path: '/', maxAge: config.session.absoluteHours * 3600 });
  return { csrf };
}

export async function loadUser(db: Database, config: Config, req: FastifyRequest): Promise<SessionUser | undefined> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 100) return undefined;
  const id = sha256Hex(token);
  return db.system(async (tx) => {
    const row = await tx.one(`SELECT s.id AS session_id, s.csrf_token, s.mfa_verified_at, s.last_seen_at, u.id, u.email, u.name, u.totp_enabled, u.status
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [id]);
    if (!row || row.status !== 'ativo') return undefined;
    if (Date.now() - new Date(row.last_seen_at).getTime() > config.session.idleMinutes * 60_000) {
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [id]);
      return undefined;
    }
    await tx.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '30 seconds'", [id]);
    const roles = (await tx.many('SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [row.id])).map((r) => r.code as string);
    const perms = (await tx.many(`SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = $1`, [row.id])).map((r) => r.code as string);
    const scopes = (await tx.many('SELECT client_id FROM user_client_scopes WHERE user_id = $1', [row.id])).map((r) => Number(r.client_id));
    return {
      sessionId: id, id: row.id, email: row.email, name: row.name, csrf: row.csrf_token,
      mfaVerified: Boolean(row.mfa_verified_at), totpEnabled: row.totp_enabled,
      roles, permissions: new Set(perms),
      scope: roles.includes('admin') || scopes.length === 0 ? '*' : scopes
    };
  });
}

/** Hook global do painel: carrega o usuário e confere CSRF em métodos que alteram estado. */
export function sessionHook(db: Database, config: Config) {
  return async (req: FastifyRequest) => {
    req.user = await loadUser(db, config, req);
    // o login cria uma sessão nova; SameSite=Strict impede que outro site o dispare
    if (req.user && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.routeOptions.url !== '/api/v1/auth/login') {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || header !== req.user.csrf) throw new AppError('Token de segurança ausente ou inválido. Recarregue a página.', { status: 403, code: 'CSRF' });
    }
  };
}

/** Exige usuário autenticado com 2FA concluído e (opcionalmente) uma permissão. */
export function requireAuth(permission?: string) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (!req.user.mfaVerified) throw new AppError('Conclua a verificação em duas etapas.', { status: 401, code: 'MFA_PENDENTE' });
    if (permission && !can(req.user, permission)) throw forbidden();
  };
}
