// Núcleo das demonstrações: construção de DOM sem innerHTML (todo texto via
// textContent), layout com menu lateral e componentes simples.
// Os dados são fictícios e vivem apenas em memória (somem ao recarregar).

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const icon = (name) => el('i', { class: `bi bi-${name}`, 'aria-hidden': 'true' });
export const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
export const fmtDateLong = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
/** Data local (não UTC) deslocada em n dias, no formato AAAA-MM-DD. */
export const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function kpis(items) {
  return el('div', { class: 'demo-kpis' }, items.map(([label, value, tone = '']) =>
    el('div', { class: `demo-kpi ${tone}` }, el('span', {}, label), el('strong', {}, value))));
}

export function table(columns, rows, { empty = 'Nenhum registro.' } = {}) {
  if (!rows.length) return el('p', { class: 'demo-empty' }, empty);
  return el('div', { class: 'table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Tabela' }, el('table', { class: 'demo-table' },
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', { scope: 'col', class: c.num ? 'num' : '' }, c.label)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => el('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : r[c.key])))))));
}

export const badge = (text, tone = 'neutral') => el('span', { class: `demo-badge t-${tone}` }, text);

export function card(title, ...body) {
  return el('section', { class: 'demo-card' }, title ? el('h3', {}, title) : null, ...body);
}

export function field(label, input) {
  const id = `d-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return el('div', { class: 'demo-field' }, el('label', { for: id }, label), input);
}

export function flash(container, message, tone = 'ok') {
  const n = el('div', { class: `demo-flash ${tone}`, role: 'status' }, message);
  container.prepend(n);
  setTimeout(() => n.remove(), 3500);
}

/**
 * Monta a aplicação de demonstração com menu lateral.
 * views: [{ id, label, icon, render(container, app) }]
 */
export function mountDemo(root, { name, views }) {
  root.textContent = '';
  const main = el('div', { class: 'demo-main', tabindex: '-1' });
  const nav = el('nav', { class: 'demo-nav', 'aria-label': `Menu do ${name}` },
    el('div', { class: 'demo-brand' }, icon('grid-1x2'), el('span', {}, name), badge('DEMO', 'warn')),
    el('ul', {}, views.map((v) => el('li', {}, el('button', { type: 'button', dataset: { view: v.id }, onclick: () => show(v.id) }, icon(v.icon), el('span', {}, v.label))))));
  root.append(el('div', { class: 'demo-layout' }, nav, main));
  const app = { refresh: () => show(current), go: (id) => show(id) };
  let current = views[0].id;
  function show(id) {
    current = id;
    const view = views.find((v) => v.id === id);
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false'));
    main.textContent = '';
    main.append(el('header', { class: 'demo-header' }, el('h2', {}, view.label), el('span', { class: 'demo-note' }, 'Dados fictícios')));
    const body = el('div', { class: 'demo-body' });
    main.append(body);
    view.render(body, app);
  }
  show(current);
  return app;
}
