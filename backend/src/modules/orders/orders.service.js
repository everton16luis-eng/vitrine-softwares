import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { sendTemplateSafe } from '../../services/email.js';
import { v, parse } from '../../utils/validation.js';
import { conflict, forbidden, notFound, ValidationError } from '../../utils/errors.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { formatMoney, parseMoney, toDecimal } from '../../utils/money.js';
import { prepareItems, saveItems } from '../shared/items.js';
import { nextDocumentNumber } from '../shared/numbering.js';
import { can } from '../../middlewares/auth.js';
import { getSettings } from '../settings/settings.service.js';

export const ORDER_STATUS = {
  rascunho: 'Rascunho', aguardando_pagamento: 'Aguardando pagamento', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado'
};
export const PAYMENT_STATUS = { pendente: 'Pendente', parcial: 'Parcialmente pago', pago: 'Pago', estornado: 'Estornado' };
export const PAYMENT_METHODS = { pix: 'PIX', boleto: 'Boleto', transferencia: 'Transferência', cartao: 'Cartão', gateway: 'Gateway online', outro: 'Outro' };

export const ORDER_TRANSITIONS = {
  rascunho: ['aguardando_pagamento', 'cancelado'],
  aguardando_pagamento: ['em_andamento', 'cancelado'],
  em_andamento: ['concluido', 'cancelado'],
  concluido: [],
  cancelado: []
};

export const canOrderTransition = (from, to) => (ORDER_TRANSITIONS[from] || []).includes(to);

/**
 * Situação de pagamento derivada SOMENTE de pagamentos confirmados.
 * Criar um pedido nunca o torna "pago".
 */
export function derivePaymentStatus(totalCents, payments) {
  const confirmed = payments.filter((p) => p.status === 'confirmado').reduce((acc, p) => acc + parseMoney(p.valor), 0n);
  const refunded = payments.some((p) => p.status === 'estornado');
  if (totalCents > 0n && confirmed >= totalCents) return 'pago';
  if (confirmed > 0n) return 'parcial';
  if (refunded) return 'estornado';
  return 'pendente';
}

async function refreshPaymentStatus(tx, orderId) {
  const order = await tx.one('SELECT total, status_pagamento FROM pedidos WHERE id = $1', [orderId]);
  const payments = await tx.many('SELECT valor, status FROM pagamentos WHERE pedido_id = $1', [orderId]);
  const status = derivePaymentStatus(parseMoney(order.total), payments);
  if (status !== order.status_pagamento) {
    await tx.query('UPDATE pedidos SET status_pagamento = $2 WHERE id = $1', [orderId, status]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, descricao) VALUES ($1,$2)', [orderId, `Situação de pagamento: ${PAYMENT_STATUS[status]}.`]);
  }
  return { previous: order.status_pagamento, status };
}

export async function listOrders(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(o.numero ILIKE $${params.length} OR c.nome ILIKE $${params.length})`); }
  if (ORDER_STATUS[query.status]) { params.push(query.status); where.push(`o.status = $${params.length}`); }
  if (PAYMENT_STATUS[query.status_pagamento]) { params.push(query.status_pagamento); where.push(`o.status_pagamento = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.inicio || '')) { params.push(query.inicio); where.push(`o.data_pedido >= $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.fim || '')) { params.push(query.fim); where.push(`o.data_pedido <= $${params.length}`); }
  if (query.cliente_id) { params.push(Number(query.cliente_id) || 0); where.push(`o.cliente_id = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM pedidos o JOIN clientes c ON c.id = o.cliente_id';
  const { total } = await db.one(`SELECT count(*)::int total ${from} ${w}`, params);
  const rows = await db.many(
    `SELECT o.id, o.numero, o.status, o.status_pagamento, o.total, o.moeda, o.data_pedido, o.forma_pagamento, c.nome AS cliente_nome
       ${from} ${w} ORDER BY o.criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function getOrder(id, conn = db) {
  const o = await conn.one(
    `SELECT o.*, c.nome AS cliente_nome, c.email AS cliente_email, c.empresa AS cliente_empresa, q.numero AS orcamento_numero,
            ua.nome AS desconto_autorizado_por_nome
       FROM pedidos o JOIN clientes c ON c.id = o.cliente_id LEFT JOIN orcamentos q ON q.id = o.orcamento_id
       LEFT JOIN usuarios ua ON ua.id = o.desconto_autorizado_por WHERE o.id = $1`, [id]);
  if (!o) throw notFound('Pedido');
  const [itens, pagamentos, historico, contratos, licencas] = await Promise.all([
    conn.many('SELECT * FROM pedido_itens WHERE pedido_id = $1 ORDER BY ordem, id', [id]),
    conn.many('SELECT p.*, u.nome AS confirmado_por_nome FROM pagamentos p LEFT JOIN usuarios u ON u.id = p.confirmado_por WHERE p.pedido_id = $1 ORDER BY p.criado_em', [id]),
    conn.many('SELECT h.*, u.nome AS usuario_nome FROM pedido_historico h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.pedido_id = $1 ORDER BY h.criado_em DESC, h.id DESC', [id]),
    conn.many('SELECT id, numero, titulo, status FROM contratos WHERE pedido_id = $1', [id]),
    conn.many('SELECT id, identificador, status FROM licencas WHERE pedido_id = $1', [id])
  ]);
  const confirmed = pagamentos.filter((p) => p.status === 'confirmado').reduce((a, p) => a + parseMoney(p.valor), 0n);
  return { ...o, itens, pagamentos, historico, contratos, licencas, total_pago: toDecimal(confirmed),
    saldo: toDecimal(parseMoney(o.total) - confirmed > 0n ? parseMoney(o.total) - confirmed : 0n), transicoes: ORDER_TRANSITIONS[o.status] };
}

const orderSchema = {
  cliente_id: v.id(),
  forma_pagamento: v.enum(Object.keys(PAYMENT_METHODS), { nullable: true }),
  moeda: v.currency(),
  observacoes: v.text({ max: 5000, nullable: true }),
  data_pedido: v.date({ optional: true }),
  data_vencimento: v.date({ nullable: true })
};

function assertDiscountAllowed(req, totals) {
  const hasDiscount = totals.desconto > 0n || totals.lines.some((l) => BigInt(l.desconto || 0n) > 0n);
  if (hasDiscount && !can(req.user, 'pedidos.autorizar_desconto')) {
    throw forbidden('Você não tem permissão para autorizar descontos.');
  }
  return hasDiscount;
}

export async function createOrder(input, req) {
  const value = parse(orderSchema, input);
  const totals = prepareItems(input.itens || [], input.desconto, { requireItems: true });
  const hasDiscount = assertDiscountAllowed(req, totals);
  const id = await withTransaction(async (tx) => {
    if (!(await tx.one('SELECT id FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [value.cliente_id]))) {
      throw new ValidationError({ cliente_id: 'Cliente inválido.' });
    }
    const numero = await nextDocumentNumber(tx, 'PED');
    const row = await tx.one(
      `INSERT INTO pedidos (numero, cliente_id, forma_pagamento, moeda, observacoes, data_pedido, data_vencimento, subtotal, desconto, total, criado_por, desconto_autorizado_por)
       VALUES ($1,$2,$3,$4,$5,coalesce($6::date, CURRENT_DATE),$7,$8,$9,$10,$11,$12) RETURNING id`,
      [numero, value.cliente_id, value.forma_pagamento ?? null, value.moeda, value.observacoes ?? null, value.data_pedido ?? null,
        value.data_vencimento ?? null, toDecimal(totals.subtotal), toDecimal(totals.desconto), toDecimal(totals.total), req.user.id,
        hasDiscount ? req.user.id : null]);
    await saveItems(tx, 'pedido_itens', 'pedido_id', row.id, totals.lines);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)', [row.id, req.user.id, 'Pedido criado (rascunho).']);
    await audit(req, 'criar', 'pedido', row.id, { numero, total: toDecimal(totals.total) }, tx);
    return row.id;
  });
  return getOrder(id);
}

export async function updateOrder(id, input, req) {
  await withTransaction(async (tx) => {
    const o = await tx.one('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
    if (!o) throw notFound('Pedido');
    const value = parse(orderSchema, input, { partial: true });
    const touchesValues = 'itens' in (input || {}) || 'desconto' in (input || {}) || 'cliente_id' in value;
    if (o.status !== 'rascunho' && touchesValues) throw conflict('Itens, valores e cliente só podem ser alterados enquanto o pedido é rascunho.');
    if (['concluido', 'cancelado'].includes(o.status)) throw conflict('Pedido finalizado não pode ser alterado.');
    const sets = { ...value };
    if ('itens' in (input || {}) || 'desconto' in (input || {})) {
      const itens = 'itens' in input ? input.itens : await tx.many('SELECT * FROM pedido_itens WHERE pedido_id = $1 ORDER BY ordem', [id]);
      const totals = prepareItems(itens, 'desconto' in input ? input.desconto : o.desconto, { requireItems: true });
      const hasDiscount = assertDiscountAllowed(req, totals);
      await saveItems(tx, 'pedido_itens', 'pedido_id', id, totals.lines);
      Object.assign(sets, { subtotal: toDecimal(totals.subtotal), desconto: toDecimal(totals.desconto), total: toDecimal(totals.total),
        desconto_autorizado_por: hasDiscount ? req.user.id : null });
    }
    const keys = Object.keys(sets);
    if (keys.length) await tx.query(`UPDATE pedidos SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => sets[k])]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)', [id, req.user.id, `Pedido atualizado (${keys.join(', ')}).`]);
    await audit(req, 'editar', 'pedido', id, { campos: keys }, tx);
  });
  return getOrder(id);
}

export async function changeOrderStatus(id, { status, observacao } = {}, req) {
  if (!ORDER_STATUS[status]) throw new ValidationError({ status: 'Status inválido.' });
  await withTransaction(async (tx) => {
    const o = await tx.one('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
    if (!o) throw notFound('Pedido');
    if (!canOrderTransition(o.status, status)) throw conflict(`Não é possível mudar de "${ORDER_STATUS[o.status]}" para "${ORDER_STATUS[status]}".`);
    if (status === 'aguardando_pagamento' && parseMoney(o.total) <= 0n) throw conflict('O pedido precisa ter valor total maior que zero.');
    if (status === 'concluido' && o.status_pagamento !== 'pago') throw conflict('O pedido só pode ser concluído após a confirmação integral do pagamento.');
    if (status === 'cancelado') {
      const { n } = await tx.one("SELECT count(*)::int n FROM pagamentos WHERE pedido_id = $1 AND status = 'confirmado'", [id]);
      if (n > 0) throw conflict('Há pagamentos confirmados. Registre o estorno antes de cancelar o pedido.');
      await tx.query("UPDATE pagamentos SET status = 'cancelado' WHERE pedido_id = $1 AND status = 'pendente'", [id]);
    }
    await tx.query(
      `UPDATE pedidos SET status = $2::varchar, concluido_em = CASE WHEN $2::varchar = 'concluido' THEN now() ELSE concluido_em END,
              cancelado_em = CASE WHEN $2::varchar = 'cancelado' THEN now() ELSE cancelado_em END WHERE id = $1`, [id, status]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)',
      [id, req.user.id, `Status: "${ORDER_STATUS[o.status]}" → "${ORDER_STATUS[status]}".${observacao ? ` ${String(observacao).slice(0, 1000)}` : ''}`]);
    await audit(req, 'alterar_status', 'pedido', id, { de: o.status, para: status }, tx);
  });
  const order = await getOrder(id);
  const settings = await getSettings();
  await sendTemplateSafe('pedido_status', order.cliente_email, { nome: order.cliente_nome, numero: order.numero, status: ORDER_STATUS[order.status], empresa_nome: settings.nome_comercial || '' });
  return order;
}

const paymentSchema = {
  valor: v.money(),
  metodo: v.enum(Object.keys(PAYMENT_METHODS).filter((m) => m !== 'gateway')),
  referencia_externa: v.string({ max: 120, nullable: true }),
  observacoes: v.text({ max: 2000, nullable: true }),
  confirmar: v.bool()
};

/**
 * Registro MANUAL de pagamento (ex.: PIX ou transferência conferidos no extrato).
 * Confirmações de pagamentos online só ocorrem via webhook validado do provedor.
 */
export async function registerPayment(orderId, input, req) {
  const value = parse(paymentSchema, input);
  if (value.valor <= 0n) throw new ValidationError({ valor: 'Informe um valor maior que zero.' });
  if (value.confirmar && !can(req.user, 'pagamentos.confirmar')) throw forbidden('Você não tem permissão para confirmar pagamentos.');
  let paid = false;
  await withTransaction(async (tx) => {
    const o = await tx.one('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [orderId]);
    if (!o) throw notFound('Pedido');
    if (['rascunho', 'cancelado', 'concluido'].includes(o.status)) throw conflict('Pagamentos só podem ser registrados em pedidos aguardando pagamento ou em andamento.');
    const { soma } = await tx.one("SELECT coalesce(sum(valor), 0) AS soma FROM pagamentos WHERE pedido_id = $1 AND status IN ('confirmado','pendente')", [orderId]);
    if (parseMoney(soma) + value.valor > parseMoney(o.total)) throw conflict(`O valor excede o saldo do pedido (${formatMoney(parseMoney(o.total) - parseMoney(soma), o.moeda)}).`);
    const row = await tx.one(
      `INSERT INTO pagamentos (pedido_id, valor, metodo, provedor, status, referencia_externa, observacoes, confirmado_em, confirmado_por)
       VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8) RETURNING id`,
      [orderId, toDecimal(value.valor), value.metodo, value.confirmar ? 'confirmado' : 'pendente', value.referencia_externa ?? null,
        value.observacoes ?? null, value.confirmar ? new Date() : null, value.confirmar ? req.user.id : null]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)',
      [orderId, req.user.id, `Pagamento manual de ${formatMoney(value.valor, o.moeda)} registrado (${value.confirmar ? 'confirmado' : 'pendente de conferência'}).`]);
    const r = await refreshPaymentStatus(tx, orderId);
    paid = r.status === 'pago' && r.previous !== 'pago';
    await audit(req, 'registrar_pagamento', 'pedido', orderId, { pagamento_id: row.id, valor: toDecimal(value.valor), confirmado: value.confirmar }, tx);
  });
  if (paid) await notifyPaid(orderId);
  return getOrder(orderId);
}

const PAYMENT_ACTIONS = {
  confirmar: { from: ['pendente'], to: 'confirmado', permission: 'pagamentos.confirmar', label: 'confirmado' },
  cancelar: { from: ['pendente'], to: 'cancelado', permission: 'pedidos.editar', label: 'cancelado' },
  estornar: { from: ['confirmado'], to: 'estornado', permission: 'pagamentos.confirmar', label: 'estornado' }
};

export async function paymentAction(paymentId, action, req) {
  const cfg = PAYMENT_ACTIONS[action];
  if (!cfg) throw new ValidationError({ acao: 'Ação inválida.' });
  if (!can(req.user, cfg.permission)) throw forbidden();
  let orderId;
  let paid = false;
  await withTransaction(async (tx) => {
    const p = await tx.one('SELECT * FROM pagamentos WHERE id = $1 FOR UPDATE', [paymentId]);
    if (!p) throw notFound('Pagamento');
    orderId = p.pedido_id;
    if (p.provedor !== 'manual' && action === 'confirmar') throw conflict('Pagamentos de gateway são confirmados apenas pela notificação validada do provedor.');
    if (!cfg.from.includes(p.status)) throw conflict(`Pagamento ${p.status} não pode ser ${cfg.label}.`);
    await tx.query(
      `UPDATE pagamentos SET status = $2::varchar, confirmado_em = CASE WHEN $2::varchar = 'confirmado' THEN now() ELSE confirmado_em END,
              confirmado_por = CASE WHEN $2::varchar = 'confirmado' THEN $3::int ELSE confirmado_por END WHERE id = $1`, [paymentId, cfg.to, req.user.id]);
    await tx.query('INSERT INTO pedido_historico (pedido_id, usuario_id, descricao) VALUES ($1,$2,$3)',
      [orderId, req.user.id, `Pagamento #${paymentId} ${cfg.label}.`]);
    const r = await refreshPaymentStatus(tx, orderId);
    paid = r.status === 'pago' && r.previous !== 'pago';
    await audit(req, `pagamento_${action}`, 'pedido', orderId, { pagamento_id: paymentId }, tx);
  });
  if (paid) await notifyPaid(orderId);
  return getOrder(orderId);
}

async function notifyPaid(orderId) {
  const order = await getOrder(orderId);
  const settings = await getSettings();
  await sendTemplateSafe('pagamento_confirmado', order.cliente_email, { nome: order.cliente_nome, numero: order.numero, total: formatMoney(order.total, order.moeda), empresa_nome: settings.nome_comercial || '' });
  await db.query("INSERT INTO notificacoes (permissao, tipo, titulo, link) VALUES ('pedidos.ver','pagamento',$1,$2)", [`Pedido ${order.numero} quitado`, `#/pedidos/${orderId}`]);
}

export { refreshPaymentStatus };
