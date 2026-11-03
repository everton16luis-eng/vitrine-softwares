// Clientes e parceiros da página inicial: cadastro, logomarcas padronizadas e lista pública.
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { db, withTransaction } from '../../database/pool.js';
import { storage } from '../../services/storage/index.js';
import { audit } from '../../services/audit.js';
import { ValidationError, notFound, AppError } from '../../utils/errors.js';
import { v } from '../../utils/validation.js';
import { createCrud } from '../shared/crud.js';
import { processLogo, detectLogoType, LOGO_TYPES, LogoError } from './logo-processor.js';

const PUBLIC_LIMIT = 60;

const base = createCrud({
  table: 'parceiros',
  entity: 'parceiro',
  label: 'Cliente/parceiro',
  schema: {
    nome: v.string({ min: 2, max: 150 }),
    site_url: v.url({ nullable: true }),
    ativo: v.bool({ default: true }),
    divulgacao_autorizada: v.bool({ default: false }),
    ordem: v.int({ min: 0, max: 100000, default: 0 }),
    observacoes: v.text({ max: 2000, nullable: true })
  },
  search: ['nome'],
  filters: { ativo: { column: 'ativo', rule: v.bool({ optional: true }) } },
  orderBy: 't.ordem, t.nome'
});

const newKey = (ext) => {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
};

/** URLs públicas das versões processadas; o arquivo original nunca é público. */
export function withLogoUrls(row) {
  if (!row) return row;
  const { logo_original_chave: originalKey, ...rest } = row;
  return {
    ...rest,
    tem_logo: Boolean(row.logo_mono_chave),
    tem_original: Boolean(originalKey),
    logo_mono_url: row.logo_mono_chave ? storage().publicUrl(row.logo_mono_chave) : null,
    logo_cor_url: row.logo_cor_chave ? storage().publicUrl(row.logo_cor_chave) : null,
    publico: Boolean(row.ativo && row.divulgacao_autorizada && row.logo_mono_chave)
  };
}

async function removeQuietly(key, privado) {
  if (!key) return;
  await storage().remove(key, { privado }).catch((err) => console.error('[parceiros] falha ao remover arquivo:', err.message));
}

/** Gera e grava as versões processadas. Devolve as chaves novas (para desfazer em caso de erro). */
async function storeProcessed(buffer, type) {
  let result;
  try {
    result = await processLogo(buffer, type);
  } catch (err) {
    if (err instanceof LogoError) throw new ValidationError({ arquivo: err.message }, err.message);
    throw err;
  }
  const monoKey = newKey('webp');
  const corKey = newKey('webp');
  await storage().save(result.mono, { key: monoKey });
  try {
    await storage().save(result.cor, { key: corKey });
  } catch (err) {
    await removeQuietly(monoKey, false);
    throw err;
  }
  return { result, monoKey, corKey };
}

export const partnersService = {
  async list(q) { const r = await base.list(q); return { ...r, items: r.items.map(withLogoUrls) }; },
  get: async (id) => withLogoUrls(await base.get(id)),
  create: async (input, req) => withLogoUrls(await base.create(input, req)),
  update: async (id, input, req) => withLogoUrls(await base.update(id, input, req)),
  async remove(id, req) {
    const row = await base.get(id);
    await base.remove(id, req);
    await Promise.all([removeQuietly(row.logo_original_chave, true), removeQuietly(row.logo_mono_chave, false), removeQuietly(row.logo_cor_chave, false)]);
  }
};

/**
 * Recebe uma logomarca em qualquer formato aceito, valida pelo conteúdo, guarda o original
 * (privado) e publica as versões padronizadas. Substitui a logo anterior, se houver.
 */
export async function uploadLogo(id, file, req) {
  const current = await db.one('SELECT * FROM parceiros WHERE id = $1', [id]);
  if (!current) throw notFound('Cliente/parceiro');
  if (!file?.buffer?.length) throw new ValidationError({ arquivo: 'Selecione a logomarca.' }, 'Selecione a logomarca.');
  if (file.size > env.uploadMaxBytes) throw new ValidationError({ arquivo: 'Arquivo acima do tamanho máximo permitido.' }, 'Arquivo acima do tamanho máximo permitido.');
  const type = detectLogoType(file.buffer);
  if (!type) throw new ValidationError({ arquivo: 'Formato não suportado. Envie PNG, JPG, WebP ou SVG.' }, 'Formato não suportado. Envie PNG, JPG, WebP ou SVG.');
  const ext = String(file.originalname || '').toLowerCase().split('.').pop();
  if (!LOGO_TYPES[type].exts.includes(ext)) throw new ValidationError({ arquivo: 'A extensão do arquivo não corresponde ao seu conteúdo.' }, 'A extensão do arquivo não corresponde ao seu conteúdo.');

  const { result, monoKey, corKey } = await storeProcessed(file.buffer, type);
  const originalKey = newKey(type === 'jpg' ? 'jpg' : type);
  const nome = String(file.originalname || 'logo').replace(/[^\w.\- ]+/g, '_').slice(0, 200);
  try {
    await storage().save(file.buffer, { key: originalKey, privado: true });
    const row = await withTransaction(async (tx) => {
      const r = await tx.one(`UPDATE parceiros SET logo_original_chave = $2, logo_original_mime = $3, logo_original_nome = $4, logo_original_tamanho = $5,
          logo_original_largura = $6, logo_original_altura = $7, logo_mono_chave = $8, logo_cor_chave = $9, logo_info = $10, logo_processada_em = now()
        WHERE id = $1 RETURNING *`,
      [id, originalKey, LOGO_TYPES[type].mime, nome, file.buffer.length, result.original.width, result.original.height, monoKey, corKey, JSON.stringify(result.info)]);
      await audit(req, current.logo_mono_chave ? 'substituir_logo' : 'enviar_logo', 'parceiro', id, { arquivo: nome, tipo: type }, tx);
      return r;
    });
    await Promise.all([removeQuietly(current.logo_original_chave, true), removeQuietly(current.logo_mono_chave, false), removeQuietly(current.logo_cor_chave, false)]);
    return withLogoUrls(row);
  } catch (err) {
    await Promise.all([removeQuietly(originalKey, true), removeQuietly(monoKey, false), removeQuietly(corKey, false)]);
    throw err;
  }
}

async function readOriginal(row) {
  const chunks = [];
  for await (const chunk of storage().read(row.logo_original_chave, { privado: true })) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Gera novamente as versões processadas a partir do original guardado. */
export async function reprocessLogo(id, req, { auditar = true } = {}) {
  const current = await db.one('SELECT * FROM parceiros WHERE id = $1', [id]);
  if (!current) throw notFound('Cliente/parceiro');
  if (!current.logo_original_chave) throw new AppError('Este cadastro não tem logomarca original para reprocessar.', { status: 409, code: 'CONFLITO' });
  const buffer = await readOriginal(current);
  const type = detectLogoType(buffer);
  if (!type) throw new AppError('O arquivo original guardado não é uma imagem reconhecida.', { status: 409, code: 'CONFLITO' });
  const { result, monoKey, corKey } = await storeProcessed(buffer, type);
  try {
    const row = await db.one('UPDATE parceiros SET logo_mono_chave = $2, logo_cor_chave = $3, logo_info = $4, logo_processada_em = now() WHERE id = $1 RETURNING *',
      [id, monoKey, corKey, JSON.stringify(result.info)]);
    if (auditar) await audit(req, 'reprocessar_logo', 'parceiro', id, {});
    await Promise.all([removeQuietly(current.logo_mono_chave, false), removeQuietly(current.logo_cor_chave, false)]);
    return withLogoUrls(row);
  } catch (err) {
    await Promise.all([removeQuietly(monoKey, false), removeQuietly(corKey, false)]);
    throw err;
  }
}

/** Reaplica o padrão visual atual a todas as logomarcas (ex.: após ajustar o processamento). */
export async function reprocessAll(req) {
  const rows = await db.many('SELECT id, nome FROM parceiros WHERE logo_original_chave IS NOT NULL ORDER BY id');
  const falhas = [];
  for (const r of rows) {
    try { await reprocessLogo(r.id, req, { auditar: false }); } catch (err) { falhas.push({ id: r.id, nome: r.nome, erro: err.message }); }
  }
  await audit(req, 'reprocessar_logos', 'parceiro', null, { total: rows.length, falhas: falhas.length });
  return { total: rows.length, processados: rows.length - falhas.length, falhas };
}

/** Download do original (somente painel). Nunca é exibido inline, nem quando é SVG. */
export async function streamOriginal(id, res) {
  const row = await db.one('SELECT * FROM parceiros WHERE id = $1', [id]);
  if (!row?.logo_original_chave) throw notFound('Logomarca original');
  const ext = row.logo_original_chave.split('.').pop();
  const filename = `${row.nome.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'logo'}-original.${ext}`;
  res.setHeader('Content-Type', row.logo_original_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = storage().read(row.logo_original_chave, { privado: true });
  stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); });
  stream.pipe(res);
}

/** Marcas exibidas no site: somente ativas, com divulgação autorizada e logo processada. */
export async function listPublicPartners() {
  const rows = await db.many(`SELECT nome, site_url, logo_mono_chave, logo_cor_chave, logo_info->>'fundo_colorida' AS fundo_colorida
    FROM parceiros WHERE ativo AND divulgacao_autorizada AND logo_mono_chave IS NOT NULL ORDER BY ordem, nome LIMIT ${PUBLIC_LIMIT}`);
  return rows.map((r) => ({
    nome: r.nome,
    site_url: r.site_url,
    mono_url: storage().publicUrl(r.logo_mono_chave),
    cor_url: storage().publicUrl(r.logo_cor_chave),
    fundo_colorida: r.fundo_colorida === 'escuro' ? 'escuro' : 'claro'
  }));
}
