// Operações da própria central (rodar no servidor da central, como o usuário do serviço):
//   npm run central -- backup                                  backup do banco da central agora
//   npm run central -- kit criar --saida kit.txt               kit de recuperação cifrado
//   npm run central -- kit abrir --arquivo kit.txt [--extrair-kek .data/kek] [--extrair-senha .data/self-backup.pw]
//   npm run central -- chaves uso                              quantos dados cada KEK protege
//   npm run central -- chaves rotacionar-kek                   KEK nova + recifra tudo
//   npm run central -- chaves aposentar-kek                    remove KEKs que nada mais usa
//   npm run central -- chaves rotacionar-cliente --cliente 12  DEK nova para um cliente
// A frase-senha do kit vem do terminal (sem eco) ou de KIT_PASSPHRASE_FILE — nunca de argumento.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Database } from '@central/database';
import { certFingerprint } from '@central/security';
import { loadConfig, loadDotEnv } from '../config.ts';
import { loadKeyring } from '../keys.ts';
import { runSelfBackup, selfBackupPassword } from '../system/selfbackup.ts';
import { sealKit, openKit, passphraseProblem } from '../system/kit.ts';
import { kekUsage, rotateKek, retireOldKeks, rotateClientKey } from '../system/rotation.ts';
import { safeRepo } from '../modules/system.ts';

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Sem terminal interativo: use KIT_PASSPHRASE_FILE.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(value); }
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1); else value += c;
      }
    };
    stdin.on('data', onData);
  });
}
async function passphrase(confirm: boolean) {
  if (process.env.KIT_PASSPHRASE_FILE) return readFileSync(process.env.KIT_PASSPHRASE_FILE, 'utf8').replace(/\r?\n$/, '');
  const p = await readHidden('Frase-senha do kit: ');
  if (confirm) {
    const problem = passphraseProblem(p);
    if (problem) throw new Error(problem);
    if (await readHidden('Repita a frase-senha: ') !== p) throw new Error('As frases não conferem.');
  }
  return p;
}
function writeSecretFile(dest: string, content: string) {
  if (existsSync(dest)) throw new Error(`${dest} já existe: não sobrescrevo chaves.`);
  writeFileSync(dest, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o400 });
  try { chmodSync(dest, 0o400); } catch { /* Windows */ }
}

loadDotEnv();
const [cmd, sub, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { saida: { type: 'string' }, arquivo: { type: 'string' }, 'extrair-kek': { type: 'string' }, 'extrair-senha': { type: 'string' }, cliente: { type: 'string' } }, allowPositionals: true });
const config = loadConfig();

async function main() {
  if (cmd === 'kit' && sub === 'abrir') {
    if (!values.arquivo) throw new Error('Informe --arquivo.');
    const k = openKit(readFileSync(values.arquivo, 'utf8'), await passphrase(false));
    console.log(`Kit de ${k.created_at} — banco "${k.database_name}", gateway ${k.gateway.public_url} (CA ${k.gateway.ca_sha256 ?? '?'}).`);
    console.log(`Backup da central: ${k.self_backup ? safeRepo(k.self_backup.repository) : 'não configurado'}. KEKs no kit: ${k.kek.split('\n').filter((l) => l.includes(':')).map((l) => l.split(':')[0]).join(', ')}.`);
    if (values['extrair-kek']) { writeSecretFile(values['extrair-kek'], k.kek); console.log(`KEK gravada em ${values['extrair-kek']} (0400).`); }
    if (values['extrair-senha'] && k.self_backup) { writeSecretFile(values['extrair-senha'], k.self_backup.password); console.log(`Senha do repositório gravada em ${values['extrair-senha']} (0400).`); }
    if (k.self_backup) console.log(`Repositório (com credencial) para restaurar: defina SELF_BACKUP_REPOSITORY no .env a partir do kit (não exibido aqui).`);
    return;
  }
  const db = new Database({ connectionString: config.databaseUrl, appRole: config.dbAppRole });
  try {
    if (cmd === 'backup') {
      const r = await runSelfBackup(db, config, 'manual');
      console.log(JSON.stringify(r));
      if (r.status !== 'validado') process.exitCode = 1;
    } else if (cmd === 'kit' && sub === 'criar') {
      if (!values.saida) throw new Error('Informe --saida.');
      if (existsSync(values.saida)) throw new Error(`${values.saida} já existe.`);
      const ca = path.join(config.gatewayDir, 'ca.pem');
      const text = sealKit({
        created_at: new Date().toISOString(),
        kek: readFileSync(config.kekFile, 'utf8'),
        self_backup: config.selfBackup.repository ? { repository: config.selfBackup.repository, password: selfBackupPassword(config) } : null,
        database_name: new URL(config.databaseUrl).pathname.slice(1),
        gateway: { public_url: config.gateway.publicUrl, ca_sha256: existsSync(ca) ? certFingerprint(readFileSync(ca, 'utf8')) : null },
        notes: 'Restauração: docs/central-backup/fase-8.md, seção "Reerguer a central".'
      }, await passphrase(true));
      writeFileSync(values.saida, text, { mode: 0o600 });
      console.log(`Kit gravado em ${values.saida}. Guarde FORA deste servidor e apague a cópia local. Gere um novo kit após cada rotação de KEK.`);
    } else if (cmd === 'chaves' && sub === 'uso') {
      console.log(JSON.stringify({ atual: loadKeyring(config).currentId, uso: await kekUsage(db) }));
    } else if (cmd === 'chaves' && sub === 'rotacionar-kek') {
      const r = await rotateKek(db, config.kekFile);
      console.log(JSON.stringify(r));
      console.log('Reinicie painel, gateway e worker para carregar a KEK nova; depois gere um kit novo e rode "chaves aposentar-kek".');
    } else if (cmd === 'chaves' && sub === 'aposentar-kek') {
      console.log(JSON.stringify(await retireOldKeks(db, config.kekFile)));
    } else if (cmd === 'chaves' && sub === 'rotacionar-cliente') {
      const id = Number(values.cliente);
      if (!Number.isInteger(id) || id < 1) throw new Error('Informe --cliente <id>.');
      console.log(JSON.stringify(await rotateClientKey(db, loadKeyring(config), id)));
    } else {
      console.log('Comandos: backup | kit criar|abrir | chaves uso|rotacionar-kek|aposentar-kek|rotacionar-cliente');
      process.exitCode = 2;
    }
  } finally { await db.close(); }
}
main().catch((err) => { console.error(`Erro: ${(err as Error).message}`); process.exit(1); });
