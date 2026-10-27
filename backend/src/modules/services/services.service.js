import { createCrud } from '../shared/crud.js';
import { v } from '../../utils/validation.js';
import { slugify } from '../../utils/common.js';
import { assertImage } from '../media/media.service.js';
import { db } from '../../database/pool.js';
import { notFound } from '../../utils/errors.js';

export const serviceSchema = {
  nome: v.string({ min: 2, max: 140 }),
  slug: v.slug({ optional: true }),
  resumo: v.string({ min: 10, max: 400 }),
  descricao: v.text({ max: 10000, nullable: true }),
  icone: v.string({ max: 40, pattern: /^[a-z0-9-]+$/, nullable: true }),
  imagem_id: v.id({ nullable: true }),
  beneficios: v.array(v.string({ min: 2, max: 200 }), { max: 20 }),
  preco: v.money({ nullable: true }),
  preco_descricao: v.string({ max: 80, nullable: true }),
  status: v.enum(['rascunho', 'publicado', 'arquivado'], { default: 'rascunho' }),
  ordem: v.int({ min: 0, max: 100000, default: 0 }),
  seo_title: v.string({ max: 70, nullable: true }),
  seo_description: v.string({ max: 170, nullable: true })
};

export const servicesService = createCrud({
  table: 'servicos',
  entity: 'servico',
  label: 'Serviço',
  schema: serviceSchema,
  search: ['nome', 'resumo'],
  filters: { status: { column: 'status', rule: v.enum(['rascunho', 'publicado', 'arquivado'], { optional: true }) } },
  orderBy: 't.ordem, t.nome',
  select: 'SELECT t.*, a.chave AS imagem_chave FROM servicos t LEFT JOIN arquivos a ON a.id = t.imagem_id',
  prepare(value, { current }) {
    if (!current && !value.slug) value.slug = slugify(value.nome);
    return value;
  },
  async beforeSave(value, { tx }) { await assertImage(value.imagem_id, tx); }
});

export const listPublishedServices = () => db.many(
  `SELECT s.*, a.chave AS imagem_chave, a.texto_alternativo AS imagem_alt
     FROM servicos s LEFT JOIN arquivos a ON a.id = s.imagem_id
    WHERE s.status = 'publicado' ORDER BY s.ordem, s.nome`
);

export async function getPublishedService(slug) {
  const row = await db.one(
    `SELECT s.*, a.chave AS imagem_chave, a.texto_alternativo AS imagem_alt
       FROM servicos s LEFT JOIN arquivos a ON a.id = s.imagem_id WHERE s.slug = $1 AND s.status = 'publicado'`,
    [slug]
  );
  if (!row) throw notFound('Serviço');
  return row;
}
