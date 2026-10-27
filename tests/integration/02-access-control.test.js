import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

describe('controle de acesso e permissões', { skip }, () => {
  let admin;
  let editor;
  let consulta;
  let gerente;
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local', 'administrador', { nome: 'Admin' });
    await h.createStaff('editor@teste.local', 'editor_conteudo');
    await h.createStaff('consulta@teste.local', 'consulta');
    await h.createStaff('gerente@teste.local', 'gerente_comercial');
    await h.createCustomer('cliente@teste.local');
    admin = await h.loginAs('admin@teste.local');
    editor = await h.loginAs('editor@teste.local');
    consulta = await h.loginAs('consulta@teste.local');
    gerente = await h.loginAs('gerente@teste.local');
  });
  after(h.closeDatabase);

  test('rotas administrativas bloqueiam acesso sem autenticação', async () => {
    for (const path of ['/api/admin/dashboard', '/api/admin/produtos', '/api/admin/leads', '/api/admin/usuarios', '/api/admin/configuracoes']) {
      assert.equal((await h.anon().get(path)).status, 401, path);
    }
  });

  test('cliente autenticado não acessa a API administrativa', async () => {
    const c = await h.loginAs('cliente@teste.local', 'cliente');
    assert.equal((await c.get('/api/admin/produtos')).status, 403);
  });

  test('editor de conteúdo: gerencia categorias, mas não leads, pedidos ou usuários', async () => {
    assert.equal((await editor.post('/api/admin/categorias', { nome: 'Categoria do editor' })).status, 201);
    assert.equal((await editor.get('/api/admin/leads')).status, 403);
    assert.equal((await editor.get('/api/admin/pedidos')).status, 403);
    assert.equal((await editor.post('/api/admin/usuarios', { nome: 'X', email: 'x@teste.local', perfis: [1] })).status, 403);
  });

  test('perfil consulta é somente leitura', async () => {
    assert.equal((await consulta.get('/api/admin/produtos')).status, 200);
    const p = await consulta.post('/api/admin/produtos', { nome: 'Tentativa', categoria_id: 1, resumo: 'Resumo de tentativa indevida' });
    assert.equal(p.status, 403);
    assert.equal((await consulta.get('/api/admin/clientes')).status, 403);
  });

  test('gerente comercial não gerencia usuários nem configurações', async () => {
    assert.equal((await gerente.get('/api/admin/usuarios')).status, 403);
    assert.equal((await gerente.put('/api/admin/configuracoes', { nome_comercial: 'Hack' })).status, 403);
    assert.equal((await gerente.get('/api/admin/leads')).status, 200);
  });

  test('não é possível conceder permissões exclusivas de administrador a outros perfis', async () => {
    const role = await h.db.one("SELECT id FROM perfis WHERE codigo = 'editor_conteudo'");
    const res = await admin.put(`/api/admin/perfis/${role.id}/permissoes`, { permissoes: ['conteudo.ver', 'usuarios.editar'] });
    assert.equal(res.status, 403);
    const consultaRole = await h.db.one("SELECT id FROM perfis WHERE codigo = 'consulta'");
    const res2 = await admin.put(`/api/admin/perfis/${consultaRole.id}/permissoes`, { permissoes: ['produtos.ver', 'produtos.editar'] });
    assert.equal(res2.status, 422, 'perfil consulta aceita apenas leitura');
  });

  test('campos extras na requisição não promovem privilégios (atribuição em massa)', async () => {
    const res = await admin.post('/api/admin/usuarios', { nome: 'Novo', email: 'novo@teste.local', perfis: [(await h.db.one("SELECT id FROM perfis WHERE codigo='consulta'")).id], tipo: 'cliente', senha_hash: 'x', cliente_id: 1 });
    assert.equal(res.status, 201);
    const u = await h.db.one("SELECT tipo, senha_hash, cliente_id FROM usuarios WHERE email = 'novo@teste.local'");
    assert.deepEqual(u, { tipo: 'equipe', senha_hash: null, cliente_id: null });
    assert.ok(res.body.link_acesso, 'sem SMTP, o link de convite é exibido ao administrador');
  });

  test('o último administrador não pode ser desativado nem desativar a si mesmo', async () => {
    const me = await h.db.one("SELECT id FROM usuarios WHERE email = 'admin@teste.local'");
    const res = await admin.put(`/api/admin/usuarios/${me.id}`, { ativo: false });
    assert.equal(res.status, 409);
  });

  test('permissões alteradas passam a valer imediatamente no servidor', async () => {
    const role = await h.db.one("SELECT id FROM perfis WHERE codigo = 'consulta'");
    await admin.put(`/api/admin/perfis/${role.id}/permissoes`, { permissoes: ['dashboard.ver'] });
    assert.equal((await consulta.get('/api/admin/produtos')).status, 403);
  });

  test('ações administrativas são auditadas sem dados sensíveis', async () => {
    const rows = await h.db.many("SELECT acao, detalhes::text FROM auditoria WHERE entidade = 'usuario'");
    assert.ok(rows.some((r) => r.acao === 'criar'));
    assert.ok(rows.every((r) => !r.detalhes.includes('senha_hash":"x')));
  });
});
