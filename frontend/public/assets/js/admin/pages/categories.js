import { crudPage, yesNo } from './_crud.js';

export function render(c, ctx) {
  return crudPage(c, ctx, {
    title: 'Categorias', singular: 'categoria', description: 'Organize o catálogo. Categorias com produtos publicados não podem ser desativadas.',
    endpoint: '/api/admin/categorias', editPerm: 'categorias.editar', invalidatesOptions: true, defaults: { ativa: true, ordem: 0 },
    filters: [{ name: 'ativa', label: 'Situação', options: [['true', 'Ativas'], ['false', 'Inativas']] }],
    columns: [
      { label: 'Nome', key: 'nome' }, { label: 'Endereço', render: (r) => `/softwares?categoria=${r.slug}` },
      { label: 'Produtos', render: (r) => `${r.total_produtos} (${r.produtos_publicados} publicados)` },
      { label: 'Ordem', key: 'ordem' }, { label: 'Ativa', render: (r) => yesNo(r.ativa) }
    ],
    fields: () => [
      { name: 'nome', label: 'Nome', required: true, col: 8, max: 120 },
      { name: 'ordem', label: 'Ordem de exibição', type: 'number', col: 4, min: 0 },
      { name: 'slug', label: 'Slug (endereço)', col: 6, help: 'Gerado automaticamente a partir do nome se ficar vazio.' },
      { name: 'imagem_id', label: 'Imagem', type: 'image', col: 6 },
      { name: 'descricao', label: 'Descrição', type: 'textarea', max: 1000 },
      { name: 'ativa', label: 'Categoria ativa', type: 'checkbox' }
    ],
    deleteMessage: (r) => `Excluir a categoria "${r.nome}"? Só é possível excluir categorias sem produtos.`
  });
}
