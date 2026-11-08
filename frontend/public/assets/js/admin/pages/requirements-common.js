// Levantamento de Requisitos: utilitários compartilhados pelas telas do módulo.
import { get, post } from '../../shared/api.js';
import { el, badge, date, formModal } from '../../shared/ui.js';

export const API = '/api/admin/requisitos';
export const STATUS_TONE = { em_andamento: 'warning', concluido: 'success', arquivado: 'secondary' };
export const VERSION_TONE = { em_trabalho: 'warning', concluida: 'success' };
export const PROJECT_TONE = { em_descoberta: 'warning', aguardando_detalhamento: 'info', em_especificacao: 'info', em_proposta: 'accent', encerrado: 'secondary' };
export const SELECTION = new Set(['selecao_unica', 'selecao_multipla']);
export const TEXT_TYPES = new Set(['texto_curto', 'texto_longo', 'observacoes']);

let refCache = null;
/** Referência do módulo (rótulos, equipe, clientes/projetos, situação do gerador de PDF). */
export async function reference(force = false) {
  if (!refCache || force) refCache = await get(`${API}/referencia`);
  return refCache;
}
export const invalidateReference = () => { refCache = null; };

export const statusChip = (ref, status) => badge(ref.status[status] || status, STATUS_TONE[status]);
export const versionChip = (ref, status) => badge(ref.versoes[status] || status, VERSION_TONE[status]);
export const projectChip = (ref, situacao) => badge(ref.situacoes[situacao] || situacao, PROJECT_TONE[situacao]);
export const muted = (text) => el('span', { class: 'text-body-secondary' }, text);
export const clientLabel = (c) => (c.empresa ? `${c.nome} · ${c.empresa}` : c.nome);

// A CSP do painel proíbe o atributo style: larguras dinâmicas vão pelo CSSOM.
export function progressBar(value, label = 'Progresso') {
  const bar = el('div', { class: 'progress-bar' });
  bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  return el('div', { class: 'progress lr-bar', role: 'progressbar', 'aria-label': label, 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
}

export function isAnswered(r) {
  return Boolean(r && r.valor && (r.valor.valor !== null && r.valor.valor !== undefined || r.valor.detalhe));
}

/** Texto legível de uma resposta (mesma regra do servidor). */
export function formatAnswer(q, r) {
  if (!isAnswered(r)) return '';
  const { valor, detalhe } = r.valor;
  let main = '';
  if (valor !== null && valor !== undefined) {
    if (q.tipo === 'sim_nao') main = valor === 'sim' ? 'Sim' : 'Não';
    else if (q.tipo === 'selecao_multipla') main = valor.join('; ');
    else if (q.tipo === 'numero') main = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
    else if (q.tipo === 'data') main = date(valor);
    else main = String(valor);
  }
  return [main, detalhe].filter(Boolean).join(main && detalhe ? ' — ' : '');
}

/** Progresso calculado na tela (espelha computeProgress do servidor). */
export function computeProgress(etapas) {
  let total = 0; let respondidas = 0; let puladas = 0;
  const pendentes = [];
  const porEtapa = new Map();
  for (const e of etapas) {
    let r = 0; let p = 0; let o = 0;
    for (const q of e.perguntas) {
      if (isAnswered(q.resposta)) r++;
      else {
        if (q.resposta?.pulada) p++;
        if (q.obrigatoria) { o++; pendentes.push({ id: q.id, etapa_id: e.id, enunciado: q.enunciado }); }
      }
    }
    total += e.perguntas.length; respondidas += r; puladas += p;
    porEtapa.set(e.id, { total: e.perguntas.length, respondidas: r, puladas: p, obrigatorias_pendentes: o });
  }
  return { total, respondidas, puladas, percentual: total ? Math.round((respondidas / total) * 100) : 0, obrigatorias_pendentes: pendentes, porEtapa };
}

/** Campos do cliente/projeto (reutilizados no novo levantamento e nas telas de cliente). */
export const clientFields = (prefix = '') => [
  { name: `${prefix}nome`, label: 'Nome do cliente', col: 6, max: 160 },
  { name: `${prefix}empresa`, label: 'Empresa', col: 6, max: 160 },
  { name: `${prefix}email`, label: 'E-mail', type: 'email', col: 6 },
  { name: `${prefix}telefone`, label: 'Telefone', col: 6, placeholder: '(11) 98888-7777' }
];

class FormError extends Error {
  constructor(fields, message = 'Verifique os campos destacados.') { super(message); this.fields = fields; }
}

/** Mostra/esconde a coluna de um campo do buildForm. */
function toggleField(form, name, show) {
  const input = form.querySelector(`[name="${name}"]`);
  const col = input?.closest('[class*="col-"]');
  if (col) col.classList.toggle('d-none', !show);
}

/**
 * Modal "Novo levantamento": cliente e projeto existentes ou novos, responsável, data e observações.
 * preset: { cliente_id, projeto_id } quando aberto a partir de um cliente ou projeto.
 */
export async function newSurveyModal(ctx, preset = {}) {
  const ref = await reference(true);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const projectsOf = (cid) => ref.projetos.filter((p) => String(p.cliente_id) === String(cid));
  const fields = [
    { type: 'section', label: 'Cliente' },
    { name: 'cliente_id', label: 'Cliente', type: 'select', required: true, options: [['novo', '+ Cadastrar novo cliente'], ...ref.clientes.map((c) => [c.id, clientLabel(c)])] },
    ...clientFields('cli_'),
    { type: 'section', label: 'Projeto ou ideia' },
    { name: 'projeto_id', label: 'Projeto', type: 'select', required: true, options: [['novo', '+ Novo projeto ou ideia']] },
    { name: 'prj_nome', label: 'Nome do projeto ou ideia', max: 200 },
    { name: 'prj_descricao', label: 'Descrição breve', type: 'textarea', rows: 2 },
    { type: 'section', label: 'Reunião' },
    { name: 'responsavel_id', label: 'Responsável pelo levantamento', type: 'select', required: true, col: 6, options: ref.equipe.map((u) => [u.id, u.nome]) },
    { name: 'data_reuniao', label: 'Data da reunião', type: 'date', required: true, col: 6 },
    { name: 'observacoes_iniciais', label: 'Observações iniciais', type: 'textarea', rows: 3, help: 'Contexto da reunião: quem participou, local, combinados prévios.' }
  ];
  const values = {
    cliente_id: preset.cliente_id ?? (ref.clientes.length ? '' : 'novo'),
    projeto_id: preset.projeto_id ?? 'novo',
    responsavel_id: ctx.user.id,
    data_reuniao: iso
  };
  if (!values.cliente_id) values.cliente_id = 'novo';
  const m = formModal({
    title: 'Novo levantamento de requisitos',
    submitLabel: 'Criar e abrir a entrevista',
    fields,
    values,
    onSubmit: async (v) => {
      const body = { responsavel_id: Number(v.responsavel_id), data_reuniao: v.data_reuniao, observacoes_iniciais: v.observacoes_iniciais };
      const errs = {};
      if (v.cliente_id === 'novo') {
        if (!v.cli_nome || v.cli_nome.trim().length < 2) errs.cli_nome = 'Informe o nome do cliente.';
        body.cliente = { nome: v.cli_nome, empresa: v.cli_empresa, email: v.cli_email, telefone: v.cli_telefone };
      } else body.cliente_id = Number(v.cliente_id);
      if (v.projeto_id === 'novo') {
        if (!v.prj_nome || v.prj_nome.trim().length < 2) errs.prj_nome = 'Informe o projeto ou a ideia.';
        body.projeto = { nome: v.prj_nome, descricao: v.prj_descricao };
      } else body.projeto_id = Number(v.projeto_id);
      if (Object.keys(errs).length) throw new FormError(errs);
      try {
        const r = await post(`${API}/levantamentos`, body);
        invalidateReference();
        ctx.navigate(`levantamentos/${r.id}`);
      } catch (err) {
        // Erros dos objetos aninhados chegam com o nome do campo do servidor.
        if (err.fields) {
          const map = { nome: v.cliente_id === 'novo' ? 'cli_nome' : 'prj_nome', email: 'cli_email', telefone: 'cli_telefone', empresa: 'cli_empresa', cliente_nome: 'cli_nome', projeto_nome: 'prj_nome' };
          err.fields = Object.fromEntries(Object.entries(err.fields).map(([k, msg]) => [map[k] || k, msg]));
        }
        throw err;
      }
    }
  });
  const form = m.dialog.querySelector('form');
  const cli = form.querySelector('[name="cliente_id"]');
  const prj = form.querySelector('[name="projeto_id"]');
  function syncClient() {
    const isNew = cli.value === 'novo';
    clientFields('cli_').forEach((f) => toggleField(form, f.name, isNew));
    const keep = prj.value;
    prj.textContent = '';
    prj.append(el('option', { value: 'novo' }, '+ Novo projeto ou ideia'));
    if (!isNew) projectsOf(cli.value).forEach((p) => prj.append(el('option', { value: p.id }, `${p.nome} — ${ref.situacoes[p.situacao]}`)));
    prj.value = [...prj.options].some((o) => o.value === String(keep)) ? String(keep) : (isNew || !projectsOf(cli.value).length ? 'novo' : String(projectsOf(cli.value)[0].id));
    syncProject();
  }
  function syncProject() {
    const isNew = prj.value === 'novo';
    toggleField(form, 'prj_nome', isNew);
    toggleField(form, 'prj_descricao', isNew);
  }
  cli.addEventListener('change', syncClient);
  prj.addEventListener('change', syncProject);
  syncClient();
  if (preset.projeto_id) { prj.value = String(preset.projeto_id); syncProject(); }
  return m;
}

/** Modal "Duplicar": novo levantamento com as mesmas perguntas, sem respostas. */
export async function duplicateModal(ctx, survey) {
  const ref = await reference(true);
  const projetos = ref.projetos.filter((p) => p.cliente_id === survey.cliente_id);
  const m = formModal({
    title: `Duplicar ${survey.codigo}`,
    submitLabel: 'Duplicar',
    size: '',
    fields: [
      { type: 'section', label: 'O novo levantamento terá as mesmas perguntas, sem as respostas.' },
      { name: 'projeto_id', label: 'Projeto', type: 'select', required: true, options: [...projetos.map((p) => [p.id, p.nome]), ['novo', '+ Novo projeto deste cliente']] },
      { name: 'prj_nome', label: 'Nome do novo projeto', max: 200 },
      { name: 'responsavel_id', label: 'Responsável', type: 'select', required: true, col: 6, options: ref.equipe.map((u) => [u.id, u.nome]) },
      { name: 'data_reuniao', label: 'Data da reunião', type: 'date', required: true, col: 6 }
    ],
    values: { projeto_id: survey.projeto_id, responsavel_id: ctx.user.id, data_reuniao: new Date().toISOString().slice(0, 10) },
    onSubmit: async (v) => {
      const body = { responsavel_id: Number(v.responsavel_id), data_reuniao: v.data_reuniao };
      if (v.projeto_id === 'novo') {
        if (!v.prj_nome || v.prj_nome.trim().length < 2) throw new FormError({ prj_nome: 'Informe o nome do projeto.' });
        body.projeto = { nome: v.prj_nome };
      } else body.projeto_id = Number(v.projeto_id);
      const r = await post(`${API}/levantamentos/${survey.id}/duplicar`, body);
      invalidateReference();
      ctx.navigate(`levantamentos/${r.id}`);
    }
  });
  const form = m.dialog.querySelector('form');
  const sel = form?.querySelector('[name="projeto_id"]');
  if (sel) {
    const sync = () => toggleField(form, 'prj_nome', sel.value === 'novo');
    sel.addEventListener('change', sync);
    sync();
  }
}

/** Abre um PDF guardado numa nova aba (a sessão é enviada pelo cookie). */
export const reportUrl = (surveyId, relId, inline = true) => `${API}/levantamentos/${surveyId}/relatorios/${relId}/arquivo${inline ? '?inline=1' : ''}`;
export const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
