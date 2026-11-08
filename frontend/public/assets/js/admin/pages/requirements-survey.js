// Levantamento de Requisitos: entrevista guiada, 5 porquês, revisão/conclusão, relatórios e versões.
// As respostas são salvas automaticamente (por pergunta, em série) e o estado aparece no topo.
import { get, post, put, del, download } from '../../shared/api.js';
import { el, icon, date, datetime, dataTable, formModal, confirmDialog, toast, toastError, tabSet, emptyState, scrollRegion, withBusy, debounce } from '../../shared/ui.js';
import {
  API, reference, statusChip, versionChip, muted, progressBar, formatAnswer, isAnswered, computeProgress,
  duplicateModal, reportUrl, fileSize, SELECTION, TEXT_TYPES, questionnaireName
} from './requirements-common.js';

const TABS = [['entrevista', 'Entrevista'], ['porques', '5 porquês'], ['revisao', 'Revisão e conclusão'], ['relatorios', 'Relatórios PDF'], ['versoes', 'Versões e histórico']];
/** Baixa o questionário em Word (em branco ou com as respostas da versão em exibição). */
function downloadQuestionnaire(btn, s, comRespostas, vq) {
  const q = new URLSearchParams(vq ? vq.slice(1) : '');
  if (comRespostas) q.set('respostas', '1');
  return withBusy(btn, () => download(`${API}/levantamentos/${s.id}/questionario.docx${q.size ? `?${q}` : ''}`, questionnaireName(s.cliente_nome, s.projeto_nome)), 'Questionário gerado.');
}
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ------------------------------------------------------------------ autosave
/**
 * Fila de gravação: cada chave (pergunta, nota, campo) grava em série; a última edição vence.
 * onChange() é chamado sempre que o estado muda para atualizar o indicador.
 */
function createSaver(onChange) {
  const timers = new Map();
  const pending = new Map();
  const chains = new Map();
  let inflight = 0;
  let lastSaved = null;
  let lastError = null;
  const state = () => ({ busy: inflight > 0 || pending.size > 0, lastSaved, lastError });
  function run(key) {
    const fn = pending.get(key);
    clearTimeout(timers.get(key));
    timers.delete(key);
    if (!fn) return chains.get(key) || Promise.resolve();
    pending.delete(key);
    inflight++;
    onChange(state());
    const p = (chains.get(key) || Promise.resolve()).then(fn).then(() => { lastSaved = new Date(); lastError = null; }, (err) => {
      lastError = err;
      if (!pending.has(key) && err.status !== 422 && err.status !== 400 && err.status !== 409) pending.set(key, fn); // tenta de novo no próximo "salvar"
    }).finally(() => { inflight--; onChange(state()); });
    chains.set(key, p);
    return p;
  }
  return {
    schedule(key, fn, delay = 900) {
      clearTimeout(timers.get(key));
      pending.set(key, fn);
      timers.set(key, setTimeout(() => run(key), delay));
      onChange(state());
    },
    now(key, fn) { pending.set(key, fn); return run(key); },
    flush() { return Promise.all([...new Set([...pending.keys(), ...chains.keys()])].map((k) => run(k))); },
    retry() { return this.flush(); },
    get busy() { return state().busy; },
    get hasError() { return Boolean(lastError); }
  };
}

// ------------------------------------------------------------------ página
export async function render(c, ctx, id) {
  const ref = await reference();
  const versaoQ = ctx.query.get('versao');
  let s = await get(`${API}/levantamentos/${id}${versaoQ ? `?versao=${encodeURIComponent(versaoQ)}` : ''}`);
  const latest = s.versoes[0];
  const viewingOld = s.versao.numero !== latest.numero;
  const canEdit = () => s.editavel && !viewingOld && ctx.can('levantamentos.editar');
  const vq = viewingOld ? `?versao=${s.versao.numero}` : '';

  const statusNode = el('span', { class: 'lr-save', role: 'status', 'aria-live': 'polite' });
  function paintSave(st) {
    statusNode.textContent = '';
    statusNode.className = `lr-save${st.lastError ? ' is-error' : st.busy ? ' is-busy' : st.lastSaved ? ' is-ok' : ''}`;
    if (st.lastError) {
      statusNode.append(icon('exclamation-triangle'), ` Não foi possível salvar: ${st.lastError.message} `,
        el('button', { class: 'btn btn-link btn-sm p-0 align-baseline', type: 'button', onclick: () => saver.retry() }, 'Tentar de novo'));
    } else if (st.busy) statusNode.append(el('span', { class: 'spinner-border spinner-border-sm', 'aria-hidden': 'true' }), ' Salvando…');
    else if (st.lastSaved) statusNode.append(icon('check2'), ` Salvo às ${hhmm(st.lastSaved)}`);
    else statusNode.append(icon(canEdit() ? 'cloud-check' : 'lock'), canEdit() ? ' As respostas são salvas automaticamente' : ' Somente leitura');
  }
  const saver = createSaver(paintSave);
  paintSave({ busy: false, lastSaved: null, lastError: null });

  // Não perder edições ao sair da página.
  const beforeUnload = (e) => { if (saver.busy) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const onHash = () => { saver.flush(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);

  async function reload(tab) {
    await saver.flush();
    s = await get(`${API}/levantamentos/${id}${vq}`);
    drawHeader();
    tabs.show(tab || current);
  }

  // ---------------------------------------------------------------- cabeçalho
  const header = el('div');
  function drawHeader() {
    header.textContent = '';
    const more = el('div', { class: 'dropdown' },
      el('button', { class: 'btn btn-outline-secondary dropdown-toggle', type: 'button', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false' }, 'Mais ações'),
      el('ul', { class: 'dropdown-menu dropdown-menu-end' },
        canEdit() ? el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: editHeader }, icon('pencil'), ' Editar dados da reunião')) : null,
        ctx.can('levantamentos.criar') ? el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: () => duplicateModal(ctx, s) }, icon('copy'), ' Duplicar (sem respostas)')) : null,
        el('li', {}, el('a', { class: 'dropdown-item', href: `#/levantamentos/comparar?a=${s.id}` }, icon('layout-split'), ' Comparar com outro')),
        el('li', {}, el('a', { class: 'dropdown-item', href: `#/levantamentos/projeto/${s.projeto_id}` }, icon('folder2-open'), ' Abrir o projeto')),
        ctx.can('levantamentos.editar') ? el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: toggleArchive }, icon(s.status === 'arquivado' ? 'box-arrow-up' : 'archive'), s.status === 'arquivado' ? ' Desarquivar' : ' Arquivar')) : null));
    header.append(
      el('a', { class: 'back-link', href: '#/levantamentos' }, icon('arrow-left'), 'Levantamentos'),
      el('div', { class: 'page-header lr-header' },
        el('div', {},
          el('p', { class: 'lr-eyebrow' }, s.codigo, el('span', { 'aria-hidden': 'true' }, ' · '), `versão ${s.versao.numero}`),
          el('h1', {}, s.projeto_nome),
          el('p', {}, el('a', { href: `#/levantamentos/cliente/${s.cliente_id}` }, s.cliente_nome), s.cliente_empresa ? ` · ${s.cliente_empresa}` : '',
            ` · reunião em ${date(s.data_reuniao)} · responsável: ${s.responsavel_nome}`),
          el('div', { class: 'lr-chips mt-2' }, statusChip(ref, s.status), versionChip(ref, s.versao.status), s.origem_codigo ? el('span', { class: 'small text-body-secondary' }, `duplicado de ${s.origem_codigo}`) : null)),
        el('div', { class: 'page-actions' },
          el('a', { class: 'btn btn-outline-secondary', href: `${API}/levantamentos/${s.id}/previa${vq}`, target: '_blank', rel: 'noopener' }, icon('eye'), ' Pré-visualizar'),
          el('div', { class: 'dropdown' },
            el('button', { class: 'btn btn-outline-secondary dropdown-toggle', type: 'button', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false' }, icon('file-earmark-word'), ' Questionário'),
            el('ul', { class: 'dropdown-menu dropdown-menu-end' },
              el('li', {}, el('span', { class: 'dropdown-item-text small text-body-secondary' }, 'Arquivo Word para o cliente responder')),
              el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: (e) => downloadQuestionnaire(e.currentTarget, s, false, vq) }, icon('file-earmark'), ' Em branco')),
              el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: (e) => downloadQuestionnaire(e.currentTarget, s, true, vq) }, icon('file-earmark-text'), ' Com as respostas já registradas')))),
          more)));
    if (viewingOld) {
      header.append(el('div', { class: 'alert alert-info d-flex flex-wrap gap-2 align-items-center', role: 'status' }, icon('clock-history'),
        el('span', {}, `Você está consultando a versão ${s.versao.numero}${s.versao.status === 'concluida' ? `, concluída em ${datetime(s.versao.concluida_em)}` : ''}. Ela é somente leitura.`),
        el('a', { href: `#/levantamentos/${s.id}?aba=${current}` }, `Ir para a versão atual (${latest.numero})`)));
    } else if (s.status === 'arquivado') {
      header.append(el('div', { class: 'alert alert-secondary', role: 'status' }, icon('archive'), ' Levantamento arquivado: somente leitura. Desarquive em "Mais ações" para continuar.'));
    } else if (s.status === 'concluido') {
      header.append(el('div', { class: 'alert alert-success', role: 'status' }, icon('check2-circle'),
        ` Versão ${s.versao.numero} concluída em ${datetime(s.versao.concluida_em)}${s.versao.concluida_por_nome ? ` por ${s.versao.concluida_por_nome}` : ''}. Para alterar, reabra na aba "Revisão e conclusão" — a versão concluída fica preservada.`));
    }
  }

  function editHeader() {
    formModal({
      title: 'Dados da reunião', size: '',
      fields: [
        { name: 'responsavel_id', label: 'Responsável', type: 'select', required: true, options: ref.equipe.map((u) => [u.id, u.nome]) },
        { name: 'data_reuniao', label: 'Data da reunião', type: 'date', required: true },
        { name: 'observacoes_iniciais', label: 'Observações iniciais', type: 'textarea', rows: 4 }
      ],
      values: s,
      onSubmit: async (v) => { await put(`${API}/levantamentos/${s.id}`, { ...v, responsavel_id: Number(v.responsavel_id) }); toast('Dados atualizados.'); await reload(); }
    });
  }

  async function toggleArchive(e) {
    const archived = s.status === 'arquivado';
    if (!archived && !(await confirmDialog({ title: 'Arquivar levantamento', message: 'O levantamento sai da lista principal e fica somente leitura. Nada é apagado e você pode desarquivar quando quiser.', confirmLabel: 'Arquivar', danger: false }))) return;
    const r = await withBusy(e.currentTarget, () => post(`${API}/levantamentos/${s.id}/${archived ? 'desarquivar' : 'arquivar'}`), archived ? 'Levantamento desarquivado.' : 'Levantamento arquivado.');
    if (r) await reload();
  }

  // ---------------------------------------------------------------- abas
  let current = TABS.some(([k]) => k === ctx.query.get('aba')) ? ctx.query.get('aba') : (canEdit() ? 'entrevista' : 'revisao');
  const tabs = tabSet(TABS, async (key, panel) => {
    if (key !== current) await saver.flush();
    current = key;
    history.replaceState(null, '', `#/levantamentos/${s.id}?${new URLSearchParams({ ...(viewingOld ? { versao: s.versao.numero } : {}), aba: key })}`);
    panel.textContent = '';
    const views = { entrevista: interviewTab, porques: whysTab, revisao: reviewTab, relatorios: reportsTab, versoes: versionsTab };
    try { await views[key](panel); } catch (err) { toastError(err); }
  }, 'Seções do levantamento');

  tabs.list.classList.add('lr-tabs');
  drawHeader();
  c.append(header, el('div', { class: 'lr-progress-row' }, el('div', { class: 'lr-progress-main' }), statusNode), tabs.list, tabs.panel);
  const progressHost = c.querySelector('.lr-progress-main');
  function drawProgress() {
    const p = computeProgress(s.etapas);
    progressHost.textContent = '';
    progressHost.append(progressBar(p.percentual, 'Perguntas respondidas'),
      el('span', { class: 'lr-progress-text' }, el('strong', {}, `${p.percentual}%`), ` · ${p.respondidas} de ${p.total} respondidas`,
        p.puladas ? ` · ${p.puladas} pulada(s)` : '', p.obrigatorias_pendentes.length ? el('span', { class: 'lr-pend' }, ` · ${p.obrigatorias_pendentes.length} obrigatória(s) pendente(s)`) : ''));
    return p;
  }
  drawProgress();
  await tabs.show(current);

  // ================================================================ ENTREVISTA
  async function interviewTab(panel) {
    if (!s.etapas.length) { panel.append(emptyState('Este levantamento não tem perguntas.')); return; }
    const editable = canEdit();
    let idx = Math.min(Math.max(Number(ctx.query.get('etapa')) || s.etapa_atual || 0, 0), s.etapas.length - 1);
    const stageNav = el('ol', { class: 'lr-stages', 'aria-label': 'Etapas da entrevista' });
    const stageBody = el('section', { class: 'lr-stage', 'aria-live': 'off' });
    panel.append(el('div', { class: 'lr-interview' }, el('nav', { class: 'lr-stages-wrap', 'aria-label': 'Etapas' }, stageNav), stageBody));

    function drawNav() {
      const p = computeProgress(s.etapas);
      stageNav.textContent = '';
      s.etapas.forEach((e, i) => {
        const st = p.porEtapa.get(e.id);
        const done = st.total && st.respondidas + st.puladas === st.total;
        stageNav.append(el('li', {}, el('button', {
          type: 'button', class: `lr-stage-btn${i === idx ? ' is-current' : ''}${done ? ' is-done' : ''}`, 'aria-current': i === idx ? 'step' : null,
          onclick: () => go(i)
        },
        el('span', { class: 'lr-stage-n', 'aria-hidden': 'true' }, done ? icon('check-lg') : String(i + 1)),
        el('span', { class: 'lr-stage-t' }, e.titulo, el('span', { class: 'lr-stage-c' }, `${st.respondidas}/${st.total}${st.obrigatorias_pendentes ? ' · obrigatória pendente' : ''}`)))));
      });
    }

    function go(i, focus = true) {
      saver.flush();
      idx = i;
      if (editable) put(`${API}/levantamentos/${s.id}/posicao`, { etapa_atual: i }).catch(() => {});
      s.etapa_atual = i;
      drawNav();
      drawStage();
      if (focus) { stageBody.querySelector('h2')?.focus(); stageBody.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }

    function drawStage() {
      const e = s.etapas[idx];
      stageBody.textContent = '';
      stageBody.append(el('header', { class: 'lr-stage-head' },
        el('p', { class: 'lr-eyebrow' }, `Etapa ${idx + 1} de ${s.etapas.length}`),
        el('h2', { tabindex: '-1' }, e.titulo),
        e.descricao ? el('p', { class: 'text-body-secondary mb-0' }, e.descricao) : null));
      e.perguntas.forEach((q, qi) => stageBody.append(questionCard(e, q, `${idx + 1}.${qi + 1}`)));
      // Observações da etapa
      const noteId = `nota-${e.id}`;
      const note = el('textarea', { class: 'form-control', id: noteId, rows: 3, maxlength: ref.limites.textoLongo, disabled: !editable || null, placeholder: 'Impressões, pontos a confirmar, falas marcantes…' }, e.nota || '');
      if (editable) {
        note.addEventListener('input', () => {
          e.nota = note.value;
          saver.schedule(`nota:${e.id}`, () => put(`${API}/levantamentos/${s.id}/etapas/${e.id}/nota`, { texto: note.value }), 1200);
        });
      }
      stageBody.append(el('div', { class: 'lr-note' }, el('label', { class: 'form-label', for: noteId }, icon('journal-text'), ' Observações do entrevistador nesta etapa'), note));
      const prev = idx > 0 ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => go(idx - 1) }, icon('arrow-left'), ` ${s.etapas[idx - 1].titulo}`) : el('span');
      const next = idx < s.etapas.length - 1
        ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(idx + 1) }, `Avançar: ${s.etapas[idx + 1].titulo} `, icon('arrow-right'))
        : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => tabs.show('revisao') }, 'Ir para a revisão ', icon('arrow-right'));
      stageBody.append(el('div', { class: 'lr-stage-nav' }, prev, next));
    }

    function questionCard(etapa, q, refNum) {
      const qid = `q-${q.id}`;
      const card = el('article', { class: 'lr-q', id: `pergunta-${q.id}` });
      const answerNode = el('div', { class: 'lr-q-answer' });
      const stateNode = el('div', { class: 'lr-q-state' });
      const r = () => q.resposta;
      const skipped = () => Boolean(r()?.pulada);

      function markState() {
        card.classList.toggle('is-answered', isAnswered(r()));
        card.classList.toggle('is-skipped', skipped());
        stateNode.textContent = '';
        if (skipped()) stateNode.append(el('span', { class: 'chip chip-neutral' }, 'Pulada'));
        else if (isAnswered(r()) && r().atualizado_por_nome) stateNode.append(el('span', { class: 'small text-body-secondary' }, `Respondida por ${r().atualizado_por_nome}`));
      }

      // Monta o valor { valor, detalhe } a partir dos controles e agenda a gravação.
      let read = () => ({});
      const blank = (x) => x === null || x === undefined || (typeof x === 'string' && !x.trim()) || (Array.isArray(x) && !x.length);
      function save(delay) {
        const payload = read();
        q.resposta = blank(payload.valor) && blank(payload.detalhe) ? null
          : { valor: { valor: blank(payload.valor) ? null : payload.valor, detalhe: blank(payload.detalhe) ? null : payload.detalhe }, pulada: false, atualizado_por_nome: ctx.user.nome };
        markState(); drawProgress(); drawNav();
        const send = () => put(`${API}/levantamentos/${s.id}/respostas/${q.id}`, payload).then((res) => {
          if (!q.resposta?.pulada) q.resposta = res.resposta ? { ...res.resposta, atualizado_por_nome: ctx.user.nome } : null;
          markState();
        });
        if (delay) saver.schedule(`q:${q.id}`, send, delay); else saver.now(`q:${q.id}`, send);
      }

      const v = r()?.valor?.valor;
      const detalhe = r()?.valor?.detalhe || '';
      const dis = !editable || null;
      const detailInput = () => {
        const d = el('textarea', { class: 'form-control form-control-sm mt-2', rows: 2, id: `${qid}-d`, maxlength: ref.limites.detalhe, disabled: dis, placeholder: 'Complemento (opcional): exemplos, ressalvas, quem disse…', 'aria-label': `Complemento da pergunta ${refNum}` }, detalhe);
        d.addEventListener('input', () => save(1000));
        return d;
      };
      let detailNode = null;

      switch (q.tipo) {
        case 'texto_curto': {
          const i = el('input', { class: 'form-control', id: qid, type: 'text', maxlength: ref.limites.textoCurto, value: v ?? '', disabled: dis });
          i.addEventListener('input', () => save(900));
          read = () => ({ valor: i.value });
          answerNode.append(i);
          break;
        }
        case 'texto_longo':
        case 'observacoes': {
          const t = el('textarea', { class: 'form-control lr-autogrow', id: qid, rows: q.tipo === 'observacoes' ? 3 : 4, maxlength: ref.limites.textoLongo, disabled: dis }, v ?? '');
          t.addEventListener('input', () => save(1100));
          read = () => ({ valor: t.value });
          answerNode.append(t);
          break;
        }
        case 'numero': {
          const i = el('input', { class: 'form-control lr-num', id: qid, type: 'text', inputmode: 'decimal', value: v === null || v === undefined ? '' : String(v).replace('.', ','), disabled: dis, placeholder: 'Ex.: 1.250,5' });
          detailNode = detailInput();
          i.addEventListener('input', () => save(900));
          read = () => ({ valor: i.value, detalhe: detailNode.value });
          answerNode.append(i, detailNode);
          break;
        }
        case 'data': {
          const i = el('input', { class: 'form-control lr-date', id: qid, type: 'date', value: v ?? '', disabled: dis });
          detailNode = detailInput();
          i.addEventListener('change', () => save(0));
          read = () => ({ valor: i.value, detalhe: detailNode.value });
          answerNode.append(i, detailNode);
          break;
        }
        case 'sim_nao':
        case 'selecao_unica': {
          const opts = q.tipo === 'sim_nao' ? [['sim', 'Sim'], ['nao', 'Não']] : q.opcoes.map((o) => [o, o]);
          const group = el('div', { class: 'lr-options', role: 'radiogroup', 'aria-labelledby': `${qid}-l` });
          opts.forEach(([val, label], i) => {
            const rid = `${qid}-${i}`;
            const input = el('input', { class: 'btn-check', type: 'radio', name: qid, id: rid, value: val, checked: v === val, disabled: dis });
            input.addEventListener('change', () => save(0));
            group.append(input, el('label', { class: 'btn btn-option', for: rid }, label));
          });
          if (editable) {
            group.append(el('button', { class: 'btn btn-link btn-sm lr-clear', type: 'button', onclick: () => { group.querySelectorAll('input').forEach((x) => { x.checked = false; }); save(0); } }, 'Limpar'));
          }
          detailNode = detailInput();
          read = () => ({ valor: group.querySelector('input:checked')?.value ?? null, detalhe: detailNode.value });
          answerNode.append(group, detailNode);
          break;
        }
        case 'selecao_multipla': {
          const chosen = new Set(Array.isArray(v) ? v : []);
          const group = el('div', { class: 'lr-options', role: 'group', 'aria-labelledby': `${qid}-l` });
          q.opcoes.forEach((o, i) => {
            const cid = `${qid}-${i}`;
            const input = el('input', { class: 'btn-check', type: 'checkbox', id: cid, value: o, checked: chosen.has(o), disabled: dis });
            input.addEventListener('change', () => save(500));
            group.append(input, el('label', { class: 'btn btn-option', for: cid }, icon('check-lg', 'lr-opt-check'), o));
          });
          detailNode = detailInput();
          read = () => ({ valor: [...group.querySelectorAll('input:checked')].map((x) => x.value), detalhe: detailNode.value });
          answerNode.append(group, detailNode);
          break;
        }
        default:
          answerNode.append(muted(formatAnswer(q, r()) || '—'));
      }

      const skipBtn = editable ? el('button', {
        class: 'btn btn-sm btn-outline-secondary lr-skip', type: 'button', 'aria-pressed': String(skipped()),
        onclick: () => {
          const willSkip = !skipped();
          if (willSkip && isAnswered(r()) && !window.confirm('Pular esta pergunta descarta a resposta já registrada. Continuar?')) return;
          q.resposta = willSkip ? { valor: null, pulada: true } : null;
          skipBtn.setAttribute('aria-pressed', String(willSkip));
          skipBtn.lastChild.textContent = willSkip ? ' Responder' : ' Pular';
          answerNode.querySelectorAll('input, textarea').forEach((x) => { if (willSkip) { if (x.type === 'radio' || x.type === 'checkbox') x.checked = false; else x.value = ''; } x.disabled = willSkip; });
          answerNode.classList.toggle('d-none', willSkip);
          markState(); drawProgress(); drawNav();
          saver.now(`q:${q.id}`, () => put(`${API}/levantamentos/${s.id}/respostas/${q.id}`, willSkip ? { pulada: true } : { valor: null }));
        }
      }, icon('skip-forward'), document.createTextNode(skipped() ? ' Responder' : ' Pular')) : null;
      if (skipped()) { answerNode.classList.add('d-none'); answerNode.querySelectorAll('input, textarea').forEach((x) => { x.disabled = true; }); }

      const labelFor = ['sim_nao', 'selecao_unica', 'selecao_multipla'].includes(q.tipo) ? null : qid;
      card.append(
        el('div', { class: 'lr-q-head' },
          el('span', { class: 'lr-q-ref', 'aria-hidden': 'true' }, refNum),
          el(labelFor ? 'label' : 'p', { class: 'lr-q-title', id: `${qid}-l`, for: labelFor },
            el('span', { class: 'visually-hidden' }, `Pergunta ${refNum}: `), q.enunciado,
            q.obrigatoria ? el('span', { class: 'lr-req' }, el('span', { 'aria-hidden': 'true' }, ' *'), el('span', { class: 'visually-hidden' }, ' (obrigatória)')) : null),
          skipBtn),
        q.orientacao ? el('p', { class: 'lr-q-hint' }, icon('info-circle'), ' ', q.orientacao) : '',
        answerNode, stateNode);
      markState();
      void etapa; void SELECTION; void TEXT_TYPES;
      return card;
    }

    drawNav();
    drawStage();
    if (!editable) {
      panel.prepend(el('div', { class: 'alert alert-secondary small', role: 'status' }, icon('lock'), viewingOld
        ? ' Versão anterior: respostas somente para consulta.'
        : ctx.can('levantamentos.editar') ? ' Entrevista somente leitura nesta situação.' : ' Seu perfil permite apenas consultar este levantamento.'));
    }
    const focusQ = ctx.query.get('pergunta');
    if (focusQ) document.getElementById(`pergunta-${focusQ}`)?.scrollIntoView({ block: 'center' });
  }

  // ================================================================ 5 PORQUÊS
  async function whysTab(panel) {
    const editable = canEdit();
    panel.append(el('div', { class: 'd-flex flex-wrap justify-content-between align-items-start gap-3 mb-3' },
      el('p', { class: 'text-body-secondary mb-0 lr-measure' }, 'Use para aprofundar um problema relatado: pergunte "por quê?" até chegar à causa provável (até 5 níveis).'),
      editable ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => whyModal(null) }, icon('plus-lg'), ' Nova investigação') : null));
    if (!s.investigacoes.length) { panel.append(emptyState('Nenhuma investigação registrada.', editable ? 'Comece pelo problema mais citado pelo cliente.' : null)); return; }
    s.investigacoes.forEach((inv, i) => {
      panel.append(el('article', { class: 'lr-why card mb-3' }, el('div', { class: 'card-body' },
        el('div', { class: 'd-flex flex-wrap justify-content-between gap-2 align-items-start' },
          el('div', {}, el('p', { class: 'lr-eyebrow mb-1' }, `Problema ${i + 1}`), el('h3', { class: 'h6 mb-0 pre-line' }, inv.problema)),
          editable ? el('div', { class: 'btn-group btn-group-sm' },
            el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': `Editar problema ${i + 1}`, title: 'Editar', onclick: () => whyModal(inv) }, icon('pencil')),
            el('button', { class: 'btn btn-outline-danger', type: 'button', 'aria-label': `Remover problema ${i + 1}`, title: 'Remover', onclick: async (e) => {
              if (!(await confirmDialog({ title: 'Remover investigação', message: 'A investigação sai desta versão; a remoção fica registrada no histórico.', confirmLabel: 'Remover' }))) return;
              const ok = await withBusy(e.currentTarget, () => del(`${API}/levantamentos/${s.id}/investigacoes/${inv.id}`).then(() => true), 'Investigação removida.');
              if (ok) await reload('porques');
            } }, icon('trash'))) : null),
        el('ol', { class: 'lr-why-chain' }, (inv.niveis || []).map((n) => el('li', {}, el('p', { class: 'lr-why-q' }, n.pergunta || 'Por quê?'), el('p', { class: 'pre-line mb-0' }, n.resposta || muted('Sem resposta.'))))),
        el('div', { class: 'lr-why-cause' }, el('p', { class: 'lr-eyebrow mb-1' }, 'Causa identificada'), el('p', { class: 'mb-0 pre-line' }, inv.causa || 'Ainda não identificada.')),
        inv.observacoes ? el('p', { class: 'small text-body-secondary mt-2 mb-0 pre-line' }, el('strong', {}, 'Observações: '), inv.observacoes) : null)));
    });
  }

  function whyModal(inv) {
    const levels = inv?.niveis || [];
    const fields = [{ name: 'problema', label: 'Problema relatado', type: 'textarea', rows: 2, required: true, max: 2000 }];
    const values = { problema: inv?.problema || '', causa: inv?.causa || '', observacoes: inv?.observacoes || '' };
    for (let i = 0; i < ref.limites.niveis; i++) {
      fields.push({ type: 'section', label: `${i + 1}º porquê` });
      fields.push({ name: `p${i}`, label: 'Pergunta', placeholder: i ? 'Por que isso acontece?' : 'Por que esse problema acontece?', max: 1000 });
      fields.push({ name: `r${i}`, label: 'Resposta do cliente', type: 'textarea', rows: 2 });
      values[`p${i}`] = levels[i]?.pergunta || '';
      values[`r${i}`] = levels[i]?.resposta || '';
    }
    fields.push({ type: 'section', label: 'Conclusão' },
      { name: 'causa', label: 'Causa identificada', type: 'textarea', rows: 2 },
      { name: 'observacoes', label: 'Observações do entrevistador', type: 'textarea', rows: 2 });
    formModal({
      title: inv ? 'Editar investigação (5 porquês)' : 'Nova investigação (5 porquês)',
      fields, values,
      onSubmit: async (v) => {
        const niveis = [];
        for (let i = 0; i < ref.limites.niveis; i++) {
          const pergunta = (v[`p${i}`] || '').trim();
          const resposta = (v[`r${i}`] || '').trim();
          if (pergunta || resposta) niveis.push({ pergunta: pergunta || (i ? 'Por que isso acontece?' : 'Por que esse problema acontece?'), resposta });
        }
        const body = { problema: v.problema, niveis, causa: v.causa, observacoes: v.observacoes };
        if (inv) await put(`${API}/levantamentos/${s.id}/investigacoes/${inv.id}`, body);
        else await post(`${API}/levantamentos/${s.id}/investigacoes`, body);
        toast('Investigação salva.');
        await reload('porques');
      }
    });
  }

  // ================================================================ REVISÃO
  async function reviewTab(panel) {
    const editable = canEdit();
    const p = drawProgress();
    const cons = s.versao.consolidacao || {};
    const allQ = s.etapas.flatMap((e, ei) => e.perguntas.map((q, qi) => ({ ...q, ref: `${ei + 1}.${qi + 1}`, etapa_index: ei })));

    // Situação e pendências
    const goTo = (q) => { ctx.query.set('etapa', q.etapa_index); ctx.query.set('pergunta', q.id); s.etapa_atual = q.etapa_index; tabs.show('entrevista'); };
    const pend = p.obrigatorias_pendentes.map((x) => allQ.find((q) => q.id === x.id)).filter(Boolean);
    panel.append(el('div', { class: 'row g-3 mb-4' },
      el('div', { class: 'col-12 col-lg-7' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' },
        el('h2', { class: 'h6' }, 'Situação da entrevista'),
        el('dl', { class: 'dl-compact mb-3' },
          el('dt', {}, 'Respondidas'), el('dd', {}, `${p.respondidas} de ${p.total} (${p.percentual}%)`),
          el('dt', {}, 'Puladas'), el('dd', {}, String(p.puladas)),
          el('dt', {}, 'Sem resposta'), el('dd', {}, String(p.total - p.respondidas - p.puladas)),
          el('dt', {}, '5 porquês'), el('dd', {}, `${s.investigacoes.length} investigação(ões)`)),
        pend.length
          ? el('div', { class: 'lr-pend-box', role: 'note' }, el('p', { class: 'fw-semibold mb-1' }, icon('exclamation-circle'), ` Obrigatórias sem resposta (${pend.length})`),
            el('ul', { class: 'mb-0' }, pend.map((q) => el('li', {}, el('button', { class: 'btn btn-link p-0 text-start', type: 'button', onclick: () => goTo(q) }, `${q.ref} — ${q.enunciado}`)))))
          : el('p', { class: 'text-success mb-0' }, icon('check2-circle'), ' Todas as perguntas obrigatórias foram respondidas.')))),
      el('div', { class: 'col-12 col-lg-5' }, lifecycleCard(p))));

    // Consolidação
    const fields = [
      ['resumo_executivo', 'Resumo executivo', 'Síntese em poucas linhas para quem vai ler o relatório primeiro.', []],
      ['contexto', 'Contextualização da ideia', 'De onde veio a ideia e em que cenário ela surge.', allQ.filter((q) => q.categoria_chave === 'contexto')],
      ['objetivo', 'Objetivo inicial', 'O resultado que o cliente espera alcançar.', allQ.filter((q) => q.categoria_chave === 'objetivos')],
      ...(s.categorias || []).filter((cat) => cat.chave !== 'contexto').map((cat) => [cat.chave, cat.titulo, cat.descricao, allQ.filter((q) => q.categoria_chave === cat.chave)])
    ];
    const box = el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-1' }, el('h2', { class: 'h6 mb-0' }, 'Consolidação'),
        el('a', { href: `${API}/levantamentos/${s.id}/previa${vq}`, target: '_blank', rel: 'noopener', class: 'small' }, icon('eye'), ' Ver como fica no relatório')),
      el('p', { class: 'text-body-secondary small' }, editable ? 'Escreva a síntese de cada tema com base nas respostas. Tudo é salvo automaticamente e entra no relatório PDF.' : 'Síntese registrada pelo entrevistador.')));
    const body = box.firstChild;
    const textArea = (key, label, help, related, value, onSave) => {
      const fid = `cons-${key}`;
      const answered = related.filter((q) => isAnswered(q.resposta));
      const t = el('textarea', { class: 'form-control', id: fid, rows: key === 'resumo_executivo' ? 4 : 3, maxlength: ref.limites.textoLongo, disabled: !editable || null }, value || '');
      if (editable) t.addEventListener('input', () => saver.schedule(`cons:${key}`, () => onSave(t.value), 1200));
      return el('div', { class: 'lr-cons' },
        editable ? el('label', { class: 'form-label fw-semibold', for: fid }, label) : el('h3', { class: 'form-label fw-semibold fs-6' }, label),
        editable && help ? el('p', { class: 'form-text mt-0 mb-2' }, help) : null,
        editable ? t : el('div', { class: 'pre-line lr-measure' }, value || muted('Não preenchido.')),
        answered.length ? el('details', { class: 'lr-related' }, el('summary', {}, `Respostas relacionadas (${answered.length})`),
          el('ul', {}, answered.map((q) => el('li', {}, el('span', { class: 'lr-q-ref' }, q.ref), el('div', {}, el('span', { class: 'small text-body-secondary' }, q.enunciado), el('div', { class: 'pre-line' }, formatAnswer(q, q.resposta))))))) : null);
    };
    for (const [key, label, help, related] of fields) {
      body.append(textArea(key, label, help, related, cons[key], (val) => put(`${API}/levantamentos/${s.id}/consolidacao`, { consolidacao: { [key]: val } }).then(() => { s.versao.consolidacao = { ...(s.versao.consolidacao || {}), [key]: val }; })));
    }
    body.append(textArea('observacoes_finais', 'Observações finais', 'Próximos passos, combinados e pendências para a próxima reunião.', [], s.versao.observacoes_finais,
      (val) => put(`${API}/levantamentos/${s.id}/consolidacao`, { observacoes_finais: val }).then(() => { s.versao.observacoes_finais = val; })));
    panel.append(box);
  }

  function lifecycleCard(p) {
    const card = el('div', { class: 'card h-100 lr-life' }, el('div', { class: 'card-body' }));
    const b = card.firstChild;
    if (viewingOld) {
      b.append(el('h2', { class: 'h6' }, `Versão ${s.versao.numero}`), el('p', { class: 'small mb-0' }, 'Versão anterior preservada. Para alterar, use a versão atual.'));
    } else if (s.status === 'em_andamento') {
      b.append(el('h2', { class: 'h6' }, 'Concluir o levantamento'),
        el('p', { class: 'small text-body-secondary' }, 'Ao concluir, esta versão é travada e passa a ser a referência do projeto. Ajustes posteriores criam uma nova versão.'));
      if (ctx.can('levantamentos.concluir')) {
        b.append(el('button', { class: 'btn btn-accent', type: 'button', disabled: p.obrigatorias_pendentes.length ? true : null, onclick: async (e) => {
          await saver.flush();
          if (saver.hasError) { toast('Há alterações não salvas. Tente salvar de novo antes de concluir.', 'danger'); return; }
          if (!(await confirmDialog({ title: 'Concluir levantamento', message: `A versão ${s.versao.numero} será concluída e ficará somente leitura. Continuar?`, confirmLabel: 'Concluir', danger: false }))) return;
          const r = await withBusy(e.currentTarget, () => post(`${API}/levantamentos/${s.id}/concluir`), 'Levantamento concluído.');
          if (r) await reload('revisao');
        } }, icon('check2-square'), ' Concluir levantamento'),
        p.obrigatorias_pendentes.length ? el('p', { class: 'small text-body-secondary mt-2 mb-0' }, 'Responda as perguntas obrigatórias para liberar a conclusão.') : '');
      } else b.append(el('p', { class: 'small mb-0' }, 'Seu perfil não pode concluir levantamentos.'));
    } else if (s.status === 'concluido') {
      b.append(el('h2', { class: 'h6' }, 'Levantamento concluído'),
        el('p', { class: 'small text-body-secondary' }, `Versão ${s.versao.numero} concluída em ${datetime(s.versao.concluida_em)}${s.versao.concluida_por_nome ? ` por ${s.versao.concluida_por_nome}` : ''}. Reabrir cria a versão ${s.versao.numero + 1} com o mesmo conteúdo; a concluída continua disponível para consulta.`));
      if (ctx.can('levantamentos.concluir')) {
        b.append(el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => formModal({
          title: 'Reabrir levantamento', size: '', submitLabel: `Criar versão ${s.versao.numero + 1}`,
          fields: [{ name: 'motivo', label: 'Motivo da reabertura', type: 'textarea', rows: 3, required: true, help: 'Fica registrado no histórico de versões.' }],
          onSubmit: async (v) => { const r = await post(`${API}/levantamentos/${s.id}/reabrir`, v); toast(`Versão ${r.versao} criada.`); await reload('entrevista'); }
        }) }, icon('unlock'), ' Reabrir para edição'));
      }
    } else {
      b.append(el('h2', { class: 'h6' }, 'Arquivado'), el('p', { class: 'small mb-0' }, 'Desarquive em "Mais ações" para continuar o trabalho.'));
    }
    return card;
  }

  // ================================================================ RELATÓRIOS
  async function reportsTab(panel) {
    const list = await get(`${API}/levantamentos/${s.id}/relatorios`);
    const canPdf = ctx.can('levantamentos.pdf');
    const pdfOk = ref.pdf?.disponivel;
    const gen = el('button', { class: 'btn btn-primary', type: 'button', disabled: !canPdf || !pdfOk || null, onclick: async (e) => {
      await saver.flush();
      const r = await withBusy(e.currentTarget, () => post(`${API}/levantamentos/${s.id}/relatorios`, { versao: s.versao.numero }), 'PDF gerado e guardado.');
      if (r) { await reload('relatorios'); window.open(reportUrl(s.id, r.id), '_blank', 'noopener'); }
    } }, icon('file-earmark-pdf'), ` Gerar PDF da versão ${s.versao.numero}`);
    panel.append(el('div', { class: 'd-flex flex-wrap justify-content-between align-items-start gap-3 mb-3' },
      el('div', { class: 'lr-measure' },
        el('p', { class: 'mb-1' }, 'Cada PDF gerado fica guardado, ligado à versão que o originou, e nunca é sobrescrito.'),
        s.versao.status === 'em_trabalho' ? el('p', { class: 'small text-body-secondary mb-0' }, 'Esta versão ainda está em trabalho: o PDF sai marcado como rascunho.') : null,
        !pdfOk ? el('p', { class: 'small text-danger mb-0' }, icon('exclamation-triangle'), ' Gerador de PDF indisponível no servidor (Chrome/Chromium não encontrado). Configure PDF_CHROME_PATH.') : null),
      el('div', { class: 'page-actions' },
        el('a', { class: 'btn btn-outline-secondary', href: `${API}/levantamentos/${s.id}/previa${vq}`, target: '_blank', rel: 'noopener' }, icon('eye'), ' Pré-visualizar'),
        canPdf ? gen : null)));
    panel.append(el('div', { class: 'lr-docx card mb-4' }, el('div', { class: 'card-body d-flex flex-wrap justify-content-between align-items-center gap-3' },
      el('div', { class: 'lr-measure' }, el('h2', { class: 'h6 mb-1' }, icon('file-earmark-word'), ' Questionário para o cliente (Word)'),
        el('p', { class: 'small text-body-secondary mb-0' }, 'Todas as perguntas deste levantamento, com quadros para escrever e caixas para marcar. Envie antes da reunião ou para o cliente completar depois. As orientações do entrevistador não aparecem.')),
      el('div', { class: 'page-actions' },
        el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: (e) => downloadQuestionnaire(e.currentTarget, s, false, vq) }, icon('download'), ' Em branco'),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: (e) => downloadQuestionnaire(e.currentTarget, s, true, vq) }, icon('download'), ' Com respostas')))));
    if (!list.length) { panel.append(emptyState('Nenhum PDF gerado ainda.', 'Use a pré-visualização para conferir o conteúdo antes de gerar.')); return; }
    panel.append(scrollRegion(el('table', { class: 'table align-middle mb-0' },
      el('thead', {}, el('tr', {}, ['Arquivo', 'Versão', 'Gerado em', 'Por', 'Páginas', 'Tamanho', ''].map((h) => el('th', { scope: 'col', class: h === 'Páginas' || h === 'Tamanho' ? 'text-end' : '' }, h)))),
      el('tbody', {}, list.map((r) => el('tr', {},
        el('td', { class: 'lr-file' }, icon('file-earmark-pdf'), ' ', r.nome_arquivo),
        el('td', {}, el('div', { class: 'lr-chips' }, `v${r.versao_numero}`, r.versao_status === 'em_trabalho' ? el('span', { class: 'chip chip-progress' }, 'rascunho') : null)),
        el('td', { class: 'text-nowrap' }, datetime(r.gerado_em)),
        el('td', {}, r.gerado_por_nome || '—'),
        el('td', { class: 'text-end' }, String(r.paginas ?? '—')),
        el('td', { class: 'text-end text-nowrap' }, fileSize(r.tamanho)),
        el('td', { class: 'text-end' }, el('div', { class: 'btn-group btn-group-sm' },
          el('a', { class: 'btn btn-outline-secondary', href: reportUrl(s.id, r.id), target: '_blank', rel: 'noopener', title: 'Abrir', 'aria-label': `Abrir ${r.nome_arquivo}` }, icon('box-arrow-up-right')),
          el('button', { class: 'btn btn-outline-secondary', type: 'button', title: 'Baixar', 'aria-label': `Baixar ${r.nome_arquivo}`, onclick: (e) => withBusy(e.currentTarget, () => download(reportUrl(s.id, r.id, false), r.nome_arquivo)) }, icon('download')))))))), 'Relatórios gerados'));
  }

  // ================================================================ VERSÕES E HISTÓRICO
  async function versionsTab(panel) {
    panel.append(el('h2', { class: 'h6' }, 'Versões'),
      scrollRegion(el('table', { class: 'table align-middle' },
        el('thead', {}, el('tr', {}, ['Versão', 'Situação', 'Criada', 'Concluída', 'Motivo da reabertura', 'PDFs', ''].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, s.versoes.map((v) => el('tr', { class: v.numero === s.versao.numero ? 'table-active' : '' },
          el('td', { class: 'fw-semibold' }, `v${v.numero}`),
          el('td', {}, versionChip(ref, v.status)),
          el('td', { class: 'small' }, datetime(v.criada_em), v.criada_por_nome ? el('div', { class: 'text-body-secondary' }, v.criada_por_nome) : null),
          el('td', { class: 'small' }, v.concluida_em ? [datetime(v.concluida_em), v.concluida_por_nome ? el('div', { class: 'text-body-secondary' }, v.concluida_por_nome) : null] : '—'),
          el('td', { class: 'small pre-line' }, v.motivo_reabertura || '—'),
          el('td', {}, String(v.relatorios)),
          el('td', { class: 'text-end text-nowrap' },
            v.numero === s.versao.numero ? el('span', { class: 'small text-body-secondary' }, 'em exibição') : el('a', { class: 'btn btn-sm btn-outline-secondary', href: `#/levantamentos/${s.id}?versao=${v.numero}&aba=revisao` }, 'Consultar'),
            s.versoes.length > 1 && v.numero !== latest.numero ? el('a', { class: 'btn btn-sm btn-link', href: `#/levantamentos/comparar?a=${s.id}:${v.numero}&b=${s.id}:${latest.numero}` }, 'Comparar com a atual') : null))))), 'Versões do levantamento'));

    const showVal = (x) => {
      if (x === null || x === undefined) return muted('—');
      if (typeof x === 'string') return x;
      if (x.pulada) return muted('(pulada)');
      if ('valor' in x && x.valor && typeof x.valor === 'object' && ('valor' in x.valor || 'detalhe' in x.valor)) {
        const val = Array.isArray(x.valor.valor) ? x.valor.valor.join('; ') : x.valor.valor === 'sim' ? 'Sim' : x.valor.valor === 'nao' ? 'Não' : x.valor.valor;
        return [val, x.valor.detalhe].filter((y) => y !== null && y !== undefined && y !== '').join(' — ') || muted('—');
      }
      if ('problema' in x) return `${x.problema}${x.causa ? ` → causa: ${x.causa}` : ''}`;
      if ('status' in x) return `${ref.status[x.status] || x.status} (v${x.versao})${x.motivo ? ` — ${x.motivo}` : ''}`;
      return JSON.stringify(x);
    };
    const table = dataTable({
      caption: 'Histórico de alterações',
      columns: [
        { label: 'Quando', class: 'text-nowrap small', render: (h) => datetime(h.atualizado_em || h.criado_em) },
        { label: 'Quem', class: 'small', render: (h) => h.usuario_nome || '—' },
        { label: 'Versão', class: 'small', render: (h) => (h.versao_numero ? `v${h.versao_numero}` : '—') },
        { label: 'O que mudou', class: 'small', render: (h) => h.rotulo || h.campo || h.tipo },
        { label: 'Antes', class: 'small pre-line lr-hist-val', render: (h) => showVal(h.valor_anterior) },
        { label: 'Depois', class: 'small pre-line lr-hist-val', render: (h) => showVal(h.valor_novo) }
      ],
      load: (page) => get(`${API}/levantamentos/${s.id}/historico?pagina=${page}`),
      empty: 'Nenhuma alteração registrada.'
    });
    panel.append(el('h2', { class: 'h6 mt-4' }, 'Histórico de alterações'),
      el('p', { class: 'small text-body-secondary' }, 'Edições seguidas do mesmo campo pela mesma pessoa, em poucos minutos, aparecem como uma só alteração.'),
      table.node);
    table.refresh();
  }

  void debounce;
}
