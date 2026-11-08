// Clientes e projetos da descoberta (repositório de levantamentos).
import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { notFound, ValidationError } from '../../utils/errors.js';
import { parse, v } from '../../utils/validation.js';
import { likeTerm, pagination, paged } from '../../utils/common.js';
import { PROJECT_STATUS } from './answers.js';

export const clientSchema = {
  nome: v.string({ min: 2, max: 160 }),
  empresa: v.string({ max: 160, nullable: true }),
  email: v.email({ nullable: true }),
  telefone: v.phone({ nullable: true }),
  observacoes: v.text({ max: 5000, nullable: true }),
  cliente_id: v.id({ nullable: true }),
  lead_id: v.id({ nullable: true })
};
export const projectSchema = {
  nome: v.string({ min: 2, max: 200 }),
  descricao: v.text({ max: 5000, nullable: true }),
  situacao: v.enum(Object.keys(PROJECT_STATUS), { default: 'em_descoberta' })
};

async function checkLinks(conn, value) {
  if (value.cliente_id && !(await conn.one('SELECT 1 FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [value.cliente_id]))) {
    throw new ValidationError({ cliente_id: 'Cliente comercial inexistente.' });
  }
  if (value.lead_id && !(await conn.one('SELECT 1 FROM leads WHERE id = $1', [value.lead_id]))) throw new ValidationError({ lead_id: 'Lead inexistente.' });
}

export async function listClients(query = {}) {
  const p = pagination(query, { defaultLimit: 20, maxLimit: 200 });
  const params = [];
  let where = '';
  if (query.busca) {
    params.push(likeTerm(query.busca));
    where = `WHERE (c.nome ILIKE $1 OR c.empresa ILIKE $1 OR c.email ILIKE $1)`;
  }
  const { total } = await db.one(`SELECT count(*)::int AS total FROM lr_clientes c ${where}`, params);
  const rows = await db.many(`SELECT c.*,
      (SELECT count(*)::int FROM lr_projetos p WHERE p.cliente_id = c.id) AS projetos,
      (SELECT count(*)::int FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id WHERE p.cliente_id = c.id) AS levantamentos,
      (SELECT max(l.data_reuniao) FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id WHERE p.cliente_id = c.id) AS ultima_reuniao
    FROM lr_clientes c ${where} ORDER BY lower(c.nome), c.id LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

/** Opções enxutas para os seletores (cliente → projetos). */
export async function clientOptions() {
  const clientes = await db.many('SELECT id, nome, empresa FROM lr_clientes ORDER BY lower(nome), id');
  const projetos = await db.many('SELECT id, cliente_id, nome, situacao FROM lr_projetos ORDER BY lower(nome), id');
  return { clientes, projetos };
}

export async function getClient(id) {
  const c = await db.one(`SELECT c.*, cc.nome AS cliente_comercial_nome, ld.nome AS lead_nome FROM lr_clientes c
    LEFT JOIN clientes cc ON cc.id = c.cliente_id LEFT JOIN leads ld ON ld.id = c.lead_id WHERE c.id = $1`, [id]);
  if (!c) throw notFound('Cliente');
  c.projetos = await db.many(`SELECT p.*, (SELECT count(*)::int FROM levantamentos l WHERE l.projeto_id = p.id) AS levantamentos
    FROM lr_projetos p WHERE p.cliente_id = $1 ORDER BY p.criado_em DESC, p.id DESC`, [id]);
  c.levantamentos = await db.many(`SELECT l.id, l.codigo, l.status, l.data_reuniao, l.responsavel_nome, l.criado_em, p.id AS projeto_id, p.nome AS projeto_nome,
      (SELECT max(numero) FROM lr_versoes v WHERE v.levantamento_id = l.id) AS versao
    FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id WHERE p.cliente_id = $1 ORDER BY l.data_reuniao DESC, l.id DESC`, [id]);
  return c;
}

export async function createClient(input, req, conn = null) {
  const value = parse(clientSchema, input);
  const run = async (tx) => {
    await checkLinks(tx, value);
    const row = await tx.one(`INSERT INTO lr_clientes (nome, empresa, email, telefone, observacoes, cliente_id, lead_id, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [value.nome, value.empresa ?? null, value.email ?? null, value.telefone ?? null, value.observacoes ?? null, value.cliente_id ?? null, value.lead_id ?? null, req.user.id]);
    await audit(req, 'criar', 'lr_cliente', row.id, value, tx);
    return row;
  };
  return conn ? run(conn) : withTransaction(run);
}

export async function updateClient(id, input, req) {
  const value = parse(clientSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_clientes WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Cliente');
    await checkLinks(tx, value);
    const n = { ...cur, ...value };
    const row = await tx.one(`UPDATE lr_clientes SET nome = $2, empresa = $3, email = $4, telefone = $5, observacoes = $6, cliente_id = $7, lead_id = $8
      WHERE id = $1 RETURNING *`, [id, n.nome, n.empresa, n.email, n.telefone, n.observacoes, n.cliente_id, n.lead_id]);
    await audit(req, 'editar', 'lr_cliente', id, value, tx);
    return row;
  });
}

export async function getProject(id) {
  const p = await db.one(`SELECT p.*, c.nome AS cliente_nome, c.empresa AS cliente_empresa FROM lr_projetos p
    JOIN lr_clientes c ON c.id = p.cliente_id WHERE p.id = $1`, [id]);
  if (!p) throw notFound('Projeto');
  p.levantamentos = await db.many(`SELECT l.id, l.codigo, l.status, l.data_reuniao, l.responsavel_nome, l.criado_em, l.concluido_em, l.origem_id,
      (SELECT max(numero) FROM lr_versoes v WHERE v.levantamento_id = l.id) AS versao,
      (SELECT count(*)::int FROM lr_relatorios r WHERE r.levantamento_id = l.id) AS relatorios
    FROM levantamentos l WHERE l.projeto_id = $1 ORDER BY l.data_reuniao DESC, l.id DESC`, [id]);
  return p;
}

export async function createProject(clienteId, input, req, conn = null) {
  const value = parse(projectSchema, input);
  const run = async (tx) => {
    if (!(await tx.one('SELECT 1 FROM lr_clientes WHERE id = $1', [clienteId]))) throw new ValidationError({ cliente_id: 'Cliente inexistente.' });
    const row = await tx.one('INSERT INTO lr_projetos (cliente_id, nome, descricao, situacao, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [clienteId, value.nome, value.descricao ?? null, value.situacao, req.user.id]);
    await audit(req, 'criar', 'lr_projeto', row.id, { cliente_id: clienteId, ...value }, tx);
    return row;
  };
  return conn ? run(conn) : withTransaction(run);
}

export async function updateProject(id, input, req) {
  const value = parse(projectSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_projetos WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Projeto');
    const n = { ...cur, ...value };
    const row = await tx.one('UPDATE lr_projetos SET nome = $2, descricao = $3, situacao = $4 WHERE id = $1 RETURNING *', [id, n.nome, n.descricao, n.situacao]);
    await audit(req, 'editar', 'lr_projeto', id, { antes: { situacao: cur.situacao }, ...value }, tx);
    return row;
  });
}
