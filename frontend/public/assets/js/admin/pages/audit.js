import { get } from '../../shared/api.js';
import { el, datetime, dataTable, infoModal } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

export function render(c) {
  const state = { entidade: '', inicio: '', fim: '' };
  const table = dataTable({
    caption: 'Auditoria',
    columns: [
      { label: 'Data', render: (r) => datetime(r.criado_em) }, { label: 'Usuário', render: (r) => r.usuario_nome || 'Sistema' },
      { label: 'Ação', key: 'acao' }, { label: 'Entidade', render: (r) => `${r.entidade}${r.entidade_id ? ` #${r.entidade_id}` : ''}` }, { label: 'IP', render: (r) => r.ip || '—' }
    ],
    load: (page) => get(`/api/admin/auditoria?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    onRowClick: (r) => infoModal({ title: `${r.acao} — ${r.entidade}`, body: el('pre', { class: 'audit-json' }, JSON.stringify(r.detalhes, null, 2)) }),
    empty: 'Nenhum registro.'
  });
  const input = (name, type, label) => el('input', { class: 'form-control', type, 'aria-label': label, placeholder: label, title: label, onchange: (e) => { state[name] = e.target.value.trim(); table.refresh(1); } });
  c.append(pageHeader('Auditoria', 'Registro das ações administrativas (sem senhas, tokens ou dados desnecessários).'),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' }, input('entidade', 'text', 'Entidade (ex.: produto)'), input('inicio', 'date', 'De'), input('fim', 'date', 'Até')),
      table.node)));
  table.refresh();
}
