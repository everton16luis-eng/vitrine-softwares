import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withTransaction } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEEDS_DIR = path.resolve(here, '../../../database/seeds');

/** Executa todos os seeds (idempotentes) em ordem alfabética, numa única transação. */
export async function runSeeds({ log = console.log } = {}) {
  const files = (await readdir(SEEDS_DIR)).filter((f) => /^\d+-[\w-]+\.js$/.test(f)).sort();
  await withTransaction(async (tx) => {
    for (const file of files) {
      const mod = await import(pathToFileURL(path.join(SEEDS_DIR, file)).href);
      await mod.seed(tx);
      log(`[seed] ${file}`);
    }
  });
}
