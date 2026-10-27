import { get, download } from '../../shared/api.js';
import { el, icon, loading, errorState, emptyState, withBusy } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

export async function render(c) {
  const types = await get('/api/admin/relatorios');
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const tipo = el('select', { class: 'form-select', id: 'rel-tipo' }, Object.entries(types).map(([k, l]) => el('option', { value: k }, l)));
  const inicio = el('input', { class: 'form-control', type: 'date', id: 'rel-ini', value: start });
  const fim = el('input', { class: 'form-control', type: 'date', id: 'rel-fim', value: today });
  const out = el('div');
  const qs = () => new URLSearchParams({ inicio: inicio.value, fim: fim.value });

  async function run() {
    out.textContent = '';
    out.append(loading('Gerando relatório…'));
    try {
      const r = await get(`/api/admin/relatorios/${tipo.value}?${qs()}`);
      out.textContent = '';
      if (!r.linhas.length) { out.append(emptyState('Sem dados no período', 'Ajuste o período ou o tipo de relatório.')); return; }
      const keys = Object.keys(r.linhas[0]);
      out.append(el('p', { class: 'small text-body-secondary' }, `${r.titulo} · ${r.linhas.length} linha(s) · ${r.inicio.split('-').reverse().join('/')} a ${r.fim.split('-').reverse().join('/')}`),
        el('div', { class: 'table-responsive' }, el('table', { class: 'table table-sm table-striped' },
          el('thead', {}, el('tr', {}, keys.map((k) => el('th', { scope: 'col' }, k.replace(/_/g, ' '))))),
          el('tbody', {}, r.linhas.slice(0, 500).map((row) => el('tr', {}, keys.map((k) => el('td', {}, row[k] === null ? '—' : typeof row[k] === 'boolean' ? (row[k] ? 'Sim' : 'Não') : String(row[k])))))))));
      if (r.linhas.length > 500) out.append(el('p', { class: 'small' }, 'Exibindo as primeiras 500 linhas. Exporte o CSV para ver tudo.'));
    } catch (err) { out.textContent = ''; out.append(errorState(err, run)); }
  }

  c.append(pageHeader('Relatórios', 'Relatórios calculados a partir dos dados registrados. Exportações ficam registradas na auditoria.'),
    el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('div', { class: 'row g-2 align-items-end' },
      el('div', { class: 'col-md-4' }, el('label', { class: 'form-label', for: 'rel-tipo' }, 'Relatório'), tipo),
      el('div', { class: 'col-md-2' }, el('label', { class: 'form-label', for: 'rel-ini' }, 'De'), inicio),
      el('div', { class: 'col-md-2' }, el('label', { class: 'form-label', for: 'rel-fim' }, 'Até'), fim),
      el('div', { class: 'col-md-4 d-flex gap-2' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: run }, icon('play'), ' Gerar'),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => download(`/api/admin/relatorios/${tipo.value}.csv?${qs()}`, `relatorio-${tipo.value}.csv`), 'CSV exportado.') }, icon('download'), ' Exportar CSV'))))),
    el('div', { class: 'card' }, el('div', { class: 'card-body' }, out)));
  run();
}
