import { el, icon, kpis, table, badge, card, field, flash, mountDemo, tourView, addDays, fmtDateLong, money } from './core.js';

// Gestão de Barbearias: simulação com dados 100% fictícios. Valores em centavos.
// Segue as regras do sistema real: o horário vem da jornada do profissional e nunca se sobrepõe a outro
// atendimento; o preço do agendamento é o do momento; finalizar o atendimento gera a comissão e deixa o
// valor a receber no caixa; o fechamento do caixa confere só o dinheiro em espécie.
const SERVICOS = [
  { id: 1, nome: 'Corte masculino', min: 30, preco: 4500, tipo: 'servico' },
  { id: 2, nome: 'Corte infantil', min: 30, preco: 3500, tipo: 'servico' },
  { id: 3, nome: 'Barba', min: 30, preco: 3500, tipo: 'servico' },
  { id: 4, nome: 'Pigmentação', min: 45, preco: 6000, tipo: 'servico' },
  { id: 5, nome: 'Hidratação', min: 30, preco: 4000, tipo: 'servico' },
  { id: 6, nome: 'Sobrancelha', min: 15, preco: 1500, tipo: 'adicional' },
  { id: 7, nome: 'Corte e barba', min: 60, preco: 7000, tipo: 'combo' }
];
const PROFS = [
  { id: 1, nome: 'Carlos Navalha', comissao: 40, faz: [1, 2, 3, 4, 5, 6, 7], ini: '09:00', fim: '19:00' },
  { id: 2, nome: 'João Tesoura', comissao: 40, faz: [1, 2, 3, 6, 7], ini: '09:00', fim: '18:00' },
  { id: 3, nome: 'Pedro Degradê', comissao: 35, faz: [1, 3, 4, 7], ini: '10:00', fim: '19:00' }
];
const ALMOCO = ['12:00', '13:00'];
const FORMAS = ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'];
const STATUS = {
  agendado: ['Agendado', 'neutral'], confirmado: ['Confirmado', 'info'], em_atendimento: ['Em atendimento', 'warn'],
  finalizado: ['Finalizado', 'ok'], cancelado: ['Cancelado', 'bad'], falta: ['Falta', 'bad']
};
const MODELOS = [
  { id: 'classico', nome: 'Black Label', desc: 'Luxo discreto: preto profundo, tipografia editorial e fotografia em grande escala.' },
  { id: 'urbano', nome: 'Urban Culture', desc: 'Cultura de rua: cartaz, letras enormes, blocos de cor e movimento.' },
  { id: 'vintage', nome: 'Heritage', desc: 'Alfaiataria e tradição: verde garrafa, latão e serifa com caráter.' },
  { id: 'minimalista', nome: 'Modern Minimal', desc: 'Design suíço: grade precisa e poucos elementos muito bem resolvidos.' },
  { id: 'comercial', nome: 'Signature', desc: 'Feito para agendar: serviços e preços organizados e reserva sempre à mão.' }
];

const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const servico = (id) => SERVICOS.find((s) => s.id === id);
const prof = (id) => PROFS.find((p) => p.id === id);
const dur = (ids) => ids.reduce((a, id) => a + servico(id).min, 0);
const total = (ids) => ids.reduce((a, id) => a + servico(id).preco, 0);
const nomes = (a) => a.itens.map((i) => i.nome).join(' + ');
const etiqueta = (s) => badge(...STATUS[s]);

const state = {
  ags: [], caixa: { aberto: true, abertura: 15000, movs: [] }, comissoes: [], recebidos: new Set(),
  site: { publicado: 'classico', rascunho: 'classico', nome: 'Barbearia Exemplo' }
};
let seq = 1;
function criar({ data, ini, profId, servs, cliente, telefone = '', origem = 'Recepção', status = 'agendado' }) {
  const a = { id: seq++, data, ini, fim: hhmm(min(ini) + dur(servs)), prof: profId, cliente, telefone, origem, status,
    itens: servs.map((id) => ({ id, nome: servico(id).nome, preco: servico(id).preco, min: servico(id).min })) };
  a.valor = a.itens.reduce((x, i) => x + i.preco, 0);
  state.ags.push(a);
  return a;
}
const ativos = (a) => !['cancelado', 'falta'].includes(a.status);
/** Motivo de recusa do horário, ou null se está livre (expediente, almoço e sobreposição). */
function recusa(profId, data, ini, minutos, ignorar) {
  const p = prof(profId);
  const i = min(ini);
  const f = i + minutos;
  if (i < min(p.ini) || f > min(p.fim)) return `fora do expediente de ${p.nome} (${p.ini} às ${p.fim})`;
  if (i < min(ALMOCO[1]) && min(ALMOCO[0]) < f) return 'cai no intervalo de almoço (12:00 às 13:00)';
  const c = state.ags.find((a) => a.id !== ignorar && a.prof === profId && a.data === data && ativos(a) && i < min(a.fim) && min(a.ini) < f);
  return c ? `${p.nome} já atende ${c.cliente} das ${c.ini} às ${c.fim}` : null;
}
function horarios(profId, data, minutos) {
  const agora = new Date();
  const corte = data === addDays(0) ? agora.getHours() * 60 + agora.getMinutes() + 30 : 0;
  const lista = [];
  for (let m = 9 * 60; m + minutos <= 19 * 60; m += 15) {
    if (m < corte) continue;
    const t = hhmm(m);
    const livre = (profId ? [profId] : PROFS.map((p) => p.id)).find((id) => !recusa(id, data, t, minutos));
    if (livre) lista.push({ t, prof: livre });
  }
  return lista;
}
function finalizar(a) {
  a.status = 'finalizado';
  const p = prof(a.prof);
  state.comissoes.push({ ag: a.id, prof: a.prof, base: a.valor, valor: Math.round((a.valor * p.comissao) / 100), status: 'A pagar' });
}

// Dados iniciais: hoje com atendimentos em cada situação, e amanhã já com reservas.
(() => {
  const h = addDays(0);
  const am = addDays(1);
  const f1 = criar({ data: h, ini: '09:00', profId: 1, servs: [7], cliente: 'Júlia Pereira (fictícia)', status: 'confirmado' });
  finalizar(f1);
  const f2 = criar({ data: h, ini: '09:30', profId: 2, servs: [1], cliente: 'Rafael Costa (fictício)', status: 'confirmado' });
  finalizar(f2);
  state.recebidos.add(f2.id);
  state.caixa.movs.push({ hora: '10:05', tipo: 'Recebimento', desc: `Atendimento de ${f2.cliente}`, forma: 'Pix', valor: f2.valor });
  criar({ data: h, ini: '10:30', profId: 1, servs: [1, 6], cliente: 'Marcos Andrade (fictício)', origem: 'Site', status: 'em_atendimento' });
  criar({ data: h, ini: '10:00', profId: 3, servs: [4], cliente: 'Thiago Mendes (fictício)', status: 'confirmado' });
  criar({ data: h, ini: '11:00', profId: 2, servs: [3], cliente: 'Lucas Ferreira (fictício)', origem: 'Site' });
  criar({ data: h, ini: '14:00', profId: 1, servs: [1], cliente: 'André Santos (fictício)', origem: 'Site' });
  criar({ data: h, ini: '15:30', profId: 3, servs: [7], cliente: 'Diego Ribeiro (fictício)', status: 'confirmado' });
  criar({ data: h, ini: '16:00', profId: 1, servs: [2], cliente: 'Enzo Lima (fictício)' });
  criar({ data: am, ini: '09:00', profId: 1, servs: [7], cliente: 'Felipe Rocha (fictício)', origem: 'Site' });
  criar({ data: am, ini: '10:00', profId: 2, servs: [1], cliente: 'Gustavo Alves (fictício)' });
})();

// Mensagem depois de redesenhar a tela (o flash antes do refresh some junto com o conteúdo).
function irCom(c, app, view, msg, tom) { const main = c.parentElement; if (view) app.go(view); else app.refresh(); flash(main.querySelector('.demo-body'), msg, tom); }
const aReceber = () => state.ags.filter((a) => a.status === 'finalizado' && !state.recebidos.has(a.id));
const saldoDinheiro = () => state.caixa.abertura + state.caixa.movs.filter((m) => m.forma === 'Dinheiro').reduce((x, m) => x + (m.tipo === 'Sangria' ? -m.valor : m.valor), 0);
function resumo(itens) { const k = kpis(itens); k.classList.add('bb-resumo'); return k; }

function painel(c, app) {
  const hoje = state.ags.filter((a) => a.data === addDays(0) && ativos(a));
  const recebido = state.caixa.movs.filter((m) => m.tipo === 'Recebimento').reduce((x, m) => x + m.valor, 0);
  c.append(resumo([
    ['Agendamentos hoje', String(hoje.length)], ['Finalizados', String(hoje.filter((a) => a.status === 'finalizado').length), 'ok'],
    ['Recebido hoje', money(recebido)], ['A receber no caixa', money(aReceber().reduce((x, a) => x + a.valor, 0)), aReceber().length ? 'warn' : '']
  ]));
  c.append(card('Próximos atendimentos', table([
    { label: 'Hora', render: (a) => `${a.ini}–${a.fim}` }, { label: 'Cliente', key: 'cliente' }, { label: 'Serviço', render: nomes },
    { label: 'Profissional', render: (a) => prof(a.prof).nome }, { label: 'Situação', render: (a) => etiqueta(a.status) }
  ], hoje.filter((a) => a.status !== 'finalizado').sort((x, y) => min(x.ini) - min(y.ini)), { empty: 'Nenhum atendimento pendente hoje.' })));
  c.append(card('Atalhos', el('div', { class: 'bb-acoes' },
    el('button', { type: 'button', class: 'btn btn-accent', onclick: () => app.go('agendar') }, icon('calendar-plus'), ' Agendar como cliente'),
    el('button', { type: 'button', class: 'btn btn-outline-light', onclick: () => app.go('barbeiro') }, icon('phone'), ' Abrir o app do barbeiro'),
    el('button', { type: 'button', class: 'btn btn-outline-light', onclick: () => app.go('caixa') }, icon('cash-stack'), ' Ir ao caixa'))));
}

let diaAgenda = addDays(0);
function agenda(c, app) {
  const data = el('input', { type: 'date', class: 'form-control', value: diaAgenda, onchange: (e) => { diaAgenda = e.target.value || addDays(0); app.refresh(); } });
  c.append(card(null, el('div', { class: 'bb-filtros' }, field('Dia', data), el('p', { class: 'demo-muted small' }, fmtDateLong(diaAgenda)))));
  const grade = el('div', { class: 'bb-grade' });
  for (const p of PROFS) {
    const doDia = state.ags.filter((a) => a.prof === p.id && a.data === diaAgenda).sort((x, y) => min(x.ini) - min(y.ini));
    grade.append(el('section', { class: 'bb-coluna', 'aria-label': `Agenda de ${p.nome}` },
      el('h3', {}, p.nome, el('span', { class: 'demo-muted small' }, ` ${p.ini}–${p.fim}`)),
      doDia.length ? el('ul', { class: 'bb-lista' }, doDia.map((a) => el('li', { class: `bb-ag s-${a.status}` },
        el('strong', {}, `${a.ini}–${a.fim}`), el('span', {}, a.cliente), el('span', { class: 'demo-muted small' }, `${nomes(a)} · ${money(a.valor)} · ${a.origem}`),
        el('span', { class: 'bb-linha' }, etiqueta(a.status), acoesRecepcao(c, app, a))))) : el('p', { class: 'demo-empty' }, 'Sem agendamentos.')));
  }
  c.append(grade);
  c.append(el('p', { class: 'demo-muted small' }, 'A recepção confirma, cancela ou registra falta. Agendamentos novos chegam pelo site de agendamento ou pela recepção, sempre respeitando a jornada e sem sobreposição.'));
}
function acoesRecepcao(c, app, a) {
  const b = (txt, fn, cls = 'btn-outline-light') => el('button', { type: 'button', class: `btn btn-sm ${cls}`, onclick: fn }, txt);
  if (a.status === 'agendado') return el('span', { class: 'bb-acoes' }, b('Confirmar', () => { a.status = 'confirmado'; irCom(c, app, null, `Agendamento de ${a.cliente} confirmado.`); }),
    b('Cancelar', () => { a.status = 'cancelado'; irCom(c, app, null, 'Agendamento cancelado. O horário voltou a ficar livre.', 'warn'); }));
  if (a.status === 'confirmado') return el('span', { class: 'bb-acoes' }, b('Falta', () => { a.status = 'falta'; irCom(c, app, null, `Falta registrada para ${a.cliente}.`, 'warn'); }));
  return null;
}

// Agendamento online, como o cliente faz pelo link da barbearia.
const reserva = { servs: [], prof: 0, data: addDays(1), hora: null, nome: '', fone: '' };
function agendar(c, app) {
  const minutos = dur(reserva.servs);
  const aptos = PROFS.filter((p) => reserva.servs.every((s) => p.faz.includes(s)));
  if (reserva.prof && !aptos.some((p) => p.id === reserva.prof)) reserva.prof = 0;
  c.append(el('p', { class: 'demo-muted' }, `Página pública de agendamento da ${state.site.nome}. O cliente não precisa criar conta.`));
  c.append(card('1. Escolha o serviço', el('ul', { class: 'bb-servicos' }, SERVICOS.map((s) => el('li', {}, el('label', {},
    el('input', { type: 'checkbox', checked: reserva.servs.includes(s.id), onchange: (e) => {
      reserva.servs = e.target.checked ? [...reserva.servs, s.id] : reserva.servs.filter((x) => x !== s.id);
      reserva.hora = null; app.refresh();
    } }),
    el('span', { class: 'bb-grow' }, el('strong', {}, s.nome), el('span', { class: 'demo-muted small' }, ` ${s.min} min${s.tipo === 'adicional' ? ' · adicional' : s.tipo === 'combo' ? ' · combo' : ''}`)),
    el('span', {}, money(s.preco))))))));
  if (!reserva.servs.length) return;
  c.append(card('2. Escolha o profissional', el('div', { class: 'bb-acoes' },
    el('button', { type: 'button', class: `btn btn-sm ${reserva.prof ? 'btn-outline-light' : 'btn-accent'}`, 'aria-pressed': String(!reserva.prof), onclick: () => { reserva.prof = 0; reserva.hora = null; app.refresh(); } }, 'Primeiro disponível'),
    aptos.map((p) => el('button', { type: 'button', class: `btn btn-sm ${reserva.prof === p.id ? 'btn-accent' : 'btn-outline-light'}`, 'aria-pressed': String(reserva.prof === p.id), onclick: () => { reserva.prof = p.id; reserva.hora = null; app.refresh(); } }, p.nome))),
  aptos.length ? null : el('p', { class: 'demo-muted small' }, 'Nenhum profissional faz todos estes serviços juntos.')));
  if (!aptos.length) return;
  const livres = horarios(reserva.prof || 0, reserva.data, minutos).filter((h) => aptos.some((p) => p.id === h.prof));
  const data = el('input', { type: 'date', class: 'form-control', min: addDays(0), max: addDays(30), value: reserva.data, onchange: (e) => { reserva.data = e.target.value || addDays(1); reserva.hora = null; app.refresh(); } });
  c.append(card('3. Escolha a data e o horário', el('div', { class: 'bb-data' }, field('Data', data)),
    livres.length ? el('div', { class: 'bb-horas' }, livres.map((h) => el('button', { type: 'button', class: `btn btn-sm ${reserva.hora?.t === h.t ? 'btn-accent' : 'btn-outline-light'}`, 'aria-pressed': String(reserva.hora?.t === h.t), onclick: () => { reserva.hora = h; app.refresh(); } }, h.t)))
      : el('p', { class: 'demo-muted' }, 'Nenhum horário livre nesta data.'),
    el('p', { class: 'demo-muted small mt-2' }, `Duração total: ${minutos} min. Os horários já descontam atendimentos marcados, almoço e expediente de cada profissional.`)));
  if (!reserva.hora) return;
  const nome = el('input', { type: 'text', class: 'form-control', required: true, autocomplete: 'off', value: reserva.nome, oninput: (e) => { reserva.nome = e.target.value; } });
  const fone = el('input', { type: 'tel', class: 'form-control', required: true, inputmode: 'tel', autocomplete: 'off', placeholder: '(11) 90000-0000', value: reserva.fone, oninput: (e) => { reserva.fone = e.target.value; } });
  c.append(card('4. Seus dados', el('form', { class: 'bb-form', onsubmit: (e) => {
    e.preventDefault();
    if (reserva.nome.trim().length < 3) return flash(c, 'Informe o nome completo.', 'bad');
    if (reserva.fone.replace(/\D/g, '').length < 10) return flash(c, 'Informe o celular com DDD.', 'bad');
    const motivo = recusa(reserva.hora.prof, reserva.data, reserva.hora.t, minutos);
    if (motivo) return flash(c, `Este horário acabou de ser ocupado: ${motivo}. Escolha outro.`, 'bad');
    const a = criar({ data: reserva.data, ini: reserva.hora.t, profId: reserva.hora.prof, servs: reserva.servs, cliente: `${reserva.nome.trim()} (simulação)`, telefone: reserva.fone, origem: 'Site' });
    Object.assign(reserva, { servs: [], prof: 0, hora: null, nome: '', fone: '' });
    diaAgenda = a.data;
    irCom(c, app, 'agenda', `Agendamento recebido: ${fmtDateLong(a.data)} às ${a.ini} com ${prof(a.prof).nome}. Ele já aparece na agenda da barbearia e no app do barbeiro.`);
  } },
  field('Nome', nome), field('Celular com DDD', fone),
  el('p', { class: 'demo-muted small' }, 'Na versão real, o cliente recebe confirmação e lembrete pelo WhatsApp, se autorizar, e um link para consultar ou cancelar.'),
  el('p', { class: 'bb-total' }, `${fmtDateLong(reserva.data)} · ${reserva.hora.t} · ${prof(reserva.hora.prof).nome} · Total: ${money(total(reserva.servs))}`),
  el('button', { type: 'submit', class: 'btn btn-accent' }, icon('check2-circle'), ' Confirmar agendamento'))));
}

// App do barbeiro: a agenda do dia de quem está logado.
let barbeiroId = 1;
function barbeiro(c, app) {
  const sel = el('select', { class: 'form-select', onchange: (e) => { barbeiroId = Number(e.target.value); app.refresh(); } },
    PROFS.map((p) => el('option', { value: p.id, selected: p.id === barbeiroId }, p.nome)));
  const hoje = state.ags.filter((a) => a.prof === barbeiroId && a.data === addDays(0) && ativos(a)).sort((x, y) => min(x.ini) - min(y.ini));
  const meus = state.comissoes.filter((m) => m.prof === barbeiroId);
  const tela = el('div', { class: 'bb-celular' },
    el('div', { class: 'bb-celular-topo' }, el('span', {}, 'Minha agenda'), el('span', { class: 'small' }, fmtDateLong(addDays(0)))),
    resumo([['Hoje', String(hoje.length)], ['Comissão do dia', money(meus.reduce((x, m) => x + m.valor, 0)), 'ok']]),
    hoje.length ? el('ul', { class: 'bb-lista' }, hoje.map((a) => el('li', { class: `bb-ag s-${a.status}` },
      el('strong', {}, `${a.ini}–${a.fim}`), el('span', {}, a.cliente), el('span', { class: 'demo-muted small' }, `${nomes(a)} · ${money(a.valor)}`),
      el('span', { class: 'bb-linha' }, etiqueta(a.status), acaoBarbeiro(c, app, a))))) : el('p', { class: 'demo-empty' }, 'Nenhum atendimento hoje.'));
  c.append(card(null, el('div', { class: 'bb-filtros' }, field('Entrar como', sel)), tela,
    el('p', { class: 'demo-muted small mt-2' }, 'O barbeiro só vê a própria agenda, as próprias comissões e os próprios recebimentos. Finalizar o atendimento gera a comissão e deixa o valor a receber no caixa.')));
}
function acaoBarbeiro(c, app, a) {
  const b = (txt, ic, fn) => el('button', { type: 'button', class: 'btn btn-sm btn-accent', onclick: fn }, icon(ic), ` ${txt}`);
  if (a.status === 'agendado') return b('Confirmar', 'check2', () => { a.status = 'confirmado'; irCom(c, app, null, `Presença de ${a.cliente} confirmada.`); });
  if (a.status === 'confirmado') return b('Iniciar', 'play-fill', () => {
    const outro = state.ags.find((x) => x.prof === a.prof && x.status === 'em_atendimento');
    if (outro) return flash(c, `Finalize primeiro o atendimento de ${outro.cliente}.`, 'bad');
    a.status = 'em_atendimento'; irCom(c, app, null, `Atendimento de ${a.cliente} iniciado.`);
  });
  if (a.status === 'em_atendimento') return b('Finalizar', 'flag-fill', () => {
    finalizar(a);
    const cm = state.comissoes.at(-1);
    irCom(c, app, null, `Atendimento finalizado. Comissão de ${money(cm.valor)} (${prof(a.prof).comissao}% de ${money(a.valor)}) e ${money(a.valor)} a receber no caixa.`);
  });
  return null;
}

function caixa(c, app) {
  const cx = state.caixa;
  const recebido = cx.movs.filter((m) => m.tipo === 'Recebimento').reduce((x, m) => x + m.valor, 0);
  c.append(resumo([['Situação', cx.aberto ? 'Aberto' : 'Fechado', cx.aberto ? 'ok' : ''], ['Abertura', money(cx.abertura)], ['Recebido', money(recebido)], ['Dinheiro na gaveta', money(saldoDinheiro())]]));
  if (!cx.aberto) {
    c.append(card('Caixa fechado', el('p', {}, 'O caixa do dia foi conferido e fechado. Na versão real, as movimentações de um caixa fechado nunca mudam.'),
      el('button', { type: 'button', class: 'btn btn-accent', onclick: () => { Object.assign(cx, { aberto: true, abertura: 15000, movs: [] }); irCom(c, app, null, 'Caixa aberto com R$ 150,00 de troco.'); } }, icon('unlock'), ' Abrir novo caixa')));
    return;
  }
  const pend = aReceber();
  c.append(card('Atendimentos a receber', pend.length ? el('ul', { class: 'bb-lista' }, pend.map((a) => {
    const forma = el('select', { class: 'form-select form-select-sm', 'aria-label': `Forma de pagamento de ${a.cliente}` }, FORMAS.map((f) => el('option', { value: f }, f)));
    const desc = el('input', { type: 'text', inputmode: 'decimal', class: 'form-control form-control-sm', placeholder: '0,00', 'aria-label': `Desconto para ${a.cliente}` });
    return el('li', { class: 'bb-ag' }, el('strong', {}, `${a.cliente} · ${money(a.valor)}`), el('span', { class: 'demo-muted small' }, `${nomes(a)} com ${prof(a.prof).nome}`),
      el('span', { class: 'bb-receber' }, forma, desc, el('button', { type: 'button', class: 'btn btn-sm btn-accent', onclick: () => {
        const d = Math.round(Number((desc.value || '0').replace(/\./g, '').replace(',', '.')) * 100);
        if (!Number.isFinite(d) || d < 0 || d >= a.valor) return flash(c, 'Desconto inválido: use um valor menor que o total.', 'bad');
        state.recebidos.add(a.id);
        const agora = new Date();
        cx.movs.push({ hora: hhmm(agora.getHours() * 60 + agora.getMinutes()), tipo: 'Recebimento', desc: `Atendimento de ${a.cliente}${d ? ` (desconto ${money(d)})` : ''}`, forma: forma.value, valor: a.valor - d });
        irCom(c, app, null, `Recebido ${money(a.valor - d)} em ${forma.value}.`);
      } }, 'Receber')));
  })) : el('p', { class: 'demo-empty' }, 'Nada a receber. Finalize um atendimento no app do barbeiro.')));
  c.append(card('Movimentações do caixa', table([
    { label: 'Hora', key: 'hora' }, { label: 'Tipo', key: 'tipo' }, { label: 'Descrição', key: 'desc' }, { label: 'Forma', key: 'forma' },
    { label: 'Valor', num: true, render: (m) => (m.tipo === 'Sangria' ? `− ${money(m.valor)}` : money(m.valor)) }
  ], cx.movs, { empty: 'Nenhuma movimentação ainda.' }),
  el('div', { class: 'bb-acoes mt-2' }, el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => {
    if (saldoDinheiro() < 5000) return flash(c, 'Sangria recusada: não há R$ 50,00 em dinheiro na gaveta.', 'bad');
    cx.movs.push({ hora: hhmm(new Date().getHours() * 60 + new Date().getMinutes()), tipo: 'Sangria', desc: 'Retirada para o cofre', forma: 'Dinheiro', valor: 5000 });
    irCom(c, app, null, 'Sangria de R$ 50,00 registrada.');
  } }, icon('box-arrow-up'), ' Sangria de R$ 50,00'))));
  const contado = el('input', { type: 'text', inputmode: 'decimal', class: 'form-control', placeholder: '0,00' });
  c.append(card('Fechar o caixa', el('form', { class: 'bb-form', onsubmit: (e) => {
    e.preventDefault();
    const v = Math.round(Number((contado.value || '').replace(/\./g, '').replace(',', '.')) * 100);
    if (!contado.value.trim() || !Number.isFinite(v) || v < 0) return flash(c, 'Informe quanto dinheiro há na gaveta.', 'bad');
    const dif = v - saldoDinheiro();
    cx.aberto = false;
    irCom(c, app, null, dif === 0 ? 'Caixa fechado e conferido, sem diferença.' : `Caixa fechado com diferença de ${money(dif)}, registrada na conferência.`, dif === 0 ? 'ok' : 'warn');
  } }, field('Dinheiro contado na gaveta (R$)', contado),
  el('p', { class: 'demo-muted small' }, `Esperado: ${money(saldoDinheiro())}. A conferência considera só o dinheiro em espécie: Pix e cartão não passam pela gaveta.`),
  el('button', { type: 'submit', class: 'btn btn-accent' }, icon('lock'), ' Fechar caixa'))));
}

function comissoes(c, app) {
  c.append(card('Comissões por profissional', table([
    { label: 'Profissional', key: 'nome' }, { label: 'Percentual', num: true, render: (p) => `${p.comissao}%` },
    { label: 'Atendimentos', num: true, render: (p) => state.comissoes.filter((m) => m.prof === p.id).length },
    { label: 'Base', num: true, render: (p) => money(state.comissoes.filter((m) => m.prof === p.id).reduce((x, m) => x + m.base, 0)) },
    { label: 'A pagar', num: true, render: (p) => money(state.comissoes.filter((m) => m.prof === p.id && m.status === 'A pagar').reduce((x, m) => x + m.valor, 0)) },
    { label: '', render: (p) => (state.comissoes.some((m) => m.prof === p.id && m.status === 'A pagar')
      ? el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => {
        const lista = state.comissoes.filter((m) => m.prof === p.id && m.status === 'A pagar');
        lista.forEach((m) => { m.status = 'Paga'; });
        irCom(c, app, null, `Pagas ${money(lista.reduce((x, m) => x + m.valor, 0))} de comissão para ${p.nome}.`);
      } }, 'Pagar') : null) }
  ], PROFS), el('p', { class: 'demo-muted small mt-2' }, 'A regra é congelada ao finalizar o atendimento: mudar o percentual depois não altera comissões já geradas.')));
}

// Sites: os cinco modelos, com os dados da barbearia (serviços, preços e equipe vêm do cadastro).
function sites(c, app) {
  const s = state.site;
  const m = MODELOS.find((x) => x.id === s.rascunho);
  c.append(card('Escolha o modelo', el('ul', { class: 'bb-modelos' }, MODELOS.map((x) => el('li', { class: x.id === s.rascunho ? 'atual' : '' },
    el('span', { class: `bb-amostra m-${x.id}`, 'aria-hidden': 'true' }),
    el('span', { class: 'bb-grow' }, el('strong', {}, x.nome), x.id === s.publicado ? el('span', { class: 'demo-muted small' }, ' · No ar') : null, el('span', { class: 'demo-muted small d-block' }, x.desc)),
    el('button', { type: 'button', class: `btn btn-sm ${x.id === s.rascunho ? 'btn-accent' : 'btn-outline-light'}`, 'aria-pressed': String(x.id === s.rascunho), 'aria-label': `Ver o modelo ${x.nome}`, onclick: () => { s.rascunho = x.id; app.refresh(); } }, x.id === s.rascunho ? 'Na prévia' : 'Ver')))),
  el('div', { class: 'bb-acoes mt-2' }, el('button', { type: 'button', class: 'btn btn-accent', disabled: s.publicado === s.rascunho, onclick: () => { s.publicado = s.rascunho; irCom(c, app, null, `Site publicado com o modelo ${m.nome}. Textos e imagens foram mantidos.`); } }, icon('globe'), ' Publicar este modelo'))));
  const equipe = PROFS.map((p) => el('li', {}, el('span', { class: 'bb-avatar', 'aria-hidden': 'true' }, p.nome.split(' ').map((n) => n[0]).join('')), el('span', {}, p.nome)));
  c.append(card(`Prévia: ${m.nome}`, el('div', { class: `bb-site m-${m.id}` },
    el('div', { class: 'bb-site-topo' }, el('span', { class: 'bb-site-marca' }, s.nome), el('span', { class: 'bb-site-menu' }, 'Serviços · Equipe · Contato')),
    el('div', { class: 'bb-site-hero' }, el('p', { class: 'bb-site-kicker' }, 'Corte, barba e atendimento com hora marcada'),
      el('h3', {}, m.id === 'urbano' ? 'Estilo de rua, corte na régua.' : m.id === 'vintage' ? 'Tradição de alfaiate desde a primeira tesoura.' : m.id === 'minimalista' ? 'Corte preciso. Nada além.' : m.id === 'comercial' ? 'Agende seu horário em menos de um minuto.' : 'O cuidado que o seu estilo merece.'),
      el('button', { type: 'button', class: 'bb-site-cta', onclick: () => app.go('agendar') }, 'Agendar horário')),
    el('div', { class: 'bb-site-corpo' },
      el('section', {}, el('h4', {}, 'Serviços'), el('ul', { class: 'bb-site-precos' }, SERVICOS.filter((x) => x.tipo !== 'adicional').map((x) => el('li', {}, el('span', {}, x.nome), el('span', {}, money(x.preco)))))),
      el('section', {}, el('h4', {}, 'Equipe'), el('ul', { class: 'bb-site-equipe' }, equipe),
        el('h4', {}, 'Horário'), el('p', {}, 'Segunda a sábado, 09:00 às 19:00'))))),
  el('p', { class: 'demo-muted small' }, 'Na versão real, cada modelo tem fontes, paletas e seções próprias, galeria de fotos, prévia em computador, tablet e celular, versões para restaurar, subdomínio e domínio próprio.'));
}

const IMG = (k) => `/assets/images/produtos/barbearia-${k}.webp`;
const TOUR = [
  { img: IMG('capa'), area: 'Dono da barbearia', titulo: 'Agenda da barbearia', ver: 'agenda',
    itens: ['Dia, semana ou mês, uma coluna por profissional, com a situação de cada atendimento.', 'O banco recusa horário duplo; encaixe ignora o expediente, mas nunca a sobreposição.'] },
  { img: IMG('painel'), area: 'Dono da barbearia', titulo: 'Visão geral', ver: 'painel',
    itens: ['Faturamento, comissões, agendamentos e clientes do período.', 'Faturamento por dia e ocupação da agenda.'] },
  { img: IMG('caixa'), area: 'Dono da barbearia', titulo: 'Caixa', ver: 'caixa',
    itens: ['Abertura, recebimentos com pagamento dividido, desconto, sangria e suprimento.', 'Fechamento com conferência do dinheiro em espécie; caixa fechado não muda.'] },
  { img: IMG('comissoes'), area: 'Dono da barbearia', titulo: 'Comissões', ver: 'comissoes',
    itens: ['Regras por serviço e profissional, em percentual ou valor fixo.', 'Bônus, ajustes, adiantamentos e pagamento das comissões.'] },
  { img: IMG('financeiro'), area: 'Dono da barbearia', titulo: 'Financeiro', ver: 'caixa',
    itens: ['Contas a pagar e a receber, parcelas, fornecedores e fluxo de caixa.', 'Resultado por período e previsão dos próximos 30 dias.'] },
  { img: IMG('estoque'), area: 'Dono da barbearia', titulo: 'Estoque', ver: 'caixa',
    itens: ['Produtos com custo, preço de venda, estoque mínimo e fornecedor.', 'Venda com baixa automática e histórico de movimentações imutável.'] },
  { img: IMG('meu-site'), area: 'Site da barbearia', titulo: 'Editor do site', ver: 'sites',
    itens: ['Modelo, seções, textos, cores, imagens, SEO e domínio.', 'Prévia em computador, tablet e celular antes de publicar, com versões para restaurar.'] },
  { img: IMG('site-black-label'), area: 'Site da barbearia', titulo: 'Modelo Black Label', ver: 'sites',
    itens: ['Luxo discreto: preto profundo, tipografia editorial e fotos grandes.', 'Serviços, preços e equipe vêm direto do cadastro.'] },
  { img: IMG('site-urban-culture'), area: 'Site da barbearia', titulo: 'Modelo Urban Culture', ver: 'sites',
    itens: ['Cultura de rua: cartaz, letras enormes e blocos de cor.'] },
  { img: IMG('site-heritage'), area: 'Site da barbearia', titulo: 'Modelo Heritage', ver: 'sites',
    itens: ['Alfaiataria e tradição: verde garrafa, latão e serifa com caráter.'] },
  { img: IMG('site-modern-minimal'), area: 'Site da barbearia', titulo: 'Modelo Modern Minimal', ver: 'sites',
    itens: ['Design suíço: grade precisa e poucos elementos.'] },
  { img: IMG('site-signature'), area: 'Site da barbearia', titulo: 'Modelo Signature', ver: 'sites',
    itens: ['Feito para agendar: serviços e preços organizados e reserva sempre à mão.'] },
  { img: IMG('agendamento'), area: 'Cliente', titulo: 'Agendamento online', ver: 'agendar',
    itens: ['Serviço, profissional ou primeiro disponível, data e horário livre.', 'Sem criar conta: nome e celular, com link para consultar ou cancelar.'] },
  { img: IMG('agendamento-celular'), area: 'Cliente', titulo: 'Agendamento no celular', ver: 'agendar',
    itens: ['O fluxo completo cabe na tela do celular.', 'Preço, duração e disponibilidade sempre saem do servidor.'] },
  { img: IMG('app-barbeiro'), area: 'App do barbeiro', titulo: 'App do barbeiro', ver: 'barbeiro',
    itens: ['Agenda do dia, início e fim do atendimento, serviços extras e observações.', 'Comissões, recebimentos, folgas, histórico e relatórios do próprio barbeiro.'] },
  { img: IMG('sites-celular'), area: 'Site da barbearia', titulo: 'Sites no celular', ver: 'sites',
    itens: ['Todos os modelos se adaptam ao celular, com o botão de agendar sempre à mão.'] }
];

export function start(root) {
  mountDemo(root, {
    name: 'Gestão de Barbearias',
    views: [
      { id: 'tour', label: 'Tour: telas reais', icon: 'images', render: tourView(TOUR) },
      { id: 'painel', label: 'Visão geral', icon: 'speedometer2', render: painel },
      { id: 'agenda', label: 'Agenda', icon: 'calendar-week', render: agenda },
      { id: 'agendar', label: 'Agendamento online', icon: 'calendar-plus', render: agendar },
      { id: 'barbeiro', label: 'App do barbeiro', icon: 'phone', render: barbeiro },
      { id: 'caixa', label: 'Caixa', icon: 'cash-stack', render: caixa },
      { id: 'comissoes', label: 'Comissões', icon: 'percent', render: comissoes },
      { id: 'sites', label: 'Sites', icon: 'globe', render: sites }
    ]
  });
}
