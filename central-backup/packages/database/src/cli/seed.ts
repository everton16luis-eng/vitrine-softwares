import { Database, seed } from '../index.ts';
import { loadEnv } from './env.ts';

loadEnv();
const db = new Database({ connectionString: process.env.DATABASE_URL ?? '', appRole: null });
try { await seed(db); console.log('Perfis e permissões conferidos.'); } finally { await db.close(); }
