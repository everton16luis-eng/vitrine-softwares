// Rotação de chaves:
//   - KEK: acrescenta uma chave nova ao arquivo (a antiga continua lá para leitura), recifra tudo o
//     que a KEK protege (DEKs dos clientes, segredos da empresa, chaves privadas da central) numa
//     transação e só então permite aposentar as antigas — depois de conferir que nada mais as usa;
//   - DEK de um cliente: gera uma DEK nova e recifra todos os segredos daquele cliente.
import { readFileSync, writeFileSync, renameSync, chmodSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { Keyring } from '@central/security';
import type { Database } from '@central/database';
import { audit, SYSTEM } from '../audit.ts';
import { SecretStore } from '../secrets.ts';
import { KEY_CONTEXT } from '../keys.ts';

const SYSTEM_CTX: Record<string, string> = { ca: KEY_CONTEXT.ca, gateway_tls: KEY_CONTEXT.gatewayTls, task_signing: KEY_CONTEXT.taskSigning };
const keyIdOf = (token: string) => token.split('.')[1] ?? '';

function writeKekFile(file: string, lines: string[]) {
  const tmp = `${file}.novo`;
  if (existsSync(tmp)) { chmodSync(tmp, 0o600); rmSync(tmp); }
  writeFileSync(tmp, `# KEK da Central de Backup — a última linha é a atual. Guarde uma cópia FORA do servidor.\n${lines.join('\n')}\n`, { mode: 0o600 });
  // no Windows um arquivo somente leitura não pode ser substituído: libera, troca e trava de novo
  if (process.platform === 'win32' && existsSync(file)) chmodSync(file, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o400);
}
const kekLines = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** Quantos textos cifrados ainda usam cada identificador de KEK. */
export async function kekUsage(db: Database) {
  return db.system(async (tx) => {
    const tokens = [
      ...(await tx.many('SELECT dek_enc AS t FROM client_keys')),
      ...(await tx.many('SELECT ciphertext AS t FROM secrets WHERE client_id IS NULL')),
      ...(await tx.many('SELECT private_enc AS t FROM system_keys')),
      ...(await tx.many('SELECT totp_secret_enc AS t FROM users WHERE totp_secret_enc IS NOT NULL'))
    ];
    const usage: Record<string, number> = {};
    for (const r of tokens) { const id = keyIdOf(r.t); usage[id] = (usage[id] ?? 0) + 1; }
    return usage;
  });
}

export async function rotateKek(db: Database, kekFile: string, newLine = Keyring.generateLine(`k${Date.now().toString(36)}`)) {
  const lines = kekLines(kekFile);
  const newId = newLine.split(':')[0]!;
  if (lines.some((l) => l.split(':')[0] === newId)) throw new Error('Identificador de KEK repetido.');
  // cópia de segurança do arquivo antes de mexer (a rotação é reversível até aposentar)
  const backup = `${kekFile}.antes-${newId}`;
  if (!existsSync(backup)) copyFileSync(kekFile, backup);
  writeKekFile(kekFile, [...lines, newLine]);
  const keyring = Keyring.fromFile(kekFile);
  const store = new SecretStore(keyring);
  const out = await db.system(async (tx) => {
    const r = await store.rewrapAll(tx);
    let sys = 0;
    for (const k of await tx.many('SELECT name, private_enc FROM system_keys FOR UPDATE')) {
      const next = keyring.rewrap(k.private_enc, SYSTEM_CTX[k.name]!);
      if (next !== k.private_enc) { await tx.query('UPDATE system_keys SET private_enc = $2 WHERE name = $1', [k.name, next]); sys++; }
    }
    // segredos do 2FA dos usuários (contexto definido em modules/auth.ts)
    let totp = 0;
    for (const u of await tx.many('SELECT id, totp_secret_enc FROM users WHERE totp_secret_enc IS NOT NULL FOR UPDATE')) {
      const next = keyring.rewrap(u.totp_secret_enc, `users:totp:${u.id}`);
      if (next !== u.totp_secret_enc) { await tx.query('UPDATE users SET totp_secret_enc = $2 WHERE id = $1', [u.id, next]); totp++; }
    }
    await audit(tx, SYSTEM, { action: 'chaves.kek_rotacionar', entity: 'sistema', entityId: newId, details: { deks: r.deks, segredos_empresa: r.companySecrets, chaves_sistema: sys, totp } });
    return { ...r, systemKeys: sys, totp };
  });
  const usage = await kekUsage(db);
  return { newId, ...out, usage, backup };
}

/** Remove do arquivo as KEKs antigas — recusa se algum texto cifrado ainda depender delas. */
export async function retireOldKeks(db: Database, kekFile: string) {
  const lines = kekLines(kekFile);
  const current = lines.at(-1)!.split(':')[0]!;
  const usage = await kekUsage(db);
  const stale = Object.entries(usage).filter(([id, n]) => id !== current && n > 0);
  if (stale.length) throw new Error(`Ainda há dados cifrados com KEK antiga (${stale.map(([id, n]) => `${id}: ${n}`).join(', ')}): rode a rotação de novo.`);
  const removed = lines.slice(0, -1).map((l) => l.split(':')[0]!);
  writeKekFile(kekFile, [lines.at(-1)!]);
  await db.system((tx) => audit(tx, SYSTEM, { action: 'chaves.kek_aposentar', entity: 'sistema', entityId: current, details: { removidas: removed } }));
  return { current, removed };
}

export async function rotateClientKey(db: Database, keyring: Keyring, clientId: number) {
  const store = new SecretStore(keyring);
  return db.system(async (tx) => {
    const n = await store.rotateClientKey(tx, clientId);
    await audit(tx, SYSTEM, { action: 'chaves.dek_rotacionar', entity: 'cliente', entityId: clientId, clientId, details: { segredos: n } });
    return { secrets: n };
  });
}
