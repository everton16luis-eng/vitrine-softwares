// Ponto de entrada: node apps/api/src/main.ts <panel|gateway|worker>
// Cada modo é um processo separado (systemd/PM2); o gateway não carrega a KEK.
import { Database } from '@central/database';
import { loadConfig, loadDotEnv } from './config.ts';
import { loadKeyring, loadGatewayMaterial } from './keys.ts';
import { buildPanel } from './panel.ts';
import { buildGateway } from './gateway/app.ts';
import { startWorker } from './worker.ts';

const mode = process.argv[2];
if (!['panel', 'gateway', 'worker'].includes(mode ?? '')) {
  console.error('Uso: node apps/api/src/main.ts <panel|gateway|worker>');
  process.exit(2);
}

loadDotEnv();
const config = loadConfig();
const db = new Database({ connectionString: config.databaseUrl, appRole: config.dbAppRole, max: mode === 'worker' ? 3 : 10 });
let shutdown: () => Promise<void>;

if (mode === 'panel') {
  const app = await buildPanel({ db, config, keyring: loadKeyring(config) });
  await app.listen({ host: config.panel.host, port: config.panel.port });
  console.log(`Painel em http://${config.panel.host}:${config.panel.port}`);
  shutdown = () => app.close();
} else if (mode === 'gateway') {
  const app = await buildGateway({ db, config, material: loadGatewayMaterial(config), logger: config.env !== 'test' });
  await app.listen({ host: config.gateway.host, port: config.gateway.port });
  console.log(`Gateway dos agentes em https://${config.gateway.host}:${config.gateway.port}`);
  shutdown = () => app.close();
} else {
  const w = startWorker(db, config, { keyring: loadKeyring(config) });
  console.log('Worker iniciado.');
  shutdown = () => w.stop();
}

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    try { await shutdown(); } finally { await db.close(); process.exit(0); }
  });
}
