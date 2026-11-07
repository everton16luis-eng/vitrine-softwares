// /api/v1/auth — login, segundo fator (TOTP obrigatório), códigos de recuperação e sessões.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { LoginRequest, MfaVerifyRequest } from '@central/contracts';
import {
  verifyPassword, dummyVerify, generateTotpSecret, verifyTotp, totpUri, randomToken, sha256Hex, safeEqualHex, type Keyring
} from '@central/security';
import { AppError, unauthorized, conflict } from '@central/shared';
import type { Database } from '@central/database';
import type { Config } from '../config.ts';
import { createSession, requireAuth, SESSION_COOKIE } from '../http/auth.ts';
import { audit } from '../audit.ts';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const totpContext = (userId: number) => `users:totp:${userId}`;

export async function authRoutes(app: FastifyInstance, { db, config, keyring }: { db: Database; config: Config; keyring: Keyring }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }, id?: number) => ({ type: 'usuario' as const, id: id ?? req.user?.id ?? null, ip: req.ip });

  r.post('/api/v1/auth/login', { schema: { body: LoginRequest }, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const user = await db.system((tx) => tx.one('SELECT id, password_hash, status, failed_logins, locked_until, totp_enabled FROM users WHERE lower(email) = $1', [email]));
    const generic = new AppError('E-mail ou senha incorretos.', { status: 401, code: 'CREDENCIAIS_INVALIDAS' });
    if (!user) { await dummyVerify(req.body.password); throw generic; }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError('Conta bloqueada temporariamente por tentativas sem sucesso. Tente mais tarde.', { status: 423, code: 'CONTA_BLOQUEADA' });
    }
    const ok = user.status === 'ativo' && (await verifyPassword(user.password_hash, req.body.password));
    if (!ok) {
      await db.system(async (tx) => {
        await tx.query(`UPDATE users SET failed_logins = failed_logins + 1,
          locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END WHERE id = $1`, [user.id, MAX_FAILED, LOCK_MINUTES]);
        await audit(tx, actor(req, user.id), { action: 'auth.login_falhou', entity: 'usuario', entityId: user.id });
      });
      throw generic;
    }
    await db.system(async (tx) => {
      await tx.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
      await audit(tx, actor(req, user.id), { action: 'auth.senha_ok', entity: 'usuario', entityId: user.id });
    });
    const { csrf } = await createSession(db, config, user.id, req, reply, { mfaVerified: false });
    return { csrf, mfa: user.totp_enabled ? 'verificar' : 'configurar' };
  });

  /** Gera (ou regenera, enquanto não ativado) o segredo TOTP. Mostrado uma única vez. */
  r.post('/api/v1/auth/mfa/setup', async (req) => {
    if (!req.user) throw unauthorized();
    if (req.user.totpEnabled) throw conflict('A verificação em duas etapas já está ativa. Peça a um administrador para redefini-la.');
    const secret = generateTotpSecret();
    await db.system((tx) => tx.query('UPDATE users SET totp_secret_enc = $2 WHERE id = $1', [req.user!.id, keyring.encrypt(secret, totpContext(req.user!.id))]));
    return { secret, otpauth_uri: totpUri(secret, req.user.email) };
  });

  r.post('/api/v1/auth/mfa/enable', { schema: { body: MfaVerifyRequest }, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
    if (!req.user) throw unauthorized();
    if (req.user.totpEnabled) throw conflict('A verificação em duas etapas já está ativa.');
    const codes = Array.from({ length: 10 }, () => randomToken(6).replace(/[^A-Za-z0-9]/g, 'X').toUpperCase().slice(0, 8).replace(/^(.{4})(.{4})$/, '$1-$2'));
    await db.system(async (tx) => {
      const u = await tx.one('SELECT totp_secret_enc, totp_last_counter FROM users WHERE id = $1 FOR UPDATE', [req.user!.id]);
      if (!u?.totp_secret_enc) throw conflict('Gere o código QR antes de ativar.');
      const counter = verifyTotp(keyring.decryptText(u.totp_secret_enc, totpContext(req.user!.id)), req.body.code, Date.now(), Number(u.totp_last_counter));
      if (counter === null) throw new AppError('Código inválido. Confira a hora do celular e tente de novo.', { status: 422, code: 'MFA_INVALIDO', fields: { code: 'Código inválido.' } });
      // ativar o 2FA conclui o primeiro login: conta como acesso
      await tx.query('UPDATE users SET totp_enabled = true, totp_last_counter = $2, last_login_at = now() WHERE id = $1', [req.user!.id, counter]);
      await tx.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [req.user!.id]);
      for (const c of codes) await tx.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [req.user!.id, sha256Hex(c)]);
      await tx.query('UPDATE sessions SET mfa_verified_at = now() WHERE id = $1', [req.user!.sessionId]);
      await audit(tx, actor(req), { action: 'auth.mfa_ativado', entity: 'usuario', entityId: req.user!.id });
    });
    return { recovery_codes: codes };
  });

  r.post('/api/v1/auth/mfa/verify', { schema: { body: MfaVerifyRequest }, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
    if (!req.user) throw unauthorized();
    if (!req.user.totpEnabled) throw conflict('Configure a verificação em duas etapas primeiro.');
    const ok = await db.system(async (tx) => {
      const u = await tx.one('SELECT totp_secret_enc, totp_last_counter FROM users WHERE id = $1 FOR UPDATE', [req.user!.id]);
      let method: string | null = null;
      if (/^\d{6}$/.test(req.body.code)) {
        const counter = verifyTotp(keyring.decryptText(u!.totp_secret_enc, totpContext(req.user!.id)), req.body.code, Date.now(), Number(u!.totp_last_counter));
        if (counter !== null) {
          await tx.query('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [req.user!.id, counter]);
          method = 'totp';
        }
      } else {
        const hash = sha256Hex(req.body.code);
        const rows = await tx.many('SELECT id, code_hash FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [req.user!.id]);
        const match = rows.find((row) => safeEqualHex(row.code_hash, hash));
        if (match) {
          await tx.query('UPDATE mfa_recovery_codes SET used_at = now() WHERE id = $1', [match.id]);
          method = 'codigo_recuperacao';
        }
      }
      if (!method) {
        await audit(tx, actor(req), { action: 'auth.mfa_falhou', entity: 'usuario', entityId: req.user!.id });
        return false;
      }
      await tx.query('UPDATE sessions SET mfa_verified_at = now() WHERE id = $1', [req.user!.sessionId]);
      await tx.query('UPDATE users SET last_login_at = now() WHERE id = $1', [req.user!.id]);
      await audit(tx, actor(req), { action: 'auth.login', entity: 'usuario', entityId: req.user!.id, details: { metodo: method } });
      return true;
    });
    if (!ok) throw new AppError('Código inválido.', { status: 401, code: 'MFA_INVALIDO', fields: { code: 'Código inválido.' } });
    return { ok: true };
  });

  r.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.user) {
      await db.system(async (tx) => {
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.user!.sessionId]);
        await audit(tx, actor(req), { action: 'auth.logout', entity: 'usuario', entityId: req.user!.id });
      });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  r.get('/api/v1/auth/me', async (req) => {
    if (!req.user) throw unauthorized();
    const u = req.user;
    return {
      user: { id: u.id, email: u.email, name: u.name, roles: u.roles, permissions: u.roles.includes('admin') ? ['*'] : [...u.permissions], all_clients: u.scope === '*' },
      csrf: u.csrf, mfa: u.mfaVerified ? 'ok' : u.totpEnabled ? 'verificar' : 'configurar'
    };
  });

  r.get('/api/v1/auth/sessions', { preValidation: requireAuth() }, async (req) => {
    const items = await db.system((tx) => tx.many(`SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC`, [req.user!.id]));
    return { items: items.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === req.user!.sessionId })) };
  });

  r.delete('/api/v1/auth/sessions/:id', { preValidation: requireAuth(), schema: { params: Type.Object({ id: Type.String({ pattern: '^[0-9a-f]{16}$' }) }) } }, async (req, reply) => {
    await db.system(async (tx) => {
      const res = await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND left(id, 16) = $2 AND revoked_at IS NULL', [req.user!.id, req.params.id]);
      if (res.rowCount) await audit(tx, actor(req), { action: 'auth.sessao_revogada', entity: 'usuario', entityId: req.user!.id });
    });
    return reply.code(204).send();
  });
}
