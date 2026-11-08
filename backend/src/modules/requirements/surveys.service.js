// Levantamentos de requisitos: criação (com fotografia do roteiro), entrevista, versões, histórico,
// conclusão/reabertura, arquivamento, duplicação, pesquisa e comparação.
//
// Regras centrais
//  - O roteiro do levantamento é uma cópia do banco de perguntas no momento da criação; editar o
//    banco depois não muda nada aqui (lr_roteiro_*, protegido por trigger).
//  - O conteúdo (respostas, notas, 5 porquês, consolidação) pertence a uma versão. Só a versão
//    "em trabalho" aceita alterações; concluir trava a versão (trigger no banco); reabrir cria a
//    versão seguinte a partir da concluída, que permanece intacta.
//  - Toda alteração de conteúdo grava valor anterior e novo em lr_historico, com usuário e data.
//    Edições seguidas do mesmo usuário no mesmo campo (salvamento automático) em até 4 minutos
//    formam um único registro: anterior = antes da primeira edição, novo = último valor.
import { isDeepStrictEqual } from 'node:util';
import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { AppError, conflict, notFound, ValidationError } from '../../utils/errors.js';
import { cleanText, parse, v } from '../../utils/validation.js';
import { likeTerm, pagination, paged } from '../../utils/common.js';
import { nextDocumentNumber } from '../shared/numbering.js';
import { clientSchema, projectSchema, createClient, createProject } from './clients.service.js';
import {
  SURVEY_STATUS, PROJECT_STATUS, VERSION_STATUS, QUESTION_TYPES,
  normalizeAnswer, isAnswered, computeProgress, normalizeWhyLevels, formatAnswer, LIMITS
} from './answers.js';

const COALESCE_MINUTES = 4;
const SPECIAL_KEYS = ['resumo_executivo', 'contexto', 'objetivo'];

const headerSchema = {
  responsavel_id: v.id({ nullable: true }),
  data_reuniao: v.date(),
  observacoes_iniciais: v.text({ max: 10000, nullable: true })
};

// ------------------------------------------------------------------ utilitários
async function staffUser(conn, id) {
  const u = await conn.one("SELECT id, nome FROM usuarios WHERE id = $1 AND tipo = 'equipe' AND ativo", [id]);
  if (!u) throw new ValidationError({ responsavel_id: 'Responsável inválido: escolha um usuário ativo da equipe.' });
  return u;
}

async function lockSurvey(tx, id) {
  const s = await tx.one('SELECT * FROM levantamentos WHERE id = $1 FOR UPDATE', [id]);
  if (!s) throw notFound('Levantamento');
  return s;
}

/** Levantamento editável: em andamento e com versão em trabalho. */
async function workingVersion(tx, id) {
  const s = await lockSurvey(tx, id);
  if (s.status === 'arquivado') throw conflict('Levantamento arquivado. Desarquive-o para editar.');
  if (s.status === 'concluido') throw conflict('Levantamento concluído. Reabra-o para criar uma nova versão de trabalho.');
  const ver = await tx.one("SELECT * FROM lr_versoes WHERE levantamento_id = $1 AND status = 'em_trabalho'", [id]);
  if (!ver) throw conflict('Não há versão em trabalho para este levantamento.');
  return { survey: s, ver };
}

/**
 * Registra uma alteração no histórico. Dentro da janela de edição do mesmo usuário e campo,
 * estende o registro aberto; caso contrário cria um novo.
 */
async function recordChange(tx, req, { levantamentoId, versaoId = null, tipo, referenciaId = null, campo = null, rotulo = null, anterior, novo }) {
  if (isDeepStrictEqual(anterior ?? null, novo ?? null)) return;
  const last = await tx.one(`SELECT id, usuario_id, valor_anterior FROM lr_historico
    WHERE levantamento_id = $1 AND versao_id IS NOT DISTINCT FROM $2 AND tipo = $3 AND referencia_id IS NOT DISTINCT FROM $4 AND campo IS NOT DISTINCT FROM $5
    ORDER BY id DESC LIMIT 1`, [levantamentoId, versaoId, tipo, referenciaId, campo]);
  if (last && last.usuario_id === req.user.id) {
    const recent = await tx.one(`SELECT 1 FROM lr_historico WHERE id = $1 AND atualizado_em > now() - interval '${COALESCE_MINUTES} minutes'`, [last.id]);
    if (recent) {
      await tx.query('UPDATE lr_historico SET valor_novo = $2 WHERE id = $1', [last.id, JSON.stringify(novo ?? null)]);
      return;
    }
  }
  await tx.query(`INSERT INTO lr_historico (levantamento_id, versao_id, tipo, referencia_id, campo, rotulo, valor_anterior, valor_novo, usuario_id, usuario_nome)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [levantamentoId, versaoId, tipo, referenciaId, campo, rotulo ? String(rotulo).slice(0, 500) : null, JSON.stringify(anterior ?? null), JSON.stringify(novo ?? null), req.user.id, req.user.nome]);
}

const answerState = (r) => (r ? { valor: r.valor ?? null, pulada: Boolean(r.pulada) } : null);

// ------------------------------------------------------------------ criação
/** Copia o roteiro ativo do banco de perguntas para o levantamento. */
async function snapshotFromBank(tx, levantamentoId) {
  const etapas = await tx.many('SELECT * FROM lr_etapas WHERE ativa ORDER BY ordem, id');
  const perguntas = await tx.many(`SELECT p.*, c.chave AS categoria_chave, c.titulo AS categoria_titulo FROM lr_perguntas p
    LEFT JOIN lr_categorias c ON c.id = p.categoria_id AND c.ativa WHERE p.ativa ORDER BY p.ordem, p.id`);
  let ordem = 0;
  let total = 0;
  for (const e of etapas) {
    const qs = perguntas.filter((p) => p.etapa_id === e.id);
    if (!qs.length) continue; // etapa sem perguntas ativas não entra no roteiro
    ordem += 1;
    const se = await tx.one('INSERT INTO lr_roteiro_etapas (levantamento_id, ordem, titulo, descricao, origem_etapa_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [levantamentoId, ordem, e.titulo, e.descricao, e.id]);
    for (const [i, q] of qs.entries()) {
      await tx.query(`INSERT INTO lr_roteiro_perguntas (levantamento_id, etapa_id, ordem, origem_pergunta_id, origem_revisao, enunciado, orientacao, tipo, obrigatoria, opcoes, categoria_chave, categoria_titulo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [levantamentoId, se.id, i + 1, q.id, q.revisao, q.enunciado, q.orientacao, q.tipo, q.obrigatoria, JSON.stringify(q.opcoes), q.categoria_chave, q.categoria_titulo]);
      total++;
    }
  }
  if (!total) throw conflict('O banco de perguntas não tem perguntas ativas. Cadastre ou ative perguntas em "Gerenciar perguntas".');
  const categorias = await tx.many('SELECT chave, titulo, descricao FROM lr_categorias WHERE ativa ORDER BY ordem, id');
  await tx.query('UPDATE levantamentos SET categorias = $2 WHERE id = $1', [levantamentoId, JSON.stringify(categorias)]);
}

/** Copia o roteiro de outro levantamento (duplicação): mesmas perguntas e configurações da origem. */
async function snapshotFromSurvey(tx, levantamentoId, origemId) {
  const etapas = await tx.many('SELECT * FROM lr_roteiro_etapas WHERE levantamento_id = $1 ORDER BY ordem', [origemId]);
  const perguntas = await tx.many('SELECT * FROM lr_roteiro_perguntas WHERE levantamento_id = $1 ORDER BY ordem', [origemId]);
  for (const e of etapas) {
    const se = await tx.one('INSERT INTO lr_roteiro_etapas (levantamento_id, ordem, titulo, descricao, origem_etapa_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [levantamentoId, e.ordem, e.titulo, e.descricao, e.origem_etapa_id]);
    for (const q of perguntas.filter((p) => p.etapa_id === e.id)) {
      await tx.query(`INSERT INTO lr_roteiro_perguntas (levantamento_id, etapa_id, ordem, origem_pergunta_id, origem_revisao, enunciado, orientacao, tipo, obrigatoria, opcoes, categoria_chave, categoria_titulo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [levantamentoId, se.id, q.ordem, q.origem_pergunta_id, q.origem_revisao, q.enunciado, q.orientacao, q.tipo, q.obrigatoria, JSON.stringify(q.opcoes), q.categoria_chave, q.categoria_titulo]);
    }
  }
  await tx.query('UPDATE levantamentos SET categorias = (SELECT categorias FROM levantamentos WHERE id = $2) WHERE id = $1', [levantamentoId, origemId]);
}

async function insertSurvey(tx, req, { projetoId, responsavel, dataReuniao, observacoes, origemId = null }) {
  const codigo = await nextDocumentNumber(tx, 'LR');
  const s = await tx.one(`INSERT INTO levantamentos (codigo, projeto_id, responsavel_id, responsavel_nome, data_reuniao, observacoes_iniciais, origem_id, criado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [codigo, projetoId, responsavel.id, responsavel.nome, dataReuniao, observacoes ?? null, origemId, req.user.id]);
  await tx.query('INSERT INTO lr_versoes (levantamento_id, numero, criada_por, criada_por_nome) VALUES ($1, 1, $2, $3)', [s.id, req.user.id, req.user.nome]);
  return s;
}

/**
 * Cria um levantamento. Cliente e projeto podem ser existentes (cliente_id/projeto_id) ou novos
 * (objetos "cliente" e "projeto"); um projeto existente precisa pertencer ao cliente informado.
 */
export async function createSurvey(input = {}, req) {
  const header = parse(headerSchema, input);
  return withTransaction(async (tx) => {
    let clienteId = input.cliente_id ? Number(input.cliente_id) : null;
    if (clienteId) {
      if (!Number.isInteger(clienteId) || !(await tx.one('SELECT 1 FROM lr_clientes WHERE id = $1', [clienteId]))) throw new ValidationError({ cliente_id: 'Cliente inexistente.' });
    } else {
      if (!input.cliente || typeof input.cliente !== 'object') throw new ValidationError({ cliente_nome: 'Informe o cliente.' }, 'Informe o cliente.');
      parse(clientSchema, input.cliente); // valida antes de gravar
      clienteId = (await createClient(input.cliente, req, tx)).id;
    }
    let projetoId = input.projeto_id ? Number(input.projeto_id) : null;
    if (projetoId) {
      const p = Number.isInteger(projetoId) ? await tx.one('SELECT cliente_id FROM lr_projetos WHERE id = $1', [projetoId]) : null;
      if (!p) throw new ValidationError({ projeto_id: 'Projeto inexistente.' });
      if (p.cliente_id !== clienteId) throw new ValidationError({ projeto_id: 'O projeto informado pertence a outro cliente.' });
    } else {
      if (!input.projeto || typeof input.projeto !== 'object') throw new ValidationError({ projeto_nome: 'Informe o projeto ou ideia.' }, 'Informe o projeto ou ideia.');
      parse(projectSchema, input.projeto);
      projetoId = (await createProject(clienteId, input.projeto, req, tx)).id;
    }
    const responsavel = await staffUser(tx, header.responsavel_id ?? req.user.id);
    const s = await insertSurvey(tx, req, { projetoId, responsavel, dataReuniao: header.data_reuniao, observacoes: header.observacoes_iniciais });
    await snapshotFromBank(tx, s.id);
    await audit(req, 'criar', 'levantamento', s.id, { codigo: s.codigo, projeto_id: projetoId, cliente_id: clienteId }, tx);
    return { id: s.id, codigo: s.codigo };
  });
}

/** Novo levantamento independente com as mesmas perguntas da origem; respostas NÃO são copiadas. */
export async function duplicateSurvey(origemId, input = {}, req) {
  const header = parse({ ...headerSchema, data_reuniao: v.date({ optional: true }) }, input);
  return withTransaction(async (tx) => {
    const origem = await tx.one('SELECT l.*, p.cliente_id FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id WHERE l.id = $1', [origemId]);
    if (!origem) throw notFound('Levantamento');
    let projetoId = origem.projeto_id;
    if (input.projeto_id) {
      projetoId = Number(input.projeto_id);
      if (!Number.isInteger(projetoId) || !(await tx.one('SELECT 1 FROM lr_projetos WHERE id = $1', [projetoId]))) throw new ValidationError({ projeto_id: 'Projeto inexistente.' });
    } else if (input.projeto && typeof input.projeto === 'object') {
      projetoId = (await createProject(origem.cliente_id, input.projeto, req, tx)).id;
    }
    const responsavel = await staffUser(tx, header.responsavel_id ?? req.user.id);
    const s = await insertSurvey(tx, req, {
      projetoId, responsavel, dataReuniao: header.data_reuniao || new Date().toISOString().slice(0, 10),
      observacoes: header.observacoes_iniciais ?? null, origemId
    });
    await snapshotFromSurvey(tx, s.id, origemId);
    await audit(req, 'duplicar', 'levantamento', s.id, { origem_id: origemId, origem_codigo: origem.codigo, codigo: s.codigo }, tx);
    return { id: s.id, codigo: s.codigo };
  });
}

// ------------------------------------------------------------------ leitura
const SURVEY_SELECT = `SELECT l.*, p.nome AS projeto_nome, p.descricao AS projeto_descricao, p.situacao AS projeto_situacao, p.cliente_id,
    c.nome AS cliente_nome, c.empresa AS cliente_empresa, c.email AS cliente_email, c.telefone AS cliente_telefone, c.observacoes AS cliente_observacoes,
    o.codigo AS origem_codigo
  FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id JOIN lr_clientes c ON c.id = p.cliente_id
  LEFT JOIN levantamentos o ON o.id = l.origem_id`;

/**
 * Levantamento com o conteúdo de uma versão (padrão: a mais recente).
 * Estrutura usada pela entrevista, pela revisão, pela comparação e pelo relatório.
 */
export async function getSurvey(id, { versao = null, conn = db } = {}) {
  const s = await conn.one(`${SURVEY_SELECT} WHERE l.id = $1`, [id]);
  if (!s) throw notFound('Levantamento');
  const versoes = await conn.many(`SELECT v.id, v.numero, v.status, v.criada_em, v.criada_por_nome, v.concluida_em, v.concluida_por_nome, v.motivo_reabertura, v.atualizado_em,
      (SELECT count(*)::int FROM lr_relatorios r WHERE r.versao_id = v.id) AS relatorios
    FROM lr_versoes v WHERE v.levantamento_id = $1 ORDER BY v.numero DESC`, [id]);
  let ver = versoes[0];
  if (versao !== null && versao !== undefined && versao !== '') {
    ver = versoes.find((x) => x.numero === Number(versao));
    if (!ver) throw notFound('Versão');
  }
  const full = await conn.one('SELECT * FROM lr_versoes WHERE id = $1', [ver.id]);
  const queries = [
    () => conn.many('SELECT * FROM lr_roteiro_etapas WHERE levantamento_id = $1 ORDER BY ordem', [id]),
    () => conn.many('SELECT * FROM lr_roteiro_perguntas WHERE levantamento_id = $1 ORDER BY ordem, id', [id]),
    () => conn.many(`SELECT r.*, u.nome AS atualizado_por_nome FROM lr_respostas r LEFT JOIN usuarios u ON u.id = r.atualizado_por WHERE r.versao_id = $1`, [ver.id]),
    () => conn.many('SELECT * FROM lr_notas_etapa WHERE versao_id = $1', [ver.id]),
    () => conn.many('SELECT * FROM lr_investigacoes WHERE versao_id = $1 ORDER BY ordem, id', [ver.id])
  ];
  // Numa transação (um único cliente) as consultas precisam ser sequenciais.
  const results = [];
  if (conn === db) results.push(...(await Promise.all(queries.map((q) => q()))));
  else for (const q of queries) results.push(await q());
  const [etapas, perguntas, respostas, notas, investigacoes] = results;
  const byQ = new Map(respostas.map((r) => [r.pergunta_id, r]));
  const byE = new Map(notas.map((n) => [n.etapa_id, n]));
  const roteiro = etapas.map((e) => ({
    id: e.id, ordem: e.ordem, titulo: e.titulo, descricao: e.descricao, origem_etapa_id: e.origem_etapa_id,
    nota: byE.get(e.id)?.texto || '',
    perguntas: perguntas.filter((q) => q.etapa_id === e.id).map((q) => {
      const r = byQ.get(q.id);
      return {
        id: q.id, ordem: q.ordem, enunciado: q.enunciado, orientacao: q.orientacao, tipo: q.tipo, obrigatoria: q.obrigatoria, opcoes: q.opcoes,
        categoria_chave: q.categoria_chave, categoria_titulo: q.categoria_titulo, origem_pergunta_id: q.origem_pergunta_id, origem_revisao: q.origem_revisao,
        resposta: r ? { valor: r.valor, pulada: r.pulada, atualizado_em: r.atualizado_em, atualizado_por_nome: r.atualizado_por_nome } : null
      };
    })
  }));
  return {
    ...s,
    versao: { ...ver, consolidacao: full.consolidacao, observacoes_finais: full.observacoes_finais, origem_versao_id: full.origem_versao_id },
    versoes,
    editavel: s.status === 'em_andamento' && ver.status === 'em_trabalho',
    etapas: roteiro,
    investigacoes,
    progresso: computeProgress(roteiro)
  };
}

export async function listSurveys(query = {}) {
  const p = pagination(query, { defaultLimit: 20, maxLimit: 100 });
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace(/\$\?/g, `$${params.length}`)); };
  const status = String(query.status || '');
  if (status === 'todos') { /* sem filtro */ } else if (SURVEY_STATUS[status]) add('l.status = $?', status);
  else where.push("l.status <> 'arquivado'");
  const intId = (x) => (Number.isInteger(Number(x)) && Number(x) > 0 ? Number(x) : null);
  if (intId(query.cliente_id)) add('p.cliente_id = $?', intId(query.cliente_id));
  if (intId(query.projeto_id)) add('l.projeto_id = $?', intId(query.projeto_id));
  if (intId(query.responsavel_id)) add('l.responsavel_id = $?', intId(query.responsavel_id));
  const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) && !Number.isNaN(Date.parse(x));
  if (isDate(query.de)) add('l.data_reuniao >= $?', query.de);
  if (isDate(query.ate)) add('l.data_reuniao <= $?', query.ate);
  if (query.busca && String(query.busca).trim()) {
    add(`(l.codigo ILIKE $? OR c.nome ILIKE $? OR c.empresa ILIKE $? OR p.nome ILIKE $? OR l.responsavel_nome ILIKE $? OR l.observacoes_iniciais ILIKE $?
      OR EXISTS (SELECT 1 FROM lr_versoes v JOIN lr_respostas r ON r.versao_id = v.id WHERE v.levantamento_id = l.id AND r.valor::text ILIKE $?)
      OR EXISTS (SELECT 1 FROM lr_versoes v JOIN lr_notas_etapa n ON n.versao_id = v.id WHERE v.levantamento_id = l.id AND n.texto ILIKE $?)
      OR EXISTS (SELECT 1 FROM lr_versoes v JOIN lr_investigacoes i ON i.versao_id = v.id WHERE v.levantamento_id = l.id AND (i.problema ILIKE $? OR i.causa ILIKE $?)))`,
    likeTerm(String(query.busca).trim().slice(0, 100)));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM levantamentos l JOIN lr_projetos p ON p.id = l.projeto_id JOIN lr_clientes c ON c.id = p.cliente_id';
  const { total } = await db.one(`SELECT count(*)::int AS total ${from} ${whereSql}`, params);
  const rows = await db.many(`SELECT l.id, l.codigo, l.status, l.data_reuniao, l.responsavel_nome, l.criado_em, l.atualizado_em, l.origem_id,
      p.id AS projeto_id, p.nome AS projeto_nome, c.id AS cliente_id, c.nome AS cliente_nome, c.empresa AS cliente_empresa,
      v.numero AS versao, v.status AS versao_status,
      (SELECT count(*)::int FROM lr_roteiro_perguntas q WHERE q.levantamento_id = l.id) AS perguntas,
      (SELECT count(*)::int FROM lr_respostas r WHERE r.versao_id = v.id AND r.valor IS NOT NULL) AS respondidas,
      (SELECT count(*)::int FROM lr_relatorios r WHERE r.levantamento_id = l.id) AS relatorios
    ${from} JOIN LATERAL (SELECT id, numero, status FROM lr_versoes WHERE levantamento_id = l.id ORDER BY numero DESC LIMIT 1) v ON true
    ${whereSql} ORDER BY l.data_reuniao DESC, l.id DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

/** Indicadores da visão geral. */
export async function overview() {
  const k = await db.one(`SELECT
      (SELECT count(*)::int FROM lr_clientes) AS clientes,
      (SELECT count(*)::int FROM lr_projetos) AS projetos,
      (SELECT count(*)::int FROM levantamentos WHERE status = 'em_andamento') AS em_andamento,
      (SELECT count(*)::int FROM levantamentos WHERE status = 'concluido') AS concluidos,
      (SELECT count(*)::int FROM levantamentos WHERE status = 'arquivado') AS arquivados,
      (SELECT count(*)::int FROM lr_projetos WHERE situacao = 'aguardando_detalhamento') AS aguardando_detalhamento`);
  const ultimos = (await listSurveys({ status: 'todos', limite: 5 })).items;
  return { indicadores: k, ultimos };
}

export function reference() {
  return { status: SURVEY_STATUS, versoes: VERSION_STATUS, situacoes: PROJECT_STATUS, tipos: QUESTION_TYPES, limites: LIMITS };
}

// ------------------------------------------------------------------ edição da entrevista
export async function updateHeader(id, input, req) {
  const value = parse(headerSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const { survey: s, ver } = await workingVersion(tx, id);
    const changes = {};
    if ('responsavel_id' in value) {
      const u = await staffUser(tx, value.responsavel_id ?? req.user.id);
      changes.responsavel_id = u.id;
      changes.responsavel_nome = u.nome;
    }
    if ('data_reuniao' in value) changes.data_reuniao = value.data_reuniao;
    if ('observacoes_iniciais' in value) changes.observacoes_iniciais = value.observacoes_iniciais;
    const keys = Object.keys(changes).filter((k) => !isDeepStrictEqual(s[k], changes[k]));
    if (!keys.length) return { ok: true };
    await tx.query(`UPDATE levantamentos SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => changes[k])]);
    for (const k of keys.filter((x) => x !== 'responsavel_id')) {
      await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'dados', campo: k, rotulo: { responsavel_nome: 'Responsável', data_reuniao: 'Data da reunião', observacoes_iniciais: 'Observações iniciais' }[k], anterior: s[k], novo: changes[k] });
    }
    await audit(req, 'editar', 'levantamento', id, Object.fromEntries(keys.map((k) => [k, changes[k]])), tx);
    return { ok: true };
  });
}

export async function savePosition(id, input) {
  const etapa = Number(input?.etapa_atual);
  if (!Number.isInteger(etapa) || etapa < 0 || etapa > 1000) throw new ValidationError({ etapa_atual: 'Posição inválida.' });
  const r = await db.query("UPDATE levantamentos SET etapa_atual = $2 WHERE id = $1 AND status = 'em_andamento'", [id, etapa]);
  if (!r.rowCount && !(await db.one('SELECT 1 FROM levantamentos WHERE id = $1', [id]))) throw notFound('Levantamento');
  return { ok: true };
}

export async function saveAnswer(id, perguntaId, input, req) {
  return withTransaction(async (tx) => {
    const { ver } = await workingVersion(tx, id);
    const q = await tx.one('SELECT * FROM lr_roteiro_perguntas WHERE id = $1 AND levantamento_id = $2', [perguntaId, id]);
    if (!q) throw notFound('Pergunta');
    const next = normalizeAnswer(q, input);
    const cur = await tx.one('SELECT * FROM lr_respostas WHERE versao_id = $1 AND pergunta_id = $2 FOR UPDATE', [ver.id, perguntaId]);
    const before = answerState(cur);
    const after = next.valor === null && !next.pulada ? null : { valor: next.valor, pulada: next.pulada };
    if (!isDeepStrictEqual(before, after)) {
      if (after === null) await tx.query('DELETE FROM lr_respostas WHERE versao_id = $1 AND pergunta_id = $2', [ver.id, perguntaId]);
      else {
        await tx.query(`INSERT INTO lr_respostas (versao_id, pergunta_id, valor, pulada, atualizado_por, atualizado_em) VALUES ($1,$2,$3,$4,$5,now())
          ON CONFLICT (versao_id, pergunta_id) DO UPDATE SET valor = EXCLUDED.valor, pulada = EXCLUDED.pulada, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
        [ver.id, perguntaId, after.valor === null ? null : JSON.stringify(after.valor), after.pulada, req.user.id]);
      }
      await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'resposta', referenciaId: perguntaId, rotulo: q.enunciado, anterior: before, novo: after });
      await tx.query('UPDATE levantamentos SET atualizado_em = now() WHERE id = $1', [id]);
    }
    const resposta = after ? { ...after, atualizado_em: new Date().toISOString() } : null;
    return { pergunta_id: perguntaId, resposta, respondida: isAnswered(resposta), salvo_em: new Date().toISOString() };
  });
}

export async function saveStageNote(id, etapaId, input, req) {
  const texto = input?.texto === null || input?.texto === undefined ? '' : cleanText(String(input.texto), { multiline: true });
  if (texto.length > LIMITS.textoLongo) throw new ValidationError({ texto: 'Observação muito longa.' });
  return withTransaction(async (tx) => {
    const { ver } = await workingVersion(tx, id);
    const e = await tx.one('SELECT * FROM lr_roteiro_etapas WHERE id = $1 AND levantamento_id = $2', [etapaId, id]);
    if (!e) throw notFound('Etapa');
    const cur = await tx.one('SELECT texto FROM lr_notas_etapa WHERE versao_id = $1 AND etapa_id = $2 FOR UPDATE', [ver.id, etapaId]);
    const before = cur?.texto || '';
    if (before !== texto) {
      if (!texto) await tx.query('DELETE FROM lr_notas_etapa WHERE versao_id = $1 AND etapa_id = $2', [ver.id, etapaId]);
      else {
        await tx.query(`INSERT INTO lr_notas_etapa (versao_id, etapa_id, texto, atualizado_por) VALUES ($1,$2,$3,$4)
          ON CONFLICT (versao_id, etapa_id) DO UPDATE SET texto = EXCLUDED.texto, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`, [ver.id, etapaId, texto, req.user.id]);
      }
      await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'nota_etapa', referenciaId: etapaId, rotulo: `Observações — ${e.titulo}`, anterior: before || null, novo: texto || null });
    }
    return { ok: true, salvo_em: new Date().toISOString() };
  });
}

// ------------------------------------------------------------------ 5 porquês
const investigationSchema = {
  problema: v.text({ min: 3, max: 2000 }),
  causa: v.text({ max: 5000, nullable: true }),
  observacoes: v.text({ max: 5000, nullable: true }),
  niveis: (raw) => ({ value: raw })
};
const invState = (i) => (i ? { problema: i.problema, niveis: i.niveis, causa: i.causa, observacoes: i.observacoes } : null);

export async function createInvestigation(id, input, req) {
  const value = parse(investigationSchema, input);
  value.niveis = normalizeWhyLevels(value.niveis);
  return withTransaction(async (tx) => {
    const { ver } = await workingVersion(tx, id);
    const { n } = await tx.one('SELECT count(*)::int AS n FROM lr_investigacoes WHERE versao_id = $1', [ver.id]);
    if (n >= 30) throw conflict('Limite de investigações por levantamento atingido.');
    const row = await tx.one(`INSERT INTO lr_investigacoes (versao_id, ordem, problema, niveis, causa, observacoes, criado_por, atualizado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [ver.id, (n + 1) * 10, value.problema, JSON.stringify(value.niveis), value.causa ?? null, value.observacoes ?? null, req.user.id]);
    await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'investigacao', referenciaId: row.id, rotulo: `5 porquês — ${value.problema.slice(0, 200)}`, anterior: null, novo: invState(row) });
    return row;
  });
}

export async function updateInvestigation(id, invId, input, req) {
  const value = parse(investigationSchema, input, { partial: true });
  if ('niveis' in value) value.niveis = normalizeWhyLevels(value.niveis);
  return withTransaction(async (tx) => {
    const { ver } = await workingVersion(tx, id);
    const cur = await tx.one('SELECT * FROM lr_investigacoes WHERE id = $1 AND versao_id = $2 FOR UPDATE', [invId, ver.id]);
    if (!cur) throw notFound('Investigação');
    const n = { ...cur, ...value };
    const row = await tx.one('UPDATE lr_investigacoes SET problema = $2, niveis = $3, causa = $4, observacoes = $5, atualizado_por = $6, atualizado_em = now() WHERE id = $1 RETURNING *',
      [invId, n.problema, JSON.stringify(n.niveis), n.causa, n.observacoes, req.user.id]);
    await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'investigacao', referenciaId: invId, rotulo: `5 porquês — ${n.problema.slice(0, 200)}`, anterior: invState(cur), novo: invState(row) });
    return row;
  });
}

export async function deleteInvestigation(id, invId, req) {
  return withTransaction(async (tx) => {
    const { ver } = await workingVersion(tx, id);
    const cur = await tx.one('SELECT * FROM lr_investigacoes WHERE id = $1 AND versao_id = $2 FOR UPDATE', [invId, ver.id]);
    if (!cur) throw notFound('Investigação');
    await tx.query('DELETE FROM lr_investigacoes WHERE id = $1', [invId]);
    // Grava um registro novo (não estende a sessão): a remoção fica sempre explícita no histórico.
    await tx.query(`INSERT INTO lr_historico (levantamento_id, versao_id, tipo, referencia_id, rotulo, valor_anterior, valor_novo, usuario_id, usuario_nome)
      VALUES ($1,$2,'investigacao',$3,$4,$5,'null',$6,$7)`, [id, ver.id, invId, `5 porquês removido — ${cur.problema.slice(0, 200)}`, JSON.stringify(invState(cur)), req.user.id, req.user.nome]);
  });
}

// ------------------------------------------------------------------ consolidação (revisão)
export async function saveConsolidation(id, input = {}, req) {
  return withTransaction(async (tx) => {
    const { survey: s, ver } = await workingVersion(tx, id);
    const allowed = new Set([...SPECIAL_KEYS, ...(s.categorias || []).map((c) => c.chave)]);
    const next = { ...(ver.consolidacao || {}) };
    const changed = [];
    for (const [k, raw] of Object.entries(input.consolidacao || {})) {
      if (!allowed.has(k)) throw new ValidationError({ [k]: 'Campo de consolidação desconhecido.' });
      const texto = raw === null || raw === undefined ? '' : cleanText(String(raw), { multiline: true });
      if (texto.length > LIMITS.textoLongo) throw new ValidationError({ [k]: 'Texto muito longo.' });
      if ((next[k] || '') !== texto) { changed.push([k, next[k] || null, texto || null]); if (texto) next[k] = texto; else delete next[k]; }
    }
    let obs = ver.observacoes_finais;
    if ('observacoes_finais' in input) {
      const t = input.observacoes_finais === null ? '' : cleanText(String(input.observacoes_finais), { multiline: true });
      if (t.length > LIMITS.textoLongo) throw new ValidationError({ observacoes_finais: 'Texto muito longo.' });
      if ((obs || '') !== t) { changed.push(['observacoes_finais', obs || null, t || null]); obs = t || null; }
    }
    if (!changed.length) return { ok: true };
    await tx.query('UPDATE lr_versoes SET consolidacao = $2, observacoes_finais = $3 WHERE id = $1', [ver.id, JSON.stringify(next), obs]);
    const titles = Object.fromEntries((s.categorias || []).map((c) => [c.chave, c.titulo]));
    const label = { resumo_executivo: 'Resumo executivo', contexto: 'Contextualização da ideia', objetivo: 'Objetivo inicial', observacoes_finais: 'Observações finais', ...titles };
    for (const [k, a, b] of changed) await recordChange(tx, req, { levantamentoId: id, versaoId: ver.id, tipo: 'consolidacao', campo: k, rotulo: label[k] || k, anterior: a, novo: b });
    return { ok: true, salvo_em: new Date().toISOString() };
  });
}

// ------------------------------------------------------------------ ciclo de vida
export async function concludeSurvey(id, req) {
  return withTransaction(async (tx) => {
    const { survey: s, ver } = await workingVersion(tx, id);
    const data = await getSurvey(id, { conn: tx });
    if (data.progresso.obrigatorias_pendentes.length) {
      const list = data.progresso.obrigatorias_pendentes;
      throw new AppError(`Responda as perguntas obrigatórias antes de concluir (${list.length} pendente${list.length > 1 ? 's' : ''}).`,
        { status: 422, code: 'OBRIGATORIAS_PENDENTES', details: { pendentes: list } });
    }
    await tx.query("UPDATE lr_versoes SET status = 'concluida', concluida_por = $2, concluida_por_nome = $3, concluida_em = now() WHERE id = $1", [ver.id, req.user.id, req.user.nome]);
    await tx.query("UPDATE levantamentos SET status = 'concluido', concluido_em = now() WHERE id = $1", [id]);
    // Projeto passa a aguardar detalhamento quando a primeira descoberta é concluída.
    await tx.query("UPDATE lr_projetos SET situacao = 'aguardando_detalhamento' WHERE id = $1 AND situacao = 'em_descoberta'", [s.projeto_id]);
    await tx.query(`INSERT INTO lr_historico (levantamento_id, versao_id, tipo, campo, rotulo, valor_anterior, valor_novo, usuario_id, usuario_nome)
      VALUES ($1,$2,'dados','status','Conclusão',$3,$4,$5,$6)`,
    [id, ver.id, JSON.stringify({ status: 'em_andamento', versao: ver.numero }), JSON.stringify({ status: 'concluido', versao: ver.numero }), req.user.id, req.user.nome]);
    await audit(req, 'concluir', 'levantamento', id, { codigo: s.codigo, versao: ver.numero, respondidas: data.progresso.respondidas, total: data.progresso.total }, tx);
    return { ok: true, versao: ver.numero };
  });
}

/** Reabre: cria a versão seguinte (em trabalho) copiando a concluída, que fica preservada. */
export async function reopenSurvey(id, input = {}, req) {
  const { motivo } = parse({ motivo: v.text({ min: 5, max: 1000 }) }, input);
  return withTransaction(async (tx) => {
    const s = await lockSurvey(tx, id);
    if (s.status !== 'concluido') throw conflict('Somente levantamentos concluídos podem ser reabertos.');
    const last = await tx.one("SELECT * FROM lr_versoes WHERE levantamento_id = $1 ORDER BY numero DESC LIMIT 1", [id]);
    const nv = await tx.one(`INSERT INTO lr_versoes (levantamento_id, numero, consolidacao, observacoes_finais, origem_versao_id, motivo_reabertura, criada_por, criada_por_nome)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [id, last.numero + 1, JSON.stringify(last.consolidacao || {}), last.observacoes_finais, last.id, motivo, req.user.id, req.user.nome]);
    await tx.query('INSERT INTO lr_respostas (versao_id, pergunta_id, valor, pulada, atualizado_por, atualizado_em) SELECT $2, pergunta_id, valor, pulada, atualizado_por, atualizado_em FROM lr_respostas WHERE versao_id = $1', [last.id, nv.id]);
    await tx.query('INSERT INTO lr_notas_etapa (versao_id, etapa_id, texto, atualizado_por, atualizado_em) SELECT $2, etapa_id, texto, atualizado_por, atualizado_em FROM lr_notas_etapa WHERE versao_id = $1', [last.id, nv.id]);
    await tx.query(`INSERT INTO lr_investigacoes (versao_id, ordem, problema, niveis, causa, observacoes, criado_por, atualizado_por, criado_em, atualizado_em)
      SELECT $2, ordem, problema, niveis, causa, observacoes, criado_por, atualizado_por, criado_em, atualizado_em FROM lr_investigacoes WHERE versao_id = $1 ORDER BY ordem, id`, [last.id, nv.id]);
    await tx.query("UPDATE levantamentos SET status = 'em_andamento', concluido_em = NULL WHERE id = $1", [id]);
    await tx.query(`INSERT INTO lr_historico (levantamento_id, versao_id, tipo, campo, rotulo, valor_anterior, valor_novo, usuario_id, usuario_nome)
      VALUES ($1,$2,'dados','status','Reabertura',$3,$4,$5,$6)`,
    [id, nv.id, JSON.stringify({ status: 'concluido', versao: last.numero }), JSON.stringify({ status: 'em_andamento', versao: nv.numero, motivo }), req.user.id, req.user.nome]);
    await audit(req, 'reabrir', 'levantamento', id, { codigo: s.codigo, versao_concluida: last.numero, nova_versao: nv.numero, motivo }, tx);
    return { ok: true, versao: nv.numero };
  });
}

export async function archiveSurvey(id, req) {
  return withTransaction(async (tx) => {
    const s = await lockSurvey(tx, id);
    if (s.status === 'arquivado') throw conflict('Levantamento já arquivado.');
    await tx.query("UPDATE levantamentos SET status = 'arquivado', status_anterior = $2, arquivado_em = now() WHERE id = $1", [id, s.status]);
    await audit(req, 'arquivar', 'levantamento', id, { codigo: s.codigo, status_anterior: s.status }, tx);
    return { ok: true };
  });
}

export async function unarchiveSurvey(id, req) {
  return withTransaction(async (tx) => {
    const s = await lockSurvey(tx, id);
    if (s.status !== 'arquivado') throw conflict('O levantamento não está arquivado.');
    const back = s.status_anterior || 'em_andamento';
    await tx.query('UPDATE levantamentos SET status = $2, status_anterior = NULL, arquivado_em = NULL WHERE id = $1', [id, back]);
    await audit(req, 'desarquivar', 'levantamento', id, { codigo: s.codigo, status: back }, tx);
    return { ok: true };
  });
}

// ------------------------------------------------------------------ histórico e comparação
export async function getHistory(id, query = {}) {
  if (!(await db.one('SELECT 1 FROM levantamentos WHERE id = $1', [id]))) throw notFound('Levantamento');
  const p = pagination(query, { defaultLimit: 50, maxLimit: 200 });
  const { total } = await db.one('SELECT count(*)::int AS total FROM lr_historico WHERE levantamento_id = $1', [id]);
  const rows = await db.many(`SELECT h.*, v.numero AS versao_numero FROM lr_historico h LEFT JOIN lr_versoes v ON v.id = h.versao_id
    WHERE h.levantamento_id = $1 ORDER BY h.criado_em DESC, h.id DESC LIMIT ${p.limit} OFFSET ${p.offset}`, [id]);
  const auditoria = await db.many(`SELECT usuario_nome, acao, detalhes, criado_em FROM auditoria WHERE entidade = 'levantamento' AND entidade_id = $1 ORDER BY criado_em DESC, id DESC LIMIT 100`, [String(id)]);
  return { ...paged(rows, total, p), auditoria };
}

/** Compara duas entrevistas (ou duas versões) pergunta a pergunta. Formato de cada lado: "id" ou "id:versão". */
export async function compare(aRef, bRef) {
  const parseRef = (ref, label) => {
    const m = /^(\d{1,9})(?::(\d{1,6}))?$/.exec(String(ref || ''));
    if (!m) throw new ValidationError({ [label]: 'Referência inválida.' }, 'Referência de comparação inválida.');
    return { id: Number(m[1]), versao: m[2] ? Number(m[2]) : null };
  };
  const ra = parseRef(aRef, 'a');
  const rb = parseRef(bRef, 'b');
  const [A, B] = await Promise.all([getSurvey(ra.id, { versao: ra.versao }), getSurvey(rb.id, { versao: rb.versao })]);
  const keyOf = (q) => (q.origem_pergunta_id ? `o${q.origem_pergunta_id}` : `t${q.enunciado.toLowerCase()}`);
  const flat = (S) => S.etapas.flatMap((e) => e.perguntas.map((q) => ({ etapa: e.titulo, q })));
  const mapB = new Map(flat(B).map((x) => [keyOf(x.q), x]));
  const linhas = [];
  for (const x of flat(A)) {
    const y = mapB.get(keyOf(x.q));
    mapB.delete(keyOf(x.q));
    const a = formatAnswer(x.q, x.q.resposta);
    const b = y ? formatAnswer(y.q, y.q.resposta) : null;
    linhas.push({ etapa: x.etapa, enunciado: x.q.enunciado, enunciado_b: y && y.q.enunciado !== x.q.enunciado ? y.q.enunciado : null, a, b, somente_em: y ? null : 'a', diferente: !y || a !== b });
  }
  for (const y of mapB.values()) linhas.push({ etapa: y.etapa, enunciado: y.q.enunciado, a: null, b: formatAnswer(y.q, y.q.resposta), somente_em: 'b', diferente: true });
  const head = (S) => ({ id: S.id, codigo: S.codigo, versao: S.versao.numero, versao_status: S.versao.status, data_reuniao: S.data_reuniao, cliente_nome: S.cliente_nome, projeto_nome: S.projeto_nome, responsavel_nome: S.responsavel_nome });
  return { a: head(A), b: head(B), linhas, diferencas: linhas.filter((l) => l.diferente).length };
}
