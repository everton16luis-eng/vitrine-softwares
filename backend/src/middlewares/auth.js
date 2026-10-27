import { cookieOptions, findSession, loadPermissions, SESSION_COOKIE } from '../modules/auth/session.service.js';
import { forbidden, unauthorized, AppError } from '../utils/errors.js';
import { safeEqual } from '../utils/common.js';

/** Carrega a sessão (se houver) em req.user / req.sessionInfo. Nunca confia em dados do corpo da requisição. */
export async function loadSession(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const row = await findSession(token);
    if (!row) {
      res.clearCookie(SESSION_COOKIE, cookieOptions());
      return next();
    }
    const user = { id: row.id, tipo: row.tipo, nome: row.nome, email: row.email, clienteId: row.cliente_id, roles: [], permissions: new Set() };
    if (row.tipo === 'equipe') Object.assign(user, await loadPermissions(row.id));
    req.user = user;
    req.sessionInfo = { id: row.sessao_id, csrf: row.csrf_token };
    return next();
  } catch (err) {
    return next(err);
  }
}

/** Exige o token CSRF (cabeçalho X-CSRF-Token) em requisições autenticadas que alteram estado. */
export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.sessionInfo) return next();
  const token = req.get('x-csrf-token');
  if (!token || !safeEqual(token, req.sessionInfo.csrf)) {
    return next(new AppError('Sessão expirada ou token de segurança inválido. Recarregue a página.', { status: 403, code: 'CSRF' }));
  }
  return next();
}

export function requireStaff(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.tipo !== 'equipe') return next(forbidden('Acesso restrito à equipe administrativa.'));
  return next();
}

export function requireCustomer(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.tipo !== 'cliente' || !req.user.clienteId) return next(forbidden('Acesso restrito a clientes.'));
  return next();
}

export const isAdmin = (user) => Boolean(user?.roles?.includes('administrador'));

export function can(user, permission) {
  if (!user || user.tipo !== 'equipe') return false;
  return isAdmin(user) || user.permissions.has(permission);
}

/** Exige ao menos uma das permissões informadas. */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (permissions.some((p) => can(req.user, p))) return next();
    return next(forbidden());
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(unauthorized());
  return isAdmin(req.user) ? next() : next(forbidden('Apenas administradores podem realizar esta ação.'));
}
