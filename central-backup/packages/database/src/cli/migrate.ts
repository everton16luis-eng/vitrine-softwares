import { Database, migrate, seed } from '../index.ts';
import { loadEnv } from './env.ts';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL não configurado (veja .env.example).'); process.exit(1); }
const db = new Database({ connectionString: url, appRole: null });
try {
  const applied = await migrate(db);
  if (!applied.length) console.log('Banco já está atualizado.');
  await seed(db);
  console.log('Perfis e permissões conferidos.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}
