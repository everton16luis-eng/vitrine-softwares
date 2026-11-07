// Só para desenvolvimento local: imprime o código TOTP atual do usuário de teste (.data/dev-admin.totp).
import { readFileSync } from 'node:fs';
import { totpCode } from '@central/security';

console.log(totpCode(readFileSync(process.argv[2] ?? '.data/dev-admin.totp', 'utf8').trim()));
