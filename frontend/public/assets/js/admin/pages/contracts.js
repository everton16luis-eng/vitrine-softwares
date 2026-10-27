import { api } from '../../shared/api.js';
import { el, icon, badge, date, money, toast, toastError } from '../../shared/ui.js';
import { crudPage, entries } from './_crud.js';

export async function render(c, ctx) {
  const opcoes = await ctx.opcoes();
  const st = opcoes.status;
  const clientes = () => (opcoes.clientes || []).map((x) => [x.id, `${x.nome}${x.empresa ? ` (${x.empresa})` : ''}`]);
  const tabs = el('ul', { class: 'nav nav-tabs mb-3', role: 'tablist' });
  const area = el('div');
  c.append(tabs, area);
  const show = async (which) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === which));
    area.textContent = '';
    if (which === 'contratos') {
      await crudPage(area, ctx, {
        title: 'Contratos', singular: 'contrato', deletable: false, labelKey: 'titulo',
        description: 'Registro dos contratos firmados. Anexe o documento assinado (PDF) para disponibilizá-lo na área do cliente.',
        endpoint: '/api/admin/contratos', editPerm: 'contratos.editar', defaults: { status: 'rascunho', moeda: 'BRL' },
        filters: [{ name: 'status', label: 'Situação', options: entries(st.contrato) }],
        columns: [
          { label: 'Número', key: 'numero' }, { label: 'Título', key: 'titulo' }, { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Vigência', render: (r) => `${date(r.data_inicio)} → ${r.data_fim ? date(r.data_fim) : 'indeterminado'}` },
          { label: 'Valor', render: (r) => money(r.valor, r.moeda) },
          { label: 'Situação', render: (r) => badge(st.contrato[r.status], r.status === 'vigente' ? 'success' : 'secondary') },
          { label: 'Arquivo', render: (r) => (r.arquivo_nome ? el('button', { class: 'btn btn-link btn-sm p-0', type: 'button', onclick: () => openPrivate(r.arquivo_id, r.arquivo_nome) }, icon('paperclip'), ' ', r.arquivo_nome) : '—') }
        ],
        rowActions: (r, { refresh }) => [uploadButton(r, refresh)],
        fields: () => [
          { name: 'titulo', label: 'Título', required: true, col: 8 },
          { name: 'status', label: 'Situação', type: 'select', options: entries(st.contrato), required: true, col: 4 },
          { name: 'cliente_id', label: 'Cliente', type: 'select', numeric: true, options: clientes, required: true, col: 6 },
          { name: 'pedido_id', label: 'Pedido relacionado (ID)', type: 'number', col: 6, help: 'Opcional. Deve pertencer ao mesmo cliente.' },
          { name: 'data_inicio', label: 'Início', type: 'date', col: 4 },
          { name: 'data_fim', label: 'Término', type: 'date', col: 4 },
          { name: 'valor', label: 'Valor', type: 'money', col: 4 },
          { name: 'observacoes', label: 'Observações', type: 'textarea' }
        ]
      });
    } else {
      await crudPage(area, ctx, {
        title: 'Licenças', singular: 'licença', deletable: false, labelKey: 'identificador',
        description: 'Registro administrativo de licenças. O identificador não é uma chave de ativação: nenhum monitoramento é feito nos sistemas dos clientes.',
        endpoint: '/api/admin/licencas', editPerm: 'contratos.editar', defaults: { status: 'ativa', tipo: 'perpetua', data_inicio: new Date().toISOString().slice(0, 10) },
        filters: [{ name: 'status', label: 'Situação', options: entries(st.licenca) }],
        columns: [
          { label: 'Identificador', key: 'identificador' }, { label: 'Produto', key: 'produto_nome' }, { label: 'Cliente', key: 'cliente_nome' },
          { label: 'Tipo', render: (r) => st.tipos_licenca[r.tipo] }, { label: 'Validade', render: (r) => (r.data_fim ? date(r.data_fim) : 'Sem término') },
          { label: 'Situação', render: (r) => badge(st.licenca[r.status], r.status === 'ativa' ? 'success' : 'secondary') }
        ],
        fields: () => [
          { name: 'cliente_id', label: 'Cliente', type: 'select', numeric: true, options: clientes, required: true, col: 6 },
          { name: 'produto_id', label: 'Produto', type: 'select', numeric: true, options: () => (opcoes.produtos || []).map((p) => [p.id, p.nome]), required: true, col: 6 },
          { name: 'tipo', label: 'Tipo', type: 'select', options: entries(st.tipos_licenca), required: true, col: 4 },
          { name: 'status', label: 'Situação', type: 'select', options: entries(st.licenca), required: true, col: 4 },
          { name: 'contrato_id', label: 'Contrato (ID)', type: 'number', col: 4 },
          { name: 'data_inicio', label: 'Início', type: 'date', required: true, col: 4 },
          { name: 'data_fim', label: 'Término', type: 'date', col: 4, help: 'Obrigatório para assinaturas.' },
          { name: 'pedido_id', label: 'Pedido (ID)', type: 'number', col: 4 },
          { name: 'limites', label: 'Limites de utilização', type: 'textarea', rows: 2 },
          { name: 'observacoes', label: 'Observações', type: 'textarea', rows: 2 }
        ]
      });
    }
  };
  for (const [k, l] of [['contratos', 'Contratos'], ['licencas', 'Licenças']]) {
    tabs.append(el('li', { class: 'nav-item' }, el('button', { class: 'nav-link', type: 'button', dataset: { tab: k }, onclick: () => show(k) }, l)));
  }
  await show('contratos');
}

function uploadButton(row, refresh) {
  const input = el('input', { type: 'file', accept: 'application/pdf', class: 'd-none', onchange: async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append('arquivo', input.files[0]);
    try {
      await api(`/api/admin/contratos/${row.id}/arquivo`, { method: 'POST', form: fd });
      toast('Documento anexado.');
      refresh();
    } catch (err) { toastError(err); }
  } });
  return el('span', {}, input, el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Anexar PDF assinado', 'aria-label': 'Anexar PDF assinado', onclick: () => input.click() }, icon('paperclip')));
}

async function openPrivate(id, name) {
  const { download } = await import('../../shared/api.js');
  try { await download(`/api/admin/arquivos-privados/${id}`, name); } catch (err) { toastError(err); }
}
