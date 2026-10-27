import { runMigrations } from '../migrator.js';
import { closePool } from '../pool.js';

try {
  await runMigrations();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
