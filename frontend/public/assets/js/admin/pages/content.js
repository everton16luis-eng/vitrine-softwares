import { get, put } from '../../shared/api.js';
import { el, icon, badge, date, toast, toastError, loading, tabSet } from '../../shared/ui.js';
import { crudPage, yesNo, pageHeader } from './_crud.js';

const GROUPS = { home: 'Página inicial', servicos: 'Página de serviços' };

async function blocks(area, ctx) {
  const canEdit = ctx.can('conteudo.editar');
  area.append(pageHeader('Textos do site', 'Altere textos e imagens das páginas sem modificar o código-fonte. Listas usam uma linha por item no formato "Título | Descrição".'));
  const box = el('div', {}, loading());
  area.append(box);
  const items = await get('/api/admin/conteudos');
  box.textContent = '';
  const inputs = [];
  const byGroup = Object.groupBy ? Object.groupBy(items, (i) => i.grupo) : items.reduce((a, i) => ((a[i.grupo] ||= []).push(i), a), {});
  for (const [group, list] of Object.entries(byGroup)) {
    const card = el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6 card-title' }, GROUPS[group] || group)));
    for (const b of list) {
      const id = `cb-${b.chave.replace(/\W/g, '-')}`;
      let input;
      if (b.tipo === 'imagem') {
        const hidden = { chave: b.chave, arquivo_id: b.arquivo_id };
        const label = el('span', { class: 'small text-body-secondary' }, b.arquivo_id ? `Arquivo #${b.arquivo_id}` : 'Ilustração padrão');
        input = el('div', { class: 'd-flex gap-2 align-items-center' }, label,
          canEdit ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', id, onclick: async () => { const f = await ctx.pickImage(); if (f) { hidden.arquivo_id = f.id; label.textContent = f.nome_original; } } }, icon('images'), ' Escolher') : null,
          canEdit ? el('button', { class: 'btn btn-sm btn-link', type: 'button', onclick: () => { hidden.arquivo_id = null; label.textContent = 'Ilustração padrão'; } }, 'Usar padrão') : null);
        inputs.push(() => ({ chave: b.chave, valor: '', arquivo_id: hidden.arquivo_id }));
      } else {
        input = ['texto_longo', 'markdown'].includes(b.tipo)
          ? el('textarea', { class: 'form-control', id, rows: b.chave.endsWith('.itens') ? 6 : 3, readonly: !canEdit || null }, b.valor)
          : el('input', { class: 'form-control', id, value: b.valor, readonly: !canEdit || null });
        inputs.push(() => ({ chave: b.chave, valor: input.value }));
      }
      card.firstChild.append(el('div', { class: 'mb-3' }, el('label', { class: 'form-label', for: id }, b.rotulo), input, el('div', { class: 'invalid-feedback d-block', dataset: { err: b.chave } })));
    }
    box.append(card);
  }
  if (canEdit) {
    const save = el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      save.disabled = true;
      box.querySelectorAll('[data-err]').forEach((n) => { n.textContent = ''; });
      try { await put('/api/admin/conteudos', { itens: inputs.map((fn) => fn()) }); toast('Conteúdo atualizado. O site reflete a alteração em até 30 segundos.'); }
      catch (err) {
        toastError(err);
        for (const [k, m] of Object.entries(err.fields || {})) { const n = box.querySelector(`[data-err="${CSS.escape(k)}"]`); if (n) n.textContent = m; }
      } finally { save.disabled = false; }
    } }, icon('check2'), ' Salvar textos');
    area.append(el('div', { class: 'sticky-save' }, save));
  }
}

export async function render(c, ctx) {
  const t = tabSet([['textos', 'Textos e imagens'], ['paginas', 'Páginas'], ['faqs', 'Perguntas frequentes']], (k) => show(k), 'Conteúdo do site');
  const area = t.panel;
  c.append(t.list, area);
  const views = {
    textos: () => blocks(area, ctx),
    paginas: () => crudPage(area, ctx, {
      title: 'Páginas institucionais', singular: 'página', labelKey: 'titulo',
      description: 'Sobre, políticas e termos. Textos jurídicos devem ser revisados por profissional habilitado antes da publicação definitiva.',
      endpoint: '/api/admin/paginas', editPerm: 'conteudo.editar', defaults: { tipo: 'institucional', publicado: true },
      columns: [
        { label: 'Título', key: 'titulo' }, { label: 'Endereço', render: (r) => el('a', { href: `/${r.slug}`, target: '_blank', rel: 'noopener' }, `/${r.slug}`) },
        { label: 'Tipo', render: (r) => (r.tipo === 'juridica' ? 'Jurídica' : 'Institucional') },
        { label: 'Revisão', render: (r) => (r.revisao_pendente ? badge('Pendente', 'warning') : badge('Revisada', 'success')) },
        { label: 'Publicada', render: (r) => yesNo(r.publicado) }, { label: 'Atualizada', render: (r) => date(r.atualizado_em) }
      ],
      fields: () => [
        { name: 'titulo', label: 'Título', required: true, col: 8 },
        { name: 'slug', label: 'Slug (endereço)', required: true, col: 4 },
        { name: 'tipo', label: 'Tipo', type: 'select', options: [['institucional', 'Institucional'], ['juridica', 'Jurídica']], required: true, col: 4 },
        { name: 'revisao_pendente', label: 'Exibir aviso "documento em revisão"', type: 'checkbox', col: 4 },
        { name: 'publicado', label: 'Publicada', type: 'checkbox', col: 4 },
        { name: 'conteudo', label: 'Conteúdo (Markdown)', type: 'markdown', rows: 16, help: 'Use ## para seções, - para listas, **negrito** e [texto](https://link).' },
        { name: 'seo_title', label: 'Título SEO', col: 6, max: 70 },
        { name: 'seo_description', label: 'Descrição SEO', col: 6, max: 170 }
      ]
    }),
    faqs: () => crudPage(area, ctx, {
      title: 'Perguntas frequentes', singular: 'pergunta', labelKey: 'pergunta', endpoint: '/api/admin/faqs', editPerm: 'conteudo.editar', defaults: { ativo: true, ordem: 0 },
      columns: [{ label: 'Pergunta', key: 'pergunta' }, { label: 'Ordem', key: 'ordem' }, { label: 'Ativa', render: (r) => yesNo(r.ativo) }],
      fields: () => [
        { name: 'pergunta', label: 'Pergunta', required: true },
        { name: 'resposta', label: 'Resposta', type: 'textarea', required: true, rows: 4 },
        { name: 'ordem', label: 'Ordem', type: 'number', col: 4 },
        { name: 'ativo', label: 'Exibir no site', type: 'checkbox', col: 8 }
      ]
    })
  };
  const show = async (k) => {
    area.textContent = '';
    try { await views[k](); } catch (err) { toastError(err); }
  };
  await t.show('textos');
}
