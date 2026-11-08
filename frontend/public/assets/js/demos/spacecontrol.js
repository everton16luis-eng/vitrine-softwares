import { el, icon, kpis, table, badge, card, field, flash, mountDemo, tourView, addDays, fmtDateLong, money } from './core.js';

// Sistema de Locação de Salas: simulação com dados 100% fictícios. Valores em centavos.
// Segue o fluxo do sistema real: contrato assinado → entrega com checklist → uso → devolução →
// vistoria final (avaria vira registro em avaliação, nunca cobrança direta) → financeiro quitado → conclusão.
const state = {
  salas: [
    { id: 1, nome: 'Salão de eventos', capacidade: 150, modalidade: 'periodo', valor: 90000, periodoH: 5, horaAdic: 15000, intervalo: 60 },
    { id: 2, nome: 'Sala de reuniões', capacidade: 12, modalidade: 'hora', valor: 8000, intervalo: 15 },
    { id: 3, nome: 'Auditório', capacidade: 80, modalidade: 'periodo', valor: 45000, periodoH: 4, horaAdic: 10000, intervalo: 30 },
    { id: 4, nome: 'Espaço gourmet', capacidade: 40, modalidade: 'periodo', valor: 52000, periodoH: 6, horaAdic: 9000, intervalo: 60 }
  ],
  clientes: [
    { id: 1, nome: 'Ana Paula Souza (fictícia)' }, { id: 2, nome: 'Bruno Lima (fictício)' },
    { id: 3, nome: 'Associação Bairro Exemplo' }, { id: 4, nome: 'Exemplo Consultoria Ltda' }
  ],
  itens: [
    { id: 1, nome: 'Prato raso', total: 150, disp: 150, uso: 0, manut: 0, baixa: 0, reposicao: 2500 },
    { id: 2, nome: 'Copo 300 ml', total: 200, disp: 200, uso: 0, manut: 0, baixa: 0, reposicao: 900 },
    { id: 3, nome: 'Taça de cristal', total: 100, disp: 100, uso: 0, manut: 0, baixa: 0, reposicao: 1800 },
    { id: 4, nome: 'Toalha de mesa redonda', total: 30, disp: 30, uso: 0, manut: 0, baixa: 0, reposicao: 4500 },
    { id: 5, nome: 'Projetor multimídia', total: 2, disp: 2, uso: 0, manut: 0, baixa: 0, reposicao: 280000 }
  ],
  locacoes: [],
  danos: []
};
let seq = 1;
const sala = (id) => state.salas.find((s) => s.id === id);
const cliente = (id) => state.clientes.find((c) => c.id === id);
const item = (id) => state.itens.find((i) => i.id === id);
const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const ETAPAS = [
  ['rascunho', 'Rascunho'], ['aguardando_contrato', 'Aguardando contrato'], ['contrato_assinado', 'Contrato assinado'],
  ['aguardando_entrega', 'Aguardando entrega'], ['em_andamento', 'Em andamento'], ['aguardando_vistoria_final', 'Aguardando vistoria final'],
  ['aguardando_pagamento_final', 'Aguardando pagamento final'], ['concluida', 'Concluída']
];
const nomeEtapa = (s) => (ETAPAS.find((e) => e[0] === s) || [s, 'Cancelada'])[1];
const TOM = { rascunho: 'neutral', aguardando_contrato: 'warn', contrato_assinado: 'info', aguardando_entrega: 'info', em_andamento: 'ok',
  aguardando_vistoria_final: 'warn', aguardando_pagamento_final: 'warn', concluida: 'ok', cancelada: 'bad' };
const etapa = (l) => badge(nomeEtapa(l.status), TOM[l.status]);

function valorBase(s, ini, fim) {
  const horas = (min(fim) - min(ini)) / 60;
  if (s.modalidade === 'hora') return Math.round(horas * s.valor);
  return s.valor + Math.max(0, Math.ceil(horas - s.periodoH)) * s.horaAdic;
}
function conflito(salaId, data, ini, fim, ignorar) {
  const s = sala(salaId);
  return state.locacoes.find((l) => l.id !== ignorar && l.sala === salaId && l.data === data && l.status !== 'cancelada'
    && min(ini) < min(l.fim) + s.intervalo && min(l.ini) < min(fim) + s.intervalo);
}
const saldoParcela = (p) => p.valor - p.pago;
function situacaoFinanceira(l) {
  const abertas = l.parcelas.filter((p) => saldoParcela(p) > 0);
  if (l.restituir > 0) return ['Saldo a restituir', 'warn'];
  if (!abertas.length) return ['Quitado', 'ok'];
  return l.parcelas.some((p) => p.pago > 0) ? ['Parcialmente pago', 'info'] : ['Em aberto', 'neutral'];
}
const quitada = (l) => situacaoFinanceira(l)[0] === 'Quitado';

function criarLocacao({ salaId, clienteId, data, ini, fim, finalidade, pessoas, sinal = 0, caucao = 0, itens = [] }) {
  const s = sala(salaId);
  const id = seq++;
  const valor = valorBase(s, ini, fim);
  const parcelas = sinal > 0
    ? [{ desc: 'Sinal', valor: sinal, pago: 0, venc: addDays(0) }, { desc: 'Saldo', valor: valor - sinal, pago: 0, venc: data }]
    : [{ desc: 'Parcela única', valor, pago: 0, venc: data }];
  if (caucao > 0) parcelas.push({ desc: 'Caução', valor: caucao, pago: 0, venc: data, caucao: true });
  const l = { id, codigo: `LOC-${String(id).padStart(6, '0')}`, sala: salaId, cliente: clienteId, data, ini, fim, finalidade, pessoas, valor, caucao,
    status: 'rascunho', contrato: null, itens: itens.map(([i, q]) => ({ item: i, prev: q, entregue: q, devolvido: q, avariado: 0 })),
    entrega: false, vistoria: false, excecao: null, parcelas, restituir: 0, historico: [[addDays(0), 'Locação criada (rascunho)']] };
  state.locacoes.push(l);
  return l;
}
function mudar(l, para, texto) { l.status = para; l.historico.push([addDays(0), texto || nomeEtapa(para)]); }

// Dados iniciais: uma locação em cada etapa importante.
(() => {
  const a = criarLocacao({ salaId: 1, clienteId: 1, data: addDays(-1), ini: '14:00', fim: '20:00', finalidade: 'Chá de bebê', pessoas: 80, sinal: 30000, caucao: 20000,
    itens: [[1, 80], [2, 100], [3, 40]] });
  a.contrato = { numero: 'CT-0001', versao: 1, assinado: true };
  for (const it of a.itens) { item(it.item).disp -= it.entregue; item(it.item).uso += it.entregue; }
  a.entrega = true; a.parcelas[0].pago = 30000; a.parcelas[2].pago = 20000;
  a.status = 'aguardando_vistoria_final';
  a.historico.push([addDays(-8), 'Contrato CT-0001 assinado'], [addDays(-1), 'Entrega concluída e locação iniciada'], [addDays(-1), 'Sala devolvida']);
  const b = criarLocacao({ salaId: 3, clienteId: 4, data: addDays(1), ini: '09:00', fim: '13:00', finalidade: 'Workshop de vendas', pessoas: 50, sinal: 15000, itens: [[5, 1]] });
  b.contrato = { numero: 'CT-0002', versao: 1, assinado: true }; b.parcelas[0].pago = 15000; b.status = 'aguardando_entrega';
  b.historico.push([addDays(-2), 'Contrato CT-0002 assinado']);
  criarLocacao({ salaId: 4, clienteId: 2, data: addDays(5), ini: '12:00', fim: '18:00', finalidade: 'Almoço de família', pessoas: 35, caucao: 15000, itens: [[1, 35], [2, 40]] });
  criarLocacao({ salaId: 2, clienteId: 3, data: addDays(3), ini: '14:00', fim: '17:00', finalidade: 'Reunião de diretoria', pessoas: 10 });
})();

let selecionada = 1;
const porData = () => [...state.locacoes].sort((x, y) => (x.data + x.ini).localeCompare(y.data + y.ini));
const periodo = (l) => `${fmtDateLong(l.data)} · ${l.ini}–${l.fim}`;
// Muda de tela e mostra a mensagem na tela nova.
function irCom(app, c, view, msg, tom = 'ok') {
  const main = c.parentElement;
  if (view) app.go(view); else app.refresh();
  flash(main.querySelector('.demo-body'), msg, tom);
}
const avisar = (app, c, msg) => irCom(app, c, null, msg);
const abrir = (app, l, view = 'locacao') => el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => { selecionada = l.id; app.go(view); } }, 'Abrir');

function painel(c, app) {
  const hoje = addDays(0);
  const aReceber = state.locacoes.reduce((a, l) => a + l.parcelas.reduce((s, p) => s + saldoParcela(p), 0), 0);
  c.append(kpis([
    ['Locações nos próximos 7 dias', state.locacoes.filter((l) => l.data >= hoje && l.data <= addDays(7) && l.status !== 'cancelada').length],
    ['Contratos aguardando assinatura', state.locacoes.filter((l) => l.status === 'aguardando_contrato').length, 'warn'],
    ['Vistorias pendentes', state.locacoes.filter((l) => l.status === 'aguardando_vistoria_final').length, 'warn'],
    ['Danos em avaliação', state.danos.filter((d) => d.status === 'em_avaliacao').length],
    ['Contas a receber', money(aReceber)]
  ]));
  c.append(card('Agenda e etapas', table([
    { label: 'Locação', key: 'codigo' }, { label: 'Período', render: periodo }, { label: 'Sala', render: (l) => sala(l.sala).nome },
    { label: 'Cliente', render: (l) => cliente(l.cliente).nome }, { label: 'Operacional', render: etapa },
    { label: 'Financeiro', render: (l) => badge(...situacaoFinanceira(l)) }, { label: '', render: (l) => abrir(app, l) }
  ], porData())));
}

function novaLocacao(c, app) {
  const sSala = el('select', { class: 'form-select' }, state.salas.map((s) => el('option', { value: s.id }, `${s.nome} (até ${s.capacidade})`)));
  const sCli = el('select', { class: 'form-select' }, state.clientes.map((x) => el('option', { value: x.id }, x.nome)));
  const data = el('input', { class: 'form-control', type: 'date', value: addDays(3) });
  const ini = el('input', { class: 'form-control', type: 'time', value: '14:00' });
  const fim = el('input', { class: 'form-control', type: 'time', value: '19:00' });
  const pessoas = el('input', { class: 'form-control', type: 'number', min: 1, value: 40 });
  const fin = el('input', { class: 'form-control', type: 'text', value: 'Festa de aniversário', maxlength: 60 });
  const caucao = el('input', { class: 'form-control', type: 'number', min: 0, step: 10, value: 200 });
  const preco = el('strong', {});
  const regra = el('p', { class: 'demo-muted small' });
  const calc = () => {
    const s = sala(Number(sSala.value));
    const ok = min(fim.value) > min(ini.value);
    preco.textContent = ok ? money(valorBase(s, ini.value, fim.value)) : '—';
    regra.textContent = s.modalidade === 'hora'
      ? `Cobrança por hora: ${money(s.valor)}/h. Intervalo de ${s.intervalo} min entre locações para limpeza.`
      : `Período de ${s.periodoH} h por ${money(s.valor)}; hora adicional ${money(s.horaAdic)}. Intervalo de ${s.intervalo} min entre locações.`;
  };
  [sSala, ini, fim].forEach((x) => x.addEventListener('input', calc));
  const form = el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const s = sala(Number(sSala.value));
    if (min(fim.value) <= min(ini.value)) { flash(c, 'O fim precisa ser depois do início.', 'bad'); return; }
    if (Number(pessoas.value) > s.capacidade) { flash(c, `O número de pessoas (${pessoas.value}) excede a capacidade da sala (${s.capacidade}).`, 'bad'); return; }
    const choque = conflito(s.id, data.value, ini.value, fim.value);
    if (choque) { flash(c, `Conflito de agenda: ${s.nome} já tem a ${choque.codigo} das ${choque.ini} às ${choque.fim} (mais ${s.intervalo} min de intervalo).`, 'bad'); return; }
    const l = criarLocacao({ salaId: s.id, clienteId: Number(sCli.value), data: data.value, ini: ini.value, fim: fim.value, finalidade: fin.value || 'Evento',
      pessoas: Number(pessoas.value), caucao: Math.round(Number(caucao.value) * 100) || 0, itens: s.id === 1 || s.id === 4 ? [[1, Number(pessoas.value)], [2, Number(pessoas.value)]] : [] });
    selecionada = l.id;
    app.go('locacao');
  } }, field('Sala', sSala), field('Cliente', sCli), field('Data', data), field('Início', ini), field('Fim', fim), field('Pessoas', pessoas),
  field('Finalidade', fin), field('Caução (R$)', caucao), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('calendar-plus'), ' Criar locação'));
  c.append(card('Nova locação', el('p', { class: 'demo-total' }, 'Valor calculado pela regra da sala: ', preco), regra, form,
    el('p', { class: 'demo-muted small mt-3' }, 'Toda locação ocupa a agenda: o sistema recusa horários que se sobrepõem, já contando o intervalo de limpeza da sala.')));
  calc();
}

function acoes(c, app, l) {
  const bt = (rotulo, ic, fn, cls = 'btn-accent') => el('button', { type: 'button', class: `btn btn-sm ${cls}`, onclick: fn }, icon(ic), ` ${rotulo}`);
  const out = [];
  const ok = (msg) => avisar(app, c, msg);
  if (l.status === 'rascunho') out.push(bt('Gerar contrato', 'file-earmark-text', () => { l.contrato = { numero: `CT-${String(l.id).padStart(4, '0')}`, versao: 1, assinado: false }; mudar(l, 'aguardando_contrato', `Contrato ${l.contrato.numero} emitido`); ok('Contrato emitido em PDF (simulado). Agora registre a assinatura.'); }));
  if (l.status === 'aguardando_contrato') out.push(bt('Registrar assinatura', 'pen', () => { l.contrato.assinado = true; mudar(l, 'contrato_assinado', `Contrato ${l.contrato.numero} assinado (presencial)`); ok('Contrato assinado. Alterações agora só por aditivo.'); }));
  if (l.status === 'contrato_assinado') out.push(bt('Liberar para entrega', 'box-arrow-right', () => { mudar(l, 'aguardando_entrega'); ok('Locação aguardando a entrega do espaço e dos utensílios.'); }));
  if (l.status === 'aguardando_entrega') {
    out.push(bt('Fazer entrega', 'list-check', () => { selecionada = l.id; app.go('entrega'); }, 'btn-outline-light'));
    const pendente = l.itens.length && !l.entrega;
    const just = el('input', { class: 'form-control form-control-sm', type: 'text', maxlength: 120, placeholder: 'Justificativa para iniciar sem entrega (mín. 10 caracteres)' });
    if (pendente) out.push(field('Exceção (opcional)', just));
    out.push(bt('Iniciar locação', 'play-fill', () => {
      if (pendente) {
        const j = just.value.trim();
        if (j.length < 10) { flash(c, 'Existem pendências obrigatórias: conclua a entrega ou informe uma justificativa de pelo menos 10 caracteres.', 'bad'); return; }
        l.excecao = j;
        mudar(l, 'em_andamento', `Iniciada com exceção: ${l.excecao}`);
      } else mudar(l, 'em_andamento', 'Locação iniciada');
      ok('Locação em andamento.');
    }));
  }
  if (l.status === 'em_andamento') out.push(bt('Registrar devolução da sala', 'door-closed', () => { mudar(l, 'aguardando_vistoria_final', 'Sala devolvida'); ok('Sala devolvida. Faça a vistoria final.'); }));
  if (l.status === 'aguardando_vistoria_final') out.push(bt('Fazer vistoria final', 'clipboard-check', () => { selecionada = l.id; app.go('vistoria'); }));
  if (l.status === 'aguardando_pagamento_final') {
    out.push(bt('Financeiro', 'cash-coin', () => { selecionada = l.id; app.go('financeiro'); }, 'btn-outline-light'));
    out.push(bt('Concluir locação', 'check2-circle', () => {
      if (!quitada(l)) { flash(c, l.restituir > 0 ? 'Há saldo de caução a restituir ao cliente. Registre a devolução antes de concluir.' : 'A locação não está quitada. Registre os recebimentos pendentes.', 'bad'); return; }
      mudar(l, 'concluida', 'Locação concluída');
      ok('Locação concluída. Comprovante de quitação disponível.');
    }));
  }
  if (['rascunho', 'aguardando_contrato', 'contrato_assinado', 'aguardando_entrega'].includes(l.status)) out.push(bt('Cancelar', 'x-circle', () => {
    for (const it of l.itens) if (l.entrega) { item(it.item).uso -= it.entregue; item(it.item).disp += it.entregue; }
    mudar(l, 'cancelada', 'Locação cancelada'); ok('Locação cancelada; a agenda foi liberada.');
  }, 'btn-outline-light'));
  return out;
}

function locacao(c, app) {
  const sel = el('select', { class: 'form-select' }, porData().map((l) => el('option', { value: l.id, selected: l.id === selecionada }, `${l.codigo} — ${sala(l.sala).nome} — ${nomeEtapa(l.status)}`)));
  sel.addEventListener('change', () => { selecionada = Number(sel.value); app.refresh(); });
  c.append(el('div', { class: 'demo-toolbar' }, field('Locação', sel)));
  const l = state.locacoes.find((x) => x.id === selecionada) || state.locacoes[0];
  const idx = ETAPAS.findIndex((e) => e[0] === l.status);
  c.append(card(`${l.codigo} · ${cliente(l.cliente).nome}`,
    el('p', { class: 'demo-muted' }, `${sala(l.sala).nome} · ${periodo(l)} · ${l.finalidade} · ${l.pessoas} pessoas`),
    el('ol', { class: 'sl-etapas', 'aria-label': 'Etapas da locação' }, ETAPAS.map(([k, n], i) =>
      el('li', { class: l.status === 'cancelada' ? '' : i < idx ? 'feita' : i === idx ? 'atual' : '', 'aria-current': i === idx ? 'step' : null }, n))),
    el('div', { class: 'sl-resumo' }, kpis([['Locação', money(l.valor)], ['Caução', money(l.caucao)],
      [l.contrato ? (l.contrato.assinado ? 'Contrato assinado' : 'Contrato a assinar') : 'Contrato', l.contrato ? l.contrato.numero : '—'], ['Financeiro', situacaoFinanceira(l)[0]]])),
    el('div', { class: 'demo-tour-nav mt-3' }, acoes(c, app, l))));
  c.append(card('Histórico (auditado)', el('ul', { class: 'demo-timeline' }, l.historico.map(([d, t]) => el('li', {}, el('strong', {}, fmtDateLong(d)), ` — ${t}`)))));
}

function escolher(c, app, filtro, vazio) {
  const lista = porData().filter(filtro);
  if (!lista.length) { c.append(card(null, el('p', { class: 'demo-empty' }, vazio))); return null; }
  const atual = lista.find((l) => l.id === selecionada) || lista[0];
  const sel = el('select', { class: 'form-select' }, lista.map((l) => el('option', { value: l.id, selected: l === atual }, `${l.codigo} — ${sala(l.sala).nome} — ${cliente(l.cliente).nome}`)));
  sel.addEventListener('change', () => { selecionada = Number(sel.value); app.refresh(); });
  c.append(el('div', { class: 'demo-toolbar' }, field('Locação', sel)));
  return atual;
}

function entrega(c, app) {
  const l = escolher(c, app, (x) => x.status === 'aguardando_entrega' && x.itens.length, 'Nenhuma locação aguardando entrega com utensílios. Gere e assine o contrato de uma locação primeiro.');
  if (!l) return;
  if (l.entrega) { c.append(card('Entrega concluída', el('p', {}, 'Itens retirados do estoque (disponível → em uso) e vistoria inicial registrada. Inicie a locação na tela da locação.'))); return; }
  const estado = el('textarea', { class: 'form-control', rows: 2, placeholder: 'Ex.: espaço limpo, mesas montadas, ar-condicionado funcionando' });
  const inputs = l.itens.map((it) => {
    const inp = el('input', { class: 'form-control form-control-sm sl-num', type: 'number', min: 0, max: it.prev, value: it.prev, 'aria-label': `Quantidade entregue de ${item(it.item).nome}` });
    return [it, inp];
  });
  c.append(card('Checklist de entrega e vistoria inicial',
    field('Estado do espaço na entrega', estado),
    table([{ label: 'Item', render: ([it]) => item(it.item).nome }, { label: 'Previsto', num: true, render: ([it]) => it.prev },
      { label: 'Disponível agora', num: true, render: ([it]) => item(it.item).disp }, { label: 'Entregue', render: ([, inp]) => inp }], inputs),
    el('button', { class: 'btn btn-accent mt-3', type: 'button', onclick: () => {
      if (estado.value.trim().length < 3) { flash(c, 'Registre o estado do espaço na vistoria inicial antes de concluir a entrega.', 'bad'); return; }
      for (const [it, inp] of inputs) {
        const q = Math.max(0, Math.min(it.prev, Number(inp.value) || 0));
        if (q > item(it.item).disp) { flash(c, `Estoque insuficiente de "${item(it.item).nome}".`, 'bad'); return; }
      }
      for (const [it, inp] of inputs) { it.entregue = Math.max(0, Math.min(it.prev, Number(inp.value) || 0)); it.devolvido = it.entregue; item(it.item).disp -= it.entregue; item(it.item).uso += it.entregue; }
      l.entrega = true; l.historico.push([addDays(0), 'Entrega concluída; termo de entrega gerado']);
      avisar(app, c, 'Entrega concluída: termo de entrega e responsabilidade gerado (simulado).');
    } }, icon('check2-square'), ' Concluir entrega')));
}

function vistoria(c, app) {
  const l = escolher(c, app, (x) => x.status === 'aguardando_vistoria_final', 'Nenhuma locação aguardando vistoria final. Registre a devolução da sala de uma locação em andamento.');
  if (!l) return;
  const estado = el('textarea', { class: 'form-control', rows: 2, placeholder: 'Ex.: espaço devolvido limpo' });
  const linhas = l.itens.filter((it) => it.entregue > 0).map((it) => ({
    it,
    dev: el('input', { class: 'form-control form-control-sm sl-num', type: 'number', min: 0, max: it.entregue, value: it.entregue, 'aria-label': `Devolvidos de ${item(it.item).nome}` }),
    av: el('input', { class: 'form-control form-control-sm sl-num', type: 'number', min: 0, max: it.entregue, value: 0, 'aria-label': `Avariados de ${item(it.item).nome}` })
  }));
  c.append(card('Devolução e vistoria final',
    el('p', { class: 'demo-muted small' }, 'Marcar avaria ou falta não gera cobrança: cria um registro de dano em avaliação, que depende de aprovação de valor por alguém autorizado.'),
    field('Estado do espaço na devolução', estado),
    table([{ label: 'Item', render: (x) => item(x.it.item).nome }, { label: 'Entregue', num: true, render: (x) => x.it.entregue },
      { label: 'Devolvidos', render: (x) => x.dev }, { label: 'Avariados (dos devolvidos)', render: (x) => x.av }], linhas, { empty: 'Sem utensílios nesta locação.' }),
    el('button', { class: 'btn btn-accent mt-3', type: 'button', onclick: () => {
      if (estado.value.trim().length < 3) { flash(c, 'Descreva o estado do espaço na devolução.', 'bad'); return; }
      let novos = 0;
      for (const { it, dev, av } of linhas) {
        const d = Math.max(0, Math.min(it.entregue, Number(dev.value) || 0));
        const a = Math.max(0, Math.min(d, Number(av.value) || 0));
        const falta = it.entregue - d;
        const i = item(it.item);
        i.uso -= d; i.disp += d - a; i.manut += a;
        if (a) { state.danos.push({ id: state.danos.length + 1, loc: l.id, item: it.item, qtd: a, tipo: 'Avaria', status: 'em_avaliacao' }); novos++; }
        if (falta) { state.danos.push({ id: state.danos.length + 1, loc: l.id, item: it.item, qtd: falta, tipo: 'Faltante', status: 'em_avaliacao' }); novos++; }
        it.devolvido = d; it.avariado = a;
      }
      l.vistoria = true;
      mudar(l, 'aguardando_pagamento_final', `Vistoria final concluída${novos ? ` com ${novos} registro(s) de dano` : ' sem ocorrências'}`);
      irCom(app, c, novos ? 'danos' : 'financeiro', novos ? `Vistoria concluída. ${novos} registro(s) de dano em avaliação.` : 'Vistoria concluída sem ocorrências.');
    } }, icon('clipboard-check'), ' Concluir vistoria final')));
}

function danos(c, app) {
  const linhas = state.danos.map((d) => ({ ...d, l: state.locacoes.find((x) => x.id === d.loc) }));
  c.append(card('Danos, perdas e faltas', el('p', { class: 'demo-muted small mb-2' }, 'O valor sugerido é o de reposição do item; quem aprova pode ajustar. Só então vira cobrança adicional no financeiro.'),
    table([
      { label: 'Locação', render: (d) => d.l.codigo }, { label: 'Item', render: (d) => item(d.item).nome }, { label: 'Tipo', key: 'tipo' },
      { label: 'Qtd.', key: 'qtd', num: true }, { label: 'Sugerido', num: true, render: (d) => money(d.qtd * item(d.item).reposicao) },
      { label: 'Situação', render: (d) => badge(...({ em_avaliacao: ['Em avaliação', 'warn'], aprovado: ['Cobrança gerada', 'info'], desconsiderado: ['Desconsiderado', 'neutral'] })[d.status]) },
      { label: '', render: (d) => (d.status !== 'em_avaliacao' ? '' : el('span', { class: 'demo-tour-nav' },
        el('button', { type: 'button', class: 'btn btn-sm btn-accent', onclick: () => {
          const original = state.danos.find((x) => x.id === d.id);
          original.status = 'aprovado';
          d.l.parcelas.push({ desc: `Cobrança adicional: ${item(d.item).nome} (${d.qtd})`, valor: d.qtd * item(d.item).reposicao, pago: 0, venc: addDays(5) });
          d.l.historico.push([addDays(0), `Dano aprovado: cobrança adicional de ${money(d.qtd * item(d.item).reposicao)}`]);
          avisar(app, c, 'Cobrança adicional gerada no financeiro da locação.');
        } }, 'Aprovar'),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => { state.danos.find((x) => x.id === d.id).status = 'desconsiderado'; app.refresh(); } }, 'Desconsiderar'))) }
    ], linhas, { empty: 'Nenhum dano registrado. Eles surgem na vistoria final.' })));
}

function financeiro(c, app) {
  const l = escolher(c, app, (x) => x.status !== 'cancelada', 'Nenhuma locação ativa.');
  if (!l) return;
  const forma = el('select', { class: 'form-select' }, ['PIX', 'Dinheiro', 'Cartão de débito', 'Transferência'].map((f) => el('option', {}, f)));
  const caucaoPaga = l.parcelas.find((p) => p.caucao && p.pago > 0);
  const abertasNaoCaucao = () => l.parcelas.filter((p) => !p.caucao && saldoParcela(p) > 0);
  c.append(card(`Contas a receber · ${l.codigo}`, el('div', { class: 'demo-toolbar' }, field('Forma de pagamento', forma)),
    table([
      { label: 'Parcela', key: 'desc' }, { label: 'Vencimento', render: (p) => fmtDateLong(p.venc) }, { label: 'Valor', num: true, render: (p) => money(p.valor) },
      { label: 'Pago', num: true, render: (p) => money(p.pago) }, { label: 'Saldo', num: true, render: (p) => money(saldoParcela(p)) },
      { label: '', render: (p) => (saldoParcela(p) > 0 ? el('button', { type: 'button', class: 'btn btn-sm btn-accent', onclick: () => {
        const v = saldoParcela(p); p.pago = p.valor;
        l.historico.push([addDays(0), `Recebimento de ${money(v)} (${forma.value}) — ${p.desc}`]);
        avisar(app, c, `Recebimento registrado e recibo gerado (${forma.value}).`);
      } }, 'Receber') : badge('Paga', 'ok')) }
    ], l.parcelas),
    el('p', { class: 'demo-total' }, 'Situação financeira: ', el('strong', {}, situacaoFinanceira(l)[0])),
    l.vistoria && caucaoPaga && !l.caucaoUsada ? el('button', { type: 'button', class: 'btn btn-outline-light', onclick: () => {
      let resto = caucaoPaga.pago;
      for (const p of abertasNaoCaucao()) { const u = Math.min(resto, saldoParcela(p)); p.pago += u; resto -= u; }
      l.caucaoUsada = true; l.restituir = resto;
      l.historico.push([addDays(0), `Caução compensada${resto ? `; ${money(resto)} a restituir` : ''}`]);
      avisar(app, c, resto ? `Caução compensou o saldo; sobram ${money(resto)} a restituir ao cliente.` : 'Caução compensou o saldo em aberto.');
    } }, icon('arrow-left-right'), ' Compensar caução no saldo') : null,
    l.restituir > 0 ? el('button', { type: 'button', class: 'btn btn-outline-light ms-2', onclick: () => {
      l.historico.push([addDays(0), `Restituição de ${money(l.restituir)} ao cliente`]); l.restituir = 0; avisar(app, c, 'Devolução da caução registrada.');
    } }, icon('cash'), ' Registrar restituição') : null,
    el('p', { class: 'demo-muted small mt-3' }, 'A situação financeira é separada da operacional: devolver a sala não quita a locação, e só uma locação quitada pode ser concluída.')));
  if (l.status === 'aguardando_pagamento_final') c.append(el('button', { type: 'button', class: 'btn btn-accent', onclick: () => { selecionada = l.id; app.go('locacao'); } }, icon('arrow-right'), ' Voltar à locação para concluir'));
}

function inventario(c) {
  c.append(card('Inventário de utensílios e bens', table([
    { label: 'Item', key: 'nome' }, { label: 'Disponível', key: 'disp', num: true }, { label: 'Em uso', key: 'uso', num: true },
    { label: 'Manutenção', key: 'manut', num: true }, { label: 'Baixados', key: 'baixa', num: true }, { label: 'Reposição', num: true, render: (i) => money(i.reposicao) }
  ], state.itens), el('p', { class: 'demo-muted small mt-2' }, 'Cada entrega, devolução e avaria movimenta o estoque e fica no histórico de movimentações.')));
}

function relatorios(c) {
  const ativas = state.locacoes.filter((l) => l.status !== 'cancelada');
  c.append(card('Receita por sala (simulado)', table([
    { label: 'Sala', key: 'nome' }, { label: 'Locações', num: true, render: (s) => ativas.filter((l) => l.sala === s.id).length },
    { label: 'Contratado', num: true, render: (s) => money(ativas.filter((l) => l.sala === s.id).reduce((a, l) => a + l.valor, 0)) },
    { label: 'Recebido', num: true, render: (s) => money(ativas.filter((l) => l.sala === s.id).reduce((a, l) => a + l.parcelas.filter((p) => !p.caucao).reduce((x, p) => x + p.pago, 0), 0)) }
  ], state.salas)));
  c.append(card('Utensílios danificados e perdidos', table([
    { label: 'Item', render: (d) => item(d.item).nome }, { label: 'Tipo', key: 'tipo' }, { label: 'Qtd.', key: 'qtd', num: true },
    { label: 'Locação', render: (d) => state.locacoes.find((l) => l.id === d.loc).codigo }
  ], state.danos, { empty: 'Nenhuma ocorrência ainda. Conclua uma vistoria final com avaria.' })));
}

const IMG = (k) => `/assets/images/produtos/locacao-de-salas-${k}.webp`;
const TOUR = [
  { img: IMG('capa'), area: 'Gestão', titulo: 'Painel', ver: 'painel',
    itens: ['Reservas de hoje, salas ocupadas, contratos aguardando assinatura, entregas e vistorias pendentes.', 'Receitas, despesas e ocupação dos últimos 12 meses.'] },
  { img: IMG('calendario'), area: 'Agenda', titulo: 'Calendário de reservas', ver: 'nova',
    itens: ['Mês, semana, dia ou lista, com a cor de cada sala e a situação da reserva.', 'O sistema recusa horários sobrepostos, contando o intervalo de limpeza entre locações.'] },
  { img: IMG('locacoes'), area: 'Operação', titulo: 'Locações', ver: 'painel',
    itens: ['Situação operacional e financeira lado a lado, independentes.', 'Filtros por situação, sala, período, cliente ou contrato.'] },
  { img: IMG('locacao'), area: 'Operação', titulo: 'Ficha da locação', ver: 'locacao',
    itens: ['As etapas do fluxo, com as pendências do próximo passo antes de avançar.', 'Valores, caução, contrato, entrega, vistorias e documentos da locação.'] },
  { img: IMG('contrato'), area: 'Contratos', titulo: 'Contrato e assinatura', ver: 'locacao',
    itens: ['Contrato em PDF a partir de um modelo, com versões.', 'Depois de assinado, qualquer alteração exige aditivo contratual.'] },
  { img: IMG('entrega'), area: 'Entrega', titulo: 'Entrega e vistoria inicial', ver: 'entrega',
    itens: ['Checklist dos utensílios entregues, com patrimônio e estado de cada item.', 'Gera o termo de entrega e responsabilidade e baixa os itens do estoque disponível.'] },
  { img: IMG('vistoria'), area: 'Devolução', titulo: 'Vistoria final', ver: 'vistoria',
    itens: ['Devolvidos, avariados e faltantes, com fotos e classificação da avaria.', 'Avaria vira registro em avaliação, nunca cobrança automática.'] },
  { img: IMG('inventario'), area: 'Inventário', titulo: 'Utensílios e bens', ver: 'inventario',
    itens: ['Disponível, em uso, em manutenção e baixado por item.', 'Itens por quantidade ou com patrimônio individual.'] },
  { img: IMG('receber'), area: 'Financeiro', titulo: 'Contas a receber', ver: 'financeiro',
    itens: ['Parcelas de sinal, saldo, caução e cobranças adicionais.', 'Recebimento por forma de pagamento, com recibo e créditos de cliente.'] },
  { img: IMG('financeiro'), area: 'Financeiro', titulo: 'Painel financeiro', ver: 'relatorios',
    itens: ['Faturamento, recebido, despesas pagas e resultado do período.', 'Saldo das contas, contas a receber e recebido por sala.'] },
  { img: IMG('salas'), area: 'Cadastros', titulo: 'Salas', ver: 'nova',
    itens: ['Capacidade, recursos, cor na agenda e regra de cobrança por hora ou por período.', 'Hora adicional, tolerância e intervalo entre locações.'] },
  { img: IMG('celular'), area: 'Celular', titulo: 'No celular', ver: 'painel',
    itens: ['Painel, ficha da locação e vistoria funcionam no celular.', 'A vistoria pode ser feita no próprio espaço, anexando fotos dos itens.'] }
];

export function start(root) {
  mountDemo(root, {
    name: 'Locação de Salas',
    views: [
      { id: 'tour', label: 'Tour: telas reais', icon: 'images', render: tourView(TOUR) },
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: painel },
      { id: 'nova', label: 'Nova locação', icon: 'calendar-plus', render: novaLocacao },
      { id: 'locacao', label: 'Locação', icon: 'file-earmark-text', render: locacao },
      { id: 'entrega', label: 'Entrega', icon: 'box-arrow-right', render: entrega },
      { id: 'vistoria', label: 'Vistoria final', icon: 'clipboard-check', render: vistoria },
      { id: 'danos', label: 'Danos', icon: 'exclamation-triangle', render: danos },
      { id: 'financeiro', label: 'Financeiro', icon: 'cash-coin', render: financeiro },
      { id: 'inventario', label: 'Inventário', icon: 'box-seam', render: inventario },
      { id: 'relatorios', label: 'Relatórios', icon: 'graph-up', render: relatorios }
    ]
  });
}
