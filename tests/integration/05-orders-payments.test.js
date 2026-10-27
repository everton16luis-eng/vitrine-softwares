import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

describe('pedidos, cálculos e pagamentos', { skip }, () => {
  let admin;
  let semDesconto;
  let clienteId;
  let orderId;
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    // Perfil personalizado: pode editar pedidos mas não autorizar descontos.
    const role = await h.db.one("INSERT INTO perfis (codigo, nome) VALUES ('vendedor', 'Vendedor') RETURNING id");
    await h.db.query("INSERT INTO perfis_permissoes (perfil_id, permissao_id) SELECT $1, id FROM permissoes WHERE codigo IN ('pedidos.ver','pedidos.editar','pagamentos.registrar')", [role.id]);
    await h.createStaff('vendedor@teste.local', 'vendedor');
    clienteId = (await h.createCustomer('cliente@teste.local', { withAccount: false })).clienteId;
    admin = await h.loginAs('admin@teste.local');
    semDesconto = await h.loginAs('vendedor@teste.local');
  });
  after(h.closeDatabase);

  const itens = [
    { descricao: 'Licença anual', quantidade: 3, preco_unitario: '1199.90', desconto: '0' },
    { descricao: 'Treinamento', quantidade: 2, preco_unitario: '450.05', desconto: '0.10' }
  ];

  test('calcula totais com precisão decimal', async () => {
    const r = await admin.post('/api/admin/pedidos', { cliente_id: clienteId, itens, desconto: '100.00' });
    assert.equal(r.status, 201);
    assert.equal(r.body.subtotal, '4499.70'); // 3599.70 + 900.00
    assert.equal(r.body.total, '4399.70');
    assert.equal(r.body.itens[1].total, '900.00');
    assert.equal(r.body.status, 'rascunho');
    assert.equal(r.body.status_pagamento, 'pendente');
    assert.match(r.body.numero, /^PED-\d{4}-\d{4}$/);
    orderId = r.body.id;
  });

  test('rejeita descontos inválidos, quantidade zero e itens vazios', async () => {
    assert.equal((await admin.post('/api/admin/pedidos', { cliente_id: clienteId, itens, desconto: '999999' })).status, 422);
    assert.equal((await admin.post('/api/admin/pedidos', { cliente_id: clienteId, itens: [{ ...itens[0], quantidade: 0 }] })).status, 422);
    assert.equal((await admin.post('/api/admin/pedidos', { cliente_id: clienteId, itens: [] })).status, 422);
    assert.equal((await admin.post('/api/admin/pedidos', { cliente_id: clienteId, itens: [{ ...itens[0], preco_unitario: '-5' }] })).status, 422);
  });

  test('desconto exige permissão específica', async () => {
    const r = await semDesconto.post('/api/admin/pedidos', { cliente_id: clienteId, itens, desconto: '10' });
    assert.equal(r.status, 403);
    const ok = await semDesconto.post('/api/admin/pedidos', { cliente_id: clienteId, itens: [itens[0]] });
    assert.equal(ok.status, 201);
  });

  test('pagamento não pode ser registrado em rascunho', async () => {
    const r = await admin.post(`/api/admin/pedidos/${orderId}/pagamentos`, { valor: '10', metodo: 'pix' });
    assert.equal(r.status, 409);
  });

  test('máquina de estados do pedido', async () => {
    assert.equal((await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'concluido' })).status, 409);
    const r = await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'aguardando_pagamento' });
    assert.equal(r.body.status, 'aguardando_pagamento');
    const edit = await admin.put(`/api/admin/pedidos/${orderId}`, { itens: [itens[0]] });
    assert.equal(edit.status, 409, 'itens bloqueados após sair do rascunho');
  });

  test('pagamentos parciais, totais, limite e estorno', async () => {
    const p1 = await admin.post(`/api/admin/pedidos/${orderId}/pagamentos`, { valor: '1000.00', metodo: 'pix', confirmar: true, referencia_externa: 'E123' });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.status_pagamento, 'parcial');
    assert.equal(p1.body.total_pago, '1000.00');
    const pend = await admin.post(`/api/admin/pedidos/${orderId}/pagamentos`, { valor: '3399.70', metodo: 'transferencia' });
    assert.equal(pend.body.status_pagamento, 'parcial', 'pagamento pendente não conta como pago');
    const excesso = await admin.post(`/api/admin/pedidos/${orderId}/pagamentos`, { valor: '0.01', metodo: 'pix' });
    assert.equal(excesso.status, 409, 'não ultrapassa o total do pedido');
    const pendingId = pend.body.pagamentos.find((p) => p.status === 'pendente').id;
    const vendedorConfirm = await semDesconto.post(`/api/admin/pagamentos/${pendingId}/confirmar`, {});
    assert.equal(vendedorConfirm.status, 403, 'confirmar pagamento exige permissão');
    const conf = await admin.post(`/api/admin/pagamentos/${pendingId}/confirmar`, {});
    assert.equal(conf.body.status_pagamento, 'pago');
    assert.equal(conf.body.saldo, '0.00');
    const mail = await h.db.one("SELECT status FROM emails_registro WHERE modelo = 'pagamento_confirmado' ORDER BY id DESC LIMIT 1");
    assert.equal(mail.status, 'nao_configurado');
    const est = await admin.post(`/api/admin/pagamentos/${p1.body.pagamentos[0].id}/estornar`, {});
    assert.equal(est.body.status_pagamento, 'parcial');
  });

  test('concluir exige pagamento integral; cancelar exige estorno dos confirmados', async () => {
    await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'em_andamento' });
    assert.equal((await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'concluido' })).status, 409);
    assert.equal((await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'cancelado' })).status, 409);
    const novo = await admin.post(`/api/admin/pedidos/${orderId}/pagamentos`, { valor: '1000.00', metodo: 'pix', confirmar: true });
    assert.equal(novo.body.status_pagamento, 'pago');
    const done = await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'concluido' });
    assert.equal(done.body.status, 'concluido');
    assert.ok(done.body.concluido_em);
    assert.equal((await admin.post(`/api/admin/pedidos/${orderId}/status`, { status: 'cancelado' })).status, 409, 'estado final');
  });

  test('webhooks de gateway sem integração configurada não confirmam nada', async () => {
    const r = await h.anon().post('/api/pagamentos/webhook/stripe').send({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    assert.equal(r.status, 503);
    const { n } = await h.db.one("SELECT count(*)::int n FROM pagamentos WHERE provedor <> 'manual'");
    assert.equal(n, 0);
  });

  test('contratos e licenças vinculados ao cliente correto', async () => {
    const outro = (await h.createCustomer('outro@teste.local', { withAccount: false })).clienteId;
    const bad = await admin.post('/api/admin/contratos', { cliente_id: outro, pedido_id: orderId, titulo: 'Contrato inválido' });
    assert.equal(bad.status, 422, 'pedido de outro cliente');
    const ok = await admin.post('/api/admin/contratos', { cliente_id: clienteId, pedido_id: orderId, titulo: 'Contrato de licenciamento', status: 'vigente', data_inicio: '2026-01-01', data_fim: '2026-12-31', valor: '4399.70' });
    assert.equal(ok.status, 201);
    assert.match(ok.body.numero, /^CTR-/);
    const datas = await admin.post('/api/admin/contratos', { cliente_id: clienteId, titulo: 'Datas invertidas', data_inicio: '2026-05-01', data_fim: '2026-01-01' });
    assert.equal(datas.status, 422);
    const lic = await admin.post('/api/admin/licencas', { cliente_id: clienteId, produto_id: 1, contrato_id: ok.body.id, tipo: 'assinatura', data_inicio: '2026-01-01' });
    assert.equal(lic.status, 422, 'assinatura exige término');
    const lic2 = await admin.post('/api/admin/licencas', { cliente_id: clienteId, produto_id: 1, contrato_id: ok.body.id, tipo: 'perpetua', data_inicio: '2026-01-01' });
    assert.equal(lic2.status, 201);
    assert.match(lic2.body.identificador, /^LIC-[0-9A-F]{10}$/);
  });

  test('relatórios e dashboard calculados a partir do banco', async () => {
    const d = await admin.get('/api/admin/dashboard');
    assert.equal(d.status, 200);
    assert.equal(d.body.receita.total, '4399.70'); // o pagamento estornado não entra: 3399,70 + 1000,00
    const vendas = await admin.get('/api/admin/relatorios/vendas');
    assert.equal(vendas.body.linhas.length, 2);
    const csv = await admin.get('/api/admin/relatorios/pedidos.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.text, /PED-/);
    assert.equal((await admin.get('/api/admin/relatorios/inexistente')).status, 422);
  });
});
