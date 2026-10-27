import { get, put } from '../../shared/api.js';
import { el, badge, datetime, dataTable, formModal, toast } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';

const TIPOS = { acesso: 'Acesso', correcao: 'Correção', exclusao: 'Eliminação', anonimizacao: 'Anonimização', portabilidade: 'Portabilidade', revogacao: 'Revogação de consentimento', informacao: 'Informação' };

export async function render(c, ctx) {
  const opcoes = await ctx.opcoes();
  const st = opcoes.status.lgpd;
  const table = dataTable({
    caption: 'Solicitações de titulares',
    columns: [
      { label: 'Protocolo', render: (r) => `LGPD-${r.id}` },
      { label: 'Titular', render: (r) => el('div', {}, r.nome, el('div', { class: 'small text-body-secondary' }, r.email)) },
      { label: 'Tipo', render: (r) => TIPOS[r.tipo] },
      { label: 'Situação', render: (r) => badge(st[r.status], r.status === 'atendida' ? 'success' : r.status === 'recebida' ? 'warning' : 'secondary') },
      { label: 'Cadastro relacionado', render: (r) => (r.cliente_id ? el('a', { href: `#/clientes/${r.cliente_id}` }, `Cliente #${r.cliente_id}`) : '—') },
      { label: 'Recebida', render: (r) => datetime(r.criado_em) }
    ],
    load: (page) => get(`/api/admin/lgpd?pagina=${page}`),
    onRowClick: (r) => formModal({
      title: `Solicitação LGPD-${r.id}`, submitLabel: 'Salvar',
      fields: [
        { type: 'section', label: `${TIPOS[r.tipo]} — ${r.nome} <${r.email}>`, help: r.descricao || 'Sem detalhes informados.' },
        { type: 'section', label: 'Antes de atender', help: 'Confirme a identidade do titular. Para acesso/portabilidade, use "Exportar dados do titular" na ficha do cliente; para eliminação/anonimização, use "Anonimizar".' },
        { name: 'status', label: 'Situação', type: 'select', required: true, options: entries(st), col: 6 },
        { name: 'resposta', label: 'Registro do atendimento', type: 'textarea', rows: 4 }
      ],
      values: r,
      onSubmit: async (v) => { if (!ctx.can('lgpd.editar')) return; await put(`/api/admin/lgpd/${r.id}`, v); toast('Solicitação atualizada.'); table.refresh(); }
    }),
    empty: 'Nenhuma solicitação recebida.'
  });
  c.append(pageHeader('Privacidade (LGPD)', 'Solicitações de titulares recebidas pelo formulário público. Este painel apoia o atendimento, mas não substitui orientação jurídica especializada.'),
    el('div', { class: 'card' }, el('div', { class: 'card-body' }, table.node)));
  table.refresh();
}
