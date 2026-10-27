// Seletor de imagens da biblioteca de mídia (com envio rápido).
import { get, api } from '../shared/api.js';
import { el, icon, loading, toastError, emptyState } from '../shared/ui.js';

export function pickImage() {
  return new Promise((resolve) => {
    let chosen = null;
    const grid = el('div', { class: 'media-grid' });
    const fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'form-control', 'aria-label': 'Enviar nova imagem' });
    const alt = el('input', { class: 'form-control', placeholder: 'Texto alternativo (descreva a imagem)', maxlength: 300, 'aria-label': 'Texto alternativo' });
    const upload = el('button', { class: 'btn btn-outline-primary', type: 'button' }, icon('upload'), ' Enviar');
    const body = el('div', {}, el('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, fileInput, alt, upload), grid);
    const dialog = el('div', { class: 'modal fade', tabindex: '-1', 'aria-label': 'Selecionar imagem' },
      el('div', { class: 'modal-dialog modal-xl modal-dialog-scrollable' }, el('div', { class: 'modal-content' },
        el('div', { class: 'modal-header' }, el('h2', { class: 'h5 modal-title' }, 'Selecionar imagem'), el('button', { class: 'btn-close', type: 'button', 'data-bs-dismiss': 'modal', 'aria-label': 'Fechar' })),
        el('div', { class: 'modal-body' }, body))));
    document.body.append(dialog);
    const modal = new window.bootstrap.Modal(dialog);
    dialog.addEventListener('hidden.bs.modal', () => { dialog.remove(); resolve(chosen); });

    async function load() {
      grid.textContent = '';
      grid.append(loading());
      try {
        const data = await get('/api/admin/midia?limite=60');
        grid.textContent = '';
        if (!data.items.length) grid.append(emptyState('Biblioteca vazia', 'Envie a primeira imagem acima.'));
        data.items.forEach((f) => grid.append(el('button', { type: 'button', class: 'media-item', onclick: () => { chosen = f; modal.hide(); } },
          el('img', { src: f.url, alt: f.texto_alternativo || f.nome_original, loading: 'lazy' }), el('span', {}, f.nome_original))));
      } catch (err) { toastError(err); }
    }
    upload.addEventListener('click', async () => {
      if (!fileInput.files[0]) { fileInput.focus(); return; }
      const fd = new FormData();
      fd.append('arquivo', fileInput.files[0]);
      if (alt.value) fd.append('texto_alternativo', alt.value);
      upload.disabled = true;
      try {
        chosen = await api('/api/admin/midia', { method: 'POST', form: fd });
        modal.hide();
      } catch (err) { toastError(err); } finally { upload.disabled = false; }
    });
    modal.show();
    load();
  });
}
