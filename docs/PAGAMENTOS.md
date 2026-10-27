# Pagamentos

## O que existe hoje

- **Pedidos, pagamentos e contratos são registros separados.**
- **Pagamentos manuais:** a equipe registra valores recebidos fora do sistema (PIX, transferência, boleto emitido no banco). Um pagamento pode ser registrado como *pendente de conferência* e confirmado depois, por quem tem a permissão `pagamentos.confirmar`. Confirmações registram quem confirmou e quando.
- **Situação de pagamento derivada:** calculada somente a partir dos pagamentos confirmados (`pendente`, `parcial`, `pago`, `estornado`). Criar um pedido nunca o torna pago. O total confirmado não pode ultrapassar o total do pedido.
- **Estornos** recalculam a situação; pedidos com pagamentos confirmados não podem ser cancelados sem estorno.
- **Nenhuma cobrança online é simulada.**

## Arquitetura para gateways

Arquivo: `backend/src/modules/payments/gateways.js`.

1. Rota `POST /api/pagamentos/webhook/:provedor` (fora da verificação de CSRF/origem, pois vem do provedor; o corpo bruto é preservado para validar a assinatura).
2. Se as credenciais não estão no ambiente → `503 Integração de pagamento não configurada`.
3. Verificação da assinatura:
   - **Stripe:** cabeçalho `Stripe-Signature` (`t=...,v1=...`), HMAC-SHA256 de `t.corpo` com `STRIPE_WEBHOOK_SECRET`, tolerância de 5 minutos.
   - **Mercado Pago:** cabeçalho `x-signature` (`ts=...,v1=...`), HMAC-SHA256 do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com `MERCADOPAGO_WEBHOOK_SECRET`.
4. Registro do evento em `eventos_pagamento` (único por provedor + id do evento → idempotência). Assinatura inválida é registrada e rejeitada com `401`.
5. Processamento: confirma (ou marca como falho) **apenas** um pagamento *pendente* previamente criado no sistema com `provedor` e `referencia_externa` correspondentes; em seguida recalcula a situação do pedido.

## O que falta implementar para cobrar online

1. **Criação da cobrança:** endpoint que, a partir de um pedido em `aguardando_pagamento`, cria a cobrança no provedor (Checkout Session/PaymentIntent no Stripe; Preference ou Payment no Mercado Pago) e grava um registro em `pagamentos` com `status='pendente'`, `provedor` e `referencia_externa` = ID retornado.
2. **Mercado Pago:** o webhook envia apenas o ID; antes de confirmar, consulte `GET https://api.mercadopago.com/v1/payments/{id}` com `MERCADOPAGO_ACCESS_TOKEN` e use o status oficial (`approved`). Esse passo está sinalizado no código (`pendingLookup`).
3. **Página de retorno** para o cliente (sucesso/pendente/falha) — sempre informativa; a confirmação real vem do webhook.
4. **Testes em sandbox** do provedor e configuração da URL do webhook no painel do provedor: `https://seu-dominio/api/pagamentos/webhook/stripe` ou `.../mercadopago`.

## Variáveis de ambiente

```
PAYMENT_PROVIDER=stripe            # ou mercadopago
STRIPE_SECRET_KEY=sk_live_...      # nunca no frontend
STRIPE_WEBHOOK_SECRET=whsec_...
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
MERCADOPAGO_WEBHOOK_SECRET=...
```

Use as chaves de teste (sandbox) até validar o fluxo completo. Nunca coloque essas chaves em `configuracoes`, no repositório ou no JavaScript do navegador.
