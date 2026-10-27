import { env } from '../../config/env.js';
import { db } from '../../database/pool.js';
import { randomToken, sha256 } from '../../utils/common.js';

export const SESSION_COOKIE = env.cookieSecure ? '__Host-sid' : 'sid';

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionTtlHours * 3600 * 1000
  };
}

export async function createSession(userId, { ip, userAgent } = {}, conn = db) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const row = await conn.one(
    `INSERT INTO sessoes (usuario_id, token_hash, csrf_token, ip, user_agent, expira_em)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6)) RETURNING id, expira_em`,
    [userId, sha256(token), csrf, ip || null, (userAgent || '').slice(0, 300) || null, env.sessionTtlHours]
  );
  return { token, csrf, id: row.id, expiresAt: row.expira_em };
}

/** Busca sessão válida (não expirada, não revogada, dentro do tempo de inatividade) e o usuário ativo. */
export async function findSession(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  const row = await db.one(
    `SELECT s.id AS sessao_id, s.csrf_token, s.ultimo_uso_em,
            u.id, u.tipo, u.nome, u.email, u.cliente_id, u.ativo
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.revogada_em IS NULL AND s.expira_em > now()
        AND s.ultimo_uso_em > now() - make_interval(mins => $2) AND u.ativo`,
    [sha256(token), env.sessionIdleMinutes]
  );
  if (!row) return null;
  if (Date.now() - new Date(row.ultimo_uso_em).getTime() > 60_000) {
    await db.query('UPDATE sessoes SET ultimo_uso_em = now() WHERE id = $1', [row.sessao_id]);
  }
  return row;
}

export async function loadPermissions(userId) {
  const rows = await db.many(
    `SELECT DISTINCT p.codigo AS perfil, pm.codigo AS permissao
       FROM usuarios_perfis up
       JOIN perfis p ON p.id = up.perfil_id
       LEFT JOIN perfis_permissoes pp ON pp.perfil_id = p.id
       LEFT JOIN permissoes pm ON pm.id = pp.permissao_id
      WHERE up.usuario_id = $1`,
    [userId]
  );
  return {
    roles: [...new Set(rows.map((r) => r.perfil))],
    permissions: new Set(rows.map((r) => r.permissao).filter(Boolean))
  };
}

export const revokeSession = (sessionId) => db.query('UPDATE sessoes SET revogada_em = now() WHERE id = $1 AND revogada_em IS NULL', [sessionId]);

export const revokeAllSessions = (userId, conn = db, exceptSessionId = null) => conn.query(
  'UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL AND ($2::bigint IS NULL OR id <> $2)',
  [userId, exceptSessionId]
);

export const purgeExpiredSessions = () => db.query(
  "DELETE FROM sessoes WHERE expira_em < now() - interval '7 days' OR revogada_em < now() - interval '7 days'"
);
