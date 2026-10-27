import { env, assertRuntimeConfig } from './config/env.js';
import { createApp } from './app.js';
import { closePool, query } from './database/pool.js';
import { purgeExpiredSessions } from './modules/auth/session.service.js';
import { expireOverdueQuotes } from './modules/quotes/quotes.service.js';
import { isEmailConfigured } from './services/email.js';

try {
  assertRuntimeConfig();
  await query('SELECT 1 FROM schema_migrations LIMIT 1');
} catch (err) {
  if (err.code === '42P01') console.error('[inicialização] Banco sem estrutura. Execute: npm run db:migrate && npm run db:seed');
  else console.error(`[inicialização] ${err.message}`);
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[servidor] ${env.appUrl} (${env.nodeEnv})`);
  console.log(`[servidor] painel administrativo: ${env.appUrl}/admin`);
  if (!isEmailConfigured()) console.warn('[servidor] E-mail NÃO configurado: mensagens serão registradas como "não enviadas".');
});

// Rotinas de manutenção (a cada hora)
const maintenance = setInterval(async () => {
  try {
    await purgeExpiredSessions();
    await expireOverdueQuotes();
  } catch (err) {
    console.error('[manutenção]', err.message);
  }
}, 60 * 60 * 1000);
maintenance.unref();

async function shutdown(signal) {
  console.log(`[servidor] ${signal} recebido, encerrando…`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
