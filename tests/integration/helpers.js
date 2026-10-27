// Utilitários dos testes de integração. Usam o banco DATABASE_URL_TEST, que é
// APAGADO e recriado a cada arquivo de teste — por segurança, o nome do banco
// precisa terminar com "_test".
process.env.NODE_ENV = 'test';

const { env } = await import('../../backend/src/config/env.js');
const pool = await import('../../backend/src/database/pool.js');
const { runMigrations } = await import('../../backend/src/database/migrator.js');
const { runSeeds } = await import('../../backend/src/database/seeder.js');
const { createApp } = await import('../../backend/src/app.js');
const { hashPassword } = await import('../../backend/src/modules/auth/password.js');
const { issueFormToken } = await import('../../backend/src/modules/leads/form-token.js');
const { invalidateSettings } = await import('../../backend/src/modules/settings/settings.service.js');
const supertest = (await import('supertest')).default;

export const db = pool.db;
export const PASSWORD = 'Senha-de-Teste-2026';

export function hasTestDatabase() {
  return Boolean(env.databaseUrl);
}

export async function resetDatabase() {
  const name = new URL(env.databaseUrl).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Recusado: o banco de testes deve terminar com "_test" (atual: "${name}").`);
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await runMigrations({ log: () => {} });
  await runSeeds({ log: () => {} });
  invalidateSettings();
}

export const closeDatabase = () => pool.closePool();
export const app = () => createApp();

export async function createStaff(email, roleCodigo = 'administrador', { nome = 'Usuário de Teste', password = PASSWORD } = {}) {
  const u = await db.one("INSERT INTO usuarios (tipo, nome, email, senha_hash) VALUES ('equipe', $1, $2, $3) RETURNING id", [nome, email, await hashPassword(password)]);
  await db.query('INSERT INTO usuarios_perfis (usuario_id, perfil_id) SELECT $1, id FROM perfis WHERE codigo = $2', [u.id, roleCodigo]);
  return u.id;
}

export async function createCustomer(email, { nome = 'Cliente de Teste', withAccount = true, password = PASSWORD } = {}) {
  const c = await db.one('INSERT INTO clientes (nome, email) VALUES ($1, $2) RETURNING id', [nome, email]);
  let userId = null;
  if (withAccount) {
    userId = (await db.one("INSERT INTO usuarios (tipo, nome, email, senha_hash, cliente_id) VALUES ('cliente', $1, $2, $3, $4) RETURNING id",
      [nome, email, await hashPassword(password), c.id])).id;
  }
  return { clienteId: c.id, userId };
}

/** Cria um agente HTTP autenticado. Retorna { agent, csrf, req(method, path) } com o cabeçalho CSRF aplicado. */
export async function loginAs(email, area = 'admin', password = PASSWORD) {
  const agent = supertest.agent(createApp());
  const res = await agent.post('/api/auth/login').send({ email, senha: password, area });
  if (res.status !== 200) throw new Error(`Falha no login de ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrf;
  const req = (method, path) => agent[method](path).set('X-CSRF-Token', csrf);
  return { agent, csrf, req, get: (p) => agent.get(p), post: (p, b) => req('post', p).send(b), put: (p, b) => req('put', p).send(b), del: (p) => req('delete', p) };
}

export const anon = () => supertest(createApp());
export const formToken = () => issueFormToken(Date.now() - 5000);
