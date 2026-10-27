import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { v, parse } from '../../utils/validation.js';
import { notFound, ValidationError } from '../../utils/errors.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { buildInsert, buildUpdate } from '../shared/crud.js';

export const TIPOS_COBRANCA = ['licenca_perpetua', 'assinatura_mensal', 'assinatura_anual', 'implantacao_unica', 'sob_orcamento', 'personalizado'];
const PERIODICIDADE_PADRAO = {
  licenca_perpetua: 'unica', assinatura_mensal: 'mensal', assinatura_anual: 'anual',
  implantacao_unica: 'unica', sob_orcamento: 'nao_aplicavel', personalizado: 'nao_aplicavel'
};

const planSchema = {
  nome: v.string({ min: 2, max: 120 }),
  descricao: v.text({ max: 3000, nullable: true }),
  tipo_cobranca: v.enum(TIPOS_COBRANCA),
  preco: v.money({ nullable: true }),
  moeda: v.currency(),
  periodicidade: v.enum(['unica', 'mensal', 'anual', 'nao_aplicavel'], { optional: true }),
  limites: v.text({ max: 2000, nullable: true }),
  ativo: v.bool({ default: true }),
  ordem: v.int({ min: 0, max: 100000, default: 0 })
};
const relationsSchema = {
  funcionalidades: v.array(v.string({ min: 2, max: 200 }), { max: 40, optional: true }),
  produtos: v.array(v.id(), { max: 100, optional: true })
};

function checkPrice(value, current = {}) {
  const tipo = value.tipo_cobranca ?? current.tipo_cobranca;
  const preco = 'preco' in value ? value.preco : current.preco;
  if (!['sob_orcamento', 'personalizado'].includes(tipo) && (preco === null || preco === undefined)) {
    throw new ValidationError({ preco: 'Informe o preço para este tipo de cobrança.' });
  }
  if (value.tipo_cobranca && !value.periodicidade) value.periodicidade = PERIODICIDADE_PADRAO[value.tipo_cobranca];
}

async function saveRelations(tx, planId, rel) {
  if (rel.funcionalidades) {
    await tx.query('DELETE FROM plano_funcionalidades WHERE plano_id = $1', [planId]);
    for (const [i, desc] of rel.funcionalidades.entries()) {
      await tx.query('INSERT INTO plano_funcionalidades (plano_id, descricao, ordem) VALUES ($1,$2,$3)', [planId, desc, i]);
    }
  }
  if (rel.produtos) {
    await tx.query('DELETE FROM planos_produtos WHERE plano_id = $1', [planId]);
    if (rel.produtos.length) {
      await tx.query('INSERT INTO planos_produtos (plano_id, produto_id) SELECT $1, id FROM produtos WHERE id = ANY($2)', [planId, rel.produtos]);
    }
  }
}

export async function listPlans(query = {}) {
  const p = pagination(query, { defaultLimit: 50 });
  const params = [];
  const where = [];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`p.nome ILIKE $${params.length}`); }
  if (query.produto_id) { params.push(Number(query.produto_id) || 0); where.push(`EXISTS (SELECT 1 FROM planos_produtos pp WHERE pp.plano_id = p.id AND pp.produto_id = $${params.length})`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await db.one(`SELECT count(*)::int total FROM planos p ${w}`, params);
  const rows = await db.many(
    `SELECT p.*, (SELECT coalesce(json_agg(pr.nome ORDER BY pr.nome), '[]') FROM planos_produtos pp JOIN produtos pr ON pr.id = pp.produto_id WHERE pp.plano_id = p.id) AS produtos_nomes
       FROM planos p ${w} ORDER BY p.ordem, p.nome LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function getPlan(id) {
  const plan = await db.one('SELECT * FROM planos WHERE id = $1', [id]);
  if (!plan) throw notFound('Plano');
  plan.funcionalidades = (await db.many('SELECT descricao FROM plano_funcionalidades WHERE plano_id = $1 ORDER BY ordem', [id])).map((r) => r.descricao);
  plan.produtos = (await db.many('SELECT produto_id FROM planos_produtos WHERE plano_id = $1', [id])).map((r) => r.produto_id);
  return plan;
}

export async function createPlan(input, req) {
  const value = parse(planSchema, input);
  const rel = parse(relationsSchema, input);
  checkPrice(value);
  const id = await withTransaction(async (tx) => {
    const { sql, params } = buildInsert('planos', value);
    const row = await tx.one(sql, params);
    await saveRelations(tx, row.id, rel);
    await audit(req, 'criar', 'plano', row.id, { ...value, ...rel }, tx);
    return row.id;
  });
  return getPlan(id);
}

export async function updatePlan(id, input, req) {
  await withTransaction(async (tx) => {
    const current = await tx.one('SELECT * FROM planos WHERE id = $1 FOR UPDATE', [id]);
    if (!current) throw notFound('Plano');
    const value = parse(planSchema, input, { partial: true });
    const rel = parse(relationsSchema, input, { partial: true });
    checkPrice(value, current);
    if (Object.keys(value).length) {
      const { sql, params } = buildUpdate('planos', id, value);
      await tx.query(sql, params);
    }
    await saveRelations(tx, id, rel);
    await audit(req, 'editar', 'plano', id, { ...value, ...rel }, tx);
  });
  return getPlan(id);
}

export async function deletePlan(id, req) {
  const used = await db.one(
    `SELECT (SELECT count(*) FROM pedido_itens WHERE plano_id = $1) + (SELECT count(*) FROM orcamento_itens WHERE plano_id = $1) AS n`, [id]);
  if (Number(used.n) > 0) {
    // Preserva o histórico comercial: o plano é apenas desativado.
    await db.query('UPDATE planos SET ativo = false WHERE id = $1', [id]);
    await audit(req, 'desativar', 'plano', id, { motivo: 'possui histórico comercial' });
    return { desativado: true };
  }
  const { rowCount } = await db.query('DELETE FROM planos WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Plano');
  await audit(req, 'excluir', 'plano', id);
  return { excluido: true };
}

/** Planos ativos de um produto, com funcionalidades (uso público). */
export async function plansForProduct(productId) {
  const plans = await db.many(
    `SELECT p.* FROM planos p JOIN planos_produtos pp ON pp.plano_id = p.id
      WHERE pp.produto_id = $1 AND p.ativo ORDER BY p.ordem, p.nome`, [productId]);
  if (!plans.length) return [];
  const feats = await db.many('SELECT plano_id, descricao FROM plano_funcionalidades WHERE plano_id = ANY($1) ORDER BY ordem', [plans.map((p) => p.id)]);
  return plans.map((p) => ({ ...p, funcionalidades: feats.filter((f) => f.plano_id === p.id).map((f) => f.descricao) }));
}
