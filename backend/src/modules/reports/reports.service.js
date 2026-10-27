import { db } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { pagination, paged, toCsv, todayIso } from '../../utils/common.js';
import { ValidationError } from '../../utils/errors.js';
import { QUOTE_STATUS } from '../quotes/quotes.service.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../orders/orders.service.js';
import { STATUS_COMERCIAL } from '../products/products.constants.js';
import { LEAD_STATUS } from '../leads/leads.service.js';

/** Todos os indicadores são calculados a partir do banco — nenhum número fixo. */
export async function dashboard() {
  const [produtos, orcamentos, contatos, pedidos, receita, maisVistos, atividades, leadsMes, pedidosMes] = await Promise.all([
    db.one(`SELECT count(*)::int total,
                   count(*) FILTER (WHERE publicado)::int publicados,
                   count(*) FILTER (WHERE status_comercial IN ('em_planejamento','em_desenvolvimento'))::int em_desenvolvimento
              FROM produtos WHERE status_comercial <> 'arquivado'`),
    db.one(`SELECT count(*)::int total,
                   count(*) FILTER (WHERE status IN ('novo','em_analise','em_elaboracao','enviado','aguardando_resposta'))::int pendentes,
                   count(*) FILTER (WHERE status = 'aceito')::int aceitos
              FROM orcamentos`),
    db.one(`SELECT count(*)::int total, count(*) FILTER (WHERE criado_em > now() - interval '30 days')::int ultimos_30 FROM contatos`),
    db.one(`SELECT count(*)::int total, count(*) FILTER (WHERE status_pagamento = 'pago')::int pagos,
                   count(*) FILTER (WHERE status = 'concluido')::int concluidos FROM pedidos WHERE status <> 'cancelado'`),
    // Receita = pagamentos efetivamente confirmados (não pedidos criados).
    db.one(`SELECT coalesce(sum(valor), 0)::text total, coalesce(sum(valor) FILTER (WHERE confirmado_em > date_trunc('month', now())), 0)::text mes
              FROM pagamentos WHERE status = 'confirmado'`),
    db.many(`SELECT p.id, p.nome, sum(v.total)::int visualizacoes FROM visualizacoes_produtos v JOIN produtos p ON p.id = v.produto_id
              WHERE v.data > CURRENT_DATE - 30 GROUP BY p.id, p.nome ORDER BY visualizacoes DESC LIMIT 5`),
    db.many('SELECT id, usuario_nome, acao, entidade, entidade_id, criado_em FROM auditoria ORDER BY criado_em DESC LIMIT 8'),
    db.many(`SELECT to_char(m, 'YYYY-MM') mes, (SELECT count(*)::int FROM leads l WHERE date_trunc('month', l.criado_em) = m) total
               FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`),
    db.many(`SELECT to_char(m, 'YYYY-MM') mes,
                    (SELECT coalesce(sum(valor), 0)::text FROM pagamentos pg WHERE pg.status = 'confirmado' AND date_trunc('month', pg.confirmado_em) = m) receita
               FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`)
  ]);
  const orcPorStatus = await db.many('SELECT status, count(*)::int total FROM orcamentos GROUP BY status');
  return {
    produtos, orcamentos, contatos, pedidos, receita, mais_vistos: maisVistos, atividades,
    series: { leads: leadsMes, receita: pedidosMes },
    orcamentos_por_status: orcPorStatus.map((r) => ({ ...r, rotulo: QUOTE_STATUS[r.status] }))
  };
}

function period(query) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const fim = re.test(query.fim || '') ? query.fim : todayIso();
  const inicio = re.test(query.inicio || '') ? query.inicio : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  if (inicio > fim) throw new ValidationError({ inicio: 'O início deve ser anterior ao fim.' });
  return { inicio, fim };
}

const REPORTS = {
  produtos: {
    title: 'Produtos cadastrados',
    sql: `SELECT p.id, p.nome, c.nome AS categoria, p.status_comercial, p.publicado, p.preco, p.moeda,
                 coalesce((SELECT sum(total) FROM visualizacoes_produtos v WHERE v.produto_id = p.id AND v.data BETWEEN $1 AND $2), 0)::int AS visualizacoes, p.criado_em
            FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL ORDER BY p.ordem`,
    columns: [{ label: 'ID', key: 'id' }, { label: 'Produto', key: 'nome' }, { label: 'Categoria', key: 'categoria' },
      { label: 'Status', value: (r) => STATUS_COMERCIAL[r.status_comercial] }, { label: 'Publicado', value: (r) => (r.publicado ? 'Sim' : 'Não') },
      { label: 'Preço', key: 'preco' }, { label: 'Visualizações no período', key: 'visualizacoes' }]
  },
  leads: {
    title: 'Leads recebidos',
    sql: `SELECT id, nome, email, empresa, status, origem, criado_em FROM leads WHERE anonimizado_em IS NULL AND criado_em >= $1::date AND criado_em < $2::date + 1 ORDER BY criado_em DESC`,
    columns: [{ label: 'ID', key: 'id' }, { label: 'Nome', key: 'nome' }, { label: 'E-mail', key: 'email' }, { label: 'Empresa', key: 'empresa' },
      { label: 'Status', value: (r) => LEAD_STATUS[r.status] }, { label: 'Origem', key: 'origem' }, { label: 'Data', value: (r) => new Date(r.criado_em).toISOString().slice(0, 10) }]
  },
  orcamentos: {
    title: 'Orçamentos por status',
    sql: `SELECT status, count(*)::int quantidade, coalesce(sum(total), 0)::text valor_total FROM orcamentos
           WHERE criado_em >= $1::date AND criado_em < $2::date + 1 GROUP BY status ORDER BY quantidade DESC`,
    columns: [{ label: 'Status', value: (r) => QUOTE_STATUS[r.status] }, { label: 'Quantidade', key: 'quantidade' }, { label: 'Valor total', key: 'valor_total' }]
  },
  pedidos: {
    title: 'Pedidos por período',
    sql: `SELECT o.numero, c.nome AS cliente, o.status, o.status_pagamento, o.total, o.data_pedido FROM pedidos o JOIN clientes c ON c.id = o.cliente_id
           WHERE o.data_pedido BETWEEN $1 AND $2 ORDER BY o.data_pedido DESC`,
    columns: [{ label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente' }, { label: 'Status', value: (r) => ORDER_STATUS[r.status] },
      { label: 'Pagamento', value: (r) => PAYMENT_STATUS[r.status_pagamento] }, { label: 'Total', key: 'total' }, { label: 'Data', key: 'data_pedido' }]
  },
  vendas: {
    title: 'Vendas registradas (pagamentos confirmados)',
    sql: `SELECT pg.id, o.numero AS pedido, c.nome AS cliente, pg.valor, pg.metodo, pg.provedor, pg.confirmado_em FROM pagamentos pg
            JOIN pedidos o ON o.id = pg.pedido_id JOIN clientes c ON c.id = o.cliente_id
           WHERE pg.status = 'confirmado' AND pg.confirmado_em >= $1::date AND pg.confirmado_em < $2::date + 1 ORDER BY pg.confirmado_em DESC`,
    columns: [{ label: 'Pagamento', key: 'id' }, { label: 'Pedido', key: 'pedido' }, { label: 'Cliente', key: 'cliente' }, { label: 'Valor', key: 'valor' },
      { label: 'Método', key: 'metodo' }, { label: 'Origem', key: 'provedor' }, { label: 'Confirmado em', value: (r) => new Date(r.confirmado_em).toISOString() }]
  },
  clientes: {
    title: 'Clientes',
    sql: `SELECT c.id, c.nome, c.email, c.empresa, c.criado_em, (SELECT count(*)::int FROM pedidos p WHERE p.cliente_id = c.id) pedidos
            FROM clientes c WHERE c.anonimizado_em IS NULL AND c.criado_em >= $1::date AND c.criado_em < $2::date + 1 ORDER BY c.criado_em DESC`,
    columns: [{ label: 'ID', key: 'id' }, { label: 'Nome', key: 'nome' }, { label: 'E-mail', key: 'email' }, { label: 'Empresa', key: 'empresa' },
      { label: 'Pedidos', key: 'pedidos' }, { label: 'Cadastro', value: (r) => new Date(r.criado_em).toISOString().slice(0, 10) }]
  },
  mais_consultados: {
    title: 'Produtos mais consultados',
    sql: `SELECT p.nome, sum(v.total)::int visualizacoes FROM visualizacoes_produtos v JOIN produtos p ON p.id = v.produto_id
           WHERE v.data BETWEEN $1 AND $2 GROUP BY p.nome ORDER BY visualizacoes DESC`,
    columns: [{ label: 'Produto', key: 'nome' }, { label: 'Visualizações', key: 'visualizacoes' }]
  },
  atividades: {
    title: 'Atividades administrativas',
    sql: `SELECT criado_em, usuario_nome, acao, entidade, entidade_id FROM auditoria WHERE criado_em >= $1::date AND criado_em < $2::date + 1 ORDER BY criado_em DESC LIMIT 5000`,
    columns: [{ label: 'Data', value: (r) => new Date(r.criado_em).toISOString() }, { label: 'Usuário', key: 'usuario_nome' }, { label: 'Ação', key: 'acao' },
      { label: 'Entidade', key: 'entidade' }, { label: 'ID', key: 'entidade_id' }]
  }
};

export const REPORT_TYPES = Object.fromEntries(Object.entries(REPORTS).map(([k, r]) => [k, r.title]));

export async function runReport(type, query) {
  const report = REPORTS[type];
  if (!report) throw new ValidationError({ tipo: 'Relatório inexistente.' });
  const { inicio, fim } = period(query);
  const rows = await db.many(report.sql, [inicio, fim]);
  return { tipo: type, titulo: report.title, inicio, fim, colunas: report.columns.map((c) => c.label), linhas: rows };
}

export async function reportCsv(type, query, req) {
  const report = REPORTS[type];
  const data = await runReport(type, query);
  await audit(req, 'exportar_relatorio', 'relatorio', type, { inicio: data.inicio, fim: data.fim, linhas: data.linhas.length });
  return toCsv(report.columns, data.linhas);
}

export async function listAudit(query = {}) {
  const p = pagination(query, { defaultLimit: 50 });
  const params = [];
  const where = [];
  if (query.entidade) { params.push(String(query.entidade).slice(0, 60)); where.push(`entidade = $${params.length}`); }
  if (query.usuario_id) { params.push(Number(query.usuario_id) || 0); where.push(`usuario_id = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.inicio || '')) { params.push(query.inicio); where.push(`criado_em >= $${params.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.fim || '')) { params.push(query.fim); where.push(`criado_em < $${params.length}::date + 1`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await db.one(`SELECT count(*)::int total FROM auditoria ${w}`, params);
  const rows = await db.many(`SELECT * FROM auditoria ${w} ORDER BY criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

// ------------------------------------------------------------- notificações
function visibleFilter(user) {
  return { sql: `(n.usuario_id = $1 OR (n.usuario_id IS NULL AND (n.permissao IS NULL OR $2 OR n.permissao = ANY($3))))`,
    params: [user.id, user.roles.includes('administrador'), [...user.permissions]] };
}

export async function listNotifications(user) {
  const f = visibleFilter(user);
  const rows = await db.many(
    `SELECT n.*, (nl.lida_em IS NOT NULL) AS lida FROM notificacoes n
       LEFT JOIN notificacoes_lidas nl ON nl.notificacao_id = n.id AND nl.usuario_id = $1
      WHERE ${f.sql} AND n.criado_em > now() - interval '60 days' ORDER BY n.criado_em DESC LIMIT 50`, f.params);
  return { itens: rows, nao_lidas: rows.filter((r) => !r.lida).length };
}

export async function markNotificationsRead(user, ids = null) {
  const f = visibleFilter(user);
  await db.query(
    `INSERT INTO notificacoes_lidas (notificacao_id, usuario_id)
     SELECT n.id, $1 FROM notificacoes n WHERE ${f.sql} AND ($4::bigint[] IS NULL OR n.id = ANY($4)) ON CONFLICT DO NOTHING`,
    [...f.params, Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : null]);
}
