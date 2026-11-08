import { el, icon, kpis, table, badge, card, field, flash, mountDemo, tourView, addDays, fmtDateLong, money } from './core.js';

// Livro-Caixa Pessoal: simulação com lançamentos 100% fictícios. Valores em centavos inteiros, como no sistema real.
// Regras reproduzidas: saldo diário (cada dia abre em R$ 0,00) ou acumulado, virada do dia até 06:00,
// lançamento não pode ser anterior à data de início, categoria em uso não pode ser excluída.
const FORMAS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', outro: 'Outro' };
const state = {
  config: { saldoInicial: 150000, inicio: addDays(-20), modo: 'diario', virada: 0 },
  categorias: [
    ['Salário', 'entrada'], ['Renda extra', 'entrada'], ['Vendas', 'entrada'], ['Rendimentos', 'entrada'], ['Outras entradas', 'entrada'],
    ['Alimentação', 'saida'], ['Moradia', 'saida'], ['Transporte', 'saida'], ['Saúde', 'saida'], ['Lazer', 'saida'],
    ['Contas e serviços', 'saida'], ['Outras saídas', 'saida']
  ].map(([nome, tipo], i) => ({ id: i + 1, nome, tipo, ativa: true })),
  movs: []
};
let seq = 1;
const cat = (id) => state.categorias.find((c) => c.id === id);
const catPorNome = (n) => state.categorias.find((c) => c.nome === n).id;
function lancar(data, descricao, tipo, categoria, valor, forma) {
  state.movs.push({ id: seq++, data, descricao, tipo, categoria: catPorNome(categoria), valor, forma });
}
[
  [-19, 'Salário', 'entrada', 'Salário', 420000, 'pix'], [-18, 'Aluguel', 'saida', 'Moradia', 145000, 'pix'],
  [-16, 'Supermercado', 'saida', 'Alimentação', 18740, 'debito'], [-14, 'Venda de bolos caseiros', 'entrada', 'Vendas', 21500, 'dinheiro'],
  [-12, 'Conta de energia', 'saida', 'Contas e serviços', 16320, 'pix'], [-9, 'Freela de design', 'entrada', 'Renda extra', 35000, 'pix'],
  [-7, 'Venda de artesanato na feira', 'entrada', 'Vendas', 18900, 'dinheiro'], [-6, 'Cinema', 'saida', 'Lazer', 6400, 'credito'],
  [-4, 'Farmácia', 'saida', 'Saúde', 4790, 'debito'], [-2, 'Aplicativo de transporte', 'saida', 'Transporte', 2780, 'credito'],
  [-1, 'Feira do bairro', 'saida', 'Alimentação', 9350, 'pix'], [-1, 'Encomenda de doces', 'entrada', 'Vendas', 26000, 'pix'],
  [0, 'Padaria', 'saida', 'Alimentação', 1850, 'dinheiro'], [0, 'Venda de bolo de aniversário', 'entrada', 'Vendas', 9500, 'pix']
].forEach(([d, ...r]) => lancar(addDays(d), ...r));

// Data "de hoje" respeitando a virada: antes da hora de virada, ainda conta como o dia anterior.
const hojeCaixa = () => (new Date().getHours() < state.config.virada ? addDays(-1) : addDays(0));
const ordenados = () => [...state.movs].sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
const sinal = (m) => (m.tipo === 'entrada' ? m.valor : -m.valor);
const somar = (lista, tipo) => lista.filter((m) => m.tipo === tipo).reduce((a, m) => a + m.valor, 0);
const mesAtual = () => hojeCaixa().slice(0, 7);
// Resumo com números menores, para caber no celular.
const resumo = (items) => { const k = kpis(items); k.classList.add('lc-resumo'); return k; };
const valorTom = (v) => el('strong', { class: v < 0 ? 'lc-neg' : 'lc-pos' }, money(v));

// Aceita 25,90 · 1.234,56 · 1234.56 · 1500 (como o sistema real).
function paraCentavos(txt) {
  let t = String(txt).trim().replace(/\s|R\$/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return c > 0 ? c : null;
}

function dashboard(c, app) {
  const hoje = hojeCaixa();
  const doDia = state.movs.filter((m) => m.data === hoje);
  const doMes = state.movs.filter((m) => m.data.startsWith(mesAtual()));
  const acumulado = state.config.saldoInicial + state.movs.reduce((a, m) => a + sinal(m), 0);
  const resDia = somar(doDia, 'entrada') - somar(doDia, 'saida');
  const diario = state.config.modo === 'diario';
  c.append(card(null, el('p', { class: 'demo-muted mb-1' }, diario ? `Saldo do dia — ${fmtDateLong(hoje)} (abriu em R$ 0,00)` : 'Saldo atual'),
    el('p', { class: 'lc-saldo' }, valorTom(diario ? resDia : acumulado)),
    el('p', { class: 'demo-muted small' }, diario ? `Acumulado desde ${fmtDateLong(state.config.inicio)}: ${money(acumulado)}` : `Saldo inicial de ${money(state.config.saldoInicial)} em ${fmtDateLong(state.config.inicio)}`)));
  c.append(resumo([['Entradas do dia', money(somar(doDia, 'entrada'))], ['Saídas do dia', money(somar(doDia, 'saida'))],
    ['Entradas do mês', money(somar(doMes, 'entrada'))], ['Saídas do mês', money(somar(doMes, 'saida'))],
    ['Resultado do mês', money(somar(doMes, 'entrada') - somar(doMes, 'saida'))]]));
  const dias = [...new Set(state.movs.map((m) => m.data))].sort().reverse().slice(0, 7);
  c.append(card('Fechamento dos últimos dias', table([
    { label: 'Dia', render: (d) => [fmtDateLong(d), d === hoje ? [' ', badge('hoje', 'info')] : null] },
    { label: 'Lançamentos', num: true, render: (d) => state.movs.filter((m) => m.data === d).length },
    { label: 'Entradas', num: true, render: (d) => money(somar(state.movs.filter((m) => m.data === d), 'entrada')) },
    { label: 'Saídas', num: true, render: (d) => money(somar(state.movs.filter((m) => m.data === d), 'saida')) },
    { label: 'Resultado do dia', num: true, render: (d) => { const l = state.movs.filter((m) => m.data === d); return valorTom(somar(l, 'entrada') - somar(l, 'saida')); } }
  ], dias), el('button', { type: 'button', class: 'btn btn-sm btn-outline-light mt-2', onclick: () => app.go('livro') }, 'Ver livro-caixa ', icon('arrow-right'))));
}

let editando = null;
function movimentacoes(c, app) {
  const m = editando ? state.movs.find((x) => x.id === editando) : null;
  let tipo = m ? m.tipo : 'saida';
  const data = el('input', { class: 'form-control', type: 'date', value: m ? m.data : hojeCaixa(), min: state.config.inicio });
  const valor = el('input', { class: 'form-control', type: 'text', inputmode: 'decimal', placeholder: '0,00', value: m ? (m.valor / 100).toFixed(2).replace('.', ',') : '' });
  const desc = el('input', { class: 'form-control', type: 'text', maxlength: 200, value: m ? m.descricao : '', list: 'lc-sugestoes' });
  const sugestoes = el('datalist', { id: 'lc-sugestoes' }, [...new Set(state.movs.map((x) => x.descricao))].map((d) => el('option', { value: d })));
  const sCat = el('select', { class: 'form-select' });
  const sForma = el('select', { class: 'form-select' }, Object.entries(FORMAS).map(([k, n]) => el('option', { value: k, selected: m ? m.forma === k : k === 'pix' }, n)));
  const bEnt = el('button', { type: 'button', class: 'btn btn-sm' }, 'Entrada');
  const bSai = el('button', { type: 'button', class: 'btn btn-sm' }, 'Saída');
  const desenhar = () => {
    bEnt.className = `btn btn-sm ${tipo === 'entrada' ? 'btn-accent' : 'btn-outline-light'}`;
    bSai.className = `btn btn-sm ${tipo === 'saida' ? 'btn-accent' : 'btn-outline-light'}`;
    bEnt.setAttribute('aria-pressed', String(tipo === 'entrada'));
    bSai.setAttribute('aria-pressed', String(tipo === 'saida'));
    sCat.replaceChildren(...state.categorias.filter((x) => x.tipo === tipo && (x.ativa || (m && m.categoria === x.id)))
      .map((x) => el('option', { value: x.id, selected: m ? m.categoria === x.id : false }, x.nome)));
  };
  bEnt.addEventListener('click', () => { tipo = 'entrada'; desenhar(); });
  bSai.addEventListener('click', () => { tipo = 'saida'; desenhar(); });
  desenhar();
  const form = el('form', { class: 'demo-inline-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    const centavos = paraCentavos(valor.value);
    if (centavos === null) { flash(c, 'Valor inválido. Use, por exemplo, 25,90 ou 1.234,56.', 'bad'); return; }
    if (!desc.value.trim()) { flash(c, 'Informe a descrição.', 'bad'); return; }
    if (!data.value) { flash(c, 'Informe a data.', 'bad'); return; }
    if (data.value < state.config.inicio) { flash(c, `A data não pode ser anterior ao início do controle (${fmtDateLong(state.config.inicio)}).`, 'bad'); return; }
    const dados = { data: data.value, descricao: desc.value.trim(), tipo, categoria: Number(sCat.value), valor: centavos, forma: sForma.value };
    if (m) Object.assign(m, dados); else state.movs.push({ id: seq++, ...dados });
    const msg = m ? 'Lançamento alterado. Os saldos seguintes foram recalculados.' : `${tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${money(centavos)} lançada.`;
    editando = null;
    const main = c.parentElement;
    app.refresh();
    flash(main.querySelector('.demo-body'), msg);
  } },
  el('div', { class: 'demo-field' }, el('span', { class: 'lc-rotulo' }, 'Tipo'), el('div', { class: 'demo-tour-nav', role: 'group', 'aria-label': 'Tipo do lançamento' }, bEnt, bSai)),
  field('Data', data), field('Valor (R$)', valor), field('Descrição', desc), sugestoes, field('Categoria', sCat), field('Forma de pagamento', sForma),
  el('button', { class: 'btn btn-accent', type: 'submit' }, icon('check2'), m ? ' Salvar alteração' : ' Salvar lançamento'),
  m ? el('button', { class: 'btn btn-outline-light', type: 'button', onclick: () => { editando = null; app.refresh(); } }, 'Cancelar edição') : null);
  c.append(card(m ? `Editar lançamento #${m.id}` : 'Novo lançamento', form));

  const fTipo = el('select', { class: 'form-select' }, [['', 'Todos'], ['entrada', 'Entradas'], ['saida', 'Saídas']].map(([v, n]) => el('option', { value: v }, n)));
  const fForma = el('select', { class: 'form-select' }, [['', 'Todas'], ...Object.entries(FORMAS)].map(([v, n]) => el('option', { value: v }, n)));
  const fBusca = el('input', { class: 'form-control', type: 'search', placeholder: 'Descrição' });
  const lista = el('div');
  const filtrar = () => {
    const b = fBusca.value.trim().toLowerCase();
    const rows = ordenados().reverse().filter((x) => (!fTipo.value || x.tipo === fTipo.value) && (!fForma.value || x.forma === fForma.value) && (!b || x.descricao.toLowerCase().includes(b)));
    lista.replaceChildren(table([
      { label: 'Data', render: (x) => fmtDateLong(x.data) }, { label: 'Descrição', key: 'descricao' },
      { label: 'Categoria', render: (x) => badge(cat(x.categoria).nome, x.tipo === 'entrada' ? 'ok' : 'bad') }, { label: 'Forma', render: (x) => FORMAS[x.forma] },
      { label: 'Valor', num: true, render: (x) => valorTom(sinal(x)) },
      { label: '', render: (x) => el('span', { class: 'demo-tour-nav' },
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', 'aria-label': `Editar ${x.descricao}`, onclick: () => { editando = x.id; app.refresh(); } }, icon('pencil')),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', 'aria-label': `Excluir ${x.descricao}`, onclick: () => {
          state.movs = state.movs.filter((y) => y.id !== x.id);
          const main = c.parentElement; app.refresh(); flash(main.querySelector('.demo-body'), 'Lançamento excluído. Os saldos seguintes foram recalculados.');
        } }, icon('trash'))) }
    ], rows, { empty: 'Nenhuma movimentação com esses filtros.' }));
  };
  [fTipo, fForma, fBusca].forEach((x) => x.addEventListener('input', filtrar));
  c.append(card('Movimentações', el('div', { class: 'demo-toolbar' }, field('Tipo', fTipo), field('Forma', fForma), field('Buscar', fBusca)), lista));
  filtrar();
}

function livro(c) {
  const sPer = el('select', { class: 'form-select' }, [['mes', 'Mês atual'], ['tudo', 'Todo o histórico']].map(([v, n]) => el('option', { value: v }, n)));
  const area = el('div');
  const desenhar = () => {
    const todos = ordenados();
    const ini = sPer.value === 'mes' ? `${mesAtual()}-01` : state.config.inicio;
    const anteriores = todos.filter((m) => m.data < ini);
    const periodo = todos.filter((m) => m.data >= ini);
    const ent = somar(periodo, 'entrada'); const sai = somar(periodo, 'saida');
    const linhas = [];
    if (state.config.modo === 'acumulado') {
      let saldo = state.config.saldoInicial + anteriores.reduce((a, m) => a + sinal(m), 0);
      linhas.push({ data: ini, desc: 'Saldo anterior', saldo, destaque: true });
      for (const m of periodo) { saldo += sinal(m); linhas.push({ data: m.data, desc: m.descricao, extra: `${cat(m.categoria).nome} · ${FORMAS[m.forma]}`, m, saldo }); }
      area.replaceChildren(resumo([['Saldo anterior', money(linhas[0].saldo)], ['Entradas', money(ent)], ['Saídas', money(sai)], ['Saldo final', money(saldo)]]));
    } else {
      for (const d of [...new Set(periodo.map((m) => m.data))]) {
        let saldo = 0;
        linhas.push({ data: d, desc: 'Abertura do dia', saldo: 0, destaque: true });
        const doDia = periodo.filter((m) => m.data === d);
        for (const m of doDia) { saldo += sinal(m); linhas.push({ desc: m.descricao, extra: `${cat(m.categoria).nome} · ${FORMAS[m.forma]}`, m, saldo }); }
        linhas.push({ desc: `Fechamento de ${fmtDateLong(d)}`, ent: somar(doDia, 'entrada'), sai: somar(doDia, 'saida'), saldo, destaque: true });
      }
      const nDias = new Set(periodo.map((m) => m.data)).size;
      area.replaceChildren(resumo([['Dias com movimento', nDias], ['Entradas', money(ent)], ['Saídas', money(sai)], ['Média por dia', money(nDias ? Math.round((ent - sai) / nDias) : 0)], ['Resultado do período', money(ent - sai)]]));
    }
    area.append(table([
      { label: 'Data', render: (l) => (l.data ? fmtDateLong(l.data) : '') },
      { label: 'Descrição', render: (l) => (l.destaque ? el('strong', {}, l.desc) : [l.desc, ' ', el('span', { class: 'demo-muted small' }, l.extra)]) },
      { label: 'Entrada', num: true, render: (l) => (l.m?.tipo === 'entrada' ? money(l.m.valor) : l.ent != null ? money(l.ent) : '') },
      { label: 'Saída', num: true, render: (l) => (l.m?.tipo === 'saida' ? money(l.m.valor) : l.sai != null ? money(l.sai) : '') },
      { label: state.config.modo === 'diario' ? 'Saldo do dia' : 'Saldo', num: true, render: (l) => valorTom(l.saldo) }
    ], linhas, { empty: 'Nenhum lançamento no período.' }));
  };
  sPer.addEventListener('change', desenhar);
  c.append(card(state.config.modo === 'diario' ? 'Livro-caixa — saldo diário (cada dia abre em R$ 0,00)' : 'Livro-caixa — saldo acumulado',
    el('div', { class: 'demo-toolbar' }, field('Período', sPer)), area));
  desenhar();
}

function categorias(c, app) {
  const nome = el('input', { class: 'form-control', type: 'text', maxlength: 60 });
  const tipo = el('select', { class: 'form-select' }, el('option', { value: 'entrada' }, 'Entrada (receita)'), el('option', { value: 'saida' }, 'Saída (despesa)'));
  const avisar = (msg, tom = 'ok') => { const main = c.parentElement; app.refresh(); flash(main.querySelector('.demo-body'), msg, tom); };
  c.append(card('Nova categoria', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const n = nome.value.trim();
    if (!n) { flash(c, 'Informe o nome.', 'bad'); return; }
    if (state.categorias.some((x) => x.nome.toLowerCase() === n.toLowerCase() && x.tipo === tipo.value)) { flash(c, 'Já existe uma categoria com esse nome e tipo.', 'bad'); return; }
    state.categorias.push({ id: state.categorias.length + 1, nome: n, tipo: tipo.value, ativa: true });
    avisar('Categoria criada.');
  } }, field('Nome', nome), field('Tipo', tipo), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('plus'), ' Salvar categoria'))));
  for (const [t, titulo] of [['entrada', 'Categorias de entrada'], ['saida', 'Categorias de saída']]) {
    c.append(card(titulo, table([
      { label: 'Nome', key: 'nome' }, { label: 'Uso', num: true, render: (x) => state.movs.filter((m) => m.categoria === x.id).length },
      { label: 'Situação', render: (x) => badge(x.ativa ? 'Ativa' : 'Inativa', x.ativa ? 'ok' : 'neutral') },
      { label: '', render: (x) => el('span', { class: 'demo-tour-nav' },
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => { x.ativa = !x.ativa; avisar(x.ativa ? `"${x.nome}" reativada.` : `"${x.nome}" desativada: some do formulário, mas o histórico fica.`); } }, x.ativa ? 'Desativar' : 'Reativar'),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', 'aria-label': `Excluir ${x.nome}`, onclick: () => {
          const uso = state.movs.filter((m) => m.categoria === x.id).length;
          if (uso) { flash(c, `"${x.nome}" tem ${uso} lançamento(s) e não pode ser excluída. Desative-a.`, 'bad'); return; }
          state.categorias = state.categorias.filter((y) => y.id !== x.id); avisar('Categoria excluída.');
        } }, icon('trash'))) }
    ], state.categorias.filter((x) => x.tipo === t))));
  }
}

function relatorios(c) {
  const mes = el('input', { class: 'form-control', type: 'month', value: mesAtual() });
  const area = el('div');
  const gerar = () => {
    const l = state.movs.filter((m) => m.data.startsWith(mes.value));
    const ent = somar(l, 'entrada'); const sai = somar(l, 'saida');
    const porCat = state.categorias.map((x) => ({ x, total: l.filter((m) => m.categoria === x.id).reduce((a, m) => a + m.valor, 0) })).filter((r) => r.total);
    const porForma = Object.entries(FORMAS).map(([k, n]) => ({ n, ent: somar(l.filter((m) => m.forma === k), 'entrada'), sai: somar(l.filter((m) => m.forma === k), 'saida') })).filter((r) => r.ent || r.sai);
    area.replaceChildren(
      resumo([['Entradas', money(ent)], ['Saídas', money(sai)], ['Resultado', money(ent - sai)], ['Dias com movimento', new Set(l.map((m) => m.data)).size]]),
      card('Por categoria', table([{ label: 'Categoria', render: (r) => r.x.nome }, { label: 'Tipo', render: (r) => badge(r.x.tipo === 'entrada' ? 'Entrada' : 'Saída', r.x.tipo === 'entrada' ? 'ok' : 'bad') },
        { label: 'Total', num: true, render: (r) => money(r.total) }], porCat, { empty: 'Sem lançamentos neste mês.' })),
      card('Por forma de pagamento', table([{ label: 'Forma', key: 'n' }, { label: 'Entradas', num: true, render: (r) => money(r.ent) },
        { label: 'Saídas', num: true, render: (r) => money(r.sai) }, { label: 'Resultado', num: true, render: (r) => valorTom(r.ent - r.sai) }], porForma, { empty: 'Sem lançamentos neste mês.' })));
  };
  mes.addEventListener('change', gerar);
  c.append(card('Relatório mensal', el('div', { class: 'demo-toolbar' }, field('Mês', mes)),
    el('p', { class: 'demo-muted small' }, 'No sistema real também há relatório diário e por período, exportação em CSV e impressão A4.'), area));
  gerar();
}

function configuracoes(c, app) {
  const modo = el('select', { class: 'form-select' }, el('option', { value: 'diario', selected: state.config.modo === 'diario' }, 'Diário — começa zerado todo dia'),
    el('option', { value: 'acumulado', selected: state.config.modo === 'acumulado' }, 'Acumulado — livro-caixa tradicional'));
  const virada = el('select', { class: 'form-select' }, [0, 1, 2, 3, 4, 5, 6].map((h) => el('option', { value: h, selected: state.config.virada === h }, h ? `0${h}:00` : '00:00 (meia-noite)')));
  const saldo = el('input', { class: 'form-control', type: 'text', inputmode: 'decimal', value: (state.config.saldoInicial / 100).toFixed(2).replace('.', ',') });
  c.append(card('Modo do saldo e saldo inicial', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const s = saldo.value.trim() === '0' || saldo.value.trim() === '0,00' ? 0 : paraCentavos(saldo.value);
    if (s === null) { flash(c, 'Saldo inicial inválido (ex.: 1.500,00).', 'bad'); return; }
    Object.assign(state.config, { modo: modo.value, virada: Number(virada.value), saldoInicial: s });
    const main = c.parentElement; app.go('livro');
    flash(main.querySelector('.demo-body'), 'Configuração salva. Nenhum lançamento foi alterado: só a forma de mostrar os saldos.');
  } }, field('Modo do saldo', modo), field('Virada do dia', virada), field('Saldo inicial (R$)', saldo),
  el('button', { class: 'btn btn-accent', type: 'submit' }, icon('check2'), ' Salvar')),
  el('p', { class: 'demo-muted small mt-3' }, 'Com a virada às 04:00, o que for lançado entre 00:00 e 03:59 conta no dia anterior. No sistema real, os dados ficam num arquivo SQLite que você exporta e abre de novo; aqui ficam só na memória desta página.')));
}

const IMG = (k) => `/assets/images/produtos/livro-caixa-${k}.webp`;
const TOUR = [
  { img: IMG('capa'), area: 'Início', titulo: 'Dashboard', ver: 'dashboard',
    itens: ['Saldo do dia (abre em R$ 0,00) e o acumulado desde o início.', 'Entradas, saídas e resultado do dia e do mês, e o fechamento dos últimos 7 dias.'] },
  { img: IMG('livro-diario'), area: 'Livro-caixa', titulo: 'Livro-caixa diário', ver: 'livro',
    itens: ['Abertura e fechamento de cada dia, com o saldo lançamento a lançamento.', 'Filtro por mês, data, intervalo ou todo o histórico.'] },
  { img: IMG('livro-acumulado'), area: 'Livro-caixa', titulo: 'Livro-caixa tradicional', ver: 'config',
    itens: ['Data, descrição, entrada, saída e saldo acumulado a partir do saldo inicial.', 'Trocar o modo não altera nenhum lançamento.'] },
  { img: IMG('movimentacoes'), area: 'Lançamentos', titulo: 'Movimentações', ver: 'movimentacoes',
    itens: ['Novo lançamento com a data de hoje, sugestões de descrição e forma de pagamento.', 'Filtros por período, tipo, categoria, forma e busca; editar recalcula os saldos.'] },
  { img: IMG('dashboard-acumulado'), area: 'Início', titulo: 'Formas de pagamento', ver: 'relatorios',
    itens: ['Entradas e saídas do dia e do mês por dinheiro, Pix, débito, crédito ou outro.', 'Últimas movimentações logo abaixo.'] },
  { img: IMG('relatorios'), area: 'Relatórios', titulo: 'Relatórios', ver: 'relatorios',
    itens: ['Diário, mensal e por período, com resumo dia a dia, por categoria e por forma.', 'Exportação em CSV e impressão em A4.'] },
  { img: IMG('categorias'), area: 'Cadastros', titulo: 'Categorias', ver: 'categorias',
    itens: ['Categorias de receitas e despesas prontas para usar.', 'Desative as que não usa; só categorias sem lançamentos podem ser excluídas.'] },
  { img: IMG('backup'), area: 'Dados', titulo: 'Banco de dados e backup', ver: 'config',
    itens: ['Exporta o arquivo .sqlite e importa um backup validado antes de usar.', 'Modo do saldo, virada do dia, saldo inicial e data de início.'] },
  { img: IMG('inicio'), area: 'Dados', titulo: 'Abrir o livro-caixa', ver: null,
    itens: ['Sem login e sem servidor: abra o arquivo exportado ou crie um livro-caixa novo.', 'Uma cópia da sessão no navegador ajuda a continuar de onde parou.'] },
  { img: IMG('celular'), area: 'Celular', titulo: 'No celular', ver: 'movimentacoes',
    itens: ['As telas se adaptam ao celular: menu recolhível e formulários em uma coluna.', 'Dashboard, novo lançamento e relatório cabem na tela sem rolar para o lado.'] }
];

export function start(root) {
  mountDemo(root, {
    name: 'Livro-Caixa',
    views: [
      { id: 'tour', label: 'Tour: telas reais', icon: 'images', render: tourView(TOUR) },
      { id: 'dashboard', label: 'Dashboard', icon: 'speedometer2', render: dashboard },
      { id: 'movimentacoes', label: 'Movimentações', icon: 'arrow-left-right', render: movimentacoes },
      { id: 'livro', label: 'Livro-caixa', icon: 'journal-text', render: livro },
      { id: 'categorias', label: 'Categorias', icon: 'tags', render: categorias },
      { id: 'relatorios', label: 'Relatórios', icon: 'file-earmark-bar-graph', render: relatorios },
      { id: 'config', label: 'Modo do saldo', icon: 'gear', render: configuracoes }
    ]
  });
}
