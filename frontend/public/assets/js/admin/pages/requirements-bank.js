// Levantamento de Requisitos: banco de perguntas (etapas, categorias, perguntas e alternativas).
// Alterações valem para os próximos levantamentos; os existentes guardam o próprio roteiro.
import { get, post, put, del, download } from '../../shared/api.js';
import { el, icon, formModal, confirmDialog, toast, toastError, tabSet, emptyState, withBusy, badge } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';
import { API, SELECTION, muted } from './requirements-common.js';

export async function render(c, ctx) {
  const canManage = ctx.can('levantamentos.perguntas');
  let bank = await get(`${API}/roteiro`);
  let current = 'etapas';
  const reload = async () => { bank = await get(`${API}/roteiro`); await tabs.show(current); };

  c.append(el('a', { class: 'back-link', href: '#/levantamentos' }, icon('arrow-left'), 'Levantamentos'),
    pageHeader('Banco de perguntas', 'Roteiro usado nas novas entrevistas. Alterações não afetam levantamentos já criados: cada um guarda as perguntas com que foi feito.',
      el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Questionário em Word com o roteiro ativo, sem cliente', onclick: (e) => withBusy(e.currentTarget, () => download(`${API}/roteiro/questionario.docx`, 'questionario-descoberta.docx'), 'Questionário gerado.') }, icon('file-earmark-word'), ' Questionário (Word)'),
      canManage ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => stageModal(null) }, icon('plus-lg'), ' Nova etapa') : null,
      canManage ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => questionModal(null) }, icon('plus-lg'), ' Nova pergunta') : null));
  if (!canManage) c.append(el('div', { class: 'alert alert-secondary small', role: 'status' }, icon('lock'), ' Seu perfil permite apenas consultar o roteiro.'));

  const tabs = tabSet([['etapas', 'Etapas e perguntas'], ['categorias', 'Categorias']], (key, panel) => {
    current = key;
    panel.textContent = '';
    if (key === 'categorias') drawCategories(panel); else drawStages(panel);
  }, 'Seções do banco de perguntas');
  tabs.list.classList.add('lr-tabs');
  c.append(tabs.list, tabs.panel);

  // ---------------------------------------------------------------- ordenação
  async function move(kind, list, index, delta, extra = {}) {
    const ids = list.map((x) => x.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try { await put(`${API}/${kind}/ordem`, { ids, ...extra }); await reload(); } catch (err) { toastError(err); }
  }
  const moveButtons = (kind, list, i, label, extra) => (canManage ? el('div', { class: 'btn-group btn-group-sm lr-move' },
    el('button', { class: 'btn btn-outline-secondary', type: 'button', disabled: i === 0 || null, 'aria-label': `Mover ${label} para cima`, title: 'Mover para cima', onclick: () => move(kind, list, i, -1, extra) }, icon('arrow-up')),
    el('button', { class: 'btn btn-outline-secondary', type: 'button', disabled: i === list.length - 1 || null, 'aria-label': `Mover ${label} para baixo`, title: 'Mover para baixo', onclick: () => move(kind, list, i, 1, extra) }, icon('arrow-down'))) : null);

  // ---------------------------------------------------------------- etapas e perguntas
  function drawStages(panel) {
    const total = bank.etapas.reduce((n, e) => n + e.perguntas.length, 0);
    const ativas = bank.etapas.reduce((n, e) => n + (e.ativa ? e.perguntas.filter((q) => q.ativa).length : 0), 0);
    panel.append(el('p', { class: 'text-body-secondary small' }, `${bank.etapas.length} etapa(s) · ${total} pergunta(s), ${ativas} ativa(s) nos novos levantamentos.`));
    if (!bank.etapas.length) { panel.append(emptyState('Nenhuma etapa cadastrada.')); return; }
    bank.etapas.forEach((e, ei) => {
      const head = el('div', { class: 'lr-bank-head' },
        el('div', { class: 'lr-bank-title' },
          el('span', { class: 'lr-stage-n', 'aria-hidden': 'true' }, String(ei + 1)),
          el('div', {}, el('h2', { class: 'h6 mb-0' }, e.titulo, ' ', !e.ativa ? badge('Inativa') : null),
            e.descricao ? el('p', { class: 'small text-body-secondary mb-0' }, e.descricao) : null)),
        canManage ? el('div', { class: 'lr-bank-actions' },
          moveButtons('etapas', bank.etapas, ei, `a etapa ${e.titulo}`),
          el('div', { class: 'btn-group btn-group-sm' },
            el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Adicionar pergunta nesta etapa', 'aria-label': `Adicionar pergunta em ${e.titulo}`, onclick: () => questionModal(null, e.id) }, icon('plus-lg')),
            el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Editar etapa', 'aria-label': `Editar etapa ${e.titulo}`, onclick: () => stageModal(e) }, icon('pencil')),
            !e.padrao ? el('button', { class: 'btn btn-outline-danger', type: 'button', title: 'Excluir etapa', 'aria-label': `Excluir etapa ${e.titulo}`, onclick: async (ev) => {
              if (!(await confirmDialog({ title: 'Excluir etapa', message: `Excluir a etapa "${e.titulo}"? Ela precisa estar vazia.`, confirmLabel: 'Excluir' }))) return;
              if (await withBusy(ev.currentTarget, () => del(`${API}/etapas/${e.id}`).then(() => true), 'Etapa excluída.')) await reload();
            } }, icon('trash')) : null)) : null);
      const list = el('ol', { class: 'lr-bank-list' });
      if (!e.perguntas.length) list.append(el('li', { class: 'text-body-secondary small' }, 'Nenhuma pergunta nesta etapa.'));
      e.perguntas.forEach((q, qi) => list.append(el('li', { class: `lr-bank-q${q.ativa ? '' : ' is-off'}` },
        el('span', { class: 'lr-q-ref' }, `${ei + 1}.${qi + 1}`),
        el('div', { class: 'lr-bank-q-body' },
          el('p', { class: 'mb-1 fw-semibold' }, q.enunciado),
          el('div', { class: 'lr-chips' },
            el('span', { class: 'small text-body-secondary' }, bank.tipos[q.tipo]),
            q.categoria_titulo ? el('span', { class: 'small text-body-secondary' }, `· ${q.categoria_titulo}`) : null,
            q.obrigatoria ? badge('Obrigatória', 'accent') : null,
            !q.ativa ? badge('Inativa') : null,
            q.personalizada ? badge('Personalizada', 'info') : null,
            q.levantamentos ? el('span', { class: 'small text-body-secondary' }, `· usada em ${q.levantamentos} levantamento(s)`) : null),
          SELECTION.has(q.tipo) ? el('p', { class: 'small text-body-secondary mb-0 mt-1' }, `Alternativas: ${q.opcoes.join(' · ')}`) : null,
          q.orientacao ? el('p', { class: 'small text-body-secondary mb-0 mt-1' }, icon('info-circle'), ` ${q.orientacao}`) : null),
        canManage ? el('div', { class: 'lr-bank-actions' },
          moveButtons('perguntas', e.perguntas, qi, `a pergunta ${ei + 1}.${qi + 1}`, { etapa_id: e.id }),
          el('div', { class: 'btn-group btn-group-sm' },
            el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Editar', 'aria-label': `Editar pergunta ${ei + 1}.${qi + 1}`, onclick: () => questionModal(q) }, icon('pencil')),
            el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Duplicar', 'aria-label': `Duplicar pergunta ${ei + 1}.${qi + 1}`, onclick: async (ev) => {
              if (await withBusy(ev.currentTarget, () => post(`${API}/perguntas/${q.id}/duplicar`), 'Pergunta duplicada.')) await reload();
            } }, icon('copy')),
            el('button', { class: 'btn btn-outline-secondary', type: 'button', title: q.ativa ? 'Desativar' : 'Ativar', 'aria-label': `${q.ativa ? 'Desativar' : 'Ativar'} pergunta ${ei + 1}.${qi + 1}`, onclick: async (ev) => {
              if (await withBusy(ev.currentTarget, () => put(`${API}/perguntas/${q.id}`, { ativa: !q.ativa }), q.ativa ? 'Pergunta desativada.' : 'Pergunta ativada.')) await reload();
            } }, icon(q.ativa ? 'eye-slash' : 'eye')),
            q.personalizada ? el('button', { class: 'btn btn-outline-danger', type: 'button', title: 'Excluir', 'aria-label': `Excluir pergunta ${ei + 1}.${qi + 1}`, onclick: async (ev) => {
              if (!(await confirmDialog({ title: 'Excluir pergunta', message: `Excluir "${q.enunciado}"? Levantamentos que já a usaram mantêm a própria cópia.`, confirmLabel: 'Excluir' }))) return;
              if (await withBusy(ev.currentTarget, () => del(`${API}/perguntas/${q.id}`).then(() => true), 'Pergunta excluída.')) await reload();
            } }, icon('trash')) : null)) : null)));
      panel.append(el('section', { class: `card mb-3 lr-bank-stage${e.ativa ? '' : ' is-off'}` }, el('div', { class: 'card-body' }, head, list)));
    });
  }

  function stageModal(stage) {
    formModal({
      title: stage ? 'Editar etapa' : 'Nova etapa', size: '',
      fields: [
        { name: 'titulo', label: 'Título', required: true, max: 160 },
        { name: 'descricao', label: 'Orientação para o entrevistador', type: 'textarea', rows: 3 },
        { name: 'ativa', label: 'Ativa (aparece nos novos levantamentos)', type: 'checkbox' }
      ],
      values: stage || { ativa: true },
      onSubmit: async (v) => {
        if (stage) await put(`${API}/etapas/${stage.id}`, v); else await post(`${API}/etapas`, v);
        toast(stage ? 'Etapa atualizada.' : 'Etapa criada.');
        await reload();
      }
    });
  }

  function questionModal(q, etapaId) {
    const m = formModal({
      title: q ? 'Editar pergunta' : 'Nova pergunta',
      fields: [
        ...(q?.levantamentos ? [{ type: 'section', label: `Usada em ${q.levantamentos} levantamento(s)`, help: 'Eles não mudam: cada levantamento guarda a própria cópia. A alteração vale para os próximos.' }] : []),
        { name: 'etapa_id', label: 'Etapa', type: 'select', required: true, numeric: true, col: 6, options: bank.etapas.map((e, i) => [e.id, `${i + 1}. ${e.titulo}`]) },
        { name: 'categoria_id', label: 'Categoria (para a consolidação)', type: 'select', numeric: true, col: 6, placeholder: 'Sem categoria', options: bank.categorias.map((cat) => [cat.id, cat.titulo]) },
        { name: 'enunciado', label: 'Pergunta', type: 'textarea', rows: 2, required: true, max: 500 },
        { name: 'orientacao', label: 'Orientação ao entrevistador', type: 'textarea', rows: 2, help: 'Aparece abaixo da pergunta durante a entrevista.' },
        { name: 'tipo', label: 'Tipo de resposta', type: 'select', required: true, col: 6, options: Object.entries(bank.tipos) },
        { name: 'opcoes', label: 'Alternativas (uma por linha)', type: 'lines', rows: 5, help: 'Pelo menos duas. A ordem aqui é a ordem na tela e no relatório.' },
        { name: 'obrigatoria', label: 'Obrigatória para concluir', type: 'checkbox', col: 6 },
        { name: 'ativa', label: 'Ativa nos novos levantamentos', type: 'checkbox', col: 6 }
      ],
      values: q ? { ...q } : { etapa_id: etapaId || bank.etapas[0]?.id, tipo: 'texto_longo', ativa: true, obrigatoria: false, opcoes: [] },
      onSubmit: async (v) => {
        const body = { ...v, opcoes: SELECTION.has(v.tipo) ? v.opcoes : [] };
        if (q) {
          await put(`${API}/perguntas/${q.id}`, body);
        } else await post(`${API}/perguntas`, body);
        toast(q ? 'Pergunta atualizada.' : 'Pergunta criada.');
        await reload();
      }
    });
    const form = m.dialog.querySelector('form');
    const tipo = form.querySelector('[name="tipo"]');
    const opcoesCol = form.querySelector('[name="opcoes"]').closest('[class*="col-"]');
    const sync = () => opcoesCol.classList.toggle('d-none', !SELECTION.has(tipo.value));
    tipo.addEventListener('change', sync);
    sync();
  }

  // ---------------------------------------------------------------- categorias
  function drawCategories(panel) {
    panel.append(el('div', { class: 'd-flex flex-wrap justify-content-between align-items-start gap-2 mb-3' },
      el('p', { class: 'text-body-secondary small mb-0 lr-measure' }, 'As categorias agrupam as respostas na consolidação e no relatório (problemas, regras, integrações…).'),
      canManage ? el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => categoryModal(null) }, icon('plus-lg'), ' Nova categoria') : null));
    if (!bank.categorias.length) { panel.append(emptyState('Nenhuma categoria.')); return; }
    const count = (id) => bank.etapas.reduce((n, e) => n + e.perguntas.filter((q) => q.categoria_id === id).length, 0);
    panel.append(el('ol', { class: 'lr-bank-list card' }, bank.categorias.map((cat, i) => el('li', { class: `lr-bank-q${cat.ativa ? '' : ' is-off'}` },
      el('span', { class: 'lr-q-ref' }, String(i + 1)),
      el('div', { class: 'lr-bank-q-body' },
        el('p', { class: 'mb-1 fw-semibold' }, cat.titulo, ' ', !cat.ativa ? badge('Inativa') : null),
        el('div', { class: 'lr-chips' }, el('code', { class: 'small' }, cat.chave), el('span', { class: 'small text-body-secondary' }, `· ${count(cat.id)} pergunta(s)`), cat.padrao ? null : badge('Personalizada', 'info')),
        cat.descricao ? el('p', { class: 'small text-body-secondary mb-0 mt-1' }, cat.descricao) : muted('')),
      canManage ? el('div', { class: 'lr-bank-actions' },
        moveButtons('categorias', bank.categorias, i, `a categoria ${cat.titulo}`),
        el('div', { class: 'btn-group btn-group-sm' },
          el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Editar', 'aria-label': `Editar categoria ${cat.titulo}`, onclick: () => categoryModal(cat) }, icon('pencil')),
          !cat.padrao ? el('button', { class: 'btn btn-outline-danger', type: 'button', title: 'Excluir', 'aria-label': `Excluir categoria ${cat.titulo}`, onclick: async (ev) => {
            if (!(await confirmDialog({ title: 'Excluir categoria', message: `Excluir "${cat.titulo}"? As perguntas dela ficam sem categoria.`, confirmLabel: 'Excluir' }))) return;
            if (await withBusy(ev.currentTarget, () => del(`${API}/categorias/${cat.id}`).then(() => true), 'Categoria excluída.')) await reload();
          } }, icon('trash')) : null)) : null))));
  }

  function categoryModal(cat) {
    formModal({
      title: cat ? 'Editar categoria' : 'Nova categoria', size: '',
      fields: [
        { name: 'titulo', label: 'Título', required: true, max: 120 },
        { name: 'descricao', label: 'Descrição', type: 'textarea', rows: 2, help: 'Orienta a síntese deste tema na revisão.' },
        { name: 'ativa', label: 'Ativa (aparece na consolidação dos novos levantamentos)', type: 'checkbox' }
      ],
      values: cat || { ativa: true },
      onSubmit: async (v) => {
        if (cat) await put(`${API}/categorias/${cat.id}`, v); else await post(`${API}/categorias`, v);
        toast(cat ? 'Categoria atualizada.' : 'Categoria criada.');
        await reload();
      }
    });
  }

  tabs.show('etapas');
}
