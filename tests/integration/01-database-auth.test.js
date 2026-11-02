import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

describe('inicialização do banco de dados', { skip }, () => {
  before(h.resetDatabase);
  after(h.closeDatabase);

  test('migrations criam as tabelas principais', async () => {
    const rows = await h.db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of ['usuarios', 'perfis', 'permissoes', 'produtos', 'orcamentos', 'pedidos', 'pagamentos', 'contratos', 'licencas', 'auditoria', 'schema_migrations']) {
      assert.ok(names.has(t), `tabela ${t} ausente`);
    }
  });

  test('dados iniciais: perfis, produtos demonstrativos e sem preços inventados', async () => {
    const perfis = await h.db.many('SELECT codigo FROM perfis ORDER BY codigo');
    assert.deepEqual(perfis.map((p) => p.codigo), ['administrador', 'consulta', 'editor_conteudo', 'gerente_comercial']);
    const produtos = await h.db.many('SELECT slug, dados_demonstrativos, preco, status_comercial FROM produtos ORDER BY ordem');
    assert.deepEqual(produtos.map((p) => p.slug), ['portal-de-noticias', 'churchflow', 'spacecontrol', 'fleetmanager', 'sistemas-personalizados']);
    assert.ok(produtos.every((p) => p.dados_demonstrativos && p.preco === null));
    const { n } = await h.db.one('SELECT count(*)::int n FROM clientes');
    assert.equal(n, 0, 'nenhum cliente fictício deve ser criado');
  });

  test('seeds são idempotentes', async () => {
    const { runSeeds } = await import('../../backend/src/database/seeder.js');
    await runSeeds({ log: () => {} });
    const { n } = await h.db.one('SELECT count(*)::int n FROM produtos');
    assert.equal(n, 5);
  });

  test('valores monetários usam NUMERIC', async () => {
    const r = await h.db.one("SELECT data_type FROM information_schema.columns WHERE table_name = 'pedidos' AND column_name = 'total'");
    assert.equal(r.data_type, 'numeric');
  });
});

describe('autenticação', { skip }, () => {
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    await h.createCustomer('cliente@teste.local');
  });
  after(h.closeDatabase);

  test('login válido cria sessão com cookie HttpOnly', async () => {
    const res = await h.anon().post('/api/auth/login').send({ email: 'admin@teste.local', senha: h.PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.csrf);
    const cookie = res.headers['set-cookie'].join(';');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.ok(!JSON.stringify(res.body).includes('senha_hash'));
  });

  test('login inválido retorna mensagem genérica (sem enumeração de contas)', async () => {
    const wrongPass = await h.anon().post('/api/auth/login').send({ email: 'admin@teste.local', senha: 'errada-123456' });
    const noUser = await h.anon().post('/api/auth/login').send({ email: 'ninguem@teste.local', senha: 'errada-123456' });
    assert.equal(wrongPass.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPass.body.erro, noUser.body.erro);
  });

  test('entradas inválidas no login retornam 422', async () => {
    const res = await h.anon().post('/api/auth/login').send({ email: 'não-é-email', senha: '' });
    assert.equal(res.status, 422);
    assert.ok(res.body.campos.email);
  });

  test('cliente não entra pela área administrativa', async () => {
    const res = await h.anon().post('/api/auth/login').send({ email: 'cliente@teste.local', senha: h.PASSWORD, area: 'admin' });
    assert.equal(res.status, 401);
    const ok = await h.anon().post('/api/auth/login').send({ email: 'cliente@teste.local', senha: h.PASSWORD, area: 'cliente' });
    assert.equal(ok.status, 200);
  });

  test('bloqueio temporário após tentativas repetidas', async () => {
    await h.createStaff('bloqueio@teste.local', 'consulta');
    for (let i = 0; i < 5; i++) await h.anon().post('/api/auth/login').send({ email: 'bloqueio@teste.local', senha: 'Errada-0000' });
    const res = await h.anon().post('/api/auth/login').send({ email: 'bloqueio@teste.local', senha: h.PASSWORD });
    assert.equal(res.status, 401, 'mesmo com a senha correta, a conta fica bloqueada');
    const u = await h.db.one("SELECT bloqueado_ate > now() AS bloqueado FROM usuarios WHERE email = 'bloqueio@teste.local'");
    assert.equal(u.bloqueado, true);
  });

  test('requisições autenticadas exigem token CSRF', async () => {
    const s = await h.loginAs('admin@teste.local');
    const semToken = await s.agent.post('/api/admin/categorias').send({ nome: 'Sem CSRF' });
    assert.equal(semToken.status, 403);
    assert.equal(semToken.body.codigo, 'CSRF');
    const comToken = await s.post('/api/admin/categorias', { nome: 'Com CSRF' });
    assert.equal(comToken.status, 201);
  });

  test('logout revoga a sessão', async () => {
    const s = await h.loginAs('admin@teste.local');
    assert.equal((await s.get('/api/auth/me')).status, 200);
    await s.post('/api/auth/logout', {});
    assert.equal((await s.get('/api/auth/me')).status, 401);
  });

  test('redefinição de senha: token de uso único e revogação de sessões', async () => {
    const s = await h.loginAs('admin@teste.local');
    const { createAccessToken } = await import('../../backend/src/modules/auth/auth.service.js');
    const user = await h.db.one("SELECT id FROM usuarios WHERE email = 'admin@teste.local'");
    const token = await createAccessToken(user.id, 'redefinir_senha');
    const fraca = await h.anon().post('/api/auth/redefinir-senha').send({ token, senha: 'fraca' });
    assert.equal(fraca.status, 422);
    const ok = await h.anon().post('/api/auth/redefinir-senha').send({ token, senha: 'Nova-Senha-2026' });
    assert.equal(ok.status, 200);
    const reuse = await h.anon().post('/api/auth/redefinir-senha').send({ token, senha: 'Outra-Senha-2026' });
    assert.equal(reuse.status, 400);
    assert.equal((await s.get('/api/auth/me')).status, 401, 'sessões antigas são encerradas');
    await h.loginAs('admin@teste.local', 'admin', 'Nova-Senha-2026');
  });

  test('esqueci minha senha responde igual para e-mail existente e inexistente', async () => {
    const a = await h.anon().post('/api/auth/esqueci-senha').send({ email: 'cliente@teste.local' });
    const b = await h.anon().post('/api/auth/esqueci-senha').send({ email: 'inexistente@teste.local' });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);
    const log = await h.db.one("SELECT status FROM emails_registro WHERE destinatario = 'cliente@teste.local' ORDER BY id DESC LIMIT 1");
    assert.equal(log.status, 'nao_configurado', 'sem SMTP, o envio é registrado como não realizado');
  });
});
