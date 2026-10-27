// Arquitetura para gateways de pagamento (Mercado Pago, Stripe).
// IMPORTANTE: nenhum pagamento é simulado. Sem credenciais no .env, os webhooks
// respondem 503 e nada é confirmado. A confirmação só ocorre com assinatura válida
// e, quando o provedor exige, após consulta à API oficial.
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { db, withTransaction } from '../../database/pool.js';
import { safeEqual } from '../../utils/common.js';
import { AppError } from '../../utils/errors.js';
import { refreshPaymentStatus } from '../orders/orders.service.js';

/**
 * Stripe: cabeçalho "Stripe-Signature: t=...,v1=..." com HMAC-SHA256 de `${t}.${corpoBruto}`.
 * Documentação: https://docs.stripe.com/webhooks#verify-manually
 */
export function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const received = String(header).split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  return received.some((sig) => safeEqual(sig, expected));
}

/**
 * Mercado Pago: cabeçalho "x-signature: ts=...,v1=..." com HMAC-SHA256 do manifesto
 * `id:${data.id};request-id:${x-request-id};ts:${ts};`.
 * Documentação: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
export function verifyMercadoPagoSignature({ signature, requestId, dataId }, secret) {
  if (!signature || !secret || !dataId) return false;
  const parts = Object.fromEntries(String(signature).split(',').map((kv) => kv.trim().split('=')).filter((p) => p.length === 2));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId || ''};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return safeEqual(parts.v1, expected);
}

const providers = {
  stripe: {
    configured: () => Boolean(env.payments.stripeSecretKey && env.payments.stripeWebhookSecret),
    verify: (req) => verifyStripeSignature(req.rawBody || '', req.get('stripe-signature'), env.payments.stripeWebhookSecret),
    parse: (req) => {
      const evt = req.body || {};
      const obj = evt.data?.object || {};
      return {
        eventId: evt.id, type: evt.type,
        // Confirma apenas pagamentos previamente criados no sistema com este identificador.
        confirm: evt.type === 'payment_intent.succeeded' ? { reference: obj.id } : null,
        fail: evt.type === 'payment_intent.payment_failed' ? { reference: obj.id } : null
      };
    }
  },
  mercadopago: {
    configured: () => Boolean(env.payments.mercadopagoAccessToken && env.payments.mercadopagoWebhookSecret),
    verify: (req) => verifyMercadoPagoSignature({
      signature: req.get('x-signature'), requestId: req.get('x-request-id'), dataId: req.query['data.id'] || req.body?.data?.id
    }, env.payments.mercadopagoWebhookSecret),
    parse: (req) => ({
      eventId: `${req.body?.type || 'evento'}:${req.body?.data?.id}:${req.get('x-request-id') || ''}`,
      type: req.body?.type,
      // O Mercado Pago envia apenas o ID: o status real deve ser consultado em GET /v1/payments/{id}.
      // Essa consulta faz parte da integração futura e não é simulada aqui.
      confirm: null,
      fail: null,
      pendingLookup: req.body?.type === 'payment' ? String(req.body?.data?.id || '') : null
    })
  }
};

export async function handleWebhook(providerName, req) {
  const provider = providers[providerName];
  if (!provider) throw new AppError('Provedor desconhecido.', { status: 404, code: 'NAO_ENCONTRADO' });
  if (!provider.configured()) throw new AppError('Integração de pagamento não configurada.', { status: 503, code: 'INTEGRACAO_INDISPONIVEL' });

  const valid = provider.verify(req);
  const evt = provider.parse(req);
  if (!evt.eventId) throw new AppError('Evento inválido.', { status: 400, code: 'EVENTO_INVALIDO' });

  // Idempotência: cada evento é registrado uma única vez.
  const inserted = await db.one(
    `INSERT INTO eventos_pagamento (provedor, evento_id, tipo, assinatura_valida, payload) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provedor, evento_id) DO NOTHING RETURNING id`,
    [providerName, String(evt.eventId).slice(0, 120), evt.type ? String(evt.type).slice(0, 80) : null, valid, JSON.stringify(req.body || {})]);
  if (!valid) throw new AppError('Assinatura inválida.', { status: 401, code: 'ASSINATURA_INVALIDA' });
  if (!inserted) return { recebido: true, duplicado: true };

  const action = evt.confirm || evt.fail;
  if (action?.reference) {
    await withTransaction(async (tx) => {
      const p = await tx.one("SELECT * FROM pagamentos WHERE provedor = $1 AND referencia_externa = $2 AND status = 'pendente' FOR UPDATE", [providerName, action.reference]);
      if (!p) return;
      const status = evt.confirm ? 'confirmado' : 'falhou';
      await tx.query("UPDATE pagamentos SET status = $2::varchar, confirmado_em = CASE WHEN $2::varchar = 'confirmado' THEN now() END WHERE id = $1", [p.id, status]);
      await tx.query('INSERT INTO pedido_historico (pedido_id, descricao) VALUES ($1,$2)', [p.pedido_id, `Pagamento #${p.id} ${status} via ${providerName} (notificação validada).`]);
      await refreshPaymentStatus(tx, p.pedido_id);
    });
  }
  await db.query('UPDATE eventos_pagamento SET processado_em = now() WHERE id = $1', [inserted.id]);
  return { recebido: true, consulta_pendente: Boolean(evt.pendingLookup) };
}
