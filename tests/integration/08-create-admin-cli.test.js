import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';
const run = promisify(execFile);
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/src/database/cli/create-admin.js');

function createAdmin(email) {
  const env = { ...process.env, NODE_ENV: 'test', ADMIN_NAME: 'Primeiro Admin', ADMIN_EMAIL: email, ADMIN_PASSWORD: h.PASSWORD };
  return run(process.execPath, [CLI], { env }).then((r) => ({ code: 0, ...r }), (err) => ({ code: err.code, stdout: err.stdout, stderr: err.stderr }));
}

describe('criação do primeiro administrador (npm run admin:create)', { skip }, () => {
  before(h.resetDatabase);
  after(h.closeDatabase);

  test('cria o administrador, registra auditoria e permite login', async () => {
    const r = await createAdmin('primeiro@teste.local');
    assert.equal(r.code, 0, r.stderr);
    const u = await h.db.one(
      `SELECT u.id, p.codigo FROM usuarios u JOIN usuarios_perfis up ON up.usuario_id = u.id JOIN perfis p ON p.id = up.perfil_id
        WHERE u.email = 'primeiro@teste.local'`);
    assert.equal(u.codigo, 'administrador');
    const a = await h.db.one("SELECT entidade_id FROM auditoria WHERE acao = 'criar_primeiro_admin'");
    assert.equal(a.entidade_id, String(u.id));
    await h.loginAs('primeiro@teste.local');
  });

  test('recusa criar um segundo administrador pela linha de comando', async () => {
    const r = await createAdmin('segundo@teste.local');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Já existe um administrador ativo/);
    assert.equal(await h.db.one("SELECT id FROM usuarios WHERE email = 'segundo@teste.local'"), null);
  });
});
