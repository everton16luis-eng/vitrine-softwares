import { get, put, del, api } from '../../shared/api.js';
import { el, icon, loading, emptyState, errorState, formModal, confirmDialog, toast, toastError, datetime, debounce } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

const ORIGENS = [['proprio', 'Próprio / criado para o projeto'], ['captura_de_tela', 'Captura de tela'], ['pexels', 'Pexels'], ['unsplash', 'Unsplash'], ['pixabay', 'Pixabay'], ['cliente', 'Fornecido pelo cliente'], ['outro', 'Outro']];
const META_FIELDS = [
  { name: 'texto_alternativo', label: 'Texto alternativo', help: 'Descreva o conteúdo da imagem para leitores de tela.', max: 300 },
  { type: 'section', label: 'Origem e licença', help: 'Para imagens de bancos (Pexels, Unsplash, Pixabay), registre o autor, a URL original e a licença consultada.' },
  { name: 'origem', label: 'Origem', type: 'select', options: ORIGENS, required: true, col: 6 },
  { name: 'autor', label: 'Autor', col: 6 },
  { name: 'url_origem', label: 'URL original', type: 'url', col: 8 },
  { name: 'licenca_verificada_em', label: 'Licença verificada em', type: 'date', col: 4 },
  { name: 'licenca', label: 'Licença consultada', placeholder: 'Ex.: Licença Pexels (uso comercial permitido, sem atribuição obrigatória)' }
];

export async function render(c, ctx) {
  const canEdit = ctx.can('midia.editar');
  let busca = '';
  const grid = el('div', { class: 'media-library' });
  const fileInput = el('input', { type: 'file', class: 'd-none', accept: 'image/jpeg,image/png,image/webp', onchange: () => fileInput.files[0] && upload(fileInput.files[0]) });

  async function load() {
    grid.textContent = '';
    grid.append(loading());
    try {
      const data = await get(`/api/admin/midia?limite=60&busca=${encodeURIComponent(busca)}`);
      grid.textContent = '';
      if (!data.items.length) { grid.append(emptyState('Nenhuma imagem', 'Envie imagens JPG, PNG ou WEBP (até o limite configurado).')); return; }
      data.items.forEach((f) => grid.append(el('figure', { class: 'media-card' },
        el('img', { src: f.url, alt: f.texto_alternativo || '', loading: 'lazy' }),
        el('figcaption', {},
          el('strong', { title: f.nome_original }, f.nome_original),
          el('span', {}, `${f.largura || '?'}×${f.altura || '?'} · ${(f.tamanho / 1024).toFixed(0)} KB · ${f.usos} uso(s)`),
          !f.texto_alternativo ? el('span', { class: 'text-warning-emphasis' }, icon('exclamation-triangle'), ' Sem texto alternativo') : null,
          el('div', { class: 'btn-group btn-group-sm mt-2' },
            el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => details(f) }, canEdit ? 'Editar' : 'Detalhes'),
            canEdit ? replaceBtn(f) : null,
            canEdit ? el('button', { class: 'btn btn-outline-danger', type: 'button', 'aria-label': `Excluir ${f.nome_original}`, disabled: f.usos > 0 || null, title: f.usos > 0 ? 'Em uso: remova as associações antes' : 'Excluir', onclick: () => remove(f) }, icon('trash')) : null)))));
    } catch (err) { grid.textContent = ''; grid.append(errorState(err, load)); }
  }

  function replaceBtn(f) {
    const input = el('input', { type: 'file', class: 'd-none', accept: 'image/jpeg,image/png,image/webp', onchange: async () => {
      const fd = new FormData();
      fd.append('arquivo', input.files[0]);
      try { await api(`/api/admin/midia/${f.id}/arquivo`, { method: 'PUT', form: fd }); toast('Imagem substituída (associações mantidas).'); load(); } catch (err) { toastError(err); }
    } });
    return el('span', { class: 'btn-group btn-group-sm' }, input, el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => input.click() }, 'Substituir'));
  }

  function details(f) {
    formModal({
      title: f.nome_original, fields: META_FIELDS.map((x) => ({ ...x, readonly: !canEdit })), values: f, submitLabel: canEdit ? 'Salvar' : 'Fechar',
      onSubmit: async (v) => { if (canEdit) { await put(`/api/admin/midia/${f.id}`, v); toast('Informações salvas.'); load(); } }
    });
  }

  async function remove(f) {
    if (!(await confirmDialog({ title: 'Excluir arquivo', message: `Excluir "${f.nome_original}" permanentemente?`, confirmLabel: 'Excluir' }))) return;
    try { await del(`/api/admin/midia/${f.id}`); toast('Arquivo excluído.'); load(); } catch (err) { toastError(err); }
  }

  async function upload(file) {
    formModal({
      title: `Enviar ${file.name}`, fields: META_FIELDS, values: { origem: 'proprio' }, submitLabel: 'Enviar',
      onSubmit: async (v) => {
        const fd = new FormData();
        fd.append('arquivo', file);
        for (const [k, val] of Object.entries(v)) if (val !== null && val !== undefined && val !== '') fd.append(k, val);
        await api('/api/admin/midia', { method: 'POST', form: fd });
        toast('Imagem enviada.');
        fileInput.value = '';
        load();
      }
    });
  }

  c.append(pageHeader('Biblioteca de mídia', 'Imagens validadas pelo conteúdo real do arquivo, reprocessadas e armazenadas com nomes seguros. Registre a origem e a licença de cada imagem.',
    canEdit ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => fileInput.click() }, icon('upload'), ' Enviar imagem') : null), fileInput,
  el('div', { class: 'toolbar mb-3' }, el('input', { type: 'search', class: 'form-control', placeholder: 'Pesquisar por nome ou texto alternativo', 'aria-label': 'Pesquisar imagens', oninput: debounce((e) => { busca = e.target.value; load(); }) })),
  grid,
  el('p', { class: 'small text-body-secondary mt-3' }, `Atualizado em ${datetime(new Date())}. Imagens em uso não podem ser excluídas.`));
  load();
}
