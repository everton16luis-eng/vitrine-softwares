import { db } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { notify } from '../../services/notifications.js';
import { v, parse } from '../../utils/validation.js';
import { notFound } from '../../utils/errors.js';
import { pagination, paged } from '../../utils/common.js';

export const TICKET_STATUS = { aberto: 'Aberto', em_atendimento: 'Em atendimento', respondido: 'Respondido', fechado: 'Fechado' };
export const LGPD_STATUS = { recebida: 'Recebida', em_analise: 'Em análise', atendida: 'Atendida', indeferida: 'Indeferida' };

// ---------------------------------------------------------------- chamados
export async function listTickets(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (TICKET_STATUS[query.status]) { params.push(query.status); where.push(`t.status = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await db.one(`SELECT count(*)::int total FROM chamados t ${w}`, params);
  const rows = await db.many(
    `SELECT t.*, c.nome AS cliente_nome, p.nome AS produto_nome FROM chamados t JOIN clientes c ON c.id = t.cliente_id
       LEFT JOIN produtos p ON p.id = t.produto_id ${w} ORDER BY t.criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function answerTicket(id, input, req) {
  const value = parse({ resposta: v.text({ min: 2, max: 5000, nullable: true }), status: v.enum(Object.keys(TICKET_STATUS)) }, input);
  const row = await db.one(
    `UPDATE chamados SET status = $2, resposta = coalesce($3, resposta),
            respondido_por = CASE WHEN $3::text IS NOT NULL THEN $4::int ELSE respondido_por END,
            respondido_em = CASE WHEN $3::text IS NOT NULL THEN now() ELSE respondido_em END
      WHERE id = $1 RETURNING *`, [id, value.status, value.resposta ?? null, req.user.id]);
  if (!row) throw notFound('Chamado');
  await audit(req, 'responder', 'chamado', id, { status: value.status });
  return row;
}

export const listCustomerTickets = (clienteId) => db.many(
  'SELECT t.id, t.assunto, t.mensagem, t.status, t.resposta, t.respondido_em, t.criado_em, p.nome AS produto_nome FROM chamados t LEFT JOIN produtos p ON p.id = t.produto_id WHERE t.cliente_id = $1 ORDER BY t.criado_em DESC',
  [clienteId]);

export async function openTicket(user, input) {
  const value = parse({ assunto: v.string({ min: 3, max: 200 }), mensagem: v.text({ min: 10, max: 5000 }), produto_id: v.id({ nullable: true }) }, input);
  // Só aceita produtos licenciados ao próprio cliente (ou nenhum).
  if (value.produto_id) {
    const ok = await db.one('SELECT 1 FROM licencas WHERE cliente_id = $1 AND produto_id = $2', [user.clienteId, value.produto_id]);
    if (!ok) value.produto_id = null;
  }
  const row = await db.one('INSERT INTO chamados (cliente_id, usuario_id, produto_id, assunto, mensagem) VALUES ($1,$2,$3,$4,$5) RETURNING id, assunto, status, criado_em',
    [user.clienteId, user.id, value.produto_id ?? null, value.assunto, value.mensagem]);
  await notify({ permissao: 'suporte.ver', tipo: 'suporte', titulo: `Novo chamado: ${value.assunto}`, link: '#/suporte' });
  return row;
}

// ---------------------------------------------------------------- LGPD
export async function listDataRequests(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (LGPD_STATUS[query.status]) { params.push(query.status); where.push(`status = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await db.one(`SELECT count(*)::int total FROM solicitacoes_titulares ${w}`, params);
  const rows = await db.many(`SELECT s.*, (SELECT id FROM clientes c WHERE lower(c.email) = lower(s.email) AND c.anonimizado_em IS NULL LIMIT 1) AS cliente_id
    FROM solicitacoes_titulares s ${w} ORDER BY criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function updateDataRequest(id, input, req) {
  const value = parse({ status: v.enum(Object.keys(LGPD_STATUS)), resposta: v.text({ max: 5000, nullable: true }) }, input);
  const done = ['atendida', 'indeferida'].includes(value.status);
  const row = await db.one(
    `UPDATE solicitacoes_titulares SET status = $2, resposta = $3, atendido_por = $4,
            atendido_em = CASE WHEN $5 THEN now() ELSE NULL END WHERE id = $1 RETURNING *`,
    [id, value.status, value.resposta ?? null, req.user.id, done]);
  if (!row) throw notFound('Solicitação');
  await audit(req, 'atualizar', 'solicitacao_titular', id, { status: value.status });
  return row;
}
