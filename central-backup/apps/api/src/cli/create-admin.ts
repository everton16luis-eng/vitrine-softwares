// Cria o primeiro administrador (ou outro, se necessário). A senha é lida do terminal sem eco,
// ou de ADMIN_PASSWORD_FILE (arquivo, nunca argumento de linha de comando, que vaza no histórico).
// Uso: npm run admin:create -- --email admin@empresa.com.br --name "Nome"
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Database } from '@central/database';
import { hashPassword, passwordProblem } from '@central/security';
import { loadConfig, loadDotEnv } from '../config.ts';
import { audit } from '../audit.ts';

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Sem terminal interativo: use ADMIN_PASSWORD_FILE.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
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

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || name.length < 2) {
  console.error('Uso: npm run admin:create -- --email admin@empresa.com.br --name "Nome Completo"');
  process.exit(2);
}

loadDotEnv();
const config = loadConfig();
const db = new Database({ connectionString: config.databaseUrl, appRole: config.dbAppRole });
try {
  let password: string;
  if (process.env.ADMIN_PASSWORD_FILE) {
    password = readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  } else {
    password = await readHidden('Senha (mín. 12 caracteres): ');
    if ((await readHidden('Repita a senha: ')) !== password) throw new Error('As senhas não conferem.');
  }
  const problem = passwordProblem(password, { email });
  if (problem) throw new Error(problem);
  const hash = await hashPassword(password);
  await db.system(async (tx) => {
    const exists = await tx.one('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists) throw new Error('Já existe um usuário com este e-mail.');
    const role = await tx.one("SELECT id FROM roles WHERE code = 'admin'");
    if (!role) throw new Error('Perfis não encontrados: execute "npm run ca:init" antes.');
    const u = await tx.one('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, name, hash]);
    await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [u!.id, role.id]);
    await audit(tx, { type: 'sistema' }, { action: 'usuario.criar', entity: 'usuario', entityId: u!.id, details: { email, perfis: ['admin'], origem: 'cli' } });
  });
  console.log(`Administrador ${email} criado. No primeiro login será pedido o cadastro do 2FA (aplicativo autenticador).`);
} catch (err) {
  console.error(`Falha: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
