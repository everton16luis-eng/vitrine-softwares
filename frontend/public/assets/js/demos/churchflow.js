import { el, icon, kpis, table, badge, card, field, flash, mountDemo, addDays, fmtDateLong } from './core.js';

// Dados 100% fictícios.
const state = {
  pessoas: [
    { id: 1, nome: 'Ana Ribeiro (fictícia)', tipo: 'membro', telefone: '(00) 90000-0001', desde: '2021-03-14' },
    { id: 2, nome: 'Bruno Teixeira (fictício)', tipo: 'membro', telefone: '(00) 90000-0002', desde: '2019-08-02' },
    { id: 3, nome: 'Carla Monteiro (fictícia)', tipo: 'visitante', telefone: '(00) 90000-0003', desde: addDays(-6) },
    { id: 4, nome: 'Diego Almeida (fictício)', tipo: 'membro', telefone: '(00) 90000-0004', desde: '2022-01-20' },
    { id: 5, nome: 'Elisa Nogueira (fictícia)', tipo: 'membro', telefone: '(00) 90000-0005', desde: '2020-11-05' },
    { id: 6, nome: 'Fábio Prado (fictício)', tipo: 'visitante', telefone: '(00) 90000-0006', desde: addDays(-2) }
  ],
  equipes: ['Recepção', 'Louvor', 'Mídia', 'Infantil'],
  voluntarios: [
    { pessoa: 1, equipe: 'Recepção' }, { pessoa: 2, equipe: 'Louvor' }, { pessoa: 4, equipe: 'Mídia' }, { pessoa: 5, equipe: 'Infantil' }, { pessoa: 1, equipe: 'Infantil' }
  ],
  eventos: [
    { id: 1, titulo: 'Encontro de domingo', data: addDays(2), hora: '18:00' },
    { id: 2, titulo: 'Reunião de líderes', data: addDays(5), hora: '20:00' },
    { id: 3, titulo: 'Ação social no bairro', data: addDays(9), hora: '09:00' }
  ],
  escalas: [
    { id: 1, evento: 1, pessoa: 1, equipe: 'Recepção', status: 'confirmado' },
    { id: 2, evento: 1, pessoa: 2, equipe: 'Louvor', status: 'pendente' },
    { id: 3, evento: 1, pessoa: 4, equipe: 'Mídia', status: 'pendente' },
    { id: 4, evento: 3, pessoa: 5, equipe: 'Infantil', status: 'recusado' },
    { id: 5, evento: 3, pessoa: 1, equipe: 'Infantil', status: 'pendente' }
  ]
};
let nextId = 100;
const pessoa = (id) => state.pessoas.find((p) => p.id === id);
const evento = (id) => state.eventos.find((e) => e.id === id);
const TONE = { confirmado: 'ok', pendente: 'warn', recusado: 'bad' };

function painel(c) {
  const pend = state.escalas.filter((e) => e.status === 'pendente').length;
  c.append(kpis([
    ['Membros', state.pessoas.filter((p) => p.tipo === 'membro').length],
    ['Visitantes (30 dias)', state.pessoas.filter((p) => p.tipo === 'visitante').length],
    ['Voluntários', new Set(state.voluntarios.map((v) => v.pessoa)).size],
    ['Confirmações pendentes', pend, pend ? 'warn' : '']
  ]));
  c.append(card('Próximos eventos', table([
    { label: 'Evento', key: 'titulo' }, { label: 'Data', render: (e) => `${fmtDateLong(e.data)} · ${e.hora}` },
    { label: 'Escalados', num: true, render: (e) => state.escalas.filter((s) => s.evento === e.id).length }
  ], state.eventos)));
}

function membros(c, app) {
  let filtro = '';
  let tipo = '';
  const list = el('div');
  const draw = () => {
    list.textContent = '';
    const rows = state.pessoas.filter((p) => (!tipo || p.tipo === tipo) && p.nome.toLowerCase().includes(filtro.toLowerCase()));
    list.append(table([
      { label: 'Nome', key: 'nome' }, { label: 'Tipo', render: (p) => badge(p.tipo === 'membro' ? 'Membro' : 'Visitante', p.tipo === 'membro' ? 'ok' : 'info') },
      { label: 'Telefone', key: 'telefone' }, { label: 'Desde', render: (p) => new Date(`${p.desde}T12:00`).toLocaleDateString('pt-BR') }
    ], rows, { empty: 'Nenhuma pessoa encontrada.' }));
  };
  const search = el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar nome', oninput: (e) => { filtro = e.target.value; draw(); } });
  const sel = el('select', { class: 'form-select', onchange: (e) => { tipo = e.target.value; draw(); } }, el('option', { value: '' }, 'Todos'), el('option', { value: 'membro' }, 'Membros'), el('option', { value: 'visitante' }, 'Visitantes'));
  const nome = el('input', { class: 'form-control', maxlength: 80, required: true });
  const tipoNovo = el('select', { class: 'form-select' }, el('option', { value: 'visitante' }, 'Visitante'), el('option', { value: 'membro' }, 'Membro'));
  const form = el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    if (nome.value.trim().length < 3) { flash(c, 'Informe um nome com ao menos 3 letras.', 'bad'); return; }
    state.pessoas.push({ id: nextId++, nome: `${nome.value.trim()} (fictício)`, tipo: tipoNovo.value, telefone: '—', desde: addDays(0) });
    flash(c, 'Cadastro incluído na demonstração.');
    app.refresh();
  } }, field('Nome', nome), field('Tipo', tipoNovo), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('plus-lg'), ' Cadastrar'));
  c.append(card('Novo cadastro', form), card('Pessoas', el('div', { class: 'demo-toolbar' }, search, sel), list));
  draw();
}

function escalas(c, app) {
  for (const ev of state.eventos) {
    const rows = state.escalas.filter((s) => s.evento === ev.id);
    c.append(card(`${ev.titulo} — ${fmtDateLong(ev.data)}`, table([
      { label: 'Voluntário', render: (s) => pessoa(s.pessoa).nome }, { label: 'Equipe', key: 'equipe' },
      { label: 'Situação', render: (s) => badge(s.status, TONE[s.status]) },
      { label: 'Ação', render: (s) => el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => {
        s.status = s.status === 'confirmado' ? 'pendente' : 'confirmado'; app.refresh();
      } }, s.status === 'confirmado' ? 'Desfazer' : 'Marcar confirmado') }
    ], rows, { empty: 'Nenhum voluntário escalado.' })));
  }
}

function eventos(c, app) {
  const titulo = el('input', { class: 'form-control', maxlength: 80 });
  const data = el('input', { class: 'form-control', type: 'date', value: addDays(7) });
  c.append(card('Novo evento', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    if (!titulo.value.trim()) { flash(c, 'Informe o título.', 'bad'); return; }
    state.eventos.push({ id: nextId++, titulo: titulo.value.trim(), data: data.value, hora: '19:00' });
    state.eventos.sort((a, b) => a.data.localeCompare(b.data));
    app.refresh();
  } }, field('Título', titulo), field('Data', data), el('button', { class: 'btn btn-accent', type: 'submit' }, 'Adicionar'))));
  c.append(card('Calendário', el('ul', { class: 'demo-timeline' }, state.eventos.map((e) => el('li', {}, el('strong', {}, fmtDateLong(e.data)), ` ${e.hora} — ${e.titulo}`)))));
}

function voluntario(c, app) {
  const ids = [...new Set(state.voluntarios.map((v) => v.pessoa))];
  let atual = ids[0];
  const area = el('div');
  const draw = () => {
    area.textContent = '';
    const minhas = state.escalas.filter((s) => s.pessoa === atual);
    area.append(el('p', { class: 'demo-muted' }, `Equipes: ${state.voluntarios.filter((v) => v.pessoa === atual).map((v) => v.equipe).join(', ')}`));
    area.append(table([
      { label: 'Evento', render: (s) => evento(s.evento).titulo }, { label: 'Data', render: (s) => fmtDateLong(evento(s.evento).data) },
      { label: 'Função', key: 'equipe' }, { label: 'Situação', render: (s) => badge(s.status, TONE[s.status]) },
      { label: 'Responder', render: (s) => el('div', { class: 'd-flex gap-1' },
        el('button', { class: 'btn btn-sm btn-accent', type: 'button', disabled: s.status === 'confirmado', onclick: () => { s.status = 'confirmado'; draw(); } }, 'Confirmar'),
        el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', disabled: s.status === 'recusado', onclick: () => { s.status = 'recusado'; draw(); } }, 'Não posso')) }
    ], minhas, { empty: 'Sem escalas para este voluntário.' }));
  };
  const sel = el('select', { class: 'form-select', onchange: (e) => { atual = Number(e.target.value); draw(); } }, ids.map((id) => el('option', { value: id }, pessoa(id).nome)));
  c.append(card('Área individual do voluntário', el('p', { class: 'demo-muted' }, 'Simula a visão do próprio voluntário ao entrar no sistema.'), field('Visualizar como', sel), area));
  draw();
}

function relatorios(c) {
  const byTeam = state.equipes.map((eq) => {
    const s = state.escalas.filter((x) => x.equipe === eq);
    return { equipe: eq, total: s.length, confirmadas: s.filter((x) => x.status === 'confirmado').length };
  });
  c.append(card('Escalas por equipe', table([
    { label: 'Equipe', key: 'equipe' }, { label: 'Escalas', key: 'total', num: true }, { label: 'Confirmadas', key: 'confirmadas', num: true },
    { label: 'Taxa', num: true, render: (r) => (r.total ? `${Math.round((r.confirmadas / r.total) * 100)}%` : '—') }
  ], byTeam)));
  c.append(card('Permissões (exemplo)', table([{ label: 'Perfil', key: 'p' }, { label: 'Acesso', key: 'a' }],
    [{ p: 'Administração', a: 'Todos os módulos' }, { p: 'Líder de equipe', a: 'Escalas e voluntários da própria equipe' }, { p: 'Voluntário', a: 'Somente a própria área' }])));
}

export function start(root) {
  mountDemo(root, {
    name: 'ChurchFlow',
    views: [
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: painel },
      { id: 'membros', label: 'Membros e visitantes', icon: 'people', render: membros },
      { id: 'escalas', label: 'Escalas', icon: 'calendar-check', render: escalas },
      { id: 'eventos', label: 'Eventos', icon: 'calendar3', render: eventos },
      { id: 'voluntario', label: 'Área do voluntário', icon: 'person-badge', render: voluntario },
      { id: 'relatorios', label: 'Relatórios', icon: 'bar-chart', render: relatorios }
    ]
  });
}
