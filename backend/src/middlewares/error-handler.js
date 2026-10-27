import { env } from '../config/env.js';
import { AppError, fromPgError } from '../utils/errors.js';
import { renderErrorPage } from '../views/errors.js';

const wantsJson = (req) => req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';

export function notFoundHandler(req, res) {
  if (wantsJson(req)) return res.status(404).json({ erro: 'Recurso não encontrado.', codigo: 'NAO_ENCONTRADO' });
  return renderErrorPage(req, res, 404);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let error = err;
  if (err?.type === 'entity.parse.failed') error = new AppError('JSON inválido na requisição.', { status: 400, code: 'JSON_INVALIDO' });
  if (err?.type === 'entity.too.large') error = new AppError('Requisição muito grande.', { status: 413, code: 'MUITO_GRANDE' });
  if (err?.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo acima do tamanho máximo permitido.' : 'Envio de arquivo inválido.';
    error = new AppError(msg, { status: 400, code: 'UPLOAD' });
  }
  if (!(error instanceof AppError)) error = fromPgError(err) || error;

  const status = error instanceof AppError ? error.status : 500;
  if (status >= 500 && !(error instanceof AppError)) {
    // Registra o erro sem dados do corpo da requisição (podem conter senhas).
    console.error(`[erro] ${req.method} ${req.originalUrl} ->`, env.isProduction ? err.message : err);
  }
  if (res.headersSent) return undefined;

  if (wantsJson(req)) {
    const body = { erro: status >= 500 ? 'Erro interno. Tente novamente mais tarde.' : error.message, codigo: error.code || 'ERRO_INTERNO' };
    if (status < 500 && error.details) body.campos = error.details;
    return res.status(status).json(body);
  }
  return renderErrorPage(req, res, status === 404 ? 404 : status >= 500 ? 500 : status, status < 500 ? error.message : undefined);
}
