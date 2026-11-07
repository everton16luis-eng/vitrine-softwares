import { get } from '../../shared/api.js';
import { el, icon, money, datetime } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

const ACTION_LABEL = { criar: 'criou', editar: 'editou', excluir: 'excluiu', publicar: 'publicou', despublicar: 'despublicou', arquivar: 'arquivou', login: 'entrou no sistema', alterar_status: 'alterou status de', registrar_pagamento: 'registrou pagamento em' };

function kpi(label, value, iconName, hint, href) {
  const inner = [el('span', { class: 'kpi-icon' }, icon(iconName)), el('div', {}, el('span', { class: 'kpi-label' }, label), el('strong', { class: 'kpi-value' }, value), hint ? el('span', { class: 'kpi-hint' }, hint) : null)];
  return el('div', { class: 'col-sm-6 col-xl' }, href ? el('a', { class: 'kpi', href }, inner) : el('div', { class: 'kpi' }, inner));
}

export async function render(c, ctx) {
  const d = await get('/api/admin/dashboard');
  c.append(pageHeader(`Olá, ${ctx.user.nome.split(' ')[0]}`, 'Indicadores calculados a partir dos dados registrados no sistema.'));
  c.append(el('div', { class: 'row g-3 mb-4' },
    kpi('Produtos cadastrados', d.produtos.total, 'box-seam', `${d.produtos.publicados} publicados · ${d.produtos.em_desenvolvimento} em planejamento/desenvolvimento`, '#/produtos'),
    kpi('Orçamentos', d.orcamentos.total, 'file-earmark-text', `${d.orcamentos.pendentes} pendentes · ${d.orcamentos.aceitos} aceitos`, '#/orcamentos'),
    kpi('Contatos recebidos', d.contatos.total, 'inbox', `${d.contatos.ultimos_30} nos últimos 30 dias`, '#/leads'),
    kpi('Pedidos registrados', d.pedidos.total, 'receipt', `${d.pedidos.pagos} pagos · ${d.pedidos.concluidos} concluídos`, '#/pedidos'),
    kpi('Receita confirmada', money(d.receita.total), 'cash-stack', `${money(d.receita.mes)} neste mês (somente pagamentos confirmados)`)));

  const leadsCanvas = el('canvas', { role: 'img', 'aria-label': 'Gráfico de leads por mês' });
  const receitaCanvas = el('canvas', { role: 'img', 'aria-label': 'Gráfico de receita confirmada por mês' });
  const statusCanvas = el('canvas', { role: 'img', 'aria-label': 'Gráfico de orçamentos por status' });
  c.append(el('div', { class: 'row g-3 mb-4' },
    el('div', { class: 'col-lg-6' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'card-title h6' }, 'Leads por mês'), el('div', { class: 'chart-box' }, leadsCanvas)))),
    el('div', { class: 'col-lg-6' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'card-title h6' }, 'Receita confirmada por mês'), el('div', { class: 'chart-box' }, receitaCanvas))))));

  c.append(el('div', { class: 'row g-3' },
    el('div', { class: 'col-lg-4' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'card-title h6' }, 'Orçamentos por status'),
      d.orcamentos_por_status.length ? el('div', { class: 'chart-box sm' }, statusCanvas) : el('p', { class: 'text-body-secondary small' }, 'Nenhum orçamento registrado.')))),
    el('div', { class: 'col-lg-4' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'card-title h6' }, 'Produtos mais visualizados (30 dias)'),
      d.mais_vistos.length ? el('ol', { class: 'rank-list' }, d.mais_vistos.map((p) => el('li', {}, el('span', {}, p.nome), el('strong', {}, p.visualizacoes)))) : el('p', { class: 'text-body-secondary small' }, 'Ainda não há visualizações registradas.')))),
    el('div', { class: 'col-lg-4' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'card-title h6' }, 'Atividades recentes'),
      d.atividades.length ? el('ul', { class: 'activity-list' }, d.atividades.map((a) => el('li', {},
        el('span', {}, `${a.usuario_nome || 'Sistema'} ${ACTION_LABEL[a.acao] || a.acao} ${a.entidade}${a.entidade_id ? ` #${a.entidade_id}` : ''}`),
        el('time', { datetime: a.criado_em }, datetime(a.criado_em))))) : el('p', { class: 'text-body-secondary small' }, 'Nenhuma atividade registrada.'))))));

  const Chart = window.Chart;
  if (!Chart) return;
  // Cores dos gráficos vêm dos tokens do sistema (tinta, azul de cota e tons de situação); o vermelhão fica para as ações.
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const ink = token('--brand-ink', '#12233D');
  const line = token('--brand-line', '#1D5F8A');
  Chart.defaults.font.family = token('--brand-font', 'system-ui, sans-serif');
  Chart.defaults.color = token('--tone-neutral', '#4A5565');
  Chart.defaults.borderColor = 'rgba(18, 35, 61, .1)';
  const label = (m) => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); };
  const common = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } };
  new Chart(leadsCanvas, { type: 'bar', data: { labels: d.series.leads.map((r) => label(r.mes)), datasets: [{ label: 'Leads', data: d.series.leads.map((r) => r.total), backgroundColor: line, borderRadius: 3, maxBarThickness: 36 }] }, options: common });
  new Chart(receitaCanvas, { type: 'line', data: { labels: d.series.receita.map((r) => label(r.mes)), datasets: [{ label: 'Receita (R$)', data: d.series.receita.map((r) => Number(r.receita)), borderColor: ink, backgroundColor: ink, borderWidth: 2, tension: 0.25, pointRadius: 3 }] },
    options: { ...common, scales: { y: { beginAtZero: true } } } });
  if (d.orcamentos_por_status.length) {
    new Chart(statusCanvas, { type: 'doughnut', data: { labels: d.orcamentos_por_status.map((r) => r.rotulo), datasets: [{ data: d.orcamentos_por_status.map((r) => r.total), backgroundColor: [ink, line, token('--tone-progress', '#855000'), token('--tone-success', '#1D6A39'), token('--tone-danger', '#A3271A'), '#7A8798', '#6FA3C7', '#C9A25E', '#B8C2CE'], borderColor: token('--sheet', '#fff'), borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } });
  }
}
