import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { securityHeaders, sameOriginGuard, apiLimiter } from './middlewares/security.js';
import { loadSession, csrfProtection } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminApi } from './routes/admin-api.js';
import { customerApi } from './routes/customer-api.js';
import { publicRouter, publicApi, webhookRouter } from './routes/public.js';
import { PUBLIC_DIR } from './services/storage/local.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const FRONTEND = path.join(ROOT, 'frontend', 'public');
const MODULES = path.join(ROOT, 'node_modules');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('query parser', 'extended');

  app.use(securityHeaders());

  // ---------------------------------------------------------- arquivos estáticos
  const staticOpts = { index: false, fallthrough: true, maxAge: env.isProduction ? '7d' : 0 };
  app.use('/assets', express.static(path.join(FRONTEND, 'assets'), staticOpts));
  app.use('/vendor/bootstrap', express.static(path.join(MODULES, 'bootstrap', 'dist'), staticOpts));
  app.use('/vendor/bootstrap-icons', express.static(path.join(MODULES, 'bootstrap-icons'), staticOpts));
  app.use('/vendor/chart.js', express.static(path.join(MODULES, 'chart.js', 'dist'), staticOpts));
  // Uploads públicos: somente imagens já validadas; nunca executáveis, sem listagem de diretório.
  app.use('/uploads', express.static(PUBLIC_DIR, {
    ...staticOpts,
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    }
  }));

  // ---------------------------------------------------------- corpo da requisição
  app.use(express.json({
    limit: '200kb',
    verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/pagamentos/webhook')) req.rawBody = buf.toString('utf8'); }
  }));
  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 200 }));
  app.use(cookieParser());

  app.get('/saude', (req, res) => res.json({ status: 'ok' }));

  app.use(sameOriginGuard);
  app.use(loadSession);

  // ---------------------------------------------------------- API
  app.use('/api/pagamentos/webhook', webhookRouter);
  app.use('/api', apiLimiter, (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api/publico', publicApi);
  app.use('/api/admin', adminApi);
  app.use('/api/cliente', customerApi);
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota da API não encontrada.', codigo: 'NAO_ENCONTRADO' }));

  // ---------------------------------------------------------- aplicações (SPA) do painel e da área do cliente
  const spa = (file) => (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(FRONTEND, file));
  };
  app.get(['/admin', '/admin/*rest'], spa('admin/index.html'));
  app.get(['/cliente', '/cliente/*rest'], spa('cliente/index.html'));

  // ---------------------------------------------------------- site público
  app.use(publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
