// Preparação da central (idempotente): KEK, migrations, perfis, CA interna, certificado do gateway
// e chave de assinatura de tarefas. Pode rodar de novo a cada atualização.
import { Database, migrate, seed } from '@central/database';
import { loadConfig, loadDotEnv } from '../config.ts';
import { ensureKekFile, loadKeyring, initSystemKeys } from '../keys.ts';

loadDotEnv();
const config = loadConfig();
const db = new Database({ connectionString: config.databaseUrl, appRole: null });
try {
  const kek = ensureKekFile(config.kekFile);
  if (kek.created) console.log(`KEK criada em ${config.kekFile} (faça backup deste arquivo FORA do servidor — sem ele os segredos não podem ser lidos).`);
  await migrate(db);
  await seed(db);
  const app = new Database({ connectionString: config.databaseUrl, appRole: config.dbAppRole });
  try {
    await initSystemKeys(app, loadKeyring(config), config, (m) => console.log(m));
  } finally { await app.close(); }
  console.log('Central preparada.');
} catch (err) {
  console.error(`Falha: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
