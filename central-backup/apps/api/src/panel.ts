// API do painel (/api/v1). Escuta só em 127.0.0.1: o acesso externo passa pelo Nginx (HTTPS).
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import type { Keyring } from '@central/security';
import type { Database } from '@central/database';
import type { Config } from './config.ts';
import { errorHandler } from './http/errors.ts';
import { sessionHook, requireAuth } from './http/auth.ts';
import { webHandler } from './http/web.ts';
import { authRoutes } from './modules/auth.ts';
import { recordRoutes } from './modules/records.ts';
import { agentRoutes } from './modules/agents.ts';
import { userRoutes } from './modules/users.ts';
import { catalogRoutes } from './modules/catalog.ts';
import { storageRoutes } from './modules/storage.ts';
import { backupRoutes } from './modules/backups.ts';
import { restoreRoutes } from './modules/restores.ts';
import { monitoringRoutes } from './modules/monitoring.ts';
import { alertRoutes } from './modules/alerts.ts';
import { drRoutes } from './modules/dr.ts';
import { pgbackrestRoutes } from './modules/pgbackrest.ts';
import { systemRoutes } from './modules/system.ts';
import { SecretStore } from './secrets.ts';
import { loadTaskSigner } from './keys.ts';
import type { TaskSigner } from './tasks/service.ts';

export async function buildPanel(deps: { db: Database; config: Config; keyring: Keyring; logger?: boolean }): Promise<FastifyInstance> {
  const { db, config, keyring } = deps;
  const app = Fastify({
    logger: deps.logger === false ? false : { level: config.env === 'production' ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'] },
    trustProxy: config.panel.trustProxy,
    bodyLimit: 1024 * 1024,
    // campos desconhecidos são recusados (não removidos em silêncio)
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: true } }
  });
  app.setErrorHandler(errorHandler);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: { info: { title: 'Central de Backup — API do painel', version: '0.1.0' }, servers: [{ url: '/' }] }
  });

  // sessão e autorização rodam antes da validação: sem permissão, a resposta é 401/403 e não revela o formato da rota
  app.addHook('preValidation', sessionHook(db, config));

  let signer: TaskSigner | null = null;
  const getSigner = async () => (signer ??= await loadTaskSigner(db, keyring));

  await authRoutes(app, { db, config, keyring });
  await recordRoutes(app, { db });
  await agentRoutes(app, { db, config, signer: getSigner });
  await userRoutes(app, { db });
  const store = new SecretStore(keyring);
  await catalogRoutes(app, { db, store, signer: getSigner });
  await storageRoutes(app, { db, store, config });
  await backupRoutes(app, { db, store, config, signer: getSigner });
  await restoreRoutes(app, { db, store, config, signer: getSigner });
  await monitoringRoutes(app, { db, config });
  await alertRoutes(app, { db, store, config });
  await drRoutes(app, { db, config });
  await pgbackrestRoutes(app, { db, deps: { store, signer: getSigner } });
  await systemRoutes(app, { db, config });

  app.get('/api/v1/health', async () => {
    await db.system((tx) => tx.one('SELECT 1'));
    return { ok: true };
  });
  app.get('/api/v1/openapi.json', { preValidation: requireAuth(), schema: { hide: true } }, async () => app.swagger());

  // painel web (build do apps/web): qualquer GET fora de /api cai aqui
  const web = webHandler(config.panel.webDist);
  app.setNotFoundHandler((req, reply) => {
    if (web.serve(req, reply)) return;
    return reply.code(404).type('application/problem+json').send({ type: 'about:blank', title: 'Rota não encontrada.', status: 404, code: 'NAO_ENCONTRADO' });
  });
  return app;
}
