// API da área do cliente: /api/cliente/*
// O identificador do cliente vem SEMPRE da sessão (req.user.clienteId), nunca da URL ou do corpo.
// Toda consulta filtra por cliente_id: alterar IDs na URL resulta em 404.
import { Router } from 'express';
import { requireCustomer } from '../middlewares/auth.js';
import { db } from '../database/pool.js';
import { v, parse, parseId } from '../utils/validation.js';
import { notFound } from '../utils/errors.js';
import { streamPrivateFile } from '../modules/media/media.service.js';
import { respondAsCustomer, getQuote } from '../modules/quotes/quotes.service.js';
import { openTicket, listCustomerTickets } from '../modules/support/support.service.js';
import { getSettings } from '../modules/settings/settings.service.js';
import { renderQuoteDocument } from '../views/quote-document.js';
import { formLimiter } from '../middlewares/security.js';

export const customerApi = Router();
customerApi.use(requireCustomer);

const cid = (req) => req.user.clienteId;

customerApi.get('/perfil', async (req, res) => {
  const c = await db.one('SELECT nome, email, telefone, empresa, criado_em FROM clientes WHERE id = $1', [cid(req)]);
  res.json(c);
});

// Somente campos de contato podem ser alterados pelo cliente; e-mail e documento exigem atendimento.
customerApi.put('/perfil', async (req, res) => {
  const value = parse({ nome: v.string({ min: 2, max: 160 }), telefone: v.phone({ nullable: true }), empresa: v.string({ max: 160, nullable: true }) }, req.body, { partial: true });
  const keys = Object.keys(value);
  if (keys.length) await db.query(`UPDATE clientes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [cid(req), ...keys.map((k) => value[k])]);
  if (value.nome) await db.query('UPDATE usuarios SET nome = $2 WHERE id = $1', [req.user.id, value.nome]);
  res.json(await db.one('SELECT nome, email, telefone, empresa FROM clientes WHERE id = $1', [cid(req)]));
});

customerApi.get('/resumo', async (req, res) => {
  res.json(await db.one(
    `SELECT (SELECT count(*)::int FROM pedidos WHERE cliente_id = $1) pedidos,
            (SELECT count(*)::int FROM orcamentos WHERE cliente_id = $1 AND status IN ('enviado','aguardando_resposta')) orcamentos_aguardando,
            (SELECT count(*)::int FROM licencas WHERE cliente_id = $1 AND status = 'ativa') licencas_ativas,
            (SELECT count(*)::int FROM chamados WHERE cliente_id = $1 AND status <> 'fechado') chamados_abertos`, [cid(req)]));
});

customerApi.get('/pedidos', async (req, res) => {
  res.json(await db.many(
    `SELECT id, numero, status, status_pagamento, total, moeda, data_pedido, data_vencimento FROM pedidos
      WHERE cliente_id = $1 AND status <> 'rascunho' ORDER BY criado_em DESC`, [cid(req)]));
});

customerApi.get('/pedidos/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const order = await db.one(
    `SELECT id, numero, status, status_pagamento, forma_pagamento, subtotal, desconto, total, moeda, data_pedido, data_vencimento, concluido_em
       FROM pedidos WHERE id = $1 AND cliente_id = $2 AND status <> 'rascunho'`, [id, cid(req)]);
  if (!order) throw notFound('Pedido');
  order.itens = await db.many('SELECT descricao, quantidade, preco_unitario, desconto, total FROM pedido_itens WHERE pedido_id = $1 ORDER BY ordem', [id]);
  order.pagamentos = await db.many("SELECT valor, metodo, status, confirmado_em, criado_em FROM pagamentos WHERE pedido_id = $1 AND status <> 'cancelado' ORDER BY criado_em", [id]);
  res.json(order);
});

const VISIBLE_QUOTES = "status IN ('enviado','aguardando_resposta','aceito','recusado','expirado')";

customerApi.get('/orcamentos', async (req, res) => {
  res.json(await db.many(`SELECT id, numero, titulo, status, total, moeda, validade, enviado_em FROM orcamentos WHERE cliente_id = $1 AND ${VISIBLE_QUOTES} ORDER BY criado_em DESC`, [cid(req)]));
});

async function ownQuote(req) {
  const id = parseId(req.params.id);
  const ok = await db.one(`SELECT id FROM orcamentos WHERE id = $1 AND cliente_id = $2 AND ${VISIBLE_QUOTES}`, [id, cid(req)]);
  if (!ok) throw notFound('Orçamento');
  const q = await getQuote(id);
  // Remove dados internos antes de devolver ao cliente.
  const { observacoes_internas, historico, responsavel_id, responsavel_nome, lead_id, contato_id, transicoes, editavel, requisitos, ...pub } = q;
  return pub;
}

customerApi.get('/orcamentos/:id', async (req, res) => res.json(await ownQuote(req)));
customerApi.get('/orcamentos/:id/documento', async (req, res) => {
  res.type('html').send(renderQuoteDocument(await ownQuote(req), await getSettings()));
});
customerApi.post('/orcamentos/:id/resposta', async (req, res) => {
  const body = parse({ resposta: v.enum(['aceitar', 'recusar']), motivo: v.text({ max: 2000, nullable: true }) }, req.body);
  await respondAsCustomer(cid(req), parseId(req.params.id), body, req);
  res.json(await ownQuote(req));
});

customerApi.get('/contratos', async (req, res) => {
  res.json(await db.many(
    "SELECT id, numero, titulo, status, data_inicio, data_fim, valor, moeda, arquivo_id IS NOT NULL AS possui_arquivo FROM contratos WHERE cliente_id = $1 AND status <> 'rascunho' ORDER BY criado_em DESC",
    [cid(req)]));
});
customerApi.get('/contratos/:id/arquivo', async (req, res) => {
  const row = await db.one("SELECT arquivo_id FROM contratos WHERE id = $1 AND cliente_id = $2 AND status <> 'rascunho' AND arquivo_id IS NOT NULL", [parseId(req.params.id), cid(req)]);
  if (!row) throw notFound('Arquivo');
  await streamPrivateFile(row.arquivo_id, res);
});

customerApi.get('/licencas', async (req, res) => {
  res.json(await db.many(
    'SELECT l.identificador, l.tipo, l.status, l.data_inicio, l.data_fim, l.limites, p.nome AS produto_nome FROM licencas l JOIN produtos p ON p.id = l.produto_id WHERE l.cliente_id = $1 ORDER BY l.criado_em DESC',
    [cid(req)]));
});

customerApi.get('/arquivos', async (req, res) => {
  res.json(await db.many('SELECT ca.id, ca.titulo, ca.descricao, ca.criado_em, a.nome_original, a.tamanho FROM cliente_arquivos ca JOIN arquivos a ON a.id = ca.arquivo_id WHERE ca.cliente_id = $1 ORDER BY ca.criado_em DESC', [cid(req)]));
});
customerApi.get('/arquivos/:id/download', async (req, res) => {
  const row = await db.one('SELECT arquivo_id FROM cliente_arquivos WHERE id = $1 AND cliente_id = $2', [parseId(req.params.id), cid(req)]);
  if (!row) throw notFound('Arquivo');
  await streamPrivateFile(row.arquivo_id, res);
});

customerApi.get('/chamados', async (req, res) => res.json(await listCustomerTickets(cid(req))));
customerApi.post('/chamados', formLimiter, async (req, res) => res.status(201).json(await openTicket(req.user, req.body)));
customerApi.get('/produtos-licenciados', async (req, res) => {
  res.json(await db.many('SELECT DISTINCT p.id, p.nome FROM licencas l JOIN produtos p ON p.id = l.produto_id WHERE l.cliente_id = $1 ORDER BY p.nome', [cid(req)]));
});
