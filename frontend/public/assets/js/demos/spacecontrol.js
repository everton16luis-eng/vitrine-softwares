import { el, icon, kpis, table, badge, card, field, flash, mountDemo, addDays, fmtDateLong, money } from './core.js';

// Dados fictícios. Valores em centavos.
const state = {
  espacos: [
    { id: 1, nome: 'Salão Principal', capacidade: 120, diaria: 90000 },
    { id: 2, nome: 'Sala de Reuniões A', capacidade: 12, diaria: 25000 },
    { id: 3, nome: 'Espaço Gourmet', capacidade: 40, diaria: 48000 }
  ],
  locatarios: [
    { id: 1, nome: 'Locatário Exemplo 1 (fictício)', contato: 'exemplo1@exemplo.invalid' },
    { id: 2, nome: 'Locatário Exemplo 2 (fictício)', contato: 'exemplo2@exemplo.invalid' },
    { id: 3, nome: 'Empresa Fictícia Ltda.', contato: 'contato@exemplo.invalid' }
  ],
  inventario: [
    { id: 1, item: 'Cadeira', espaco: 1, qtd: 120, reposicao: 8500 },
    { id: 2, item: 'Mesa redonda', espaco: 1, qtd: 15, reposicao: 32000 },
    { id: 3, item: 'Taça de vidro', espaco: 3, qtd: 60, reposicao: 1800 },
    { id: 4, item: 'Projetor', espaco: 2, qtd: 1, reposicao: 280000 },
    { id: 5, item: 'Toalha de mesa', espaco: 1, qtd: 20, reposicao: 4500 }
  ],
  reservas: [
    { id: 1, espaco: 1, locatario: 1, data: addDays(3), status: 'confirmada', contrato: 'CT-0001' },
    { id: 2, espaco: 2, locatario: 3, data: addDays(1), status: 'confirmada', contrato: 'CT-0002' },
    { id: 3, espaco: 3, locatario: 2, data: addDays(-2), status: 'em_devolucao', contrato: 'CT-0003' }
  ],
  ocorrencias: []
};
let nextId = 100;
const espaco = (id) => state.espacos.find((e) => e.id === id);
const locatario = (id) => state.locatarios.find((l) => l.id === id);
const STATUS = { confirmada: ['Confirmada', 'info'], em_devolucao: ['Aguardando devolução', 'warn'], encerrada: ['Encerrada', 'ok'] };

function painel(c) {
  const futuras = state.reservas.filter((r) => r.data >= addDays(0));
  const extras = state.ocorrencias.reduce((a, o) => a + o.valor, 0);
  c.append(kpis([
    ['Espaços', state.espacos.length], ['Reservas futuras', futuras.length],
    ['Aguardando devolução', state.reservas.filter((r) => r.status === 'em_devolucao').length, 'warn'],
    ['Cobranças adicionais', money(extras)]
  ]));
  c.append(card('Próximas reservas', table([
    { label: 'Data', render: (r) => fmtDateLong(r.data) }, { label: 'Espaço', render: (r) => espaco(r.espaco).nome },
    { label: 'Locatário', render: (r) => locatario(r.locatario).nome }, { label: 'Situação', render: (r) => badge(...STATUS[r.status]) }
  ], [...state.reservas].sort((a, b) => a.data.localeCompare(b.data)))));
}

function reservas(c, app) {
  const sEsp = el('select', { class: 'form-select' }, state.espacos.map((e) => el('option', { value: e.id }, e.nome)));
  const sLoc = el('select', { class: 'form-select' }, state.locatarios.map((l) => el('option', { value: l.id }, l.nome)));
  const data = el('input', { class: 'form-control', type: 'date', value: addDays(3) });
  c.append(card('Nova reserva', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const conflito = state.reservas.find((r) => r.espaco === Number(sEsp.value) && r.data === data.value && r.status !== 'encerrada');
    if (conflito) { flash(c, `Conflito: ${espaco(conflito.espaco).nome} já está reservado nesta data.`, 'bad'); return; }
    const id = nextId++;
    state.reservas.push({ id, espaco: Number(sEsp.value), locatario: Number(sLoc.value), data: data.value, status: 'confirmada', contrato: `CT-${String(id).padStart(4, '0')}` });
    flash(c, 'Reserva registrada e contrato gerado (demonstração).');
    app.refresh();
  } }, field('Espaço', sEsp), field('Locatário', sLoc), field('Data', data), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('calendar-plus'), ' Reservar'))));
  c.append(card('Agenda', table([
    { label: 'Data', render: (r) => fmtDateLong(r.data) }, { label: 'Espaço', render: (r) => espaco(r.espaco).nome },
    { label: 'Locatário', render: (r) => locatario(r.locatario).nome }, { label: 'Contrato', key: 'contrato' },
    { label: 'Diária', num: true, render: (r) => money(espaco(r.espaco).diaria) },
    { label: 'Situação', render: (r) => badge(...STATUS[r.status]) },
    { label: '', render: (r) => (r.status === 'confirmada' ? el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { r.status = 'em_devolucao'; app.refresh(); } }, 'Registrar entrega') : '') }
  ], [...state.reservas].sort((a, b) => a.data.localeCompare(b.data)))));
}

function checklist(c, app) {
  const pend = state.reservas.filter((r) => r.status === 'em_devolucao');
  if (!pend.length) { c.append(card('Checklist de devolução', el('p', { class: 'demo-empty' }, 'Nenhuma reserva aguardando devolução. Registre uma entrega na Agenda.'))); return; }
  const sel = el('select', { class: 'form-select' }, pend.map((r) => el('option', { value: r.id }, `${r.contrato} — ${espaco(r.espaco).nome}`)));
  const area = el('div');
  const draw = () => {
    area.textContent = '';
    const r = pend.find((x) => x.id === Number(sel.value));
    const itens = state.inventario.filter((i) => i.espaco === r.espaco);
    const inputs = new Map();
    const total = el('strong', {}, money(0));
    const recalc = () => {
      let sum = 0;
      for (const [item, inp] of inputs) sum += Math.max(0, Math.min(item.qtd, Number(inp.value) || 0)) * item.reposicao;
      total.textContent = money(sum);
      return sum;
    };
    area.append(table([
      { label: 'Item', key: 'item' }, { label: 'Entregue', key: 'qtd', num: true },
      { label: 'Reposição (un.)', num: true, render: (i) => money(i.reposicao) },
      { label: 'Danificado/faltante', render: (i) => { const inp = el('input', { class: 'form-control form-control-sm', type: 'number', min: 0, max: i.qtd, value: 0, oninput: recalc, 'aria-label': `Quantidade danificada de ${i.item}` }); inputs.set(i, inp); return inp; } }
    ], itens, { empty: 'Este espaço não possui itens inventariados.' }));
    area.append(el('p', { class: 'demo-total' }, 'Cobrança adicional calculada: ', total));
    area.append(el('button', { class: 'btn btn-accent', type: 'button', onclick: () => {
      const valor = recalc();
      if (valor > 0) state.ocorrencias.push({ reserva: r.id, valor, data: addDays(0) });
      r.status = 'encerrada';
      flash(c, valor > 0 ? `Devolução registrada com cobrança adicional de ${money(valor)}.` : 'Devolução registrada sem avarias.');
      app.refresh();
    } }, icon('check2-square'), ' Concluir devolução'));
  };
  sel.addEventListener('change', draw);
  c.append(card('Checklist de devolução', field('Reserva', sel), area));
  draw();
}

function inventario(c) {
  c.append(card('Inventário de utensílios', table([
    { label: 'Item', key: 'item' }, { label: 'Espaço', render: (i) => espaco(i.espaco).nome },
    { label: 'Quantidade', key: 'qtd', num: true }, { label: 'Valor de reposição', num: true, render: (i) => money(i.reposicao) }
  ], state.inventario)));
}

function relatorios(c) {
  const rows = state.espacos.map((e) => {
    const rs = state.reservas.filter((r) => r.espaco === e.id);
    const extras = state.ocorrencias.filter((o) => rs.some((r) => r.id === o.reserva)).reduce((a, o) => a + o.valor, 0);
    return { nome: e.nome, reservas: rs.length, receita: rs.length * e.diaria, extras };
  });
  c.append(card('Desempenho por espaço (simulado)', table([
    { label: 'Espaço', key: 'nome' }, { label: 'Reservas', key: 'reservas', num: true },
    { label: 'Receita de diárias', num: true, render: (r) => money(r.receita) }, { label: 'Cobranças extras', num: true, render: (r) => money(r.extras) }
  ], rows)));
  c.append(card('Histórico de ocorrências', table([
    { label: 'Data', render: (o) => fmtDateLong(o.data) }, { label: 'Reserva', render: (o) => state.reservas.find((r) => r.id === o.reserva).contrato },
    { label: 'Valor', num: true, render: (o) => money(o.valor) }
  ], state.ocorrencias, { empty: 'Nenhuma avaria registrada ainda. Use o checklist de devolução.' })));
}

export function start(root) {
  mountDemo(root, {
    name: 'SpaceControl',
    views: [
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: painel },
      { id: 'reservas', label: 'Agenda de reservas', icon: 'calendar-week', render: reservas },
      { id: 'checklist', label: 'Checklist de devolução', icon: 'list-check', render: checklist },
      { id: 'inventario', label: 'Inventário', icon: 'box-seam', render: inventario },
      { id: 'relatorios', label: 'Relatórios', icon: 'graph-up', render: relatorios }
    ]
  });
}
