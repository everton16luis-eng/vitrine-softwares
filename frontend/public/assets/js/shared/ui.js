// Componentes de interface compartilhados (painel e área do cliente).
// Todo texto é inserido com textContent — nunca innerHTML com dados.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = Boolean(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const icon = (name, extra = '') => el('i', { class: `bi bi-${name} ${extra}`.trim(), 'aria-hidden': 'true' });

// ---------------------------------------------------------------- formatação
export function money(value, currency = 'BRL') {
  if (value === null || value === undefined || value === '') return '—';
  const [int, frac = '00'] = String(value).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const sym = { BRL: 'R$', USD: 'US$', EUR: '€' }[currency] || currency;
  return `${neg ? '-' : ''}${sym} ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(frac + '00').slice(0, 2)}`;
}
export function date(value) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  return new Date(value).toLocaleDateString('pt-BR');
}
export const datetime = (value) => (value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** "1.234,56" | "1234.56" -> "1234.56" (string, sem ponto flutuante). */
export function parseMoneyInput(text) {
  let s = String(text ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return s;
}
/** Soma/multiplica valores monetários em centavos inteiros (para prévias na tela). */
export const toCents = (s) => {
  const v = parseMoneyInput(s);
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return 0;
  const [i, f = ''] = v.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
};
export const centsToStr = (c) => `${Math.trunc(c / 100)}.${String(Math.abs(c % 100)).padStart(2, '0')}`;

// ---------------------------------------------------------------- feedback
export function toast(message, tone = 'success') {
  const region = document.querySelector('[data-toasts]');
  const n = el('div', { class: `alert alert-${tone} shadow mb-0 d-flex gap-2 align-items-start`, role: tone === 'danger' ? 'alert' : 'status' },
    icon(tone === 'success' ? 'check-circle' : tone === 'danger' ? 'exclamation-octagon' : 'info-circle'), el('span', {}, message));
  region.append(n);
  setTimeout(() => n.remove(), tone === 'danger' ? 8000 : 4500);
}
export const toastError = (err) => toast(err?.message || 'Erro inesperado.', 'danger');

export const badge = (text, tone = 'secondary') => el('span', { class: `badge rounded-pill text-bg-${tone}` }, text);
export const loading = (text = 'Carregando…') => el('div', { class: 'state-loading', role: 'status' }, el('span', { class: 'spinner-border spinner-border-sm', 'aria-hidden': 'true' }), ` ${text}`);
export const emptyState = (title, text, action) => el('div', { class: 'state-empty' }, icon('inbox'), el('h3', {}, title), text ? el('p', {}, text) : null, action || null);
export const errorState = (err, retry) => el('div', { class: 'state-error', role: 'alert' }, icon('exclamation-triangle'),
  el('p', {}, err?.message || 'Não foi possível carregar os dados.'), retry ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: retry }, 'Tentar novamente') : null);

// ---------------------------------------------------------------- modais
function baseModal({ title, size = '', body, footer, onHidden }) {
  const dialog = el('div', { class: 'modal fade', tabindex: '-1', 'aria-hidden': 'true', 'aria-labelledby': 'modal-title' },
    el('div', { class: `modal-dialog modal-dialog-scrollable ${size}` },
      el('div', { class: 'modal-content' },
        el('div', { class: 'modal-header' }, el('h2', { class: 'modal-title h5', id: 'modal-title' }, title),
          el('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'modal', 'aria-label': 'Fechar' })),
        el('div', { class: 'modal-body' }, body),
        footer ? el('div', { class: 'modal-footer' }, footer) : null)));
  document.body.append(dialog);
  const instance = new window.bootstrap.Modal(dialog);
  dialog.addEventListener('hidden.bs.modal', () => { onHidden?.(); dialog.remove(); });
  instance.show();
  return { dialog, close: () => instance.hide() };
}

/** Confirmação para operações destrutivas. Resolve true/false. */
export function confirmDialog({ title = 'Confirmar ação', message, confirmLabel = 'Confirmar', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button' }, confirmLabel);
    const m = baseModal({
      title,
      body: el('p', { class: 'mb-0' }, message),
      footer: [el('button', { class: 'btn btn-outline-secondary', type: 'button', 'data-bs-dismiss': 'modal' }, 'Cancelar'), ok],
      onHidden: () => resolve(result)
    });
    ok.addEventListener('click', () => { result = true; m.close(); });
    m.dialog.addEventListener('shown.bs.modal', () => ok.focus());
  });
}

/** Modal com formulário. `onSubmit(values)` deve lançar ApiError para exibir erros nos campos. */
export function formModal({ title, fields, values = {}, submitLabel = 'Salvar', size = 'modal-lg', onSubmit, context = {} }) {
  const form = buildForm(fields, values, context);
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', form: form.node.id = `f-${Math.random().toString(36).slice(2)}` }, submitLabel);
  const m = baseModal({ title, size, body: form.node, footer: [el('button', { class: 'btn btn-outline-secondary', type: 'button', 'data-bs-dismiss': 'modal' }, 'Cancelar'), submit] });
  form.node.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.validate()) return;
    submit.disabled = true;
    try {
      await onSubmit(form.values());
      m.close();
    } catch (err) {
      form.showErrors(err.fields || {}, err.message);
    } finally {
      submit.disabled = false;
    }
  });
  return m;
}

export function infoModal({ title, body, size = '' }) {
  return baseModal({ title, size, body, footer: el('button', { class: 'btn btn-primary', type: 'button', 'data-bs-dismiss': 'modal' }, 'Fechar') });
}

// ---------------------------------------------------------------- formulários
/**
 * Campos: { name, label, type, required, options, help, col, min, max, rows, placeholder, readonly }
 * Tipos: text, email, url, textarea, number, money, date, select, checkbox, lines (array de strings),
 *        checklist (array de valores), image (id de arquivo via seletor de mídia), section (título),
 *        file (File selecionado ou null; aceita "accept" e "preview", um nó exibido acima do campo).
 */
export function buildForm(fields, values = {}, context = {}) {
  const node = el('form', { class: 'admin-form', novalidate: true });
  const general = el('div', { class: 'alert alert-danger d-none', role: 'alert' });
  node.append(general);
  const row = el('div', { class: 'row g-3' });
  node.append(row);
  const inputs = new Map();

  for (const f of fields) {
    if (f.type === 'section') { row.append(el('div', { class: 'col-12' }, el('h3', { class: 'form-section' }, f.label), f.help ? el('p', { class: 'form-text mt-0' }, f.help) : null)); continue; }
    const id = `fld-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    const v = values[f.name];
    const errorId = `${id}-err`;
    let input;
    const common = { id, name: f.name, 'aria-describedby': errorId, required: f.required || null, readonly: f.readonly || null };
    switch (f.type) {
      case 'textarea':
      case 'markdown':
        input = el('textarea', { ...common, class: 'form-control', rows: f.rows || (f.type === 'markdown' ? 8 : 3), maxlength: f.max || null }, v ?? '');
        break;
      case 'lines':
        input = el('textarea', { ...common, class: 'form-control', rows: f.rows || 4 }, Array.isArray(v) ? v.join('\n') : '');
        break;
      case 'select': {
        const opts = typeof f.options === 'function' ? f.options(context) : f.options;
        input = el('select', { ...common, class: 'form-select' },
          f.required ? null : el('option', { value: '' }, f.placeholder || '—'),
          (opts || []).map(([val, label]) => el('option', { value: val, selected: String(val) === String(v ?? '') || null }, label)));
        break;
      }
      case 'checkbox':
        input = el('input', { ...common, type: 'checkbox', class: 'form-check-input', checked: Boolean(v) });
        break;
      case 'checklist': {
        const opts = typeof f.options === 'function' ? f.options(context) : f.options;
        const set = new Set((v || []).map(String));
        input = el('div', { class: 'checklist', id, role: 'group', 'aria-describedby': errorId },
          (opts || []).map(([val, label]) => el('div', { class: 'form-check' },
            el('input', { class: 'form-check-input', type: 'checkbox', id: `${id}-${val}`, value: val, checked: set.has(String(val)) }),
            el('label', { class: 'form-check-label', for: `${id}-${val}` }, label))));
        break;
      }
      case 'image': {
        const hidden = el('input', { type: 'hidden', name: f.name, value: v ?? '' });
        const preview = el('div', { class: 'image-field-preview' }, v ? el('span', {}, `Arquivo #${v}`) : el('span', { class: 'text-body-secondary' }, 'Nenhuma imagem'));
        const pick = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', id, onclick: async () => {
          const file = await context.pickImage?.();
          if (file) { hidden.value = file.id; preview.textContent = ''; preview.append(el('img', { src: file.url, alt: file.texto_alternativo || '', height: 48 })); }
        } }, icon('images'), ' Escolher');
        const clear = el('button', { type: 'button', class: 'btn btn-sm btn-link text-danger', onclick: () => { hidden.value = ''; preview.textContent = 'Nenhuma imagem'; } }, 'Remover');
        input = el('div', { class: 'image-field' }, hidden, preview, pick, clear);
        input.hiddenInput = hidden;
        break;
      }
      case 'file':
        input = el('input', { ...common, type: 'file', class: 'form-control', accept: f.accept || null });
        break;
      case 'money':
        input = el('input', { ...common, class: 'form-control', inputmode: 'decimal', placeholder: f.placeholder || '0,00', value: v ? String(v).replace('.', ',') : '' });
        break;
      default:
        input = el('input', { ...common, class: 'form-control', type: f.type || 'text', value: v ?? '', maxlength: f.max || null, min: f.min ?? null, placeholder: f.placeholder || null });
    }
    const label = el('label', { class: f.type === 'checkbox' ? 'form-check-label' : 'form-label', for: id }, f.label, f.required ? el('span', { class: 'text-danger', 'aria-hidden': 'true' }, ' *') : null);
    const err = el('div', { class: 'invalid-feedback', id: errorId });
    const help = f.help && f.type !== 'section' ? el('div', { class: 'form-text' }, f.help) : null;
    const wrap = f.type === 'checkbox'
      ? el('div', { class: `col-${f.col || 12}` }, el('div', { class: 'form-check form-switch' }, input, label, err), help)
      : el('div', { class: `col-12 col-md-${f.col || 12}` }, label, f.type === 'file' ? f.preview || null : null, input, help, err);
    row.append(wrap);
    inputs.set(f.name, { f, input, err });
  }

  function getValues() {
    const out = {};
    for (const [name, { f, input }] of inputs) {
      if (f.readonly) continue;
      if (f.type === 'checkbox') out[name] = input.checked;
      else if (f.type === 'lines') out[name] = input.value.split('\n').map((s) => s.trim()).filter(Boolean);
      else if (f.type === 'checklist') out[name] = [...input.querySelectorAll('input:checked')].map((c) => (f.numeric ? Number(c.value) : c.value));
      else if (f.type === 'image') out[name] = input.hiddenInput.value ? Number(input.hiddenInput.value) : null;
      else if (f.type === 'file') out[name] = input.files?.[0] || null;
      else if (f.type === 'money') out[name] = input.value.trim() ? parseMoneyInput(input.value) : null;
      else if (f.type === 'number') out[name] = input.value === '' ? null : Number(input.value);
      else if (f.type === 'select' && f.numeric) out[name] = input.value ? Number(input.value) : null;
      else out[name] = input.value.trim() === '' ? (f.required ? '' : null) : input.value;
    }
    return out;
  }

  function showErrors(errors = {}, message) {
    for (const { input, err } of inputs.values()) { input.classList?.remove('is-invalid'); err.textContent = ''; }
    let first = null;
    for (const [name, msg] of Object.entries(errors)) {
      const item = inputs.get(name);
      if (!item) continue;
      item.input.classList?.add('is-invalid');
      item.err.textContent = msg;
      item.err.classList.add('d-block');
      first ||= item.input;
    }
    if (message) { general.textContent = message; general.classList.remove('d-none'); } else general.classList.add('d-none');
    (first || general).focus?.();
  }

  function validate() {
    const errs = {};
    for (const [name, { f, input }] of inputs) {
      if (f.required && f.type !== 'checkbox' && f.type !== 'checklist' && f.type !== 'image' && !input.value?.trim()) errs[name] = 'Campo obrigatório.';
      else if (f.type === 'file' && f.maxBytes && input.files?.[0]?.size > f.maxBytes) errs[name] = 'Arquivo acima do tamanho máximo permitido.';
      else if (f.type === 'email' && input.value && !input.checkValidity()) errs[name] = 'E-mail inválido.';
      else if (f.type === 'money' && input.value && !/^\d+(\.\d{1,2})?$/.test(parseMoneyInput(input.value))) errs[name] = 'Valor inválido (ex.: 1.500,00).';
    }
    if (Object.keys(errs).length) { showErrors(errs, 'Verifique os campos destacados.'); return false; }
    showErrors({});
    return true;
  }

  return { node, values: getValues, showErrors, validate, inputs };
}

// ---------------------------------------------------------------- tabelas
/**
 * Tabela com paginação no servidor.
 * columns: [{ label, key, render(row), class }]
 * load(page) -> { items, total, page, pages }
 */
export function dataTable({ columns, load, onRowClick, empty = 'Nenhum registro encontrado.', caption }) {
  const wrap = el('div', { class: 'data-table' });
  let page = 1;
  async function refresh(p = page) {
    page = p;
    wrap.textContent = '';
    wrap.append(loading());
    try {
      const data = await load(page);
      wrap.textContent = '';
      if (!data.items.length) { wrap.append(emptyState(empty)); return; }
      const tbl = el('table', { class: 'table table-hover align-middle mb-0' },
        caption ? el('caption', { class: 'visually-hidden' }, caption) : null,
        el('thead', {}, el('tr', {}, columns.map((c) => el('th', { scope: 'col', class: c.class || '' }, c.label)))),
        el('tbody', {}, data.items.map((row) => {
          const tr = el('tr', { class: onRowClick ? 'clickable' : '' }, columns.map((c) => el('td', { class: c.class || '' }, c.render ? c.render(row) : row[c.key] ?? '—')));
          if (onRowClick) {
            tr.tabIndex = 0;
            tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input')) onRowClick(row); });
            tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) onRowClick(row); });
          }
          return tr;
        })));
      wrap.append(el('div', { class: 'table-responsive' }, tbl));
      if (data.pages > 1) {
        wrap.append(el('nav', { class: 'd-flex justify-content-between align-items-center mt-3', 'aria-label': 'Paginação' },
          el('span', { class: 'text-body-secondary small' }, `${data.total} registros · página ${data.page} de ${data.pages}`),
          el('div', { class: 'btn-group' },
            el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', disabled: data.page <= 1 || null, onclick: () => refresh(page - 1) }, '‹ Anterior'),
            el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', disabled: data.page >= data.pages || null, onclick: () => refresh(page + 1) }, 'Próxima ›'))));
      } else {
        wrap.append(el('p', { class: 'text-body-secondary small mt-2 mb-0' }, `${data.total} registro(s)`));
      }
    } catch (err) {
      wrap.textContent = '';
      wrap.append(errorState(err, () => refresh()));
    }
  }
  return { node: wrap, refresh };
}

/** Executa uma ação com botão em estado de carregamento e mensagens. */
export async function withBusy(button, fn, successMessage) {
  const prev = button?.disabled;
  if (button) button.disabled = true;
  try {
    const r = await fn();
    if (successMessage) toast(successMessage);
    return r;
  } catch (err) {
    toastError(err);
    return undefined;
  } finally {
    if (button) button.disabled = prev || false;
  }
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
