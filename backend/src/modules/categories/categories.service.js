import { createCrud } from '../shared/crud.js';
import { v } from '../../utils/validation.js';
import { conflict } from '../../utils/errors.js';
import { slugify } from '../../utils/common.js';
import { assertImage } from '../media/media.service.js';
import { db } from '../../database/pool.js';

export const categorySchema = {
  nome: v.string({ min: 2, max: 120 }),
  slug: v.slug({ optional: true }),
  descricao: v.text({ max: 1000, nullable: true }),
  imagem_id: v.id({ nullable: true }),
  ordem: v.int({ min: 0, max: 100000, default: 0 }),
  ativa: v.bool({ default: true })
};

export const categoriesService = createCrud({
  table: 'categorias',
  entity: 'categoria',
  label: 'Categoria',
  schema: categorySchema,
  search: ['nome', 'descricao'],
  filters: { ativa: { column: 'ativa', rule: v.bool({ optional: true, default: undefined }) } },
  orderBy: 't.ordem, t.nome',
  select: `SELECT t.*, (SELECT count(*)::int FROM produtos p WHERE p.categoria_id = t.id) AS total_produtos,
                  (SELECT count(*)::int FROM produtos p WHERE p.categoria_id = t.id AND p.publicado) AS produtos_publicados,
                  a.chave AS imagem_chave
             FROM categorias t LEFT JOIN arquivos a ON a.id = t.imagem_id`,
  prepare(value, { current }) {
    if (!current && !value.slug) value.slug = slugify(value.nome);
    return value;
  },
  async beforeSave(value, { id, tx }) {
    await assertImage(value.imagem_id, tx);
    // Regra: uma categoria com produtos publicados não pode ser desativada.
    if (id && value.ativa === false) {
      const { n } = await tx.one('SELECT count(*)::int AS n FROM produtos WHERE categoria_id = $1 AND publicado', [id]);
      if (n > 0) throw conflict(`Não é possível desativar: ${n} produto(s) publicado(s) usam esta categoria. Despublique-os ou mova-os antes.`);
    }
  },
  async beforeDelete(row, { tx }) {
    const { n } = await tx.one('SELECT count(*)::int AS n FROM produtos WHERE categoria_id = $1', [row.id]);
    if (n > 0) throw conflict('Não é possível excluir uma categoria que possui produtos. Desative-a ou mova os produtos.');
  }
});

export const listActiveCategories = () => db.many(
  `SELECT c.id, c.nome, c.slug, c.descricao, c.imagem_id,
          (SELECT count(*)::int FROM produtos p WHERE p.categoria_id = c.id AND p.publicado) AS total
     FROM categorias c WHERE c.ativa ORDER BY c.ordem, c.nome`
);
