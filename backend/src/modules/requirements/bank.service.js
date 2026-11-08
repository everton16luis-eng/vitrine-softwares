// Banco de perguntas do Levantamento de Requisitos: etapas, categorias e perguntas.
// Alterações aqui valem só para levantamentos criados depois: os existentes guardam a própria
// fotografia do roteiro (lr_roteiro_*).
import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { badRequest, conflict, notFound, ValidationError } from '../../utils/errors.js';
import { parse, v } from '../../utils/validation.js';
import { QUESTION_TYPES, normalizeOptions } from './answers.js';

const stageSchema = {
  titulo: v.string({ min: 2, max: 160 }),
  descricao: v.text({ max: 2000, nullable: true }),
  ativa: v.bool({ default: true })
};
const categorySchema = {
  titulo: v.string({ min: 2, max: 120 }),
  descricao: v.text({ max: 1000, nullable: true }),
  ativa: v.bool({ default: true })
};
const questionSchema = {
  etapa_id: v.id(),
  categoria_id: v.id({ nullable: true }),
  enunciado: v.string({ min: 3, max: 500 }),
  orientacao: v.text({ max: 2000, nullable: true }),
  tipo: v.enum(Object.keys(QUESTION_TYPES)),
  obrigatoria: v.bool({ default: false }),
  ativa: v.bool({ default: true }),
  opcoes: (raw) => ({ value: raw })
};

/** Roteiro completo (inclusive itens inativos) para a tela "Gerenciar perguntas". */
export async function getBank() {
  const [etapas, categorias, perguntas, usos] = await Promise.all([
    db.many('SELECT * FROM lr_etapas ORDER BY ordem, id'),
    db.many('SELECT * FROM lr_categorias ORDER BY ordem, id'),
    db.many(`SELECT p.*, c.titulo AS categoria_titulo FROM lr_perguntas p LEFT JOIN lr_categorias c ON c.id = p.categoria_id ORDER BY p.ordem, p.id`),
    db.many('SELECT origem_pergunta_id AS id, count(DISTINCT levantamento_id)::int AS n FROM lr_roteiro_perguntas WHERE origem_pergunta_id IS NOT NULL GROUP BY 1')
  ]);
  const usedIn = new Map(usos.map((u) => [u.id, u.n]));
  return {
    tipos: QUESTION_TYPES,
    categorias,
    etapas: etapas.map((e) => ({
      ...e,
      perguntas: perguntas.filter((p) => p.etapa_id === e.id).map((p) => ({ ...p, levantamentos: usedIn.get(p.id) || 0 }))
    }))
  };
}

// ------------------------------------------------------------------ etapas
export async function createStage(input, req) {
  const value = parse(stageSchema, input);
  return withTransaction(async (tx) => {
    const { max } = await tx.one('SELECT COALESCE(max(ordem), 0)::int AS max FROM lr_etapas');
    const row = await tx.one('INSERT INTO lr_etapas (titulo, descricao, ativa, ordem) VALUES ($1,$2,$3,$4) RETURNING *', [value.titulo, value.descricao ?? null, value.ativa, max + 10]);
    await audit(req, 'criar', 'lr_etapa', row.id, value, tx);
    return row;
  });
}

export async function updateStage(id, input, req) {
  const value = parse(stageSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_etapas WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Etapa');
    const next = { ...cur, ...value };
    const row = await tx.one('UPDATE lr_etapas SET titulo = $2, descricao = $3, ativa = $4 WHERE id = $1 RETURNING *', [id, next.titulo, next.descricao, next.ativa]);
    await audit(req, 'editar', 'lr_etapa', id, { antes: pick(cur, value), depois: value }, tx);
    return row;
  });
}

export async function deleteStage(id, req) {
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_etapas WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Etapa');
    if (cur.padrao) throw conflict('Etapas do roteiro inicial não podem ser excluídas. Desative-a, se não quiser mais usá-la.');
    const { n } = await tx.one('SELECT count(*)::int AS n FROM lr_perguntas WHERE etapa_id = $1', [id]);
    if (n) throw conflict('Mova ou exclua as perguntas desta etapa antes de excluí-la.');
    await tx.query('DELETE FROM lr_etapas WHERE id = $1', [id]);
    await audit(req, 'excluir', 'lr_etapa', id, { titulo: cur.titulo }, tx);
  });
}

// ------------------------------------------------------------------ categorias
const categoryKey = (titulo) => titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'categoria';

export async function createCategory(input, req) {
  const value = parse(categorySchema, input);
  return withTransaction(async (tx) => {
    let chave = categoryKey(value.titulo);
    if (!/^[a-z]/.test(chave)) chave = `c_${chave}`.slice(0, 32);
    for (let i = 2; await tx.one('SELECT 1 FROM lr_categorias WHERE chave = $1', [chave]); i++) chave = `${chave.replace(/_\d+$/, '')}_${i}`;
    const { max } = await tx.one('SELECT COALESCE(max(ordem), 0)::int AS max FROM lr_categorias');
    const row = await tx.one('INSERT INTO lr_categorias (chave, titulo, descricao, ativa, ordem) VALUES ($1,$2,$3,$4,$5) RETURNING *', [chave, value.titulo, value.descricao ?? null, value.ativa, max + 10]);
    await audit(req, 'criar', 'lr_categoria', row.id, value, tx);
    return row;
  });
}

export async function updateCategory(id, input, req) {
  const value = parse(categorySchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_categorias WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Categoria');
    const next = { ...cur, ...value };
    const row = await tx.one('UPDATE lr_categorias SET titulo = $2, descricao = $3, ativa = $4 WHERE id = $1 RETURNING *', [id, next.titulo, next.descricao, next.ativa]);
    await audit(req, 'editar', 'lr_categoria', id, { antes: pick(cur, value), depois: value }, tx);
    return row;
  });
}

export async function deleteCategory(id, req) {
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_categorias WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Categoria');
    if (cur.padrao) throw conflict('Categorias do roteiro inicial não podem ser excluídas. Desative-a, se não quiser mais usá-la.');
    await tx.query('DELETE FROM lr_categorias WHERE id = $1', [id]); // perguntas ficam sem categoria (SET NULL)
    await audit(req, 'excluir', 'lr_categoria', id, { titulo: cur.titulo }, tx);
  });
}

// ------------------------------------------------------------------ perguntas
async function checkRefs(tx, { etapa_id: etapaId, categoria_id: categoriaId }) {
  if (etapaId !== undefined && !(await tx.one('SELECT 1 FROM lr_etapas WHERE id = $1', [etapaId]))) throw new ValidationError({ etapa_id: 'Etapa inexistente.' });
  if (categoriaId && !(await tx.one('SELECT 1 FROM lr_categorias WHERE id = $1', [categoriaId]))) throw new ValidationError({ categoria_id: 'Categoria inexistente.' });
}

export async function createQuestion(input, req) {
  const value = parse(questionSchema, input);
  value.opcoes = normalizeOptions(value.tipo, value.opcoes);
  return withTransaction(async (tx) => {
    await checkRefs(tx, value);
    const { max } = await tx.one('SELECT COALESCE(max(ordem), 0)::int AS max FROM lr_perguntas WHERE etapa_id = $1', [value.etapa_id]);
    const row = await tx.one(`INSERT INTO lr_perguntas (etapa_id, categoria_id, enunciado, orientacao, tipo, obrigatoria, ativa, opcoes, ordem, personalizada, criado_por, atualizado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10) RETURNING *`,
    [value.etapa_id, value.categoria_id ?? null, value.enunciado, value.orientacao ?? null, value.tipo, value.obrigatoria, value.ativa, JSON.stringify(value.opcoes), max + 10, req.user.id]);
    await audit(req, 'criar', 'lr_pergunta', row.id, value, tx);
    return row;
  });
}

export async function updateQuestion(id, input, req) {
  const value = parse(questionSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_perguntas WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Pergunta');
    const next = { ...cur, ...value };
    next.opcoes = normalizeOptions(next.tipo, 'opcoes' in value ? value.opcoes : cur.opcoes);
    await checkRefs(tx, value);
    let ordem = cur.ordem;
    if (next.etapa_id !== cur.etapa_id) ordem = (await tx.one('SELECT COALESCE(max(ordem), 0)::int + 10 AS o FROM lr_perguntas WHERE etapa_id = $1', [next.etapa_id])).o;
    const row = await tx.one(`UPDATE lr_perguntas SET etapa_id = $2, categoria_id = $3, enunciado = $4, orientacao = $5, tipo = $6, obrigatoria = $7, ativa = $8,
        opcoes = $9, ordem = $10, revisao = revisao + 1, atualizado_por = $11 WHERE id = $1 RETURNING *`,
    [id, next.etapa_id, next.categoria_id, next.enunciado, next.orientacao, next.tipo, next.obrigatoria, next.ativa, JSON.stringify(next.opcoes), ordem, req.user.id]);
    await audit(req, 'editar', 'lr_pergunta', id, { antes: pick(cur, value), depois: value, revisao: row.revisao }, tx);
    return row;
  });
}

export async function duplicateQuestion(id, req) {
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_perguntas WHERE id = $1', [id]);
    if (!cur) throw notFound('Pergunta');
    // Abre espaço logo abaixo da original.
    await tx.query('UPDATE lr_perguntas SET ordem = ordem + 10 WHERE etapa_id = $1 AND ordem > $2', [cur.etapa_id, cur.ordem]);
    const row = await tx.one(`INSERT INTO lr_perguntas (etapa_id, categoria_id, enunciado, orientacao, tipo, obrigatoria, ativa, opcoes, ordem, personalizada, criado_por, atualizado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10) RETURNING *`,
    [cur.etapa_id, cur.categoria_id, `${cur.enunciado.slice(0, 488)} (cópia)`, cur.orientacao, cur.tipo, cur.obrigatoria, cur.ativa, JSON.stringify(cur.opcoes), cur.ordem + 10, req.user.id]);
    await audit(req, 'duplicar', 'lr_pergunta', row.id, { origem: id }, tx);
    return row;
  });
}

export async function deleteQuestion(id, req) {
  return withTransaction(async (tx) => {
    const cur = await tx.one('SELECT * FROM lr_perguntas WHERE id = $1 FOR UPDATE', [id]);
    if (!cur) throw notFound('Pergunta');
    if (!cur.personalizada) throw conflict('Perguntas do roteiro inicial não podem ser excluídas. Desative-a para que não apareça em novos levantamentos.');
    // Levantamentos que já usaram a pergunta não são afetados: guardam a própria cópia.
    await tx.query('DELETE FROM lr_perguntas WHERE id = $1', [id]);
    await audit(req, 'excluir', 'lr_pergunta', id, { enunciado: cur.enunciado }, tx);
  });
}

/** Reordena etapas, categorias ou perguntas de uma etapa. A lista deve conter exatamente os itens do grupo. */
export async function reorder(kind, input, req) {
  const ids = input?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => !Number.isInteger(x) || x < 1) || new Set(ids).size !== ids.length) throw badRequest('Lista de ordenação inválida.');
  const cfg = {
    etapas: { table: 'lr_etapas', where: 'true', params: [], entity: 'lr_etapa' },
    categorias: { table: 'lr_categorias', where: 'true', params: [], entity: 'lr_categoria' },
    perguntas: { table: 'lr_perguntas', where: 'etapa_id = $1', params: [Number(input.etapa_id)], entity: 'lr_pergunta' }
  }[kind];
  if (!cfg) throw notFound('Lista');
  if (kind === 'perguntas' && !(Number.isInteger(cfg.params[0]) && cfg.params[0] > 0)) throw badRequest('Informe a etapa.');
  return withTransaction(async (tx) => {
    const current = (await tx.many(`SELECT id FROM ${cfg.table} WHERE ${cfg.where} FOR UPDATE`, cfg.params)).map((r) => r.id);
    if (current.length !== ids.length || ids.some((x) => !current.includes(x))) throw badRequest('A lista de ordenação não corresponde aos itens atuais. Recarregue a página.');
    for (let i = 0; i < ids.length; i++) await tx.query(`UPDATE ${cfg.table} SET ordem = $2 WHERE id = $1`, [ids[i], (i + 1) * 10]);
    await audit(req, 'reordenar', cfg.entity, kind === 'perguntas' ? cfg.params[0] : null, { ids }, tx);
    return { ok: true };
  });
}

function pick(row, keys) {
  return Object.fromEntries(Object.keys(keys).map((k) => [k, row[k]]));
}
