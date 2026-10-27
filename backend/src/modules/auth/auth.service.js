import { db, withTransaction } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { randomToken, sha256 } from '../../utils/common.js';
import { hashPassword, verifyPassword, passwordProblem } from './password.js';
import { createSession, revokeAllSessions } from './session.service.js';
import { sendTemplateSafe } from '../../services/email.js';
import { audit } from '../../services/audit.js';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
// Mensagem única para usuário inexistente, senha errada, conta inativa ou bloqueada (evita enumeração).
const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos. Após várias tentativas, o acesso é bloqueado temporariamente.';

export async function login({ email, senha, area }, { ip, userAgent }) {
  const tipo = area === 'cliente' ? 'cliente' : 'equipe';
  const user = await db.one('SELECT * FROM usuarios WHERE lower(email) = lower($1)', [String(email || '').trim()]);
  const valid = await verifyPassword(user?.senha_hash, senha);
  const locked = user?.bloqueado_ate && new Date(user.bloqueado_ate) > new Date();

  if (!user || !valid || !user.ativo || locked || user.tipo !== tipo) {
    if (user && !locked && !valid) {
      await db.query(
        `UPDATE usuarios SET tentativas_falhas = CASE WHEN tentativas_falhas + 1 >= $2 THEN 0 ELSE tentativas_falhas + 1 END,
                bloqueado_ate = CASE WHEN tentativas_falhas + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloqueado_ate END
          WHERE id = $1`,
        [user.id, MAX_FAILURES, LOCK_MINUTES]
      );
    }
    throw new AppError(GENERIC_LOGIN_ERROR, { status: 401, code: 'CREDENCIAIS_INVALIDAS' });
  }

  await db.query('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = now() WHERE id = $1', [user.id]);
  const session = await createSession(user.id, { ip, userAgent });
  if (user.tipo === 'equipe') await audit({ user, ip }, 'login', 'usuario', user.id);
  return { user, session };
}

/** Cria token de uso único (convite ou redefinição). Retorna o token em claro apenas uma vez. */
export async function createAccessToken(userId, finalidade, conn = db) {
  const token = randomToken(32);
  const hours = finalidade === 'convite' ? 72 : 1;
  await conn.query("UPDATE tokens_acesso SET usado_em = now() WHERE usuario_id = $1 AND finalidade = $2 AND usado_em IS NULL", [userId, finalidade]);
  await conn.query(
    'INSERT INTO tokens_acesso (usuario_id, finalidade, token_hash, expira_em) VALUES ($1, $2, $3, now() + make_interval(hours => $4))',
    [userId, finalidade, sha256(token), hours]
  );
  return token;
}

export function accessLink(token, finalidade) {
  return `${env.appUrl}/redefinir-senha?token=${token}${finalidade === 'convite' ? '&convite=1' : ''}`;
}

/** Resposta idêntica exista ou não o e-mail (proteção contra enumeração). */
export async function requestPasswordReset(email) {
  const user = await db.one('SELECT id, nome, email, ativo FROM usuarios WHERE lower(email) = lower($1)', [String(email || '').trim()]);
  if (user && user.ativo) {
    const token = await createAccessToken(user.id, 'redefinir_senha');
    await sendTemplateSafe('recuperacao_senha', user.email, { nome: user.nome, link: accessLink(token, 'redefinir_senha'), validade: '1 hora' });
  }
  return { mensagem: 'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.' };
}

export async function resetPassword({ token, senha }) {
  if (!token || typeof token !== 'string' || token.length !== 64) throw new AppError('Link inválido ou expirado.', { status: 400, code: 'TOKEN_INVALIDO' });
  return withTransaction(async (tx) => {
    const row = await tx.one(
      `SELECT t.id, t.usuario_id, u.email FROM tokens_acesso t JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.token_hash = $1 AND t.usado_em IS NULL AND t.expira_em > now() AND u.ativo FOR UPDATE OF t`,
      [sha256(token)]
    );
    if (!row) throw new AppError('Link inválido ou expirado. Solicite um novo.', { status: 400, code: 'TOKEN_INVALIDO' });
    const problem = passwordProblem(senha, row.email);
    if (problem) throw new ValidationError({ senha: problem }, problem);
    await tx.query('UPDATE tokens_acesso SET usado_em = now() WHERE id = $1', [row.id]);
    await tx.query('UPDATE usuarios SET senha_hash = $2, senha_alterada_em = now(), tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1',
      [row.usuario_id, await hashPassword(senha)]);
    await revokeAllSessions(row.usuario_id, tx);
    return { mensagem: 'Senha definida com sucesso. Você já pode entrar.' };
  });
}

export async function changePassword(user, sessionId, { senha_atual, nova_senha }) {
  const row = await db.one('SELECT senha_hash, email FROM usuarios WHERE id = $1', [user.id]);
  if (!(await verifyPassword(row?.senha_hash, senha_atual))) throw new ValidationError({ senha_atual: 'Senha atual incorreta.' });
  const problem = passwordProblem(nova_senha, row.email);
  if (problem) throw new ValidationError({ nova_senha: problem }, problem);
  await db.query('UPDATE usuarios SET senha_hash = $2, senha_alterada_em = now() WHERE id = $1', [user.id, await hashPassword(nova_senha)]);
  await revokeAllSessions(user.id, db, sessionId); // encerra as demais sessões
  if (user.tipo === 'equipe') await audit({ user }, 'alterar_senha', 'usuario', user.id);
}
