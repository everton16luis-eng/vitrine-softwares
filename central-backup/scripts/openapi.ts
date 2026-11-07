// Gera o OpenAPI do painel (sem subir servidor nem tocar no banco): npm run openapi -- saida.json
import { writeFileSync } from 'node:fs';
import { Database } from '@central/database';
import { Keyring } from '@central/security';
import { loadConfig, loadDotEnv } from '../apps/api/src/config.ts';
import { buildPanel } from '../apps/api/src/panel.ts';

loadDotEnv();
const config = loadConfig();
const db = new Database({ connectionString: config.databaseUrl, appRole: config.dbAppRole, max: 1 });
const app = await buildPanel({ db, config, keyring: new Keyring({ x: Buffer.alloc(32) }, 'x'), logger: false });
await app.ready();
const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, JSON.stringify(app.swagger(), null, 1));
await app.close(); await db.close();
console.log(`OpenAPI gravado em ${out}`);
