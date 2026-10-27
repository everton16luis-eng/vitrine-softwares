import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, QUOTE_TRANSITIONS } from '../../backend/src/modules/quotes/quotes.service.js';
import { canOrderTransition, derivePaymentStatus } from '../../backend/src/modules/orders/orders.service.js';

describe('fluxo de orçamentos', () => {
  test('transições permitidas', () => {
    assert.ok(canTransition('novo', 'em_analise'));
    assert.ok(canTransition('em_elaboracao', 'enviado'));
    assert.ok(canTransition('enviado', 'aceito'));
    assert.ok(canTransition('expirado', 'em_elaboracao'));
  });
  test('transições proibidas', () => {
    assert.equal(canTransition('novo', 'aceito'), false);
    assert.equal(canTransition('aceito', 'cancelado'), false);
    assert.equal(canTransition('recusado', 'enviado'), false);
  });
  test('estados finais não têm saída', () => {
    for (const s of ['aceito', 'recusado', 'cancelado']) assert.deepEqual(QUOTE_TRANSITIONS[s], []);
  });
});

describe('fluxo de pedidos e pagamentos', () => {
  test('transições de pedido', () => {
    assert.ok(canOrderTransition('rascunho', 'aguardando_pagamento'));
    assert.equal(canOrderTransition('rascunho', 'concluido'), false);
    assert.equal(canOrderTransition('concluido', 'cancelado'), false);
  });
  test('pedido sem pagamentos confirmados nunca é "pago"', () => {
    assert.equal(derivePaymentStatus(10000n, []), 'pendente');
    assert.equal(derivePaymentStatus(10000n, [{ valor: '100.00', status: 'pendente' }]), 'pendente');
  });
  test('situação derivada dos pagamentos confirmados', () => {
    assert.equal(derivePaymentStatus(10000n, [{ valor: '40.00', status: 'confirmado' }]), 'parcial');
    assert.equal(derivePaymentStatus(10000n, [{ valor: '40.00', status: 'confirmado' }, { valor: '60.00', status: 'confirmado' }]), 'pago');
    assert.equal(derivePaymentStatus(10000n, [{ valor: '100.00', status: 'estornado' }]), 'estornado');
  });
});
