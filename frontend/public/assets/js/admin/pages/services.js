import { badge, money } from '../../shared/ui.js';
import { crudPage } from './_crud.js';

const STATUS = [['rascunho', 'Rascunho'], ['publicado', 'Publicado'], ['arquivado', 'Arquivado']];

export function render(c, ctx) {
  return crudPage(c, ctx, {
    title: 'Serviços', singular: 'serviço', description: 'Serviços exibidos na página /servicos. Somente os publicados aparecem no site.',
    endpoint: '/api/admin/servicos', editPerm: 'servicos.editar', invalidatesOptions: true, defaults: { status: 'rascunho', ordem: 0, beneficios: [] },
    filters: [{ name: 'status', label: 'Situação', options: STATUS }],
    columns: [
      { label: 'Serviço', key: 'nome' },
      { label: 'Situação', render: (r) => badge(STATUS.find(([k]) => k === r.status)[1], r.status === 'publicado' ? 'success' : 'secondary') },
      { label: 'Preço', render: (r) => (r.preco ? `${r.preco_descricao || ''} ${money(r.preco)}` : 'Sob orçamento') },
      { label: 'Ordem', key: 'ordem' }
    ],
    fields: () => [
      { name: 'nome', label: 'Nome', required: true, col: 8 },
      { name: 'status', label: 'Situação', type: 'select', options: STATUS, required: true, col: 4 },
      { name: 'resumo', label: 'Resumo', type: 'textarea', required: true, max: 400, rows: 2 },
      { name: 'descricao', label: 'Descrição completa (Markdown)', type: 'markdown', help: 'Use ## para subtítulos, - para listas e **negrito**.' },
      { name: 'beneficios', label: 'Benefícios (um por linha)', type: 'lines' },
      { name: 'preco', label: 'Preço (opcional)', type: 'money', col: 4 },
      { name: 'preco_descricao', label: 'Texto do preço', col: 4, placeholder: 'a partir de' },
      { name: 'ordem', label: 'Ordem', type: 'number', col: 4 },
      { name: 'icone', label: 'Ícone (Bootstrap Icons)', col: 6, placeholder: 'code-square', help: 'Nome do ícone em icons.getbootstrap.com' },
      { name: 'imagem_id', label: 'Imagem (opcional)', type: 'image', col: 6 },
      { type: 'section', label: 'SEO' },
      { name: 'slug', label: 'Slug', col: 4 },
      { name: 'seo_title', label: 'Título SEO', col: 8, max: 70 },
      { name: 'seo_description', label: 'Descrição SEO', type: 'textarea', max: 170, rows: 2 }
    ]
  });
}
