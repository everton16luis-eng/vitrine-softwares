import { get, put } from '../../shared/api.js';
import { el, badge, datetime, dataTable, formModal, toast } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';

export async function render(c, ctx) {
  const opcoes = await ctx.opcoes();
  const st = opcoes.status.chamado;
  let status = '';
  const table = dataTable({
    caption: 'Chamados',
    columns: [
      { label: 'Assunto', render: (r) => el('div', {}, el('strong', {}, r.assunto), el('div', { class: 'small text-body-secondary' }, r.cliente_nome)) },
      { label: 'Produto', render: (r) => r.produto_nome || '—' },
      { label: 'Situação', render: (r) => badge(st[r.status], r.status === 'aberto' ? 'warning' : r.status === 'fechado' ? 'secondary' : 'info') },
      { label: 'Aberto em', render: (r) => datetime(r.criado_em) }
    ],
    load: (page) => get(`/api/admin/chamados?pagina=${page}${status ? `&status=${status}` : ''}`),
    onRowClick: (r) => formModal({
      title: r.assunto, submitLabel: 'Salvar resposta',
      fields: [
        { type: 'section', label: `Mensagem de ${r.cliente_nome} (${datetime(r.criado_em)})`, help: r.mensagem },
        { name: 'status', label: 'Situação', type: 'select', required: true, options: entries(st), col: 6 },
        { name: 'resposta', label: 'Resposta ao cliente (visível na área do cliente)', type: 'textarea', rows: 5, readonly: !ctx.can('suporte.editar') }
      ],
      values: r,
      onSubmit: async (v) => { if (!ctx.can('suporte.editar')) return; await put(`/api/admin/chamados/${r.id}`, v); toast('Chamado atualizado.'); table.refresh(); }
    }),
    empty: 'Nenhum chamado aberto pelos clientes.'
  });
  c.append(pageHeader('Chamados de suporte', 'Solicitações abertas pelos clientes na área do cliente.'),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' }, el('select', { class: 'form-select', 'aria-label': 'Situação', onchange: (e) => { status = e.target.value; table.refresh(1); } }, el('option', { value: '' }, 'Todas'), entries(st).map(([k, l]) => el('option', { value: k }, l)))),
      table.node)));
  table.refresh();
}
