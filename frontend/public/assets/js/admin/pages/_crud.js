// Página genérica de listagem + formulário em modal para entidades simples.
import { get, post, put, del } from '../../shared/api.js';
import { el, icon, dataTable, formModal, confirmDialog, toast, debounce, toastError } from '../../shared/ui.js';

export function pageHeader(title, description, ...actions) {
  return el('div', { class: 'page-header' },
    el('div', {}, el('h1', {}, title), description ? el('p', { class: 'text-body-secondary mb-0' }, description) : null),
    el('div', { class: 'page-actions' }, actions));
}

/**
 * @param {HTMLElement} container
 * @param {object} ctx  contexto do app (permissões, opções, seletor de imagens)
 * @param {object} cfg
 *   cfg.afterSave(saved, values, previous) — opcional, roda depois de criar/editar (ex.: upload)
 */
export async function crudPage(container, ctx, cfg) {
  const canEdit = ctx.can(cfg.editPerm);
  const state = { busca: '', filtros: {} };
  const opcoes = cfg.needsOptions ? await ctx.opcoes() : {};
  const fctx = { ...ctx, opcoes };

  const table = dataTable({
    caption: cfg.title,
    columns: [...cfg.columns, ...(canEdit ? [{ label: '', class: 'text-end', render: (row) => rowActions(row) }] : [])],
    load: (page) => {
      const q = new URLSearchParams({ pagina: page, busca: state.busca, ...state.filtros });
      [...q.keys()].forEach((k) => { if (!q.get(k)) q.delete(k); });
      return get(`${cfg.endpoint}?${q}`);
    },
    onRowClick: canEdit ? (row) => openForm(row) : cfg.onView,
    empty: cfg.empty || 'Nenhum registro cadastrado.'
  });

  function rowActions(row) {
    const box = el('div', { class: 'btn-group btn-group-sm' });
    (cfg.rowActions?.(row, { refresh: () => table.refresh() }) || []).forEach((b) => box.append(b));
    box.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': 'Editar', title: 'Editar', onclick: () => openForm(row) }, icon('pencil')));
    if (cfg.deletable !== false) {
      box.append(el('button', { class: 'btn btn-outline-danger', type: 'button', 'aria-label': 'Excluir', title: 'Excluir', onclick: async () => {
        const ok = await confirmDialog({ title: `Excluir ${cfg.singular}`, message: cfg.deleteMessage?.(row) || `Deseja excluir "${row[cfg.labelKey || 'nome']}"? Esta ação não pode ser desfeita.`, confirmLabel: 'Excluir' });
        if (!ok) return;
        try {
          const r = await del(`${cfg.endpoint}/${row.id}`);
          toast(r?.desativado ? 'Registro possui histórico e foi desativado.' : 'Registro excluído.');
          table.refresh();
        } catch (err) { toastError(err); }
      } }, icon('trash')));
    }
    return box;
  }

  async function openForm(row = null) {
    let saved = row; // após criar, novas tentativas do mesmo formulário editam o registro criado
    let values = row ? { ...row } : { ...(cfg.defaults || {}) };
    if (row && cfg.loadOne) values = await get(`${cfg.endpoint}/${row.id}`).catch((err) => { toastError(err); return null; });
    if (!values) return;
    formModal({
      title: row ? `Editar ${cfg.singular}` : `Novo ${cfg.singular}`,
      fields: cfg.fields(fctx, values),
      values,
      context: fctx,
      onSubmit: async (v) => {
        const payload = cfg.prepare ? cfg.prepare(v, row) : v;
        const previous = saved;
        saved = saved ? await put(`${cfg.endpoint}/${saved.id}`, payload) : await post(cfg.endpoint, payload);
        if (cfg.afterSave) {
          try { await cfg.afterSave(saved, v, previous); } catch (err) { table.refresh(); throw err; }
        }
        toast(row ? 'Alterações salvas.' : `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} cadastrado(a).`);
        if (cfg.invalidatesOptions) ctx._opcoes = null;
        table.refresh();
      }
    });
  }

  const search = el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar…', 'aria-label': `Pesquisar ${cfg.title}`, oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) });
  const filterNodes = (cfg.filters || []).map((f) => el('select', { class: 'form-select', 'aria-label': f.label, onchange: (e) => { state.filtros[f.name] = e.target.value; table.refresh(1); } },
    el('option', { value: '' }, f.label), (typeof f.options === 'function' ? f.options(fctx) : f.options).map(([v, l]) => el('option', { value: v }, l))));

  container.append(
    pageHeader(cfg.title, cfg.description, canEdit ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm() }, icon('plus-lg'), ` ${cfg.newLabel || 'Novo'}`) : null),
    ...(cfg.extraTop ? [cfg.extraTop] : []),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' }, cfg.searchable === false ? null : search, filterNodes),
      table.node)));
  table.refresh();
  return { table, openForm };
}

export const yesNo = (v) => (v ? el('span', { class: 'badge text-bg-success' }, 'Sim') : el('span', { class: 'badge text-bg-light border' }, 'Não'));
export const entries = (obj) => Object.entries(obj || {});
