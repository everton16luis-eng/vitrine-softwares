import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'upgrade-insecure-requests': env.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });
}

/**
 * Rejeita requisições que alteram estado vindas de outra origem (defesa
 * adicional ao SameSite e ao token CSRF). Requisições sem Origin/Referer
 * (ex.: clientes de API, testes) passam para a verificação de CSRF.
 */
export function sameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/pagamentos/webhook')) return next(); // provedores externos; validados por assinatura
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  let origin;
  try { origin = new URL(source).origin; } catch { return next(new AppError('Origem inválida.', { status: 403, code: 'ORIGEM' })); }
  const allowed = new Set([new URL(env.appUrl).origin, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) return next(new AppError('Origem não autorizada.', { status: 403, code: 'ORIGEM' }));
  return next();
}

const limiterMessage = (msg) => ({ erro: msg, codigo: 'LIMITE_REQUISICOES' });

function limiter({ windowMinutes, max, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Em testes automatizados os limites seriam atingidos pelo volume de casos.
    skip: () => env.isTest && process.env.TEST_RATE_LIMIT !== '1',
    handler: (req, res) => res.status(429).json(limiterMessage(message))
  });
}

export const loginLimiter = limiter({ windowMinutes: 15, max: 10, message: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.' });
export const formLimiter = limiter({ windowMinutes: 10, max: 6, message: 'Muitos envios em sequência. Aguarde alguns minutos e tente novamente.' });
export const passwordResetLimiter = limiter({ windowMinutes: 30, max: 5, message: 'Muitas solicitações. Aguarde e tente novamente.' });
export const apiLimiter = limiter({ windowMinutes: 1, max: 300, message: 'Muitas requisições. Aguarde um momento.' });
