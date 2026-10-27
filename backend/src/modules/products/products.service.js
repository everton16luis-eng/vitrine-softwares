import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { v, parse } from '../../utils/validation.js';
import { conflict, notFound, ValidationError } from '../../utils/errors.js';
import { pagination, paged, likeTerm, slugify, todayIso } from '../../utils/common.js';
import { buildInsert, buildUpdate } from '../shared/crud.js';
import { assertImage } from '../media/media.service.js';
import { storage } from '../../services/storage/index.js';
import { STATUS_COMERCIAL, MODELOS_CONTRATACAO } from './products.constants.js';
import { plansForProduct } from '../plans/plans.service.js';

const statusKeys = Object.keys(STATUS_COMERCIAL);
const modeloKeys = Object.keys(MODELOS_CONTRATACAO);

export const productSchema = {
  categoria_id: v.id(),
  nome: v.string({ min: 2, max: 140 }),
  slug: v.slug({ optional: true }),
  resumo: v.string({ min: 10, max: 400 }),
  descricao: v.text({ max: 20000, nullable: true }),
  problema_resolvido: v.text({ max: 5000, nullable: true }),
  publico_alvo: v.text({ max: 3000, nullable: true }),
  requisitos_tecnicos: v.text({ max: 5000, nullable: true }),
  modelo_contratacao: v.enum(modeloKeys, { default: 'sob_orcamento' }),
  preco: v.money({ nullable: true }),
  moeda: v.currency(),
  preco_descricao: v.string({ max: 80, nullable: true }),
  status_comercial: v.enum(statusKeys.filter((s) => s !== 'arquivado'), { default: 'em_planejamento' }),
  destaque: v.bool(),
  imagem_id: v.id({ nullable: true }),
  imagem_url: v.url({ allowRelative: true, nullable: true }),
  demo_tipo: v.enum(['nenhuma', 'interna', 'externa'], { default: 'nenhuma' }),
  demo_url: v.url({ nullable: true }),
  demo_disponivel: v.bool(),
  demo_aviso: v.string({ max: 300, nullable: true }),
  documentacao_url: v.url({ nullable: true }),
  manual_url: v.url({ nullable: true }),
  video_url: v.url({ nullable: true }),
  seo_title: v.string({ max: 70, nullable: true }),
  seo_description: v.string({ max: 170, nullable: true }),
  ordem: v.int({ min: 0, max: 100000, default: 0 })
};

const featureSchema = {
  tipo: v.enum(['funcionalidade', 'beneficio'], { default: 'funcionalidade' }),
  titulo: v.string({ min: 2, max: 160 }),
  descricao: v.text({ max: 1000, nullable: true }),
  icone: v.string({ max: 40, pattern: /^[a-z0-9-]+$/, nullable: true }),
  ordem: v.int({ min: 0, max: 100000, default: 0 })
};
const imageSchema = {
  arquivo_id: v.id(),
  legenda: v.string({ max: 200, nullable: true }),
  ordem: v.int({ min: 0, max: 100000, default: 0 })
};
const faqSchema = {
  pergunta: v.string({ min: 5, max: 300 }),
  resposta: v.text({ min: 2, max: 3000 }),
  ordem: v.int({ min: 0, max: 100000, default: 0 })
};

const VIDEO_HOSTS = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com)\//;

async function validateProduct(value, current, tx) {
  const merged = { ...(current || {}), ...value };
  const errors = {};
  if (merged.demo_tipo === 'externa' && !merged.demo_url) errors.demo_url = 'Informe a URL da demonstração externa.';
  if (value.video_url && !VIDEO_HOSTS.test(value.video_url)) errors.video_url = 'Use um link do YouTube ou Vimeo.';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  if (value.categoria_id) {
    const cat = await tx.one('SELECT ativa FROM categorias WHERE id = $1', [value.categoria_id]);
    if (!cat) throw new ValidationError({ categoria_id: 'Categoria inexistente.' });
    if (!cat.ativa && merged.publicado) throw new ValidationError({ categoria_id: 'Um produto publicado não pode usar uma categoria inativa.' });
  }
  await assertImage(value.imagem_id, tx);
}

function coverUrl(row) {
  if (row.imagem_chave) return storage().publicUrl(row.imagem_chave);
  return row.imagem_url || '/assets/images/produtos/placeholder.svg';
}

// ------------------------------------------------------------------ admin

export async function adminList(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(p.nome ILIKE $${params.length} OR p.resumo ILIKE $${params.length})`); }
  if (query.categoria_id) { params.push(Number(query.categoria_id) || 0); where.push(`p.categoria_id = $${params.length}`); }
  if (statusKeys.includes(query.status_comercial)) { params.push(query.status_comercial); where.push(`p.status_comercial = $${params.length}`); }
  if (query.publicado === 'true' || query.publicado === 'false') { params.push(query.publicado === 'true'); where.push(`p.publicado = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = await db.one(`SELECT count(*)::int total FROM produtos p ${w}`, params);
  const rows = await db.many(
    `SELECT p.id, p.nome, p.slug, p.resumo, p.status_comercial, p.publicado, p.destaque, p.ordem, p.preco, p.moeda,
            p.modelo_contratacao, p.dados_demonstrativos, p.atualizado_em, c.nome AS categoria_nome, p.imagem_url, a.chave AS imagem_chave,
            coalesce((SELECT sum(total) FROM visualizacoes_produtos vp WHERE vp.produto_id = p.id), 0)::int AS visualizacoes
       FROM produtos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN arquivos a ON a.id = p.imagem_id
       ${w} ORDER BY p.ordem, p.nome LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows.map((r) => ({ ...r, capa_url: coverUrl(r) })), total, p);
}

export async function getProduct(id, conn = db) {
  const product = await conn.one(
    `SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug, c.ativa AS categoria_ativa, a.chave AS imagem_chave, a.texto_alternativo AS imagem_alt
       FROM produtos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN arquivos a ON a.id = p.imagem_id WHERE p.id = $1`, [id]);
  if (!product) throw notFound('Produto');
  return hydrate(product, conn);
}

async function hydrate(product, conn = db) {
  const [features, images, faqs, planos] = await Promise.all([
    conn.many('SELECT * FROM produto_funcionalidades WHERE produto_id = $1 ORDER BY tipo, ordem, id', [product.id]),
    conn.many(
      `SELECT i.*, a.chave, a.texto_alternativo, a.largura, a.altura FROM produto_imagens i
         LEFT JOIN arquivos a ON a.id = i.arquivo_id WHERE i.produto_id = $1 ORDER BY i.ordem, i.id`, [product.id]),
    conn.many('SELECT * FROM produto_faqs WHERE produto_id = $1 ORDER BY ordem, id', [product.id]),
    conn.many('SELECT plano_id FROM planos_produtos WHERE produto_id = $1', [product.id])
  ]);
  return {
    ...product,
    capa_url: coverUrl(product),
    funcionalidades: features.filter((f) => f.tipo === 'funcionalidade'),
    beneficios: features.filter((f) => f.tipo === 'beneficio'),
    imagens: images.map((i) => ({ ...i, url: i.chave ? storage().publicUrl(i.chave) : i.url_estatica })),
    faqs,
    planos_ids: planos.map((p) => p.plano_id)
  };
}

export async function createProduct(input, req) {
  const value = parse(productSchema, input);
  value.slug ||= slugify(value.nome);
  const id = await withTransaction(async (tx) => {
    await validateProduct(value, null, tx);
    const { sql, params } = buildInsert('produtos', value);
    const row = await tx.one(sql, params);
    await audit(req, 'criar', 'produto', row.id, { nome: value.nome, slug: value.slug }, tx);
    return row.id;
  });
  return getProduct(id);
}

export async function updateProduct(id, input, req) {
  await withTransaction(async (tx) => {
    const current = await tx.one('SELECT * FROM produtos WHERE id = $1 FOR UPDATE', [id]);
    if (!current) throw notFound('Produto');
    if (current.status_comercial === 'arquivado') throw conflict('Produto arquivado. Restaure-o antes de editar.');
    const value = parse(productSchema, input, { partial: true });
    await validateProduct(value, current, tx);
    if (Object.keys(value).length) {
      const { sql, params } = buildUpdate('produtos', id, value);
      await tx.query(sql, params);
    }
    await audit(req, 'editar', 'produto', id, { campos: Object.keys(value) }, tx);
  });
  return getProduct(id);
}

export async function setPublished(id, publish, req) {
  await withTransaction(async (tx) => {
    const p = await tx.one(
      'SELECT p.*, c.ativa AS categoria_ativa FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE p.id = $1 FOR UPDATE OF p', [id]);
    if (!p) throw notFound('Produto');
    if (publish) {
      if (p.status_comercial === 'arquivado') throw conflict('Produtos arquivados não podem ser publicados.');
      if (!p.categoria_ativa) throw conflict('A categoria do produto está inativa. Ative-a ou escolha outra antes de publicar.');
    }
    await tx.query(
      'UPDATE produtos SET publicado = $2, publicado_em = CASE WHEN $2 THEN coalesce(publicado_em, now()) ELSE publicado_em END, destaque = CASE WHEN $2 THEN destaque ELSE false END WHERE id = $1',
      [id, publish]
    );
    await audit(req, publish ? 'publicar' : 'despublicar', 'produto', id, { nome: p.nome }, tx);
  });
  return getProduct(id);
}

export async function archiveProduct(id, req) {
  await withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      "UPDATE produtos SET status_comercial = 'arquivado', publicado = false, destaque = false, arquivado_em = now() WHERE id = $1", [id]);
    if (!rowCount) throw notFound('Produto');
    await audit(req, 'arquivar', 'produto', id, {}, tx);
  });
  return getProduct(id);
}

export async function restoreProduct(id, req) {
  const { rowCount } = await db.query(
    "UPDATE produtos SET status_comercial = 'em_planejamento', arquivado_em = NULL WHERE id = $1 AND status_comercial = 'arquivado'", [id]);
  if (!rowCount) throw conflict('O produto não está arquivado.');
  await audit(req, 'restaurar', 'produto', id);
  return getProduct(id);
}

/** Exclusão definitiva apenas sem histórico comercial; caso contrário, oriente o arquivamento. */
export async function deleteProduct(id, req) {
  await withTransaction(async (tx) => {
    const p = await tx.one('SELECT id, nome, publicado FROM produtos WHERE id = $1 FOR UPDATE', [id]);
    if (!p) throw notFound('Produto');
    if (p.publicado) throw conflict('Despublique o produto antes de excluí-lo.');
    const { n } = await tx.one(
      `SELECT ((SELECT count(*) FROM pedido_itens WHERE produto_id = $1) + (SELECT count(*) FROM orcamento_itens WHERE produto_id = $1)
        + (SELECT count(*) FROM orcamentos WHERE produto_id = $1) + (SELECT count(*) FROM licencas WHERE produto_id = $1)
        + (SELECT count(*) FROM contatos WHERE produto_id = $1))::int AS n`, [id]);
    if (n > 0) throw conflict('Este produto possui histórico comercial (contatos, orçamentos, pedidos ou licenças). Use "Arquivar" para preservá-lo.');
    await tx.query('DELETE FROM produtos WHERE id = $1', [id]);
    await audit(req, 'excluir', 'produto', id, { nome: p.nome }, tx);
  });
}

// Itens filhos ---------------------------------------------------------

async function assertProduct(tx, productId) {
  const p = await tx.one('SELECT id FROM produtos WHERE id = $1', [productId]);
  if (!p) throw notFound('Produto');
}

const childTables = {
  funcionalidades: { table: 'produto_funcionalidades', schema: featureSchema, entity: 'produto_funcionalidade' },
  imagens: { table: 'produto_imagens', schema: imageSchema, entity: 'produto_imagem' },
  faqs: { table: 'produto_faqs', schema: faqSchema, entity: 'produto_faq' }
};

export async function addChild(kind, productId, input, req) {
  const cfg = childTables[kind];
  const value = parse(cfg.schema, input);
  return withTransaction(async (tx) => {
    await assertProduct(tx, productId);
    if (kind === 'imagens') await assertImage(value.arquivo_id, tx);
    const { sql, params } = buildInsert(cfg.table, { ...value, produto_id: productId });
    const row = await tx.one(sql, params);
    await audit(req, 'criar', cfg.entity, row.id, { produto_id: productId }, tx);
    return row;
  });
}

export async function updateChild(kind, productId, childId, input, req) {
  const cfg = childTables[kind];
  const value = parse(cfg.schema, input, { partial: true });
  delete value.arquivo_id; // para trocar a imagem, remova e adicione outra
  if (!Object.keys(value).length) throw new ValidationError({}, 'Nada para atualizar.');
  const keys = Object.keys(value);
  const row = await db.one(
    `UPDATE ${cfg.table} SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND produto_id = $2 RETURNING *`,
    [childId, productId, ...keys.map((k) => value[k])]
  );
  if (!row) throw notFound('Item');
  await audit(req, 'editar', cfg.entity, childId, { produto_id: productId });
  return row;
}

export async function deleteChild(kind, productId, childId, req) {
  const cfg = childTables[kind];
  const { rowCount } = await db.query(`DELETE FROM ${cfg.table} WHERE id = $1 AND produto_id = $2`, [childId, productId]);
  if (!rowCount) throw notFound('Item');
  await audit(req, 'excluir', cfg.entity, childId, { produto_id: productId });
}

export async function setProductPlans(productId, planIds, req) {
  const ids = parse({ planos: v.array(v.id(), { max: 50 }) }, { planos: planIds }).planos;
  await withTransaction(async (tx) => {
    await assertProduct(tx, productId);
    await tx.query('DELETE FROM planos_produtos WHERE produto_id = $1', [productId]);
    if (ids.length) await tx.query('INSERT INTO planos_produtos (plano_id, produto_id) SELECT id, $1 FROM planos WHERE id = ANY($2)', [productId, ids]);
    await audit(req, 'associar_planos', 'produto', productId, { planos: ids }, tx);
  });
  return getProduct(productId);
}

// ------------------------------------------------------------------ público

const PUBLIC_FIELDS = `p.id, p.nome, p.slug, p.resumo, p.modelo_contratacao, p.preco, p.moeda, p.preco_descricao, p.status_comercial,
  p.destaque, p.dados_demonstrativos, p.imagem_url, p.demo_tipo, p.demo_disponivel, p.demo_url, c.nome AS categoria_nome, c.slug AS categoria_slug,
  a.chave AS imagem_chave, a.texto_alternativo AS imagem_alt`;

/** Somente produtos publicados, com categoria ativa e não arquivados. */
const PUBLIC_WHERE = "p.publicado AND c.ativa AND p.status_comercial <> 'arquivado'";

export async function listPublic(query = {}) {
  const p = pagination(query, { defaultLimit: 9, maxLimit: 30 });
  const params = [];
  const where = [PUBLIC_WHERE];
  const busca = typeof query.busca === 'string' ? query.busca.trim().slice(0, 100) : '';
  if (busca) {
    params.push(likeTerm(busca));
    const n = params.length;
    where.push(`(p.nome ILIKE $${n} OR p.resumo ILIKE $${n} OR p.descricao ILIKE $${n}
      OR EXISTS (SELECT 1 FROM produto_funcionalidades f WHERE f.produto_id = p.id AND (f.titulo ILIKE $${n} OR f.descricao ILIKE $${n})))`);
  }
  if (typeof query.categoria === 'string' && query.categoria) { params.push(query.categoria); where.push(`c.slug = $${params.length}`); }
  if (modeloKeys.includes(query.modelo)) { params.push(query.modelo); where.push(`p.modelo_contratacao = $${params.length}`); }
  if (statusKeys.includes(query.disponibilidade)) { params.push(query.disponibilidade); where.push(`p.status_comercial = $${params.length}`); }
  const from = 'FROM produtos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN arquivos a ON a.id = p.imagem_id';
  const w = `WHERE ${where.join(' AND ')}`;
  const { total } = await db.one(`SELECT count(*)::int total ${from} ${w}`, params);
  const rows = await db.many(`SELECT ${PUBLIC_FIELDS} ${from} ${w} ORDER BY p.ordem, p.nome LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  const withFeatures = await attachTopFeatures(rows);
  return { ...paged(withFeatures, total, p), filtros: { busca, categoria: query.categoria || '', modelo: query.modelo || '', disponibilidade: query.disponibilidade || '' } };
}

async function attachTopFeatures(rows) {
  if (!rows.length) return rows;
  const feats = await db.many(
    `SELECT produto_id, titulo FROM (
       SELECT produto_id, titulo, row_number() OVER (PARTITION BY produto_id ORDER BY ordem, id) rn
         FROM produto_funcionalidades WHERE produto_id = ANY($1) AND tipo = 'funcionalidade') x WHERE rn <= 4`,
    [rows.map((r) => r.id)]
  );
  return rows.map((r) => ({ ...r, capa_url: coverUrl(r), destaques: feats.filter((f) => f.produto_id === r.id).map((f) => f.titulo) }));
}

export async function listFeatured(limit = 3) {
  const rows = await db.many(
    `SELECT ${PUBLIC_FIELDS} FROM produtos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN arquivos a ON a.id = p.imagem_id
      WHERE ${PUBLIC_WHERE} AND p.destaque ORDER BY p.ordem, p.nome LIMIT $1`, [limit]);
  return attachTopFeatures(rows);
}

export async function getPublicBySlug(slug) {
  const product = await db.one(
    `SELECT p.*, c.nome AS categoria_nome, c.slug AS categoria_slug, a.chave AS imagem_chave, a.texto_alternativo AS imagem_alt
       FROM produtos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN arquivos a ON a.id = p.imagem_id
      WHERE p.slug = $1 AND ${PUBLIC_WHERE}`, [String(slug).slice(0, 160)]);
  if (!product) throw notFound('Software');
  const full = await hydrate(product);
  full.planos = await plansForProduct(product.id);
  return full;
}

export async function listPublicSlugs() {
  return db.many(`SELECT p.slug, p.atualizado_em FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE ${PUBLIC_WHERE} ORDER BY p.ordem`);
}

/** Contagem agregada por dia, sem dados pessoais. Ignora robôs conhecidos. */
export async function recordView(productId, userAgent = '') {
  if (/bot|crawl|spider|slurp|preview|lighthouse|headless/i.test(userAgent)) return;
  await db.query(
    `INSERT INTO visualizacoes_produtos (produto_id, data, total) VALUES ($1, $2, 1)
     ON CONFLICT (produto_id, data) DO UPDATE SET total = visualizacoes_produtos.total + 1`, [productId, todayIso()]);
}

export const listForSelect = () => db.many("SELECT id, nome, slug, publicado, status_comercial FROM produtos WHERE status_comercial <> 'arquivado' ORDER BY ordem, nome");
