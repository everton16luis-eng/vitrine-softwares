import { el, icon, kpis, table, badge, card, field, flash, mountDemo, tourView, addDays, fmtDateLong } from './core.js';

// Gerenciamento de Igrejas: dados 100% fictícios (pessoas, igreja e logo genéricos).
const state = {
  pessoas: [
    { id: 1, nome: 'Ana Ribeiro (fictícia)', tipo: 'membro', telefone: '(00) 90000-0001', desde: '2021-03-14' },
    { id: 2, nome: 'Bruno Teixeira (fictício)', tipo: 'membro', telefone: '(00) 90000-0002', desde: '2019-08-02' },
    { id: 3, nome: 'Carla Monteiro (fictícia)', tipo: 'visitante', telefone: '(00) 90000-0003', desde: addDays(-6) },
    { id: 4, nome: 'Diego Almeida (fictício)', tipo: 'membro', telefone: '(00) 90000-0004', desde: '2022-01-20' },
    { id: 5, nome: 'Elisa Nogueira (fictícia)', tipo: 'membro', telefone: '(00) 90000-0005', desde: '2020-11-05' },
    { id: 6, nome: 'Fábio Prado (fictício)', tipo: 'visitante', telefone: '(00) 90000-0006', desde: addDays(-2) },
    { id: 7, nome: 'Gustavo Lima (fictício)', tipo: 'membro', telefone: '(00) 90000-0007', desde: '2023-05-07' }
  ],
  equipes: ['Recepção', 'Louvor', 'Mídia', 'Infantil'],
  voluntarios: [
    { pessoa: 1, equipe: 'Recepção' }, { pessoa: 2, equipe: 'Louvor' }, { pessoa: 4, equipe: 'Mídia' }, { pessoa: 5, equipe: 'Infantil' }, { pessoa: 1, equipe: 'Infantil' },
    { pessoa: 7, equipe: 'Recepção' }, { pessoa: 7, equipe: 'Infantil' }
  ],
  eventos: [
    { id: 1, titulo: 'Culto de domingo', data: addDays(2), hora: '18:00' },
    { id: 2, titulo: 'Reunião de líderes', data: addDays(5), hora: '20:00' },
    { id: 3, titulo: 'Ação social no bairro', data: addDays(9), hora: '09:00' }
  ],
  escalas: [
    { id: 1, evento: 1, pessoa: 1, equipe: 'Recepção', status: 'confirmado' },
    { id: 2, evento: 1, pessoa: 2, equipe: 'Louvor', status: 'pendente' },
    { id: 3, evento: 1, pessoa: 4, equipe: 'Mídia', status: 'pendente' },
    { id: 4, evento: 3, pessoa: 5, equipe: 'Infantil', status: 'recusado' },
    { id: 5, evento: 3, pessoa: 1, equipe: 'Infantil', status: 'pendente' }
  ],
  turmas: ['Kids — 2 a 4 anos', 'Kids — 5 a 8 anos', 'Pré-adolescentes — 9 a 12 anos'],
  criancas: [
    { id: 1, nome: 'Lia Ribeiro (fictícia)', idade: 3, turma: 0, responsaveis: ['Ana Ribeiro (fictícia)'], autorizados: ['Ana Ribeiro (fictícia)', 'Avó: Marta Ribeiro (fictícia)'] },
    { id: 2, nome: 'Theo Almeida (fictício)', idade: 6, turma: 1, responsaveis: ['Diego Almeida (fictício)'], autorizados: ['Diego Almeida (fictício)'] },
    { id: 3, nome: 'Nina Nogueira (fictícia)', idade: 7, turma: 1, responsaveis: ['Elisa Nogueira (fictícia)'], autorizados: ['Elisa Nogueira (fictícia)', 'Tio: Paulo Nogueira (fictício)'] },
    { id: 4, nome: 'Davi Teixeira (fictício)', idade: 10, turma: 2, responsaveis: ['Bruno Teixeira (fictício)'], autorizados: ['Bruno Teixeira (fictício)'] }
  ],
  presencas: [], // { crianca, entrada, deixou, codigo, saida, buscou }
  turmaAberta: false
};
let nextId = 100;
const pessoa = (id) => state.pessoas.find((p) => p.id === id);
const evento = (id) => state.eventos.find((e) => e.id === id);
const crianca = (id) => state.criancas.find((c) => c.id === id);
const TONE = { confirmado: 'ok', pendente: 'warn', recusado: 'bad' };
const agora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const codigoEtiqueta = () => String(Math.floor(1000 + Math.random() * 9000));

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
      { label: 'Telefone', key: 'telefone' }, { label: 'Desde', render: (p) => new Date(`${p.desde}T12:00`).toLocaleDateString('pt-BR') },
      { label: 'Ação', render: (p) => (p.tipo === 'visitante'
        ? el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { p.tipo = 'membro'; flash(c, `${p.nome} agora é membro.`); draw(); } }, 'Tornar membro') : '—') }
    ], rows, { empty: 'Nenhuma pessoa encontrada.' }));
  };
  const search = el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar nome', 'aria-label': 'Pesquisar nome', oninput: (e) => { filtro = e.target.value; draw(); } });
  const sel = el('select', { class: 'form-select', 'aria-label': 'Filtrar por tipo', onchange: (e) => { tipo = e.target.value; draw(); } }, el('option', { value: '' }, 'Todos'), el('option', { value: 'membro' }, 'Membros'), el('option', { value: 'visitante' }, 'Visitantes'));
  const nome = el('input', { class: 'form-control', maxlength: 80, required: true });
  const tipoNovo = el('select', { class: 'form-select' }, el('option', { value: 'visitante' }, 'Visitante'), el('option', { value: 'membro' }, 'Membro'));
  const form = el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    if (nome.value.trim().length < 3) { flash(c, 'Informe um nome com ao menos 3 letras.', 'bad'); return; }
    state.pessoas.push({ id: nextId++, nome: `${nome.value.trim()} (fictício)`, tipo: tipoNovo.value, telefone: '—', desde: addDays(0) });
    flash(c, 'Cadastro incluído na demonstração.');
    app.refresh();
  } }, field('Nome', nome), field('Tipo', tipoNovo), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('plus-lg'), ' Cadastrar'));
  c.append(card('Novo cadastro', el('p', { class: 'demo-muted small mb-2' }, 'Cadastro único: a mesma pessoa pode ser visitante, membro, voluntário e responsável por crianças.'), form),
    card('Participantes', el('div', { class: 'demo-toolbar' }, search, sel), list));
  draw();
}

function escalas(c, app) {
  for (const ev of state.eventos) {
    const rows = state.escalas.filter((s) => s.evento === ev.id);
    c.append(card(`${ev.titulo} — ${fmtDateLong(ev.data)}`, table([
      { label: 'Voluntário', render: (s) => pessoa(s.pessoa).nome }, { label: 'Função', key: 'equipe' },
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

// Turmas: recepção das crianças no culto, com quem deixou, etiqueta com código e saída conferida.
function turmas(c, app) {
  const ev = state.eventos[0];
  if (!state.turmaAberta) {
    c.append(card('Recepção das crianças', el('p', {}, `Próximo evento: ${ev.titulo}, ${fmtDateLong(ev.data)} às ${ev.hora}.`),
      el('p', { class: 'demo-muted small' }, 'No sistema real a turma só abre perto do horário de um evento cadastrado e é encerrada automaticamente às 23h59.'),
      el('button', { class: 'btn btn-accent', type: 'button', onclick: () => { state.turmaAberta = true; app.refresh(); } }, icon('door-open'), ' Abrir turmas')));
    return;
  }
  const dentro = state.presencas.filter((p) => !p.saida);
  c.append(kpis([['Crianças presentes', dentro.length], ['Entradas no evento', state.presencas.length], ['Saídas conferidas', state.presencas.filter((p) => p.saida).length]]));

  const fora = state.criancas.filter((k) => !dentro.some((p) => p.crianca === k.id));
  const sel = el('select', { class: 'form-select' }, fora.map((k) => el('option', { value: k.id }, `${k.nome} · ${state.turmas[k.turma]}`)));
  const deixou = el('select', { class: 'form-select' });
  const preencher = () => {
    const k = crianca(Number(sel.value));
    deixou.replaceChildren(...(k ? k.autorizados : []).map((n) => el('option', {}, n)));
  };
  sel.addEventListener('change', preencher);
  preencher();
  const etiqueta = el('div');
  c.append(card('Entrada', fora.length ? el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const codigo = codigoEtiqueta();
    const k = crianca(Number(sel.value));
    state.presencas.push({ crianca: k.id, entrada: agora(), deixou: deixou.value, codigo });
    app.refresh();
    flash(document.querySelector('#demo-app .demo-body'), `Entrada registrada. Etiquetas impressas: criança e retirada (código ${codigo}).`);
  } }, field('Criança', sel), field('Quem deixou', deixou), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('printer'), ' Registrar e imprimir etiquetas'))
    : el('p', { class: 'demo-empty' }, 'Todas as crianças cadastradas já estão na turma.'), etiqueta));

  c.append(card('Na turma agora', table([
    { label: 'Criança', render: (p) => crianca(p.crianca).nome }, { label: 'Turma', render: (p) => state.turmas[crianca(p.crianca).turma] },
    { label: 'Entrada', render: (p) => `${p.entrada} · deixou: ${p.deixou}` },
    { label: 'Etiqueta', render: (p) => el('span', { class: 'cf-etiqueta' }, icon('qr-code'), ` ${p.codigo}`) },
    { label: 'Saída', render: (p) => {
      const cod = el('input', { class: 'form-control form-control-sm cf-codigo', inputmode: 'numeric', maxlength: 4, placeholder: 'Código', 'aria-label': `Código da etiqueta de ${crianca(p.crianca).nome}` });
      return el('form', { class: 'd-flex gap-1', onsubmit: (e) => {
        e.preventDefault();
        if (cod.value.trim() !== p.codigo) { flash(c, 'Código não confere com a etiqueta de retirada. A criança continua na turma.', 'bad'); return; }
        p.saida = agora();
        p.buscou = p.deixou;
        app.refresh();
        flash(document.querySelector('#demo-app .demo-body'), `Saída conferida: ${crianca(p.crianca).nome} entregue a ${p.buscou}.`);
      } }, cod, el('button', { class: 'btn btn-sm btn-outline-light', type: 'submit' }, 'Conferir saída'));
    } }
  ], dentro, { empty: 'Nenhuma criança na turma.' }),
  el('p', { class: 'demo-muted small mt-2' }, 'No sistema real a saída é feita lendo o QR da etiqueta pela câmera do celular, com confirmação de quem está buscando.')));

  const saidas = state.presencas.filter((p) => p.saida);
  if (saidas.length) {
    c.append(card('Saídas do evento', table([
      { label: 'Criança', render: (p) => crianca(p.crianca).nome }, { label: 'Entrada', key: 'entrada' }, { label: 'Saída', key: 'saida' }, { label: 'Entregue a', key: 'buscou' }
    ], saidas)));
  }
}

function voluntario(c, app) {
  const ids = [...new Set(state.voluntarios.map((v) => v.pessoa))];
  let atual = ids[0];
  const area = el('div');
  const draw = () => {
    area.textContent = '';
    const minhas = state.escalas.filter((s) => s.pessoa === atual);
    area.append(el('p', { class: 'demo-muted' }, `Funções: ${state.voluntarios.filter((v) => v.pessoa === atual).map((v) => v.equipe).join(', ')}`));
    area.append(table([
      { label: 'Evento', render: (s) => evento(s.evento).titulo }, { label: 'Data', render: (s) => fmtDateLong(evento(s.evento).data) },
      { label: 'Função', key: 'equipe' }, { label: 'Situação', render: (s) => badge(s.status, TONE[s.status]) },
      { label: 'Responder', render: (s) => el('div', { class: 'd-flex flex-wrap gap-1' },
        el('button', { class: 'btn btn-sm btn-accent', type: 'button', disabled: s.status === 'confirmado', onclick: () => { s.status = 'confirmado'; draw(); } }, 'Confirmar'),
        el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', disabled: s.status === 'recusado', onclick: () => { s.status = 'recusado'; draw(); } }, 'Não posso'),
        el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => passarVaga(s) }, icon('arrow-left-right'), ' Passar a vaga')) }
    ], minhas, { empty: 'Sem escalas para este voluntário.' }));
  };
  function passarVaga(s) {
    const candidatos = state.voluntarios.filter((v) => v.equipe === s.equipe && v.pessoa !== s.pessoa && !state.escalas.some((x) => x.evento === s.evento && x.pessoa === v.pessoa));
    if (!candidatos.length) { flash(c, `Nenhum outro voluntário de ${s.equipe} disponível para este evento.`, 'bad'); return; }
    const de = pessoa(s.pessoa).nome;
    Object.assign(s, { pessoa: candidatos[0].pessoa, status: 'pendente' });
    draw();
    flash(c, `Vaga passada: ${pessoa(s.pessoa).nome} recebeu o aviso para confirmar no lugar de ${de}.`);
  }
  const sel = el('select', { class: 'form-select', onchange: (e) => { atual = Number(e.target.value); draw(); } }, ids.map((id) => el('option', { value: id }, pessoa(id).nome)));
  c.append(card('Minha área (voluntário)', el('p', { class: 'demo-muted' }, 'Simula a visão do próprio voluntário ao entrar no sistema pelo celular.'), field('Visualizar como', sel), area));
  draw();
}

function relatorios(c) {
  const byTeam = state.equipes.map((eq) => {
    const s = state.escalas.filter((x) => x.equipe === eq);
    return { equipe: eq, total: s.length, confirmadas: s.filter((x) => x.status === 'confirmado').length };
  });
  c.append(card('Escalas por função', table([
    { label: 'Função', key: 'equipe' }, { label: 'Escalas', key: 'total', num: true }, { label: 'Confirmadas', key: 'confirmadas', num: true },
    { label: 'Taxa', num: true, render: (r) => (r.total ? `${Math.round((r.confirmadas / r.total) * 100)}%` : '—') }
  ], byTeam), el('p', { class: 'demo-muted small mt-2' }, 'No sistema real são 8 relatórios com filtros e pré-visualização, exportados em PDF, Excel e CSV.')));
  c.append(card('Perfis de acesso (exemplo)', table([{ label: 'Perfil', key: 'p' }, { label: 'Acesso', key: 'a' }],
    [{ p: 'Administrador', a: 'Todas as áreas' }, { p: 'Secretaria', a: 'Cadastros, eventos, escalas e crianças' }, { p: 'Financeiro', a: 'Somente relatórios' }, { p: 'Voluntário', a: 'Somente a Minha área' }])));
}

const IMG = (k) => `/assets/images/produtos/gerenciamento-de-igrejas-${k}.webp`;
const TOUR = [
  { img: IMG('capa'), area: 'Gestão', titulo: 'Dashboard', ver: 'painel',
    itens: ['Visitantes, membros, voluntários e escalas do mês em um só lugar.', 'Escalas da semana com confirmações e pendências, próximos eventos e gráfico do mês.'] },
  { img: IMG('escalas'), area: 'Escalas', titulo: 'Calendário de escalas', ver: 'escalas',
    itens: ['Calendário que mostra os dias tudo confirmado e os com pendência.', 'Nova escala verifica as ausências informadas; substituição e confirmações pendentes em uma aba própria.'] },
  { img: IMG('celular'), area: 'Celular', titulo: 'No celular', ver: 'voluntario',
    itens: ['O voluntário confirma, recusa ou passa a vaga pelo celular, sem instalar aplicativo.', 'Avisos no celular (notificações) e lembrete na véspera da escala.'] },
  { img: IMG('minha-area'), area: 'Voluntário', titulo: 'Minha área', ver: 'voluntario',
    itens: ['Próximas escalas, quantas vezes serviu e a taxa de presença confirmada.', 'Informa ausências e troca a senha; membros e visitantes veem os próximos eventos.'] },
  { img: IMG('participantes'), area: 'Cadastros', titulo: 'Participantes', ver: 'membros',
    itens: ['Cadastro único de pessoas: visitantes, membros, voluntários e responsáveis.', 'Classificação, apto ao voluntariado e acesso ao sistema na mesma ficha.'] },
  { img: IMG('voluntarios'), area: 'Cadastros', titulo: 'Voluntários', ver: 'voluntario',
    itens: ['Funções, disponibilidade por dia e última escala de cada voluntário.', 'Ficha completa com histórico, ausências e acesso ao portal.'] },
  { img: IMG('criancas'), area: 'Ministério infantil', titulo: 'Crianças', ver: 'turmas',
    itens: ['Crianças com responsáveis, autorizações e quem pode buscar.', 'Turmas por faixa etária e presença do dia.'] },
  { img: IMG('turmas'), area: 'Ministério infantil', titulo: 'Turmas', ver: 'turmas',
    itens: ['Recepção no culto: abre só com evento, registra quem deixou e imprime duas etiquetas.', 'Saída lendo o QR da etiqueta pela câmera, encerramento automático e alertas.'] },
  { img: IMG('eventos'), area: 'Eventos', titulo: 'Eventos', ver: 'eventos',
    itens: ['Eventos com horário, tipo de culto e as funções necessárias.', 'Próximos e realizados: o evento realizado vira histórico.'] },
  { img: IMG('funcoes'), area: 'Escalas', titulo: 'Funções', ver: 'escalas',
    itens: ['Funções dos voluntários, quantos por escala, vagas abertas e dias de uso.'] },
  { img: IMG('relatorios'), area: 'Gestão', titulo: 'Relatórios', ver: 'relatorios',
    itens: ['8 tipos de relatório e o relatório por evento, com filtros e pré-visualização.', 'PDF, Excel e CSV, com histórico dos arquivos gerados.'] }
];

export function start(root) {
  mountDemo(root, {
    name: 'Gerenciamento de Igrejas',
    views: [
      { id: 'tour', label: 'Tour: telas reais', icon: 'images', render: tourView(TOUR) },
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: painel },
      { id: 'membros', label: 'Participantes', icon: 'people', render: membros },
      { id: 'escalas', label: 'Escalas', icon: 'calendar-check', render: escalas },
      { id: 'eventos', label: 'Eventos', icon: 'calendar3', render: eventos },
      { id: 'turmas', label: 'Turmas (crianças)', icon: 'balloon', render: turmas },
      { id: 'voluntario', label: 'Minha área', icon: 'person-badge', render: voluntario },
      { id: 'relatorios', label: 'Relatórios', icon: 'bar-chart', render: relatorios }
    ]
  });
}
