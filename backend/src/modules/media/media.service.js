import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../../config/env.js';
import { db } from '../../database/pool.js';
import { storage } from '../../services/storage/index.js';
import { audit } from '../../services/audit.js';
import { AppError, conflict, notFound, ValidationError } from '../../utils/errors.js';
import { v, parse } from '../../utils/validation.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { validateFile } from './file-type.js';

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }

/** Upload em memória com limite de tamanho; o arquivo só é gravado após validação. */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxBytes, files: 1, fields: 20 }
}).single('arquivo');

export const metadataSchema = {
  texto_alternativo: v.string({ max: 300, nullable: true }),
  origem: v.enum(['proprio', 'pexels', 'unsplash', 'pixabay', 'captura_de_tela', 'cliente', 'outro'], { default: 'proprio' }),
  autor: v.string({ max: 200, nullable: true }),
  url_origem: v.url({ nullable: true }),
  licenca: v.string({ max: 200, nullable: true }),
  licenca_verificada_em: v.date({ nullable: true })
};

function newKey(type) {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(16).toString('hex')}.${type}`;
}

/**
 * Reprocessa imagens (quando o sharp está disponível): remove metadados EXIF,
 * limita a 2000px e recomprime. Isso também neutraliza arquivos "poliglotas".
 */
async function processImage(buffer, type) {
  if (!sharp) return { buffer, width: null, height: null };
  try {
    let pipeline = sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
    if (type === 'jpg') pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    if (type === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
    if (type === 'webp') pipeline = pipeline.webp({ quality: 82 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new ValidationError({ arquivo: 'Imagem corrompida ou inválida.' }, 'Imagem corrompida ou inválida.');
  }
}

export async function storeUpload(file, meta, req, { privado = false, allowDocuments = false } = {}) {
  if (!file) throw new ValidationError({ arquivo: 'Selecione um arquivo.' });
  const check = validateFile(file, { allowDocuments, maxBytes: env.uploadMaxBytes });
  if (check.error) throw new ValidationError({ arquivo: check.error }, check.error);
  const metadata = parse(metadataSchema, meta);

  let { buffer } = file;
  let width = null;
  let height = null;
  if (['jpg', 'png', 'webp'].includes(check.type)) ({ buffer, width, height } = await processImage(buffer, check.type));

  const key = newKey(check.type);
  await storage().save(buffer, { key, privado });
  const originalName = String(file.originalname || 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 200);
  try {
    const row = await db.one(
      `INSERT INTO arquivos (nome_original, chave, privado, mime, tamanho, largura, altura, texto_alternativo, origem, autor,
                             url_origem, licenca, licenca_verificada_em, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [originalName, key, privado, check.mime, buffer.length, width, height, metadata.texto_alternativo ?? null, metadata.origem,
        metadata.autor ?? null, metadata.url_origem ?? null, metadata.licenca ?? null, metadata.licenca_verificada_em ?? null, req.user?.id || null]
    );
    await audit(req, 'enviar', 'arquivo', row.id, { nome: originalName, privado });
    return withUrl(row);
  } catch (err) {
    await storage().remove(key, { privado });
    throw err;
  }
}

export function withUrl(row) {
  if (!row) return row;
  return { ...row, url: row.privado ? null : storage().publicUrl(row.chave) };
}

export async function listFiles(query) {
  const p = pagination(query, { defaultLimit: 24 });
  const params = [];
  const where = ['NOT privado'];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(nome_original ILIKE $${params.length} OR texto_alternativo ILIKE $${params.length})`); }
  const sql = `FROM arquivos WHERE ${where.join(' AND ')}`;
  const { total } = await db.one(`SELECT count(*)::int AS total ${sql}`, params);
  const rows = await db.many(`SELECT * ${sql} ORDER BY criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  const usage = await usageMap(rows.map((r) => r.id));
  return paged(rows.map((r) => ({ ...withUrl(r), usos: usage.get(r.id) || 0 })), total, p);
}

async function usageMap(ids) {
  if (!ids.length) return new Map();
  const rows = await db.many(
    `SELECT id, sum(n)::int AS usos FROM (
       SELECT imagem_id AS id, count(*) n FROM produtos WHERE imagem_id = ANY($1) GROUP BY 1
       UNION ALL SELECT arquivo_id, count(*) FROM produto_imagens WHERE arquivo_id = ANY($1) GROUP BY 1
       UNION ALL SELECT imagem_id, count(*) FROM categorias WHERE imagem_id = ANY($1) GROUP BY 1
       UNION ALL SELECT imagem_id, count(*) FROM servicos WHERE imagem_id = ANY($1) GROUP BY 1
       UNION ALL SELECT arquivo_id, count(*) FROM conteudos WHERE arquivo_id = ANY($1) GROUP BY 1
       UNION ALL SELECT arquivo_id, count(*) FROM cliente_arquivos WHERE arquivo_id = ANY($1) GROUP BY 1
       UNION ALL SELECT arquivo_id, count(*) FROM contratos WHERE arquivo_id = ANY($1) GROUP BY 1
     ) u GROUP BY id`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id, r.usos]));
}

export async function getFile(id) {
  const row = await db.one('SELECT * FROM arquivos WHERE id = $1', [id]);
  if (!row) throw notFound('Arquivo');
  const usage = await usageMap([id]);
  return { ...withUrl(row), usos: usage.get(id) || 0 };
}

export async function updateMetadata(id, input, req) {
  const value = parse(metadataSchema, input, { partial: true });
  const keys = Object.keys(value);
  if (!keys.length) return getFile(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const row = await db.one(`UPDATE arquivos SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => value[k])]);
  if (!row) throw notFound('Arquivo');
  await audit(req, 'editar', 'arquivo', id, { campos: keys });
  return withUrl(row);
}

/** Substitui o conteúdo do arquivo mantendo o mesmo id (as associações continuam válidas). */
export async function replaceFile(id, file, req) {
  const current = await db.one('SELECT * FROM arquivos WHERE id = $1', [id]);
  if (!current) throw notFound('Arquivo');
  const check = validateFile(file || {}, { allowDocuments: current.privado, maxBytes: env.uploadMaxBytes });
  if (check.error) throw new ValidationError({ arquivo: check.error }, check.error);
  let { buffer } = file;
  let width = null;
  let height = null;
  if (['jpg', 'png', 'webp'].includes(check.type)) ({ buffer, width, height } = await processImage(buffer, check.type));
  const key = newKey(check.type);
  await storage().save(buffer, { key, privado: current.privado });
  const row = await db.one(
    'UPDATE arquivos SET chave = $2, mime = $3, tamanho = $4, largura = $5, altura = $6 WHERE id = $1 RETURNING *',
    [id, key, check.mime, buffer.length, width, height]
  );
  await storage().remove(current.chave, { privado: current.privado });
  await audit(req, 'substituir', 'arquivo', id, {});
  return withUrl(row);
}

export async function deleteFile(id, req) {
  const file = await getFile(id);
  if (file.usos > 0) throw conflict('Este arquivo está em uso. Remova as associações antes de excluí-lo.');
  await db.query('DELETE FROM arquivos WHERE id = $1', [id]);
  await storage().remove(file.chave, { privado: file.privado });
  await audit(req, 'excluir', 'arquivo', id, { nome: file.nome_original });
}

export async function streamPrivateFile(id, res) {
  const row = await db.one('SELECT * FROM arquivos WHERE id = $1', [id]);
  if (!row) throw notFound('Arquivo');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${row.nome_original.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = storage().read(row.chave, { privado: row.privado });
  stream.on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); });
  stream.pipe(res);
}

export const assertImage = async (id, conn = db) => {
  if (id === null || id === undefined) return;
  const row = await conn.one('SELECT id FROM arquivos WHERE id = $1 AND NOT privado AND mime LIKE $2', [id, 'image/%']);
  if (!row) throw new AppError('Imagem selecionada inválida.', { status: 422, code: 'VALIDACAO', details: { imagem_id: 'Imagem não encontrada.' } });
};
