import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

describe('área do cliente e isolamento de dados', { skip }, () => {
  let admin;
  let a;
  let b;
  const ids = {};
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    admin = await h.loginAs('admin@teste.local');
    ids.A = (await h.createCustomer('a@teste.local', { nome: 'Cliente A' })).clienteId;
    ids.B = (await h.createCustomer('b@teste.local', { nome: 'Cliente B' })).clienteId;
    for (const who of ['A', 'B']) {
      const o = await admin.post('/api/admin/pedidos', { cliente_id: ids[who], itens: [{ descricao: `Item ${who}`, quantidade: 1, preco_unitario: '100' }] });
      await admin.post(`/api/admin/pedidos/${o.body.id}/status`, { status: 'aguardando_pagamento' });
      ids[`pedido${who}`] = o.body.id;
      const q = await admin.post('/api/admin/orcamentos', { titulo: `Orçamento ${who}`, cliente_id: ids[who], itens: [{ descricao: 'Serviço', quantidade: 1, preco_unitario: '200' }] });
      await admin.post(`/api/admin/orcamentos/${q.body.id}/status`, { status: 'enviado' });
      ids[`orc${who}`] = q.body.id;
      const ct = await admin.post('/api/admin/contratos', { cliente_id: ids[who], titulo: `Contrato ${who}`, status: 'vigente' });
      ids[`ct${who}`] = ct.body.id;
    }
    a = await h.loginAs('a@teste.local', 'cliente');
    b = await h.loginAs('b@teste.local', 'cliente');
  });
  after(h.closeDatabase);

  test('cada cliente vê somente os próprios pedidos', async () => {
    const la = await a.get('/api/cliente/pedidos');
    assert.deepEqual(la.body.map((o) => o.id), [ids.pedidoA]);
    assert.equal((await a.get(`/api/cliente/pedidos/${ids.pedidoA}`)).status, 200);
    assert.equal((await a.get(`/api/cliente/pedidos/${ids.pedidoB}`)).status, 404, 'alterar o ID na URL não expõe dados de outro cliente');
  });

  test('orçamentos, contratos e documentos isolados', async () => {
    assert.equal((await a.get(`/api/cliente/orcamentos/${ids.orcB}`)).status, 404);
    assert.equal((await a.get(`/api/cliente/orcamentos/${ids.orcB}/documento`)).status, 404);
    assert.equal((await a.post(`/api/cliente/orcamentos/${ids.orcB}/resposta`, { resposta: 'aceitar' })).status, 404);
    const contratos = await a.get('/api/cliente/contratos');
    assert.deepEqual(contratos.body.map((c) => c.id), [ids.ctA]);
    assert.equal((await a.get(`/api/cliente/contratos/${ids.ctB}/arquivo`)).status, 404);
  });

  test('dados internos do orçamento não são expostos ao cliente', async () => {
    await admin.put(`/api/admin/orcamentos/${ids.orcA}`, { observacoes_internas: 'Margem mínima 20%' });
    const r = await a.get(`/api/cliente/orcamentos/${ids.orcA}`);
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('Margem mínima'));
    assert.ok(!('historico' in r.body));
  });

  test('cliente responde ao próprio orçamento', async () => {
    const r = await a.post(`/api/cliente/orcamentos/${ids.orcA}/resposta`, { resposta: 'aceitar' });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'aceito');
    assert.equal((await a.post(`/api/cliente/orcamentos/${ids.orcA}/resposta`, { resposta: 'recusar' })).status, 409);
    const st = await h.db.one('SELECT status FROM orcamentos WHERE id = $1', [ids.orcB]);
    assert.equal(st.status, 'enviado', 'orçamento do outro cliente não foi alterado');
  });

  test('parâmetros extras não trocam o cliente da sessão', async () => {
    const r = await a.put('/api/cliente/perfil', { nome: 'Cliente A Atualizado', cliente_id: ids.B, email: 'roubo@teste.local' });
    assert.equal(r.status, 200);
    const cb = await h.db.one('SELECT nome, email FROM clientes WHERE id = $1', [ids.B]);
    assert.equal(cb.nome, 'Cliente B');
    const ca = await h.db.one('SELECT email FROM clientes WHERE id = $1', [ids.A]);
    assert.equal(ca.email, 'a@teste.local', 'e-mail não é alterável pelo cliente');
    const t = await b.post('/api/cliente/chamados', { assunto: 'Ajuda', mensagem: 'Preciso de ajuda com o sistema.', cliente_id: ids.A });
    assert.equal(t.status, 201);
    const owner = await h.db.one('SELECT cliente_id FROM chamados WHERE id = $1', [t.body.id]);
    assert.equal(owner.cliente_id, ids.B);
    assert.equal((await a.get('/api/cliente/chamados')).body.length, 0);
  });

  test('rascunhos não aparecem para o cliente; equipe não usa a API do cliente', async () => {
    await admin.post('/api/admin/pedidos', { cliente_id: ids.A, itens: [{ descricao: 'Rascunho', quantidade: 1, preco_unitario: '1' }] });
    assert.equal((await a.get('/api/cliente/pedidos')).body.length, 1);
    assert.equal((await admin.get('/api/cliente/pedidos')).status, 403);
    assert.equal((await h.anon().get('/api/cliente/pedidos')).status, 401);
  });

  test('acesso desativado encerra sessões', async () => {
    await admin.del(`/api/admin/clientes/${ids.B}/acesso`);
    assert.equal((await b.get('/api/cliente/pedidos')).status, 401);
  });

  test('anonimização LGPD remove dados pessoais e preserva registros comerciais', async () => {
    const r = await admin.post(`/api/admin/clientes/${ids.B}/anonimizar`, {});
    assert.equal(r.status, 200);
    const c = await h.db.one('SELECT nome, email, telefone, anonimizado_em FROM clientes WHERE id = $1', [ids.B]);
    assert.match(c.nome, /anonimizado/);
    assert.match(c.email, /anonimizado\.invalid$/);
    assert.ok(c.anonimizado_em);
    const { n } = await h.db.one('SELECT count(*)::int n FROM pedidos WHERE cliente_id = $1', [ids.B]);
    assert.equal(n, 1);
  });
});
