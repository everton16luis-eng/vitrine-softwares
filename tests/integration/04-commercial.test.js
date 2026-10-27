import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

const contato = (extra = {}) => ({
  tipo: 'contato', nome: 'Maria Teste', email: 'maria@teste.local', telefone: '(11) 98888-7777', mensagem: 'Gostaria de conhecer melhor os sistemas.',
  consentimento: true, form_token: h.formToken(), ...extra
});

describe('contatos, leads e orçamentos', { skip }, () => {
  let admin;
  let quoteId;
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    admin = await h.loginAs('admin@teste.local');
  });
  after(h.closeDatabase);

  test('formulário de contato grava contato, lead e notificação', async () => {
    const res = await h.anon().post('/api/publico/contato').send(contato());
    assert.equal(res.status, 201);
    const lead = await h.db.one("SELECT * FROM leads WHERE email = 'maria@teste.local'");
    assert.equal(lead.status, 'novo');
    const c = await h.db.one('SELECT * FROM contatos WHERE lead_id = $1', [lead.id]);
    assert.ok(c.consentimento_em);
    assert.equal(c.aceita_comunicacoes, false, 'consentimento opcional não é marcado por padrão');
    assert.ok(c.ip_hash && c.ip_hash.length === 64, 'IP armazenado apenas como hash');
    const n = await h.db.one("SELECT count(*)::int n FROM notificacoes WHERE tipo = 'contato'");
    assert.equal(n.n, 1);
  });

  test('envio pelo formulário HTML (sem JavaScript) também funciona', async () => {
    const res = await h.anon().post('/contato').type('form').send({ ...contato({ email: 'semjs@teste.local' }), consentimento: 'true' });
    assert.equal(res.status, 200);
    assert.match(res.text, /Mensagem recebida/);
  });

  test('validações: campos inválidos, consentimento, anti-spam', async () => {
    const invalid = await h.anon().post('/api/publico/contato').send(contato({ nome: '', email: 'x', mensagem: 'curta' }));
    assert.equal(invalid.status, 422);
    assert.ok(invalid.body.campos.nome && invalid.body.campos.email && invalid.body.campos.mensagem);
    const noConsent = await h.anon().post('/api/publico/contato').send(contato({ consentimento: false }));
    assert.equal(noConsent.status, 422);
    assert.ok(noConsent.body.campos.consentimento);
    const { issueFormToken } = await import('../../backend/src/modules/leads/form-token.js');
    const fast = await h.anon().post('/api/publico/contato').send(contato({ form_token: issueFormToken() }));
    assert.equal(fast.status, 400);
    const before = await h.db.one('SELECT count(*)::int n FROM contatos');
    const bot = await h.anon().post('/api/publico/contato').send(contato({ website: 'http://spam.example' }));
    assert.equal(bot.status, 201);
    const afterCount = await h.db.one('SELECT count(*)::int n FROM contatos');
    assert.equal(afterCount.n, before.n, 'honeypot: nada é gravado');
  });

  test('solicitação de orçamento abre orçamento vinculado ao produto', async () => {
    const res = await h.anon().post('/api/publico/contato').send(contato({ tipo: 'orcamento', produto: 'spacecontrol', email: 'joao@teste.local', nome: 'João Teste' }));
    assert.equal(res.status, 201);
    assert.match(res.body.protocolo, /^ORC-\d{4}-\d{4}$/);
    const q = await h.db.one('SELECT o.*, p.slug FROM orcamentos o JOIN produtos p ON p.id = o.produto_id WHERE o.numero = $1', [res.body.protocolo]);
    assert.equal(q.status, 'novo');
    assert.equal(q.slug, 'spacecontrol');
    quoteId = q.id;
    const mail = await h.db.one("SELECT status FROM emails_registro WHERE modelo = 'confirmacao_orcamento' ORDER BY id DESC LIMIT 1");
    assert.equal(mail.status, 'nao_configurado');
  });

  test('levantamento de requisitos (desenvolvimento personalizado) é armazenado', async () => {
    const res = await h.anon().post('/api/publico/contato').send(contato({ tipo: 'personalizado', email: 'ana@teste.local', requisitos: { segmento: 'Logística', plataformas: ['web', 'api'], prazo: '3_6_meses' } }));
    assert.equal(res.status, 201);
    const c = await h.db.one("SELECT dados_extras FROM contatos WHERE email = 'ana@teste.local'");
    assert.deepEqual(c.dados_extras.plataformas, ['web', 'api']);
  });

  test('acompanhamento do orçamento: transições, itens e histórico', async () => {
    const invalid = await admin.post(`/api/admin/orcamentos/${quoteId}/status`, { status: 'aceito' });
    assert.equal(invalid.status, 409, 'novo -> aceito não é permitido');
    assert.equal((await admin.post(`/api/admin/orcamentos/${quoteId}/status`, { status: 'em_elaboracao' })).status, 200);
    const semItens = await admin.post(`/api/admin/orcamentos/${quoteId}/status`, { status: 'enviado' });
    assert.equal(semItens.status, 409);
    const validade = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const upd = await admin.put(`/api/admin/orcamentos/${quoteId}`, {
      validade, condicoes_comerciais: 'Pagamento em 2x.',
      itens: [{ descricao: 'Licença SpaceControl', quantidade: 3, preco_unitario: '33,33' }, { descricao: 'Implantação', quantidade: 1, preco_unitario: '500.00', desconto: '50' }],
      desconto: '9.99'
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.subtotal, '549.99');
    assert.equal(upd.body.total, '540.00');
    const sent = await admin.post(`/api/admin/orcamentos/${quoteId}/status`, { status: 'enviado' });
    assert.equal(sent.status, 200);
    assert.ok(sent.body.enviado_em);
    const locked = await admin.put(`/api/admin/orcamentos/${quoteId}`, { itens: [] });
    assert.equal(locked.status, 409, 'valores ficam bloqueados após o envio');
    const notes = await admin.put(`/api/admin/orcamentos/${quoteId}`, { observacoes_internas: 'Cliente pediu desconto.' });
    assert.equal(notes.status, 200);
    const accepted = await admin.post(`/api/admin/orcamentos/${quoteId}/status`, { status: 'aceito' });
    assert.equal(accepted.body.status, 'aceito');
    assert.ok(accepted.body.historico.length >= 4);
    const doc = await admin.get(`/api/admin/orcamentos/${quoteId}/documento`);
    assert.equal(doc.status, 200);
    assert.match(doc.text, /R\$ 540,00/);
  });

  test('gerar pedido a partir do orçamento aceito converte o lead e não marca como pago', async () => {
    const r = await admin.post(`/api/admin/orcamentos/${quoteId}/gerar-pedido`, {});
    assert.equal(r.status, 201);
    const order = (await admin.get(`/api/admin/pedidos/${r.body.pedido_id}`)).body;
    assert.equal(order.status, 'rascunho');
    assert.equal(order.status_pagamento, 'pendente');
    assert.equal(order.total, '540.00');
    assert.equal(order.itens.length, 2);
    const lead = await h.db.one("SELECT status, cliente_id FROM leads WHERE email = 'joao@teste.local'");
    assert.equal(lead.status, 'convertido');
    assert.ok(lead.cliente_id);
    assert.equal((await admin.post(`/api/admin/orcamentos/${quoteId}/gerar-pedido`, {})).status, 409, 'não gera pedido duplicado');
  });

  test('lead: atualização, interação, conversão e exportação auditada', async () => {
    const lead = await h.db.one("SELECT id FROM leads WHERE email = 'maria@teste.local'");
    assert.equal((await admin.put(`/api/admin/leads/${lead.id}`, { status: 'em_atendimento' })).status, 200);
    assert.equal((await admin.post(`/api/admin/leads/${lead.id}/interacoes`, { tipo: 'ligacao', descricao: 'Retornou a ligação.' })).status, 201);
    const conv = await admin.post(`/api/admin/leads/${lead.id}/converter`, {});
    assert.equal(conv.status, 200);
    assert.equal(conv.body.cliente.email, 'maria@teste.local');
    const detail = await admin.get(`/api/admin/leads/${lead.id}`);
    assert.ok(detail.body.interacoes.some((i) => i.tipo === 'conversao'));
    assert.ok(!('ip_hash' in detail.body.contatos[0]));
    const csv = await admin.get('/api/admin/leads/exportar.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    const audit = await h.db.one("SELECT count(*)::int n FROM auditoria WHERE acao = 'exportar' AND entidade = 'leads'");
    assert.equal(audit.n, 1);
  });

  test('busca e filtros de leads', async () => {
    const r = await admin.get('/api/admin/leads?status=convertido');
    assert.ok(r.body.items.every((l) => l.status === 'convertido'));
    const s = await admin.get('/api/admin/leads?busca=ana@');
    assert.equal(s.body.total, 1);
  });
});
