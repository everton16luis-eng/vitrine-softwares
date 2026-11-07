import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carrega central-backup/.env, se existir (variáveis já definidas no ambiente têm prioridade). */
export function loadEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
