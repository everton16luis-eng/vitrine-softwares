// Levantamento de Requisitos: visão geral, listagem, clientes/projetos e comparação.
// Rotas: #/levantamentos, #/levantamentos/<id>, #/levantamentos/perguntas,
//        #/levantamentos/cliente/<id>, #/levantamentos/projeto/<id>, #/levantamentos/comparar?a=&b=
import { get, post, put } from '../../shared/api.js';
import { el, icon, date, datetime, dataTable, formModal, confirmDialog, toast, toastError, debounce, tabSet, loading, errorState, emptyState, scrollRegion, withBusy } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';
import {
  API, reference, invalidateReference, statusChip, versionChip, projectChip, muted, clientLabel, progressBar,
  newSurveyModal, duplicateModal, clientFields
} from './requirements-common.js';

export async function render(c, ctx, params) {
  const [a, b] = params;
  if (a === 'perguntas') return (await import('./requirements-bank.js')).render(c, ctx);
  if (a === 'comparar') return compareView(c, ctx);
  if (a === 'cliente' && /^\d+$/.test(b || '')) return clientView(c, ctx, Number(b));
  if (a === 'projeto' && /^\d+$/.test(b || '')) return projectView(c, ctx, Number(b));
  if (a && /^\d+$/.test(a)) return (await import('./requirements-survey.js')).render(c, ctx, Number(a));
  return listView(c, ctx);
}

const backLink = (href, text) => el('a', { class: 'back-link', href }, icon('arrow-left'), text);

// ------------------------------------------------------------------ ações de linha
function surveyActions(ctx, row, ref, refresh) {
  const box = el('div', { class: 'btn-group btn-group-sm lr-row-actions' });
  const open = (aba) => ctx.navigate(`levantamentos/${row.id}${aba ? `?aba=${aba}` : ''}`);
  box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Visualizar', 'aria-label': `Visualizar ${row.codigo}`, onclick: () => open('revisao') }, icon('eye')));
  if (ctx.can('levantamentos.editar') && row.status === 'em_andamento') {
    box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Continuar a entrevista', 'aria-label': `Continuar a entrevista ${row.codigo}`, onclick: () => open('entrevista') }, icon('pencil')));
  }
  if (ctx.can('levantamentos.criar')) {
    box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Duplicar', 'aria-label': `Duplicar ${row.codigo}`, onclick: () => duplicateModal(ctx, row) }, icon('copy')));
  }
  box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Relatórios PDF', 'aria-label': `Relatórios PDF de ${row.codigo}`, onclick: () => open('relatorios') }, icon('file-earmark-pdf')));
  if (ctx.can('levantamentos.editar')) {
    const archived = row.status === 'arquivado';
    box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', title: archived ? 'Desarquivar' : 'Arquivar', 'aria-label': `${archived ? 'Desarquivar' : 'Arquivar'} ${row.codigo}`, onclick: async (e) => {
      if (!archived && !(await confirmDialog({ title: 'Arquivar levantamento', message: `${row.codigo} sairá da lista principal, mas continua disponível pelo filtro "Arquivados". Nada é apagado.`, confirmLabel: 'Arquivar', danger: false }))) return;
      await withBusy(e.currentTarget, () => post(`${API}/levantamentos/${row.id}/${archived ? 'desarquivar' : 'arquivar'}`), archived ? 'Levantamento desarquivado.' : 'Levantamento arquivado.');
      refresh();
    } }, icon(archived ? 'box-arrow-up' : 'archive')));
  }
  void ref;
  return box;
}

function surveyColumns(ctx, ref, refresh, { client = true, project = true } = {}) {
  return [
    { label: 'Código', class: 'text-nowrap', render: (r) => el('a', { href: `#/levantamentos/${r.id}`, class: 'fw-semibold' }, r.codigo) },
    ...(client ? [{ label: 'Cliente', render: (r) => el('div', {}, r.cliente_nome, r.cliente_empresa ? el('div', { class: 'small text-body-secondary' }, r.cliente_empresa) : null) }] : []),
    ...(project ? [{ label: 'Projeto', key: 'projeto_nome' }] : []),
    { label: 'Reunião', class: 'text-nowrap', render: (r) => date(r.data_reuniao) },
    { label: 'Responsável', key: 'responsavel_nome' },
    { label: 'Situação', render: (r) => el('div', { class: 'lr-chips' }, statusChip(ref, r.status), el('span', { class: 'small text-body-secondary' }, `versão ${r.versao}`)) },
    { label: 'Respostas', render: (r) => (r.perguntas === undefined ? '—' : el('div', { class: 'lr-progress-cell' }, progressBar(r.perguntas ? Math.round((r.respondidas / r.perguntas) * 100) : 0, `Respostas de ${r.codigo}`), el('span', { class: 'small' }, `${r.respondidas}/${r.perguntas}`))) },
    { label: '', class: 'text-end', render: (r) => surveyActions(ctx, r, ref, refresh) }
  ];
}

// ------------------------------------------------------------------ listagem
async function listView(c, ctx) {
  const ref = await reference();
  const resumo = await get(`${API}/resumo`);
  const k = resumo.indicadores;
  c.append(pageHeader('Levantamento de Requisitos', 'Entrevistas guiadas de descoberta com clientes: roteiro de perguntas, 5 porquês, consolidação e relatório em PDF.',
    ctx.can('levantamentos.perguntas') ? el('a', { class: 'btn btn-outline-secondary', href: '#/levantamentos/perguntas' }, icon('list-check'), ' Gerenciar perguntas') : null,
    ctx.can('levantamentos.ver') ? el('a', { class: 'btn btn-outline-secondary', href: '#/levantamentos/comparar' }, icon('layout-split'), ' Comparar') : null,
    ctx.can('levantamentos.criar') ? el('button', { class: 'btn btn-accent', type: 'button', onclick: () => newSurveyModal(ctx) }, icon('plus-lg'), ' Novo levantamento') : null));

  const kpi = (label, value, hint, ico) => el('div', { class: 'col-6 col-lg-3' }, el('div', { class: 'kpi' },
    el('span', { class: 'kpi-icon' }, icon(ico)), el('div', {}, el('span', { class: 'kpi-label' }, label), el('span', { class: 'kpi-value' }, String(value)), hint ? el('span', { class: 'kpi-hint' }, hint) : null)));
  c.append(el('div', { class: 'row g-3 mb-4' },
    kpi('Em andamento', k.em_andamento, 'entrevistas abertas', 'hourglass-split'),
    kpi('Concluídos', k.concluidos, k.arquivados ? `${k.arquivados} arquivado(s)` : 'prontos para detalhamento', 'check2-square'),
    kpi('Clientes', k.clientes, `${k.projetos} projeto(s)`, 'people'),
    kpi('Aguardando detalhamento', k.aguardando_detalhamento, 'projetos com descoberta concluída', 'signpost-split')));

  const tabs = tabSet([['levantamentos', 'Levantamentos'], ['clientes', 'Clientes e projetos']], (key, panel) => {
    panel.textContent = '';
    if (key === 'clientes') clientsTab(panel, ctx, ref); else surveysTab(panel, ctx, ref);
  }, 'Seções do levantamento de requisitos');
  tabs.list.classList.add('lr-tabs');
  c.append(el('div', { class: 'card' }, el('div', { class: 'card-body' }, tabs.list, tabs.panel)));
  tabs.show(ctx.query?.get('aba') === 'clientes' ? 'clientes' : 'levantamentos');
}

function surveysTab(panel, ctx, ref) {
  const state = { busca: '', status: '', cliente_id: ctx.query?.get('cliente_id') || '', de: '', ate: '' };
  const table = dataTable({
    caption: 'Levantamentos',
    columns: surveyColumns(ctx, ref, () => table.refresh()),
    load: (page) => {
      const q = new URLSearchParams({ pagina: page, ...state });
      [...q.keys()].forEach((key) => { if (!q.get(key)) q.delete(key); });
      return get(`${API}/levantamentos?${q}`);
    },
    onRowClick: (r) => ctx.navigate(`levantamentos/${r.id}`),
    empty: 'Nenhum levantamento encontrado com esses filtros.'
  });
  const set = (k) => (e) => { state[k] = e.target.value; table.refresh(1); };
  const busca = el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar código, cliente, projeto ou respostas…', 'aria-label': 'Pesquisar levantamentos', oninput: debounce(set('busca'), 350) });
  const cliente = el('select', { class: 'form-select', 'aria-label': 'Filtrar por cliente', onchange: set('cliente_id') },
    el('option', { value: '' }, 'Todos os clientes'), ref.clientes.map((x) => el('option', { value: x.id, selected: String(x.id) === state.cliente_id || null }, clientLabel(x))));
  const status = el('select', { class: 'form-select', 'aria-label': 'Filtrar por situação', onchange: set('status') },
    el('option', { value: '' }, 'Ativos (sem arquivados)'), Object.entries(ref.status).map(([v, l]) => el('option', { value: v }, l)), el('option', { value: 'todos' }, 'Todos'));
  const de = el('input', { type: 'date', class: 'form-control', 'aria-label': 'Reuniões a partir de', title: 'Reuniões a partir de', onchange: set('de') });
  const ate = el('input', { type: 'date', class: 'form-control', 'aria-label': 'Reuniões até', title: 'Reuniões até', onchange: set('ate') });
  panel.append(el('div', { class: 'toolbar lr-filters' }, busca, cliente, status, el('div', { class: 'lr-period' }, de, el('span', { 'aria-hidden': 'true' }, 'a'), ate)), table.node);
  table.refresh();
}

function clientsTab(panel, ctx, ref) {
  const state = { busca: '' };
  const table = dataTable({
    caption: 'Clientes da descoberta',
    columns: [
      { label: 'Cliente', render: (r) => el('a', { href: `#/levantamentos/cliente/${r.id}`, class: 'fw-semibold' }, r.nome) },
      { label: 'Empresa', render: (r) => r.empresa || muted('—') },
      { label: 'Contato', render: (r) => el('div', { class: 'small' }, r.email || '', r.email && r.telefone ? el('br') : null, r.telefone || '') },
      { label: 'Projetos', class: 'text-end', key: 'projetos' },
      { label: 'Levantamentos', class: 'text-end', key: 'levantamentos' },
      { label: 'Última reunião', class: 'text-nowrap', render: (r) => date(r.ultima_reuniao) }
    ],
    load: (page) => get(`${API}/clientes?${new URLSearchParams({ pagina: page, busca: state.busca })}`),
    onRowClick: (r) => ctx.navigate(`levantamentos/cliente/${r.id}`),
    empty: 'Nenhum cliente cadastrado. Os clientes são criados junto com o primeiro levantamento.'
  });
  panel.append(el('div', { class: 'toolbar' },
    el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar cliente…', 'aria-label': 'Pesquisar clientes', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }, 350) }),
    el('div', { class: 'flex-grow-1' }),
    ctx.can('levantamentos.criar') ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => clientModal(ctx, null, () => table.refresh()) }, icon('person-plus'), ' Novo cliente') : null),
  table.node);
  table.refresh();
  void ref;
}

function clientModal(ctx, client, done) {
  formModal({
    title: client ? 'Editar cliente' : 'Novo cliente',
    fields: [...clientFields().map((f) => (f.name === 'nome' ? { ...f, required: true } : f)), { name: 'observacoes', label: 'Observações', type: 'textarea', rows: 3 }],
    values: client || {},
    onSubmit: async (v) => {
      const saved = client ? await put(`${API}/clientes/${client.id}`, v) : await post(`${API}/clientes`, v);
      invalidateReference();
      toast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      done?.(saved);
    }
  });
}

function projectModal(ctx, clienteId, project, done) {
  reference().then((ref) => formModal({
    title: project ? 'Editar projeto' : 'Novo projeto ou ideia',
    fields: [
      { name: 'nome', label: 'Nome do projeto ou ideia', required: true, max: 200 },
      { name: 'descricao', label: 'Descrição', type: 'textarea', rows: 3 },
      { name: 'situacao', label: 'Situação', type: 'select', required: true, options: Object.entries(ref.situacoes) }
    ],
    values: project || { situacao: 'em_descoberta' },
    onSubmit: async (v) => {
      const saved = project ? await put(`${API}/projetos/${project.id}`, v) : await post(`${API}/clientes/${clienteId}/projetos`, v);
      invalidateReference();
      toast(project ? 'Projeto atualizado.' : 'Projeto cadastrado.');
      done?.(saved);
    }
  })).catch(toastError);
}

// ------------------------------------------------------------------ cliente
async function clientView(c, ctx, id) {
  const ref = await reference();
  const cl = await get(`${API}/clientes/${id}`);
  const reload = () => { c.textContent = ''; clientView(c, ctx, id).catch((err) => c.append(errorState(err))); };
  c.append(backLink('#/levantamentos?aba=clientes', 'Clientes e projetos'),
    pageHeader(cl.nome, cl.empresa || 'Cliente da descoberta',
      ctx.can('levantamentos.editar') ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => clientModal(ctx, cl, reload) }, icon('pencil'), ' Editar cliente') : null,
      ctx.can('levantamentos.criar') ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => newSurveyModal(ctx, { cliente_id: cl.id }) }, icon('plus-lg'), ' Novo levantamento') : null));

  c.append(el('div', { class: 'row g-4' },
    el('div', { class: 'col-12 col-xl-4' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6 mb-3' }, 'Dados do cliente'),
      el('dl', { class: 'dl-compact' },
        el('dt', {}, 'E-mail'), el('dd', {}, cl.email ? el('a', { href: `mailto:${cl.email}` }, cl.email) : '—'),
        el('dt', {}, 'Telefone'), el('dd', {}, cl.telefone || '—'),
        el('dt', {}, 'Cadastro'), el('dd', {}, date(cl.criado_em)),
        cl.cliente_comercial_nome ? [el('dt', {}, 'Cliente comercial'), el('dd', {}, cl.cliente_comercial_nome)] : null,
        cl.lead_nome ? [el('dt', {}, 'Lead de origem'), el('dd', {}, cl.lead_nome)] : null,
        el('dt', {}, 'Observações'), el('dd', { class: 'pre-line' }, cl.observacoes || '—'))))),
    el('div', { class: 'col-12 col-xl-8' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-3' }, el('h2', { class: 'h6 mb-0' }, `Projetos e ideias (${cl.projetos.length})`),
        ctx.can('levantamentos.criar') ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => projectModal(ctx, cl.id, null, reload) }, icon('plus-lg'), ' Novo projeto') : null),
      cl.projetos.length ? scrollRegion(el('table', { class: 'table align-middle mb-0' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Projeto'), el('th', { scope: 'col' }, 'Situação'), el('th', { scope: 'col', class: 'text-end' }, 'Levantamentos'), el('th', { scope: 'col' }, 'Criado em'))),
        el('tbody', {}, cl.projetos.map((p) => el('tr', {},
          el('td', {}, el('a', { href: `#/levantamentos/projeto/${p.id}`, class: 'fw-semibold' }, p.nome), p.descricao ? el('div', { class: 'small text-body-secondary lr-clamp' }, p.descricao) : null),
          el('td', {}, projectChip(ref, p.situacao)), el('td', { class: 'text-end' }, String(p.levantamentos)), el('td', { class: 'text-nowrap' }, date(p.criado_em)))))), 'Projetos do cliente')
        : emptyState('Nenhum projeto ainda.'))))));

  c.append(el('div', { class: 'card mt-4' }, el('div', { class: 'card-body' },
    el('h2', { class: 'h6 mb-3' }, `Levantamentos (${cl.levantamentos.length})`),
    cl.levantamentos.length ? surveyListTable(ctx, ref, cl.levantamentos, { client: false }, reload) : emptyState('Nenhum levantamento com este cliente.'))));
}

function surveyListTable(ctx, ref, rows, opts, reload) {
  const cols = surveyColumns(ctx, ref, reload, opts).filter((col) => col.label !== 'Respostas');
  return scrollRegion(el('table', { class: 'table table-hover align-middle mb-0' },
    el('thead', {}, el('tr', {}, cols.map((col) => el('th', { scope: 'col', class: col.class || '' }, col.label)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((col) => el('td', { class: col.class || '' }, col.render ? col.render(r) : r[col.key] ?? '—')))))), 'Levantamentos');
}

// ------------------------------------------------------------------ projeto
async function projectView(c, ctx, id) {
  const ref = await reference();
  const p = await get(`${API}/projetos/${id}`);
  const reload = () => { c.textContent = ''; projectView(c, ctx, id).catch((err) => c.append(errorState(err))); };
  const rows = p.levantamentos.map((l) => ({ ...l, projeto_id: p.id, projeto_nome: p.nome, cliente_id: p.cliente_id, cliente_nome: p.cliente_nome }));
  c.append(backLink(`#/levantamentos/cliente/${p.cliente_id}`, p.cliente_nome),
    pageHeader(p.nome, `${clientLabel({ nome: p.cliente_nome, empresa: p.cliente_empresa })}`,
      ctx.can('levantamentos.editar') ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => projectModal(ctx, p.cliente_id, p, reload) }, icon('pencil'), ' Editar projeto') : null,
      rows.length > 1 ? el('a', { class: 'btn btn-outline-secondary', href: `#/levantamentos/comparar?a=${rows[1].id}&b=${rows[0].id}` }, icon('layout-split'), ' Comparar os dois últimos') : null,
      ctx.can('levantamentos.criar') ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => newSurveyModal(ctx, { cliente_id: p.cliente_id, projeto_id: p.id }) }, icon('plus-lg'), ' Novo levantamento') : null));
  c.append(el('div', { class: 'card mb-4' }, el('div', { class: 'card-body' },
    el('dl', { class: 'dl-compact' },
      el('dt', {}, 'Situação'), el('dd', {}, projectChip(ref, p.situacao)),
      el('dt', {}, 'Descrição'), el('dd', { class: 'pre-line' }, p.descricao || '—'),
      el('dt', {}, 'Criado em'), el('dd', {}, date(p.criado_em))))));
  c.append(el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('h2', { class: 'h6 mb-3' }, `Levantamentos deste projeto (${rows.length})`),
    rows.length ? surveyListTable(ctx, ref, rows, { client: false, project: false }, reload) : emptyState('Nenhum levantamento neste projeto.'))));
}

// ------------------------------------------------------------------ comparação
async function compareView(c, ctx) {
  const a = ctx.query.get('a') || '';
  const b = ctx.query.get('b') || '';
  const lista = await get(`${API}/levantamentos?status=todos&limite=100`);
  const options = (sel) => [el('option', { value: '' }, 'Escolha um levantamento…'),
    lista.items.map((r) => el('option', { value: r.id, selected: String(r.id) === sel.split(':')[0] || null }, `${r.codigo} · ${r.cliente_nome} — ${r.projeto_nome} (${date(r.data_reuniao)})`))];
  const selA = el('select', { class: 'form-select', id: 'cmp-a' }, options(a));
  const selB = el('select', { class: 'form-select', id: 'cmp-b' }, options(b));
  const verA = el('input', { class: 'form-control', id: 'cmp-va', type: 'number', min: 1, placeholder: 'atual', value: a.split(':')[1] || '' });
  const verB = el('input', { class: 'form-control', id: 'cmp-vb', type: 'number', min: 1, placeholder: 'atual', value: b.split(':')[1] || '' });
  const refOf = (s, v) => (v.value ? `${s.value}:${v.value}` : s.value);
  c.append(backLink('#/levantamentos', 'Levantamentos'),
    pageHeader('Comparar entrevistas', 'Compare duas entrevistas (ou duas versões da mesma) pergunta a pergunta.'),
    el('form', { class: 'card mb-4', onsubmit: (e) => { e.preventDefault(); if (selA.value && selB.value) ctx.navigate(`levantamentos/comparar?a=${refOf(selA, verA)}&b=${refOf(selB, verB)}`); } },
      el('div', { class: 'card-body row g-3 align-items-end' },
        el('div', { class: 'col-12 col-lg-4' }, el('label', { class: 'form-label', for: 'cmp-a' }, 'Levantamento A'), selA),
        el('div', { class: 'col-6 col-lg-1' }, el('label', { class: 'form-label', for: 'cmp-va' }, 'Versão'), verA),
        el('div', { class: 'col-12 col-lg-4' }, el('label', { class: 'form-label', for: 'cmp-b' }, 'Levantamento B'), selB),
        el('div', { class: 'col-6 col-lg-1' }, el('label', { class: 'form-label', for: 'cmp-vb' }, 'Versão'), verB),
        el('div', { class: 'col-12 col-lg-2' }, el('button', { class: 'btn btn-primary w-100', type: 'submit' }, 'Comparar')))));
  if (!a || !b) return;
  const out = el('div', {}, loading());
  c.append(out);
  try {
    const r = await get(`${API}/levantamentos/comparar?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    out.textContent = '';
    const head = (h, letter) => el('div', { class: 'col-12 col-md-6' }, el('div', { class: 'lr-cmp-head' },
      el('span', { class: 'lr-cmp-letter' }, letter),
      el('div', {}, el('a', { href: `#/levantamentos/${h.id}`, class: 'fw-semibold' }, `${h.codigo} · versão ${h.versao}`),
        el('div', { class: 'small text-body-secondary' }, `${h.cliente_nome} — ${h.projeto_nome} · ${date(h.data_reuniao)} · ${h.responsavel_nome}`))));
    const onlyDiff = el('input', { class: 'form-check-input', type: 'checkbox', id: 'cmp-diff', checked: true });
    const tbody = el('tbody');
    const draw = () => {
      tbody.textContent = '';
      const rows = r.linhas.filter((l) => !onlyDiff.checked || l.diferente);
      if (!rows.length) tbody.append(el('tr', {}, el('td', { colspan: 3, class: 'text-body-secondary' }, 'Nenhuma diferença entre as respostas.')));
      let etapa = null;
      for (const l of rows) {
        if (l.etapa !== etapa) { etapa = l.etapa; tbody.append(el('tr', { class: 'lr-cmp-stage' }, el('th', { colspan: 3, scope: 'colgroup' }, etapa))); }
        tbody.append(el('tr', { class: l.diferente ? 'lr-cmp-diff' : '' },
          el('th', { scope: 'row', class: 'fw-normal' }, l.enunciado, l.enunciado_b ? el('div', { class: 'small text-body-secondary' }, `Em B: ${l.enunciado_b}`) : null, l.somente_em ? el('div', { class: 'small text-body-secondary' }, `Só existe em ${l.somente_em.toUpperCase()}`) : null),
          el('td', { class: 'pre-line' }, l.a || muted('—')), el('td', { class: 'pre-line' }, l.b || muted('—'))));
      }
    };
    onlyDiff.addEventListener('change', draw);
    out.append(el('div', { class: 'row g-3 mb-3' }, head(r.a, 'A'), head(r.b, 'B')),
      el('div', { class: 'card' }, el('div', { class: 'card-body' },
        el('div', { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-3' },
          el('p', { class: 'mb-0' }, el('strong', {}, String(r.diferencas)), ` pergunta(s) com respostas diferentes de ${r.linhas.length}.`),
          el('div', { class: 'form-check form-switch mb-0' }, onlyDiff, el('label', { class: 'form-check-label', for: 'cmp-diff' }, 'Mostrar só as diferenças'))),
        scrollRegion(el('table', { class: 'table align-middle mb-0 lr-cmp-table' },
          el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Pergunta'), el('th', { scope: 'col' }, `A · ${r.a.codigo} v${r.a.versao}`), el('th', { scope: 'col' }, `B · ${r.b.codigo} v${r.b.versao}`))), tbody), 'Comparação das respostas'))));
    draw();
  } catch (err) { out.textContent = ''; out.append(errorState(err)); }
  void datetime;
}
