// Regras puras do Levantamento de Requisitos: tipos de resposta, validação, formatação e progresso.
// Sem acesso a banco — usado pelo serviço, pelo relatório e pelos testes unitários.
import { cleanText } from '../../utils/validation.js';
import { ValidationError } from '../../utils/errors.js';

export const QUESTION_TYPES = Object.freeze({
  texto_curto: 'Texto curto',
  texto_longo: 'Texto longo',
  sim_nao: 'Sim ou não',
  selecao_unica: 'Seleção única',
  selecao_multipla: 'Seleção múltipla',
  numero: 'Número',
  data: 'Data',
  observacoes: 'Campo de observações'
});

export const SURVEY_STATUS = Object.freeze({ em_andamento: 'Em andamento', concluido: 'Concluído', arquivado: 'Arquivado' });
export const VERSION_STATUS = Object.freeze({ em_trabalho: 'Em trabalho', concluida: 'Concluída' });
export const PROJECT_STATUS = Object.freeze({
  em_descoberta: 'Em descoberta',
  aguardando_detalhamento: 'Aguardando detalhamento',
  em_especificacao: 'Em especificação',
  em_proposta: 'Em proposta',
  encerrado: 'Encerrado'
});

export const SELECTION_TYPES = new Set(['selecao_unica', 'selecao_multipla']);
const TEXT_TYPES = new Set(['texto_curto', 'texto_longo', 'observacoes']);

export const LIMITS = Object.freeze({ textoCurto: 500, textoLongo: 20000, detalhe: 5000, opcoes: 30, opcao: 200, niveis: 5 });

/** Normaliza e valida a lista de alternativas de uma pergunta de seleção. */
export function normalizeOptions(tipo, raw) {
  if (!SELECTION_TYPES.has(tipo)) return [];
  if (!Array.isArray(raw)) throw new ValidationError({ opcoes: 'Informe as alternativas.' });
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const s = cleanText(item);
    if (!s) continue;
    if (s.length > LIMITS.opcao) throw new ValidationError({ opcoes: `Cada alternativa pode ter até ${LIMITS.opcao} caracteres.` });
    const key = s.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) throw new ValidationError({ opcoes: `Alternativa repetida: "${s}".` });
    seen.add(key);
    out.push(s);
  }
  if (out.length < 2) throw new ValidationError({ opcoes: 'Perguntas de seleção precisam de ao menos duas alternativas.' });
  if (out.length > LIMITS.opcoes) throw new ValidationError({ opcoes: `Máximo de ${LIMITS.opcoes} alternativas.` });
  return out;
}

const fail = (msg) => { throw new ValidationError({ valor: msg }, msg); };

function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(/\s/g, '');
  if (!s) return null;
  // Aceita "1.234,5" (pt-BR) e "1234.5".
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Converte o que veio da tela em { valor, pulada } para gravar.
 *   valor: null (sem resposta) ou { valor: <conforme o tipo>, detalhe: string|null }
 * Pular uma pergunta descarta a resposta (fica registrada como "pulada").
 */
export function normalizeAnswer(question, input = {}) {
  if (input === null || typeof input !== 'object') fail('Resposta inválida.');
  if (input.pulada === true) return { valor: null, pulada: true };
  const { tipo } = question;
  const raw = input.valor;
  let valor = null;
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && !raw.length);

  if (!empty) {
    switch (tipo) {
      case 'texto_curto': {
        if (typeof raw !== 'string' && typeof raw !== 'number') fail('Texto inválido.');
        valor = cleanText(raw);
        if (valor.length > LIMITS.textoCurto) fail(`Use no máximo ${LIMITS.textoCurto} caracteres.`);
        break;
      }
      case 'texto_longo':
      case 'observacoes': {
        if (typeof raw !== 'string') fail('Texto inválido.');
        valor = cleanText(raw, { multiline: true });
        if (valor.length > LIMITS.textoLongo) fail(`Use no máximo ${LIMITS.textoLongo.toLocaleString('pt-BR')} caracteres.`);
        break;
      }
      case 'sim_nao': {
        const s = String(raw).toLowerCase();
        if (!['sim', 'nao'].includes(s)) fail('Responda com "sim" ou "não".');
        valor = s;
        break;
      }
      case 'selecao_unica': {
        const s = cleanText(raw);
        if (!question.opcoes.includes(s)) fail('Alternativa inexistente para esta pergunta.');
        valor = s;
        break;
      }
      case 'selecao_multipla': {
        if (!Array.isArray(raw)) fail('Lista de alternativas inválida.');
        const chosen = new Set(raw.map((x) => cleanText(String(x))));
        for (const c of chosen) if (!question.opcoes.includes(c)) fail(`Alternativa inexistente para esta pergunta: "${c}".`);
        valor = question.opcoes.filter((o) => chosen.has(o)); // ordem das alternativas
        break;
      }
      case 'numero': {
        const n = parseNumber(raw);
        if (n === null) break;
        if (!Number.isFinite(n) || Math.abs(n) >= 1e12) fail('Informe um número válido.');
        valor = n;
        break;
      }
      case 'data': {
        const s = cleanText(raw);
        const d = new Date(`${s}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail('Data inválida (use AAAA-MM-DD).');
        valor = s;
        break;
      }
      default:
        fail('Tipo de pergunta desconhecido.');
    }
  }

  let detalhe = null;
  if (!TEXT_TYPES.has(tipo) && input.detalhe !== undefined && input.detalhe !== null) {
    if (typeof input.detalhe !== 'string') fail('Complemento inválido.');
    detalhe = cleanText(input.detalhe, { multiline: true }) || null;
    if (detalhe && detalhe.length > LIMITS.detalhe) fail(`O complemento pode ter até ${LIMITS.detalhe} caracteres.`);
  }
  if (valor === null && detalhe === null) return { valor: null, pulada: false };
  return { valor: { valor, detalhe }, pulada: false };
}

export const isAnswered = (resposta) => Boolean(resposta && resposta.valor && (resposta.valor.valor !== null || resposta.valor.detalhe));

const fmtDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('/') : s);
const fmtNumber = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 6 });

/** Texto legível da resposta (para relatório, histórico e comparação). */
export function formatAnswer(question, resposta) {
  if (!isAnswered(resposta)) return '';
  const { valor, detalhe } = resposta.valor;
  let main = '';
  if (valor !== null && valor !== undefined) {
    switch (question.tipo) {
      case 'sim_nao': main = valor === 'sim' ? 'Sim' : 'Não'; break;
      case 'selecao_multipla': main = valor.join('; '); break;
      case 'numero': main = fmtNumber(valor); break;
      case 'data': main = fmtDate(valor); break;
      default: main = String(valor);
    }
  }
  return [main, detalhe].filter(Boolean).join(main && detalhe ? ' — ' : '');
}

/** Progresso por etapa e geral a partir do roteiro com respostas. */
export function computeProgress(etapas) {
  let total = 0;
  let respondidas = 0;
  let puladas = 0;
  const obrigatoriasPendentes = [];
  const porEtapa = etapas.map((e) => {
    let r = 0;
    let p = 0;
    for (const q of e.perguntas) {
      if (isAnswered(q.resposta)) r++;
      else {
        if (q.resposta?.pulada) p++;
        if (q.obrigatoria) obrigatoriasPendentes.push({ id: q.id, etapa_id: e.id, enunciado: q.enunciado });
      }
    }
    total += e.perguntas.length;
    respondidas += r;
    puladas += p;
    return { etapa_id: e.id, total: e.perguntas.length, respondidas: r, puladas: p, obrigatorias_pendentes: e.perguntas.filter((q) => q.obrigatoria && !isAnswered(q.resposta)).length };
  });
  return { total, respondidas, puladas, percentual: total ? Math.round((respondidas / total) * 100) : 0, obrigatorias_pendentes: obrigatoriasPendentes, etapas: porEtapa };
}

/** Normaliza os níveis dos 5 porquês: até 5, cada um com pergunta e resposta. */
export function normalizeWhyLevels(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError({ niveis: 'Níveis inválidos.' });
  if (raw.length > LIMITS.niveis) throw new ValidationError({ niveis: `A investigação admite no máximo ${LIMITS.niveis} porquês.` });
  return raw.map((n, i) => {
    if (!n || typeof n !== 'object') throw new ValidationError({ niveis: `Nível ${i + 1} inválido.` });
    const pergunta = cleanText(n.pergunta ?? '', { multiline: true }).slice(0, 1000);
    const resposta = cleanText(n.resposta ?? '', { multiline: true });
    if (resposta.length > LIMITS.detalhe) throw new ValidationError({ niveis: `Resposta do nível ${i + 1} muito longa.` });
    return { pergunta: pergunta || `Por que ${i === 0 ? 'isso acontece' : 'isso ocorre'}?`, resposta };
  });
}

/** Nome de arquivo padronizado: levantamento-requisitos-<cliente>-<projeto>[-v<versão>].pdf */
export function reportFileName(cliente, projeto, versao) {
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  const parts = ['levantamento-requisitos', slug(cliente) || 'cliente', slug(projeto) || 'projeto'];
  if (versao && versao > 1) parts.push(`v${versao}`);
  return `${parts.join('-')}.pdf`;
}
