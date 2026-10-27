import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { createCrud } from '../shared/crud.js';
import { v, parse, cleanText } from '../../utils/validation.js';
import { notFound, ValidationError } from '../../utils/errors.js';
import { storage } from '../../services/storage/index.js';
import { assertImage } from '../media/media.service.js';

const CACHE_MS = 30_000;
let cache = null;

/** Mapa chave -> valor de todos os blocos de conteúdo editáveis. */
export async function getContentMap() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const rows = await db.many('SELECT c.chave, c.valor, c.tipo, a.chave AS arquivo_chave, a.texto_alternativo FROM conteudos c LEFT JOIN arquivos a ON a.id = c.arquivo_id');
  const data = {};
  for (const r of rows) {
    data[r.chave] = r.tipo === 'imagem' && r.arquivo_chave ? storage().publicUrl(r.arquivo_chave) : r.valor;
    if (r.tipo === 'imagem') data[`${r.chave}.alt`] = r.texto_alternativo || '';
  }
  cache = { at: Date.now(), data };
  return data;
}

export const listContentBlocks = () => db.many(
  'SELECT c.*, a.chave AS arquivo_chave FROM conteudos c LEFT JOIN arquivos a ON a.id = c.arquivo_id ORDER BY c.grupo, c.ordem, c.chave');

const LIMITS = { texto: 300, texto_longo: 3000, markdown: 20000, link: 500, imagem: 500 };

/** Atualiza vários blocos: [{ chave, valor, arquivo_id }]. Somente chaves existentes. */
export async function updateContentBlocks(items, req) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new ValidationError({ itens: 'Lista inválida.' });
  const errors = {};
  await withTransaction(async (tx) => {
    for (const item of items) {
      const block = await tx.one('SELECT * FROM conteudos WHERE chave = $1', [String(item?.chave || '')]);
      if (!block) { errors[item?.chave || '?'] = 'Bloco inexistente.'; continue; }
      const multiline = ['texto_longo', 'markdown'].includes(block.tipo);
      const valor = cleanText(item.valor ?? '', { multiline });
      if (valor.length > LIMITS[block.tipo]) { errors[block.chave] = `Máximo de ${LIMITS[block.tipo]} caracteres.`; continue; }
      if (block.tipo === 'link' && valor && !/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(valor)) { errors[block.chave] = 'Link inválido.'; continue; }
      let arquivoId = block.arquivo_id;
      if (block.tipo === 'imagem' && 'arquivo_id' in item) {
        arquivoId = item.arquivo_id ? Number(item.arquivo_id) : null;
        await assertImage(arquivoId, tx);
      }
      await tx.query('UPDATE conteudos SET valor = $2, arquivo_id = $3 WHERE chave = $1', [block.chave, valor, arquivoId]);
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await audit(req, 'editar', 'conteudo', null, { chaves: items.map((i) => i.chave) }, tx);
  });
  cache = null;
  return listContentBlocks();
}

export const pagesService = createCrud({
  table: 'paginas',
  entity: 'pagina',
  label: 'Página',
  schema: {
    slug: v.slug(),
    titulo: v.string({ min: 2, max: 200 }),
    conteudo: v.text({ max: 60000, default: '' }),
    tipo: v.enum(['institucional', 'juridica'], { default: 'institucional' }),
    revisao_pendente: v.bool(),
    publicado: v.bool({ default: true }),
    seo_title: v.string({ max: 70, nullable: true }),
    seo_description: v.string({ max: 170, nullable: true })
  },
  search: ['titulo', 'slug'],
  orderBy: 't.tipo, t.titulo',
  async beforeSave(value) {
    const reserved = ['admin', 'cliente', 'api', 'softwares', 'servicos', 'contato', 'orcamento', 'assets', 'uploads', 'vendor', 'sitemap', 'robots', 'redefinir-senha', 'perguntas-frequentes', 'privacidade'];
    if (value.slug && reserved.includes(value.slug)) throw new ValidationError({ slug: 'Este endereço é reservado pelo sistema.' });
  }
});

export const faqsService = createCrud({
  table: 'faqs',
  entity: 'faq',
  label: 'Pergunta',
  schema: {
    pergunta: v.string({ min: 5, max: 300 }),
    resposta: v.text({ min: 2, max: 5000 }),
    ordem: v.int({ min: 0, max: 100000, default: 0 }),
    ativo: v.bool({ default: true })
  },
  search: ['pergunta'],
  orderBy: 't.ordem, t.id'
});

export async function getPublishedPage(slug) {
  const page = await db.one('SELECT * FROM paginas WHERE slug = $1 AND publicado', [String(slug).slice(0, 120)]);
  if (!page) throw notFound('Página');
  return page;
}

export const listPublicFaqs = () => db.many('SELECT pergunta, resposta FROM faqs WHERE ativo ORDER BY ordem, id');
export const listPublishedPages = () => db.many('SELECT slug, titulo, tipo, atualizado_em FROM paginas WHERE publicado ORDER BY tipo, titulo');

// ------------------------------------------------------------- modelos de e-mail
export const listEmailTemplates = () => db.many('SELECT * FROM modelos_email ORDER BY nome');

export async function updateEmailTemplate(chave, input, req) {
  const value = parse({ assunto: v.string({ min: 3, max: 200 }), corpo: v.text({ min: 10, max: 10000 }), ativo: v.bool({ default: true }) }, input);
  const row = await db.one('UPDATE modelos_email SET assunto = $2, corpo = $3, ativo = $4 WHERE chave = $1 RETURNING *', [chave, value.assunto, value.corpo, value.ativo]);
  if (!row) throw notFound('Modelo de e-mail');
  await audit(req, 'editar', 'modelo_email', chave);
  return row;
}

export const emailLog = () => db.many('SELECT id, modelo, destinatario, assunto, status, erro, criado_em FROM emails_registro ORDER BY criado_em DESC LIMIT 100');
