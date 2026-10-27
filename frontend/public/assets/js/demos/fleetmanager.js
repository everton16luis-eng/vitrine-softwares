import { el, icon, kpis, table, badge, card, field, flash, mountDemo, addDays, fmtDateLong, money } from './core.js';

// Dados fictícios. Valores em centavos; distâncias em km; litros com 1 casa decimal.
const state = {
  veiculos: [
    { id: 1, placa: 'AAA-0A01', modelo: 'Utilitário leve (exemplo)', tipo: 'veiculo', km: 48210, revisaoKm: 50000, docVence: addDays(25) },
    { id: 2, placa: 'AAA-0B02', modelo: 'Caminhão médio (exemplo)', tipo: 'veiculo', km: 131400, revisaoKm: 130000, docVence: addDays(120) },
    { id: 3, placa: 'MAQ-0003', modelo: 'Retroescavadeira (exemplo)', tipo: 'maquina', horimetro: 3920, revisaoHoras: 4000, docVence: addDays(-3) }
  ],
  abastecimentos: [
    { id: 1, veiculo: 1, data: addDays(-12), km: 47600, litros: 42.5, valor: 26350 },
    { id: 2, veiculo: 1, data: addDays(-3), km: 48100, litros: 40.2, valor: 25120 },
    { id: 3, veiculo: 2, data: addDays(-5), km: 131000, litros: 180.0, valor: 109800 }
  ],
  manutencoes: [
    { veiculo: 2, data: addDays(-40), tipo: 'Preventiva', descricao: 'Troca de óleo e filtros', valor: 128000 },
    { veiculo: 3, data: addDays(-60), tipo: 'Corretiva', descricao: 'Reparo no sistema hidráulico', valor: 345000 },
    { veiculo: 1, data: addDays(-90), tipo: 'Pneus', descricao: 'Substituição de 2 pneus dianteiros', valor: 98000 }
  ]
};
let nextId = 100;
const veic = (id) => state.veiculos.find((v) => v.id === id);

function alertas() {
  const out = [];
  for (const v of state.veiculos) {
    if (v.tipo === 'veiculo') {
      const falta = v.revisaoKm - v.km;
      if (falta <= 2000) out.push({ veiculo: v, msg: falta < 0 ? `Revisão atrasada em ${Math.abs(falta).toLocaleString('pt-BR')} km` : `Revisão em ${falta.toLocaleString('pt-BR')} km`, tone: falta < 0 ? 'bad' : 'warn' });
    } else {
      const falta = v.revisaoHoras - v.horimetro;
      if (falta <= 150) out.push({ veiculo: v, msg: `Revisão em ${falta} horas de uso`, tone: 'warn' });
    }
    if (v.docVence < addDays(0)) out.push({ veiculo: v, msg: 'Documento vencido', tone: 'bad' });
    else if (v.docVence <= addDays(30)) out.push({ veiculo: v, msg: `Documento vence em ${fmtDateLong(v.docVence)}`, tone: 'warn' });
  }
  return out;
}

function consumo(vId) {
  const ab = state.abastecimentos.filter((a) => a.veiculo === vId).sort((a, b) => a.km - b.km);
  if (ab.length < 2) return null;
  const km = ab[ab.length - 1].km - ab[0].km;
  const litros = ab.slice(1).reduce((s, a) => s + a.litros, 0);
  return litros ? km / litros : null;
}

function painel(c) {
  const custoMes = state.abastecimentos.filter((a) => a.data >= addDays(-30)).reduce((s, a) => s + a.valor, 0);
  const al = alertas();
  c.append(kpis([
    ['Veículos e máquinas', state.veiculos.length], ['Alertas ativos', al.length, al.length ? 'warn' : ''],
    ['Combustível (30 dias)', money(custoMes)], ['Manutenções registradas', state.manutencoes.length]
  ]));
  c.append(card('Alertas de revisão e documentos', table([
    { label: 'Equipamento', render: (a) => `${a.veiculo.placa} — ${a.veiculo.modelo}` }, { label: 'Alerta', render: (a) => badge(a.msg, a.tone) }
  ], al, { empty: 'Nenhum alerta no momento.' })));
}

function veiculos(c) {
  c.append(card('Frota', table([
    { label: 'Identificação', key: 'placa' }, { label: 'Modelo', key: 'modelo' },
    { label: 'Leitura atual', num: true, render: (v) => (v.tipo === 'veiculo' ? `${v.km.toLocaleString('pt-BR')} km` : `${v.horimetro} h`) },
    { label: 'Consumo médio', num: true, render: (v) => { const k = consumo(v.id); return k ? `${k.toFixed(1)} km/l` : '—'; } },
    { label: 'Documento', render: (v) => badge(fmtDateLong(v.docVence), v.docVence < addDays(0) ? 'bad' : v.docVence <= addDays(30) ? 'warn' : 'ok') }
  ], state.veiculos)));
}

function abastecimentos(c, app) {
  const sel = el('select', { class: 'form-select' }, state.veiculos.filter((v) => v.tipo === 'veiculo').map((v) => el('option', { value: v.id }, v.placa)));
  const km = el('input', { class: 'form-control', type: 'number', min: 0, step: 1 });
  const litros = el('input', { class: 'form-control', type: 'number', min: 1, step: '0.1' });
  const valor = el('input', { class: 'form-control', type: 'number', min: 1, step: '0.01' });
  const sync = () => { km.value = veic(Number(sel.value)).km + 400; };
  sel.addEventListener('change', sync);
  sync();
  c.append(card('Registrar abastecimento', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    const v = veic(Number(sel.value));
    const kmN = Number(km.value);
    if (!(kmN > v.km)) { flash(c, `A quilometragem deve ser maior que a última leitura (${v.km.toLocaleString('pt-BR')} km).`, 'bad'); return; }
    if (!(Number(litros.value) > 0) || !(Number(valor.value) > 0)) { flash(c, 'Informe litros e valor.', 'bad'); return; }
    state.abastecimentos.push({ id: nextId++, veiculo: v.id, data: addDays(0), km: kmN, litros: Number(litros.value), valor: Math.round(Number(valor.value) * 100) });
    v.km = kmN;
    flash(c, 'Abastecimento registrado; leitura e consumo médio atualizados.');
    app.refresh();
  } }, field('Veículo', sel), field('Quilometragem', km), field('Litros', litros), field('Valor (R$)', valor), el('button', { class: 'btn btn-accent', type: 'submit' }, icon('fuel-pump'), ' Registrar'))));
  c.append(card('Histórico', table([
    { label: 'Data', render: (a) => fmtDateLong(a.data) }, { label: 'Veículo', render: (a) => veic(a.veiculo).placa },
    { label: 'Km', num: true, render: (a) => a.km.toLocaleString('pt-BR') }, { label: 'Litros', num: true, render: (a) => a.litros.toFixed(1) },
    { label: 'Valor', num: true, render: (a) => money(a.valor) }, { label: 'R$/litro', num: true, render: (a) => money(Math.round(a.valor / a.litros)) }
  ], [...state.abastecimentos].sort((a, b) => b.data.localeCompare(a.data)))));
}

function manutencoes(c) {
  c.append(card('Histórico de manutenções', table([
    { label: 'Data', render: (m) => fmtDateLong(m.data) }, { label: 'Equipamento', render: (m) => veic(m.veiculo).placa },
    { label: 'Tipo', render: (m) => badge(m.tipo, m.tipo === 'Corretiva' ? 'bad' : 'info') }, { label: 'Descrição', key: 'descricao' },
    { label: 'Valor', num: true, render: (m) => money(m.valor) }
  ], state.manutencoes)));
}

function custos(c) {
  const rows = state.veiculos.map((v) => {
    const comb = state.abastecimentos.filter((a) => a.veiculo === v.id).reduce((s, a) => s + a.valor, 0);
    const man = state.manutencoes.filter((m) => m.veiculo === v.id).reduce((s, m) => s + m.valor, 0);
    return { v, comb, man, total: comb + man };
  });
  const max = Math.max(1, ...rows.map((r) => r.total));
  c.append(card('Custos operacionais por equipamento', table([
    { label: 'Equipamento', render: (r) => r.v.placa }, { label: 'Combustível', num: true, render: (r) => money(r.comb) },
    { label: 'Manutenção', num: true, render: (r) => money(r.man) }, { label: 'Total', num: true, render: (r) => money(r.total) },
    { label: 'Proporção', render: (r) => el('span', { class: 'demo-bar', role: 'img', 'aria-label': `${Math.round((r.total / max) * 100)}% do maior custo` }, el('span', { class: `w-${Math.round((r.total / max) * 10) * 10}` })) }
  ], rows)));
}

export function start(root) {
  mountDemo(root, {
    name: 'FleetManager',
    views: [
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: painel },
      { id: 'veiculos', label: 'Veículos e máquinas', icon: 'truck', render: veiculos },
      { id: 'abastecimentos', label: 'Abastecimentos', icon: 'fuel-pump', render: abastecimentos },
      { id: 'manutencoes', label: 'Manutenções', icon: 'tools', render: manutencoes },
      { id: 'custos', label: 'Custos', icon: 'cash-stack', render: custos }
    ]
  });
}
