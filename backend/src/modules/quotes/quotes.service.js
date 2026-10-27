import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { sendTemplateSafe } from '../../services/email.js';
import { v, parse } from '../../utils/validation.js';
import { conflict, notFound, ValidationError } from '../../utils/errors.js';
import { pagination, paged, likeTerm, todayIso } from '../../utils/common.js';
import { formatMoney, toDecimal, parseMoney } from '../../utils/money.js';
import { prepareItems, saveItems } from '../shared/items.js';
import { nextDocumentNumber } from '../shared/numbering.js';
import { getSettings } from '../settings/settings.service.js';
import { env } from '../../config/env.js';

export const QUOTE_STATUS = {
  novo: 'Novo', em_analise: 'Em análise', em_elaboracao: 'Em elaboração', enviado: 'Enviado',
  aguardando_resposta: 'Aguardando resposta', aceito: 'Aceito', recusado: 'Recusado', expirado: 'Expirado', cancelado: 'Cancelado'
};

/** Transições permitidas. Estados finais: aceito, recusado, cancelado. Expirado pode ser revisado. */
export const QUOTE_TRANSITIONS = {
  novo: ['em_analise', 'em_elaboracao', 'cancelado'],
  em_analise: ['em_elaboracao', 'cancelado'],
  em_elaboracao: ['enviado', 'cancelado'],
  enviado: ['aguardando_resposta', 'aceito', 'recusado', 'expirado', 'cancelado'],
  aguardando_resposta: ['aceito', 'recusado', 'expirado', 'cancelado'],
  expirado: ['em_elaboracao', 'cancelado'],
  aceito: [],
  recusado: [],
  cancelado: []
};
const EDITABLE = new Set(['novo', 'em_analise', 'em_elaboracao']);
const AWAITING = ['enviado', 'aguardando_resposta'];

export function canTransition(from, to) {
  return (QUOTE_TRANSITIONS[from] || []).includes(to);
}

/** Marca como expirados os orçamentos enviados cuja validade passou. */
export async function expireOverdueQuotes() {
  const rows = await db.many(
    `UPDATE orcamentos SET status = 'expirado' WHERE status = ANY($1) AND validade IS NOT NULL AND validade < CURRENT_DATE RETURNING id`, [AWAITING]);
  for (const r of rows) {
    await db.query("INSERT INTO orcamento_historico (orcamento_id, status_novo, descricao) VALUES ($1, 'expirado', 'Validade encerrada automaticamente.')", [r.id]);
  }
  return rows.length;
}

export async function listQuotes(query = {}) {
  await expireOverdueQuotes();
  const p = pagination(query);
  const params = [];
  const where = [];
  if (query.busca) {
    params.push(likeTerm(query.busca));
    where.push(`(o.numero ILIKE $${params.length} OR o.titulo ILIKE $${params.length} OR c.nome ILIKE $${params.length} OR l.nome ILIKE $${params.length})`);
  }
  if (QUOTE_STATUS[query.status]) { params.push(query.status); where.push(`o.status = $${params.length}`); }
  if (query.pendentes === 'true') where.push("o.status IN ('novo','em_analise','em_elaboracao','enviado','aguardando_resposta')");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN leads l ON l.id = o.lead_id';
  const { total } = await db.one(`SELECT count(*)::int total ${from} ${w}`, params);
  const rows = await db.many(
    `SELECT o.id, o.numero, o.titulo, o.status, o.total, o.moeda, o.validade, o.criado_em, o.enviado_em,
            coalesce(c.nome, l.nome) AS interessado_nome, coalesce(c.email, l.email) AS interessado_email
       ${from} ${w} ORDER BY o.criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function getQuote(id, conn = db) {
  const q = await conn.one(
    `SELECT o.*, c.nome AS cliente_nome, c.email AS cliente_email, c.empresa AS cliente_empresa, c.telefone AS cliente_telefone, c.documento AS cliente_documento,
            l.nome AS lead_nome, l.email AS lead_email, l.empresa AS lead_empresa, l.telefone AS lead_telefone,
            p.nome AS produto_nome, s.nome AS servico_nome, u.nome AS responsavel_nome, ct.dados_extras AS requisitos,
            (SELECT id FROM pedidos pd WHERE pd.orcamento_id = o.id LIMIT 1) AS pedido_id
       FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN leads l ON l.id = o.lead_id
       LEFT JOIN produtos p ON p.id = o.produto_id LEFT JOIN servicos s ON s.id = o.servico_id
       LEFT JOIN usuarios u ON u.id = o.responsavel_id LEFT JOIN contatos ct ON ct.id = o.contato_id
      WHERE o.id = $1`, [id]);
  if (!q) throw notFound('Orçamento');
  q.itens = await conn.many('SELECT * FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY ordem, id', [id]);
  q.historico = await conn.many('SELECT h.*, u.nome AS usuario_nome FROM orcamento_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.orcamento_id = $1 ORDER BY h.criado_em DESC, h.id DESC', [id]);
  q.transicoes = QUOTE_TRANSITIONS[q.status];
  q.editavel = EDITABLE.has(q.status);
  return q;
}

const quoteSchema = {
  titulo: v.string({ min: 3, max: 200 }),
  cliente_id: v.id({ nullable: true }),
  lead_id: v.id({ nullable: true }),
  produto_id: v.id({ nullable: true }),
  servico_id: v.id({ nullable: true }),
  descricao_solicitacao: v.text({ max: 10000, nullable: true }),
  validade: v.date({ nullable: true }),
  condicoes_comerciais: v.text({ max: 5000, nullable: true }),
  informacoes_adicionais: v.text({ max: 5000, nullable: true }),
  observacoes_internas: v.text({ max: 5000, nullable: true }),
  responsavel_id: v.id({ nullable: true }),
  moeda: v.currency()
};

async function assertParties(tx, value) {
  if (value.cliente_id && !(await tx.one('SELECT id FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [value.cliente_id]))) {
    throw new ValidationError({ cliente_id: 'Cliente inválido.' });
  }
  if (value.lead_id && !(await tx.one('SELECT id FROM leads WHERE id = $1', [value.lead_id]))) throw new ValidationError({ lead_id: 'Lead inválido.' });
}

export async function createQuote(input, req) {
  const value = parse(quoteSchema, input);
  if (!value.cliente_id && !value.lead_id) throw new ValidationError({ cliente_id: 'Selecione um cliente ou lead.' });
  const totals = prepareItems(input.itens || [], input.desconto);
  const settings = await getSettings();
  if (!value.validade) {
    const days = Number(settings.validade_orcamento_dias) || 15;
    value.validade = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  }
  value.condicoes_comerciais ??= settings.condicoes_orcamento_padrao || null;
  const id = await withTransaction(async (tx) => {
    await assertParties(tx, value);
    const numero = await nextDocumentNumber(tx, 'ORC');
    const row = await tx.one(
      `INSERT INTO orcamentos (numero, titulo, cliente_id, lead_id, produto_id, servico_id, descricao_solicitacao, validade, condicoes_comerciais,
                               informacoes_adicionais, observacoes_internas, responsavel_id, moeda, subtotal, desconto, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'em_elaboracao') RETURNING id`,
      [numero, value.titulo, value.cliente_id ?? null, value.lead_id ?? null, value.produto_id ?? null, value.servico_id ?? null,
        value.descricao_solicitacao ?? null, value.validade, value.condicoes_comerciais ?? null, value.informacoes_adicionais ?? null,
        value.observacoes_internas ?? null, value.responsavel_id ?? req.user.id, value.moeda,
        toDecimal(totals.subtotal), toDecimal(totals.desconto), toDecimal(totals.total)]);
    await saveItems(tx, 'orcamento_itens', 'orcamento_id', row.id, totals.lines);
    await tx.query("INSERT INTO orcamento_historico (orcamento_id, usuario_id, status_novo, descricao) VALUES ($1,$2,'em_elaboracao','Orçamento criado pela equipe.')", [row.id, req.user.id]);
    await audit(req, 'criar', 'orcamento', row.id, { numero, total: toDecimal(totals.total) }, tx);
    return row.id;
  });
  return getQuote(id);
}

export async function updateQuote(id, input, req) {
  await withTransaction(async (tx) => {
    const q = await tx.one('SELECT * FROM orcamentos WHERE id = $1 FOR UPDATE', [id]);
    if (!q) throw notFound('Orçamento');
    const value = parse(quoteSchema, input, { partial: true });
    const changesItems = 'itens' in (input || {}) || 'desconto' in (input || {});
    // Após o envio, apenas observações internas podem ser alteradas (o documento enviado é preservado).
    if (!EDITABLE.has(q.status)) {
      const allowed = Object.keys(value).every((k) => k === 'observacoes_internas' || k === 'responsavel_id');
      if (!allowed || changesItems) throw conflict(`Orçamento "${QUOTE_STATUS[q.status]}" não pode ter valores ou condições alterados.`);
    }
    await assertParties(tx, value);
    const sets = { ...value };
    if (changesItems) {
      const itens = 'itens' in input ? input.itens : (await tx.many('SELECT * FROM orcamento_itens WHERE orcamento_id = $1 ORDER BY ordem', [id]))
        .map((i) => ({ ...i, preco_unitario: i.preco_unitario, desconto: i.desconto }));
      const totals = prepareItems(itens, 'desconto' in input ? input.desconto : q.desconto);
      await saveItems(tx, 'orcamento_itens', 'orcamento_id', id, totals.lines);
      Object.assign(sets, { subtotal: toDecimal(totals.subtotal), desconto: toDecimal(totals.desconto), total: toDecimal(totals.total) });
    }
    const keys = Object.keys(sets);
    if (keys.length) await tx.query(`UPDATE orcamentos SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => sets[k])]);
    await tx.query('INSERT INTO orcamento_historico (orcamento_id, usuario_id, descricao) VALUES ($1,$2,$3)', [id, req.user.id, `Dados atualizados (${keys.join(', ') || 'sem alterações'}).`]);
    await audit(req, 'editar', 'orcamento', id, { campos: keys }, tx);
  });
  return getQuote(id);
}

/**
 * Altera o status do orçamento respeitando QUOTE_TRANSITIONS.
 * `actor` = 'equipe' (req.user) ou 'cliente' (resposta pela área do cliente).
 */
export async function changeQuoteStatus(id, { status, observacao, motivo_recusa } = {}, req, { actor = 'equipe' } = {}) {
  if (!QUOTE_STATUS[status]) throw new ValidationError({ status: 'Status inválido.' });
  let notifyEmail = null;
  await withTransaction(async (tx) => {
    const q = await tx.one('SELECT * FROM orcamentos WHERE id = $1 FOR UPDATE', [id]);
    if (!q) throw notFound('Orçamento');
    if (!canTransition(q.status, status)) {
      throw conflict(`Não é possível mudar de "${QUOTE_STATUS[q.status]}" para "${QUOTE_STATUS[status]}".`);
    }
    if (status === 'enviado') {
      const { n } = await tx.one('SELECT count(*)::int n FROM orcamento_itens WHERE orcamento_id = $1', [id]);
      if (!n) throw conflict('Adicione ao menos um item antes de enviar o orçamento.');
      if (!q.validade) throw conflict('Defina a validade antes de enviar.');
      if (q.validade < todayIso()) throw conflict('A validade informada já passou. Atualize-a antes de enviar.');
      notifyEmail = 'orcamento_enviado';
    }
    if (['aceito', 'recusado'].includes(status) && q.validade && q.validade < todayIso()) {
      throw conflict('Orçamento fora da validade. Revise-o antes de registrar a resposta.');
    }
    const sets = ['status = $2'];
    if (status === 'enviado') sets.push('enviado_em = now()');
    if (['aceito', 'recusado'].includes(status)) sets.push('respondido_em = now()');
    const params = [id, status];
    if (status === 'recusado' && motivo_recusa) { params.push(String(motivo_recusa).slice(0, 2000)); sets.push(`motivo_recusa = $${params.length}`); }
    await tx.query(`UPDATE orcamentos SET ${sets.join(', ')} WHERE id = $1`, params);
    const who = actor === 'cliente' ? 'pelo cliente (área do cliente)' : 'pela equipe';
    const desc = `Status alterado de "${QUOTE_STATUS[q.status]}" para "${QUOTE_STATUS[status]}" ${who}.${observacao ? ` Observação: ${String(observacao).slice(0, 1000)}` : ''}`;
    await tx.query('INSERT INTO orcamento_historico (orcamento_id, usuario_id, status_anterior, status_novo, descricao) VALUES ($1,$2,$3,$4,$5)',
      [id, req.user?.id ?? null, q.status, status, desc]);
    if (actor === 'equipe') await audit(req, 'alterar_status', 'orcamento', id, { de: q.status, para: status }, tx);
    if (actor === 'cliente') {
      await tx.query("INSERT INTO notificacoes (permissao, tipo, titulo, link) VALUES ('orcamentos.ver', 'orcamento', $1, $2)",
        [`Orçamento ${q.numero} ${status === 'aceito' ? 'aceito' : 'recusado'} pelo cliente`, `#/orcamentos/${id}`]);
    }
  });
  const quote = await getQuote(id);
  if (notifyEmail) {
    const to = quote.cliente_email || quote.lead_email;
    const settings = await getSettings();
    await sendTemplateSafe(notifyEmail, to, {
      nome: quote.cliente_nome || quote.lead_nome, numero: quote.numero, titulo: quote.titulo, total: formatMoney(quote.total, quote.moeda),
      validade: quote.validade ? quote.validade.split('-').reverse().join('/') : '-', empresa_nome: settings.nome_comercial || '',
      link_cliente: `${env.appUrl}/cliente`
    });
  }
  return quote;
}

/** Gera pedido (rascunho) a partir de orçamento aceito. Converte o lead em cliente se necessário. */
export async function createOrderFromQuote(id, req) {
  const orderId = await withTransaction(async (tx) => {
    const q = await tx.one('SELECT * FROM orcamentos WHERE id = $1 FOR UPDATE', [id]);
    if (!q) throw notFound('Orçamento');
    if (q.status !== 'aceito') throw conflict('Somente orçamentos aceitos podem gerar pedido.');
    if (await tx.one('SELECT id FROM pedidos WHERE orcamento_id = $1', [id])) throw conflict('Este orçamento já gerou um pedido.');
    let clienteId = q.cliente_id;
    if (!clienteId) {
      const lead = await tx.one('SELECT * FROM leads WHERE id = $1', [q.lead_id]);
      if (!lead) throw conflict('Orçamento sem cliente ou lead associado.');
      const existing = await tx.one('SELECT id FROM clientes WHERE lower(email) = lower($1) AND anonimizado_em IS NULL', [lead.email]);
      clienteId = existing?.id || (await tx.one("INSERT INTO clientes (nome, email, telefone, empresa, origem) VALUES ($1,$2,$3,$4,'orcamento') RETURNING id",
        [lead.nome, lead.email, lead.telefone, lead.empresa])).id;
      await tx.query("UPDATE leads SET cliente_id = $2, status = 'convertido' WHERE id = $1", [lead.id, clienteId]);
      await tx.query('UPDATE orcamentos SET cliente_id = $2 WHERE id = $1', [id, clienteId]);
    }
    const numero = await nextDocumentNumber(tx, 'PED');
    const order = await tx.one(
      `INSERT INTO pedidos (numero, cliente_id, orcamento_id, moeda, subtotal, desconto, total, observacoes, criado_por, desconto_autorizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [numero, clienteId, id, q.moeda, q.subtotal, q.desconto, q.total, `Gerado a partir do orçamento ${q.numero}.`, req.user.id,
        parseMoney(q.desconto) > 0n ? req.user.id : null]);
    await tx.query(
      `INSERT INTO pedido_itens (pedido_id, descricao, produto_id, servico_id, plano_id, quantidade, preco_unitario, desconto, total, ordem)
       SELECT $1, descricao, produto_id, servico_id, plano_id, quantidade, preco_unitario, desconto, total, ordem FROM orcamento_itens WHERE orcamento_id = $2`,
      [order.id, id]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)', [order.id, req.user.id, `Pedido criado a partir do orçamento ${q.numero}.`]);
    await tx.query('INSERT INTO orcamento_historico (orcamento_id, usuario_id, descricao) VALUES ($1,$2,$3)', [id, req.user.id, `Pedido ${numero} gerado.`]);
    await audit(req, 'gerar_pedido', 'orcamento', id, { pedido: numero }, tx);
    return order.id;
  });
  return { pedido_id: orderId };
}

/** Resposta do cliente pela área do cliente — somente para orçamentos do próprio cliente. */
export async function respondAsCustomer(customerId, quoteId, { resposta, motivo } = {}, req) {
  const q = await db.one('SELECT id, status FROM orcamentos WHERE id = $1 AND cliente_id = $2', [quoteId, customerId]);
  if (!q) throw notFound('Orçamento');
  if (!AWAITING.includes(q.status)) throw conflict('Este orçamento não está aguardando resposta.');
  if (!['aceitar', 'recusar'].includes(resposta)) throw new ValidationError({ resposta: 'Resposta inválida.' });
  return changeQuoteStatus(quoteId, { status: resposta === 'aceitar' ? 'aceito' : 'recusado', motivo_recusa: motivo }, req, { actor: 'cliente' });
}
