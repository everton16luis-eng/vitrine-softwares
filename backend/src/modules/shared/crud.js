// Fábrica de serviços CRUD para entidades administrativas simples.
// Os nomes de colunas vêm sempre do código (schema), nunca da requisição;
// os valores são sempre parâmetros ($n).
import { Router } from 'express';
import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { parse, parseId } from '../../utils/validation.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { toDecimal } from '../../utils/money.js';
import { requirePermission } from '../../middlewares/auth.js';

export const toDb = (value) => (typeof value === 'bigint' ? toDecimal(value) : value);

export function buildInsert(table, data) {
  const keys = Object.keys(data);
  const cols = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  return { sql: `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`, params: keys.map((k) => toDb(data[k])) };
}

export function buildUpdate(table, id, data, idColumn = 'id') {
  const keys = Object.keys(data);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  return { sql: `UPDATE ${table} SET ${sets} WHERE ${idColumn} = $1 RETURNING *`, params: [id, ...keys.map((k) => toDb(data[k]))] };
}

/**
 * @param {object} cfg
 * @param {string} cfg.table
 * @param {string} cfg.entity     nome usado na auditoria
 * @param {string} cfg.label      nome amigável (mensagens)
 * @param {object} cfg.schema     regras de validação (utils/validation)
 * @param {string[]} [cfg.search] colunas pesquisáveis por ILIKE
 * @param {object} [cfg.filters]  { param: { column, rule } }
 * @param {string} [cfg.orderBy]
 * @param {string} [cfg.select]   SELECT customizado (deve expor a tabela com alias "t")
 * @param {Function} [cfg.beforeSave] (value, { id, tx, current }) => void | Promise
 * @param {Function} [cfg.beforeDelete] (row, { tx }) => void | Promise
 * @param {Function} [cfg.prepare] (value, { id, current }) => value
 */
export function createCrud(cfg) {
  const { table, entity, label, schema, search = [], filters = {}, orderBy = 't.id DESC' } = cfg;
  const select = cfg.select || `SELECT t.* FROM ${table} t`;

  async function list(query = {}) {
    const p = pagination(query);
    const params = [];
    const where = [];
    if (query.busca && search.length) {
      params.push(likeTerm(query.busca));
      where.push(`(${search.map((c) => `t.${c} ILIKE $${params.length}`).join(' OR ')})`);
    }
    for (const [param, f] of Object.entries(filters)) {
      if (query[param] === undefined || query[param] === '') continue;
      const r = f.rule(query[param]);
      if (r.error || r.value === undefined) continue;
      params.push(r.value);
      where.push(`t.${f.column} = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { total } = await db.one(`SELECT count(*)::int AS total FROM ${table} t ${whereSql}`, params);
    const rows = await db.many(`${select} ${whereSql} ORDER BY ${orderBy} LIMIT ${p.limit} OFFSET ${p.offset}`, params);
    return paged(rows, total, p);
  }

  async function get(id, conn = db) {
    const row = await conn.one(`${select} WHERE t.id = $1`, [id]);
    if (!row) throw notFound(label);
    return row;
  }

  async function create(input, req) {
    let value = parse(schema, input);
    if (cfg.prepare) value = await cfg.prepare(value, {});
    return withTransaction(async (tx) => {
      if (cfg.beforeSave) await cfg.beforeSave(value, { tx });
      const { sql, params } = buildInsert(table, value);
      const row = await tx.one(sql, params);
      await audit(req, 'criar', entity, row.id, value, tx);
      return row;
    });
  }

  async function update(id, input, req) {
    return withTransaction(async (tx) => {
      const current = await tx.one(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!current) throw notFound(label);
      let value = parse(schema, input, { partial: true });
      if (cfg.prepare) value = await cfg.prepare(value, { id, current });
      if (cfg.beforeSave) await cfg.beforeSave(value, { id, tx, current });
      if (!Object.keys(value).length) return current;
      const { sql, params } = buildUpdate(table, id, value);
      const row = await tx.one(sql, params);
      await audit(req, 'editar', entity, id, value, tx);
      return row;
    });
  }

  async function remove(id, req) {
    return withTransaction(async (tx) => {
      const current = await tx.one(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      if (!current) throw notFound(label);
      if (cfg.beforeDelete) await cfg.beforeDelete(current, { tx });
      await tx.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      await audit(req, 'excluir', entity, id, {}, tx);
    });
  }

  return { list, get, create, update, remove };
}

/** Rotas REST padrão para um serviço CRUD. */
export function crudRouter(service, { view, edit, remove = edit } = {}) {
  const router = Router();
  router.get('/', requirePermission(view), async (req, res) => res.json(await service.list(req.query)));
  router.get('/:id', requirePermission(view), async (req, res) => res.json(await service.get(parseId(req.params.id))));
  router.post('/', requirePermission(edit), async (req, res) => res.status(201).json(await service.create(req.body, req)));
  router.put('/:id', requirePermission(edit), async (req, res) => res.json(await service.update(parseId(req.params.id), req.body, req)));
  if (remove) {
    router.delete('/:id', requirePermission(remove), async (req, res) => {
      await service.remove(parseId(req.params.id), req);
      res.status(204).end();
    });
  }
  return router;
}

/** Atualiza a coluna "ordem" de vários registros de uma vez. */
export async function reorder(table, ids, req, entity) {
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    throw badRequest('Lista de ordenação inválida.');
  }
  await withTransaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) await tx.query(`UPDATE ${table} SET ordem = $2 WHERE id = $1`, [ids[i], (i + 1) * 10]);
    await audit(req, 'reordenar', entity, null, { ids }, tx);
  });
}
