import { runSeeds } from '../seeder.js';
import { closePool } from '../pool.js';

try {
  await runSeeds();
  console.log('[seed] dados iniciais aplicados. Crie o primeiro administrador com: npm run admin:create');
} catch (err) {
  console.error(`[seed] falhou: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
