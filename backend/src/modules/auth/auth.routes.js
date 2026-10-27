import { Router } from 'express';
import { loginLimiter, passwordResetLimiter } from '../../middlewares/security.js';
import { clientIp } from '../../utils/common.js';
import { unauthorized } from '../../utils/errors.js';
import { v, parse } from '../../utils/validation.js';
import { isAdmin } from '../../middlewares/auth.js';
import * as auth from './auth.service.js';
import { cookieOptions, revokeSession, SESSION_COOKIE } from './session.service.js';

export const authRouter = Router();

function publicUser(req) {
  const u = req.user;
  return {
    id: u.id, nome: u.nome, email: u.email, tipo: u.tipo,
    perfis: u.roles, administrador: isAdmin(u),
    permissoes: isAdmin(u) ? ['*'] : [...u.permissions]
  };
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parse({
    email: v.email(),
    senha: v.string({ min: 1, max: 128 }),
    area: v.enum(['admin', 'cliente'], { default: 'admin' })
  }, req.body);
  // Encerra uma sessão anterior neste navegador (evita fixação de sessão).
  if (req.sessionInfo) await revokeSession(req.sessionInfo.id);
  const { user, session } = await auth.login(input, { ip: clientIp(req), userAgent: req.get('user-agent') });
  res.cookie(SESSION_COOKIE, session.token, cookieOptions());
  res.json({ usuario: { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo }, csrf: session.csrf });
});

authRouter.post('/logout', async (req, res) => {
  if (req.sessionInfo) await revokeSession(req.sessionInfo.id);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) throw unauthorized();
  res.json({ usuario: publicUser(req), csrf: req.sessionInfo.csrf });
});

authRouter.post('/esqueci-senha', passwordResetLimiter, async (req, res) => {
  const { email } = parse({ email: v.email() }, req.body);
  res.json(await auth.requestPasswordReset(email));
});

authRouter.post('/redefinir-senha', passwordResetLimiter, async (req, res) => {
  const input = parse({ token: v.string({ min: 64, max: 64 }), senha: v.string({ min: 1, max: 200 }) }, req.body);
  res.json(await auth.resetPassword(input));
});

authRouter.post('/alterar-senha', async (req, res) => {
  if (!req.user) throw unauthorized();
  const input = parse({ senha_atual: v.string({ min: 1, max: 200 }), nova_senha: v.string({ min: 1, max: 200 }) }, req.body);
  await auth.changePassword(req.user, req.sessionInfo.id, input);
  res.json({ mensagem: 'Senha alterada. As outras sessões foram encerradas.' });
});
