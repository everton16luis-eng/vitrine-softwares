// Implantações: criação, informações do cliente, linha do tempo, fila de tarefas,
// logs e entrega. O painel NUNCA executa nada no servidor: ele só registra tarefas
// que o agente (backend/src/agent) consome.
import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { AppError, ValidationError, conflict, notFound, forbidden } from '../../utils/errors.js';
import { can, isAdmin } from '../../middlewares/auth.js';
import { parse, v, cleanText } from '../../utils/validation.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { nextDocumentNumber } from '../shared/numbering.js';
import { PolicyError, assertSlug, normalizeDomain, PORT_MIN, PORT_MAX, resourcesFor, TECNOLOGIAS } from './policy.js';
import { ETAPAS, DEPLOYMENT_STATUS, PASSO_ROTULO, stepsFor } from './steps.js';
import { encrypt } from './secrets.js';
import { FIELD_TYPES, FIELD_OWNERS } from './recipes.service.js';

const PORT_LOCK = 727_002;
const ACTIVE_TASK = "status IN ('pendente','executando')";
const CLOSED = ['entregue', 'cancelada'];

const slugify = (s, max) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

export async function addLog(conn, implantacaoId, nivel, mensagem, { tarefaId = null, passo = null } = {}) {
  await conn.query('INSERT INTO implantacao_logs (implantacao_id, tarefa_id, passo, nivel, mensagem) VALUES ($1,$2,$3,$4,$5)',
    [implantacaoId, tarefaId, passo, nivel, String(mensagem).slice(0, 20000)]);
}

export async function setEtapa(conn, implantacaoId, etapa, status, detalhe = null) {
  await conn.query('UPDATE implantacao_etapas SET status = $3, detalhe = $4, atualizado_em = now() WHERE implantacao_id = $1 AND etapa = $2',
    [implantacaoId, etapa, status, detalhe]);
}

// ------------------------------------------------------------------ dados do cliente
function resolveAuto(token, { cliente, produto, dominio }) {
  return String(token).replace(/\{(cliente\.(?:nome|empresa|email|telefone)|dominio|produto\.nome)\}/g, (_, k) => {
    if (k === 'dominio') return dominio || '';
    if (k === 'produto.nome') return produto.nome || '';
    return cliente[k.split('.')[1]] || '';
  });
}

const FIELD_RULES = {
  texto: v.string({ max: 500, nullable: true }),
  texto_longo: v.text({ max: 5000, nullable: true }),
  email: v.email({ nullable: true }),
  url: v.url({ nullable: true }),
  cor: v.string({ max: 7, nullable: true, pattern: /^#[0-9a-fA-F]{6}$/, patternMessage: 'Use uma cor no formato #RRGGBB.' })
};

/** Pendências de informação (campos obrigatórios vazios). */
function missingFields(campos, dados, secretKeys, dominio) {
  const missing = [];
  if (!dominio) missing.push({ chave: 'dominio', rotulo: 'Domínio de acesso' });
  for (const c of campos) {
    if (!c.obrigatorio) continue;
    const filled = c.tipo === 'segredo' ? secretKeys.has(`campo:${c.chave}`) : Boolean(dados[c.chave]);
    if (!filled) missing.push({ chave: c.chave, rotulo: c.rotulo });
  }
  return missing;
}

async function loadContext(conn, id, { lock = false } = {}) {
  const imp = await conn.one(`SELECT * FROM implantacoes WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!imp) throw notFound('Implantação');
  const receita = await conn.one('SELECT * FROM receitas_implantacao WHERE id = $1', [imp.receita_id]);
  const dominio = await conn.one('SELECT * FROM dominios WHERE implantacao_id = $1', [id]);
  const secretKeys = new Set((await conn.many('SELECT chave FROM implantacao_segredos WHERE implantacao_id = $1', [id])).map((r) => r.chave));
  return { imp, receita, dominio, secretKeys };
}

/** Recalcula a etapa 2 e, antes da instalação, a situação geral. */
async function refreshPreparation(conn, id) {
  const { imp, receita, dominio, secretKeys } = await loadContext(conn, id);
  const missing = missingFields(receita.campos_cliente, imp.dados_cliente, secretKeys, dominio?.nome);
  await setEtapa(conn, id, 2, missing.length ? 'aguardando_cliente' : 'concluida',
    missing.length ? `Faltam: ${missing.map((m) => m.rotulo).join(', ')}` : 'Informações obrigatórias registradas.');
  if (['em_preparacao', 'aguardando_cliente', 'pronta_para_instalar'].includes(imp.status)) {
    const started = await conn.one("SELECT 1 FROM implantacao_passos WHERE implantacao_id = $1 AND status <> 'pendente' LIMIT 1", [id]);
    const status = missing.length ? 'aguardando_cliente' : 'pronta_para_instalar';
    await conn.query('UPDATE implantacoes SET status = $2, etapa_atual = $3 WHERE id = $1', [id, status, started ? imp.etapa_atual : missing.length ? 2 : 3]);
  }
  return missing;
}

// ------------------------------------------------------------------ criação
const createSchema = {
  cliente_id: v.id(),
  produto_id: v.id(),
  receita_id: v.id(),
  pedido_id: v.id({ nullable: true }),
  contrato_id: v.id({ nullable: true }),
  licenca_id: v.id({ nullable: true }),
  responsavel_id: v.id({ nullable: true }),
  dominio: v.string({ max: 253, nullable: true }),
  slug: v.string({ max: 40, nullable: true }),
  contratada_em: v.date({ nullable: true }),
  observacoes: v.text({ max: 5000, nullable: true }),
  adicional: v.bool()
};

export async function createDeployment(input, req) {
  const value = parse(createSchema, input);
  return withTransaction(async (tx) => {
    const cliente = await tx.one('SELECT id, nome, email, empresa, telefone FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [value.cliente_id]);
    if (!cliente) throw new ValidationError({ cliente_id: 'Cliente inválido.' });
    const produto = await tx.one('SELECT id, nome, slug FROM produtos WHERE id = $1', [value.produto_id]);
    if (!produto) throw new ValidationError({ produto_id: 'Produto inválido.' });
    const receita = await tx.one('SELECT * FROM receitas_implantacao WHERE id = $1', [value.receita_id]);
    if (!receita || receita.produto_id !== produto.id) throw new ValidationError({ receita_id: 'Escolha uma receita do produto contratado.' });
    if (!receita.ativa) throw new ValidationError({ receita_id: 'Esta receita está desativada.' });
    for (const [field, table] of [['pedido_id', 'pedidos'], ['contrato_id', 'contratos'], ['licenca_id', 'licencas']]) {
      if (!value[field]) continue;
      const row = await tx.one(`SELECT cliente_id FROM ${table} WHERE id = $1`, [value[field]]);
      if (!row || row.cliente_id !== cliente.id) throw new ValidationError({ [field]: 'Registro inexistente ou de outro cliente.' });
    }
    if (value.responsavel_id && !(await tx.one("SELECT id FROM usuarios WHERE id = $1 AND tipo = 'equipe' AND ativo", [value.responsavel_id]))) {
      throw new ValidationError({ responsavel_id: 'Responsável inválido.' });
    }

    let dominio = null;
    if (value.dominio) {
      try { dominio = normalizeDomain(value.dominio); } catch (err) { throw new ValidationError({ dominio: err.message }); }
      if (await tx.one('SELECT 1 FROM dominios WHERE lower(nome) = $1', [dominio])) throw new ValidationError({ dominio: 'Este domínio já está vinculado a outra implantação.' });
    }

    if (!value.adicional) {
      const dup = await tx.one("SELECT codigo FROM implantacoes WHERE cliente_id = $1 AND produto_id = $2 AND status <> 'cancelada' LIMIT 1", [cliente.id, produto.id]);
      if (dup) throw conflict(`Este cliente já possui a implantação ${dup.codigo} deste software. Marque "instalação adicional" se for mesmo outra instalação (ex.: outro domínio).`);
    }

    let slug = value.slug;
    if (slug) {
      try { assertSlug(slug); } catch (err) { throw new ValidationError({ slug: err.message }); }
      if (await tx.one('SELECT 1 FROM implantacoes WHERE slug = $1', [slug])) throw new ValidationError({ slug: 'Identificador já em uso.' });
    } else {
      const base = `${slugify(cliente.empresa || cliente.nome, 16) || 'cliente'}-${slugify(produto.slug, 9) || 'app'}`.replace(/-+$/, '');
      slug = base;
      for (let n = 2; await tx.one('SELECT 1 FROM implantacoes WHERE slug = $1', [slug]); n++) slug = `${base.slice(0, 25)}-${n}`;
      assertSlug(slug);
    }

    await tx.query('SELECT pg_advisory_xact_lock($1)', [PORT_LOCK]);
    const port = await tx.one(`SELECT min(p)::int AS porta FROM generate_series(${PORT_MIN}, ${PORT_MAX}) p WHERE p NOT IN (SELECT porta FROM implantacoes)`);
    if (!port?.porta) throw new AppError('Não há portas livres na faixa reservada.', { status: 409, code: 'SEM_PORTA' });

    const dados = {};
    for (const c of receita.campos_cliente) {
      if (c.responsavel === 'automatico' && c.padrao) dados[c.chave] = resolveAuto(c.padrao, { cliente, produto, dominio }).slice(0, 500) || null;
    }
    const codigo = await nextDocumentNumber(tx, 'IMP');
    const imp = await tx.one(
      `INSERT INTO implantacoes (codigo, slug, cliente_id, produto_id, receita_id, pedido_id, contrato_id, licenca_id, responsavel_id,
                                 porta, dados_cliente, contratada_em, observacoes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, CURRENT_DATE),$13,$14) RETURNING id`,
      [codigo, slug, cliente.id, produto.id, receita.id, value.pedido_id ?? null, value.contrato_id ?? null, value.licenca_id ?? null,
        value.responsavel_id ?? req.user?.id ?? null, port.porta, JSON.stringify(dados), value.contratada_em ?? null, value.observacoes ?? null, req.user?.id ?? null]);

    const requisitos = [`${TECNOLOGIAS[receita.tecnologia]} ${receita.node_versao_minima}+`, receita.requer_banco ? 'PostgreSQL' : null, 'Nginx', 'certificado SSL',
      receita.memoria_mb ? `${receita.memoria_mb} MB de memória` : null, receita.disco_mb ? `${receita.disco_mb} MB de disco` : null].filter(Boolean);
    for (const [etapa] of Object.entries(ETAPAS)) {
      await tx.query('INSERT INTO implantacao_etapas (implantacao_id, etapa, status, detalhe) VALUES ($1,$2,$3,$4)', [imp.id, Number(etapa),
        Number(etapa) === 1 ? 'concluida' : 'pendente',
        Number(etapa) === 1 ? `${produto.nome} (receita "${receita.nome}"). Requisitos: ${requisitos.join(', ')}.` : null]);
    }
    for (const s of stepsFor(receita)) {
      await tx.query('INSERT INTO implantacao_passos (implantacao_id, passo, ordem, etapa) VALUES ($1,$2,$3,$4)', [imp.id, s.passo, s.ordem, s.etapa]);
    }
    if (dominio) await tx.query('INSERT INTO dominios (implantacao_id, nome) VALUES ($1, $2)', [imp.id, dominio]);
    await refreshPreparation(tx, imp.id);
    await addLog(tx, imp.id, 'info', `Implantação ${codigo} criada para ${cliente.nome} — ${produto.nome}. Recursos reservados: ${resourcesFor(slug).dir}, porta ${port.porta}.`);
    await audit(req, 'criar', 'implantacao', imp.id, { codigo, cliente_id: cliente.id, produto_id: produto.id, receita_id: receita.id, dominio, slug });
    return { id: imp.id, codigo };
  });
}

// ------------------------------------------------------------------ consulta
export async function listDeployments(query = {}) {
  const p = pagination(query);
  const params = [];
  const where = [];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(i.codigo ILIKE $${params.length} OR c.nome ILIKE $${params.length} OR d.nome ILIKE $${params.length})`); }
  if (query.status && DEPLOYMENT_STATUS[query.status]) { params.push(query.status); where.push(`i.status = $${params.length}`); }
  if (query.produto_id && /^\d+$/.test(String(query.produto_id))) { params.push(Number(query.produto_id)); where.push(`i.produto_id = $${params.length}`); }
  if (query.cliente_id && /^\d+$/.test(String(query.cliente_id))) { params.push(Number(query.cliente_id)); where.push(`i.cliente_id = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM implantacoes i JOIN clientes c ON c.id = i.cliente_id JOIN produtos p ON p.id = i.produto_id
    LEFT JOIN dominios d ON d.implantacao_id = i.id LEFT JOIN usuarios u ON u.id = i.responsavel_id`;
  const { total } = await db.one(`SELECT count(*)::int AS total ${from} ${w}`, params);
  const rows = await db.many(`SELECT i.id, i.codigo, i.slug, i.status, i.etapa_atual, i.progresso, i.contratada_em, i.atualizado_em, i.entregue_em,
      c.nome AS cliente_nome, p.nome AS produto_nome, d.nome AS dominio, u.nome AS responsavel_nome,
      (SELECT status FROM tarefas_implantacao t WHERE t.implantacao_id = i.id ORDER BY t.id DESC LIMIT 1) AS ultima_tarefa_status
    ${from} ${w} ORDER BY i.atualizado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function agentStatus(conn = db) {
  const row = await conn.one("SELECT nome, executor, visto_em, visto_em > now() - interval '90 seconds' AS online FROM agentes_implantacao ORDER BY visto_em DESC LIMIT 1");
  return row || { online: false };
}

export async function getDeployment(id) {
  const { imp, receita, dominio, secretKeys } = await loadContext(db, id);
  const extra = await db.one(`SELECT c.nome AS cliente_nome, c.email AS cliente_email, c.empresa AS cliente_empresa, p.nome AS produto_nome,
      u.nome AS responsavel_nome, pe.numero AS pedido_numero, ct.numero AS contrato_numero, l.identificador AS licenca_identificador, eu.nome AS entregue_por_nome
    FROM implantacoes i JOIN clientes c ON c.id = i.cliente_id JOIN produtos p ON p.id = i.produto_id
    LEFT JOIN usuarios u ON u.id = i.responsavel_id LEFT JOIN pedidos pe ON pe.id = i.pedido_id LEFT JOIN contratos ct ON ct.id = i.contrato_id
    LEFT JOIN licencas l ON l.id = i.licenca_id LEFT JOIN usuarios eu ON eu.id = i.entregue_por WHERE i.id = $1`, [id]);
  const etapas = await db.many('SELECT etapa, status, detalhe, atualizado_em FROM implantacao_etapas WHERE implantacao_id = $1 ORDER BY etapa', [id]);
  const passos = await db.many('SELECT passo, ordem, etapa, status, tentativas, iniciado_em, concluido_em, erro FROM implantacao_passos WHERE implantacao_id = $1 ORDER BY ordem', [id]);
  const tarefas = await db.many(`SELECT t.id, t.tipo, t.passo, t.status, t.tentativas, t.criada_em, t.iniciada_em, t.finalizada_em, t.erro, u.nome AS solicitada_por_nome
    FROM tarefas_implantacao t LEFT JOIN usuarios u ON u.id = t.solicitada_por WHERE t.implantacao_id = $1 ORDER BY t.id DESC LIMIT 15`, [id]);
  const lastTest = await db.one("SELECT max(tarefa_id) AS t FROM implantacao_verificacoes WHERE implantacao_id = $1", [id]);
  const verificacoes = lastTest?.t ? await db.many('SELECT codigo, descricao, ok, detalhe, criado_em FROM implantacao_verificacoes WHERE implantacao_id = $1 AND tarefa_id = $2 ORDER BY id', [id, lastTest.t]) : [];
  const segredos = await db.many('SELECT chave, origem, definido_em FROM implantacao_segredos WHERE implantacao_id = $1 ORDER BY chave', [id]);
  const backups = await db.many('SELECT arquivo, tamanho_bytes, motivo, criado_em FROM implantacao_backups WHERE implantacao_id = $1 ORDER BY id DESC LIMIT 10', [id]);
  const campos = receita.campos_cliente.map((c) => ({
    ...c, tipo_rotulo: FIELD_TYPES[c.tipo], responsavel_rotulo: FIELD_OWNERS[c.responsavel],
    valor: c.tipo === 'segredo' ? null : imp.dados_cliente[c.chave] ?? null,
    definido: c.tipo === 'segredo' ? secretKeys.has(`campo:${c.chave}`) : Boolean(imp.dados_cliente[c.chave])
  }));
  const pendencias = missingFields(receita.campos_cliente, imp.dados_cliente, secretKeys, dominio?.nome);
  const tarefaAtiva = tarefas.find((t) => ['pendente', 'executando'].includes(t.status)) || null;
  const instalado = passos.some((p) => p.passo === 'iniciar_aplicacao' && p.status === 'concluido');
  const closed = CLOSED.includes(imp.status);
  const acoes = {
    iniciar: !closed && !tarefaAtiva && !pendencias.length && !passos.some((p) => p.status !== 'pendente'),
    continuar: !closed && !tarefaAtiva && !pendencias.length && passos.some((p) => p.status !== 'pendente') && passos.some((p) => ['pendente', 'falhou', 'aguardando'].includes(p.status)),
    reexecutar: !closed && !tarefaAtiva,
    personalizar: !closed && !tarefaAtiva && instalado,
    testar: !tarefaAtiva && instalado && imp.status !== 'cancelada',
    entregar: imp.status === 'pronta_para_entrega' && !tarefaAtiva,
    cancelar: !closed && !tarefaAtiva
  };
  const r = resourcesFor(imp.slug);
  return {
    ...imp, ...extra,
    status_rotulo: DEPLOYMENT_STATUS[imp.status],
    receita: {
      id: receita.id, nome: receita.nome, tecnologia: TECNOLOGIAS[receita.tecnologia], versao_app: receita.versao_app, referencia: receita.referencia,
      node_versao_minima: receita.node_versao_minima, requer_banco: receita.requer_banco, memoria_mb: receita.memoria_mb, disco_mb: receita.disco_mb
    },
    recursos: { diretorio: r.dir, usuario: r.usuario, banco: receita.requer_banco ? r.banco : null, servico: r.servico, nginx: r.nginxSite, porta: imp.porta },
    dominio, campos, pendencias,
    etapas: etapas.map((e) => ({ ...e, rotulo: ETAPAS[e.etapa] })),
    passos: passos.map((p) => ({ ...p, rotulo: PASSO_ROTULO[p.passo] || p.passo })),
    tarefas, tarefa_ativa: tarefaAtiva, verificacoes, segredos, backups, acoes,
    agente: await agentStatus()
  };
}

// ------------------------------------------------------------------ edição
const editSchema = {
  responsavel_id: v.id({ nullable: true }),
  observacoes: v.text({ max: 5000, nullable: true }),
  contrato_id: v.id({ nullable: true }),
  licenca_id: v.id({ nullable: true })
};

export async function updateDeployment(id, input, req) {
  const value = parse(editSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const imp = await tx.one('SELECT * FROM implantacoes WHERE id = $1 FOR UPDATE', [id]);
    if (!imp) throw notFound('Implantação');
    for (const [field, table] of [['contrato_id', 'contratos'], ['licenca_id', 'licencas']]) {
      if (!value[field]) continue;
      const row = await tx.one(`SELECT cliente_id FROM ${table} WHERE id = $1`, [value[field]]);
      if (!row || row.cliente_id !== imp.cliente_id) throw new ValidationError({ [field]: 'Registro inexistente ou de outro cliente.' });
    }
    const keys = Object.keys(value);
    if (keys.length) {
      await tx.query(`UPDATE implantacoes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => value[k])]);
      await audit(req, 'editar', 'implantacao', id, value, tx);
    }
    return { ok: true };
  });
}

/**
 * Registra as informações do cliente. Valores sigilosos (tipo "segredo") são cifrados
 * em implantacao_segredos e nunca voltam na resposta; deixar em branco mantém o valor atual.
 */
export async function updateClientData(id, input = {}, req) {
  return withTransaction(async (tx) => {
    const { imp, receita, dominio } = await loadContext(tx, id, { lock: true });
    if (CLOSED.includes(imp.status)) throw conflict('Implantação encerrada.');
    const active = await tx.one(`SELECT 1 FROM tarefas_implantacao WHERE implantacao_id = $1 AND ${ACTIVE_TASK}`, [id]);
    const errors = {};
    const dados = { ...imp.dados_cliente };
    const changed = [];
    const valores = input.valores && typeof input.valores === 'object' ? input.valores : {};

    if ('dominio' in input) {
      let novo = null;
      if (input.dominio) {
        try { novo = normalizeDomain(input.dominio); } catch (err) { errors.dominio = err.message; }
      }
      if (novo && novo !== dominio?.nome) {
        const nginxDone = await tx.one("SELECT 1 FROM implantacao_passos WHERE implantacao_id = $1 AND passo IN ('configurar_nginx','emitir_ssl') AND status = 'concluido'", [id]);
        if (active) errors.dominio = 'Aguarde a tarefa em andamento terminar.';
        else if (await tx.one('SELECT 1 FROM dominios WHERE lower(nome) = $1 AND implantacao_id <> $2', [novo, id])) errors.dominio = 'Domínio já vinculado a outra implantação.';
        else {
          if (dominio) await tx.query("UPDATE dominios SET nome = $2, status_dns = 'nao_verificado', ipv4 = '{}', ipv6 = '{}', status_ssl = 'pendente', ssl_expira_em = NULL, mensagem = NULL WHERE implantacao_id = $1", [id, novo]);
          else await tx.query('INSERT INTO dominios (implantacao_id, nome) VALUES ($1, $2)', [id, novo]);
          if (nginxDone) {
            // Novo domínio exige refazer Nginx, DNS, SSL e HTTPS.
            await tx.query("UPDATE implantacao_passos SET status = 'pendente', erro = NULL WHERE implantacao_id = $1 AND passo IN ('configurar_nginx','verificar_dns','emitir_ssl','ativar_https','testes')", [id]);
          }
          changed.push('dominio');
        }
      }
    }

    for (const c of receita.campos_cliente) {
      if (!(c.chave in valores)) continue;
      const raw = valores[c.chave];
      if (c.tipo === 'segredo') {
        if (raw === null || raw === undefined || String(raw) === '') continue; // em branco: mantém
        if (!can(req.user, 'implantacoes.segredos')) throw forbidden('Você não tem permissão para definir credenciais sigilosas.');
        const s = String(raw);
        if (s.length > 2000 || /[\r\n\0]/.test(s)) { errors[c.chave] = 'Valor inválido.'; continue; }
        await tx.query(`INSERT INTO implantacao_segredos (implantacao_id, chave, valor_cifrado, origem, definido_por) VALUES ($1,$2,$3,'manual',$4)
          ON CONFLICT (implantacao_id, chave) DO UPDATE SET valor_cifrado = EXCLUDED.valor_cifrado, origem = 'manual', definido_por = EXCLUDED.definido_por, definido_em = now()`,
        [id, `campo:${c.chave}`, encrypt(s), req.user?.id ?? null]);
        changed.push(c.chave);
        continue;
      }
      const r = FIELD_RULES[c.tipo](raw);
      if (r.error) { errors[c.chave] = r.error; continue; }
      const val = r.value ?? null;
      if ((dados[c.chave] ?? null) !== val) { dados[c.chave] = val; changed.push(c.chave); }
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await tx.query('UPDATE implantacoes SET dados_cliente = $2 WHERE id = $1', [id, JSON.stringify(dados)]);
    const missing = await refreshPreparation(tx, id);
    const personalized = await tx.one("SELECT 1 FROM implantacao_passos WHERE implantacao_id = $1 AND passo = 'personalizar' AND status = 'concluido'", [id]);
    if (changed.length && personalized) {
      await setEtapa(tx, id, 5, 'aguardando_tecnico', 'Informações do cliente alteradas: aplique a personalização novamente.');
    }
    if (changed.length) {
      await addLog(tx, id, 'info', `Informações do cliente atualizadas: ${changed.map((k) => (receita.campos_cliente.find((c) => c.chave === k)?.tipo === 'segredo' ? `${k} (sigiloso)` : k)).join(', ')}.`);
      await audit(req, 'atualizar_dados_cliente', 'implantacao', id, { campos: changed }, tx);
    }
    return { pendencias: missing, alterados: changed };
  });
}

// ------------------------------------------------------------------ tarefas
const taskSchema = { tipo: v.enum(['instalar', 'reexecutar', 'personalizar', 'testar']), passo: v.string({ max: 40, nullable: true }) };

export async function enqueueTask(id, input, req) {
  const { tipo, passo } = parse(taskSchema, input);
  return withTransaction(async (tx) => {
    const { imp, receita, dominio, secretKeys } = await loadContext(tx, id, { lock: true });
    if (CLOSED.includes(imp.status)) throw conflict('Implantação encerrada: nenhuma tarefa pode ser executada.');
    if (await tx.one(`SELECT 1 FROM tarefas_implantacao WHERE implantacao_id = $1 AND ${ACTIVE_TASK}`, [id])) {
      throw conflict('Já existe uma tarefa em andamento para esta implantação. Aguarde a conclusão.');
    }
    const passos = await tx.many('SELECT passo, status FROM implantacao_passos WHERE implantacao_id = $1 ORDER BY ordem', [id]);
    const installed = passos.some((p) => p.passo === 'iniciar_aplicacao' && p.status === 'concluido');
    const missing = missingFields(receita.campos_cliente, imp.dados_cliente, secretKeys, dominio?.nome);

    if (tipo === 'instalar') {
      if (missing.length) throw new ValidationError({ dados: 'pendente' }, `Complete as informações obrigatórias antes de instalar: ${missing.map((m) => m.rotulo).join(', ')}.`);
      if (!passos.some((p) => p.status !== 'concluido' && p.status !== 'ignorado')) throw conflict('Todos os passos já foram concluídos. Use "Reexecutar passo" ou "Executar testes".');
      await tx.query("UPDATE implantacao_passos SET status = 'pendente' WHERE implantacao_id = $1 AND status IN ('falhou','aguardando','executando')", [id]);
    } else if (tipo === 'reexecutar') {
      const p = passos.find((x) => x.passo === passo);
      if (!p) throw new ValidationError({ passo: 'Passo inexistente nesta implantação.' });
      if (p.status === 'pendente') throw conflict('Este passo ainda não foi executado. Use "Continuar implantação".');
      if (['criar_banco', 'migracoes', 'seed'].includes(passo) && !isAdmin(req.user)) {
        throw new AppError('Reexecutar operações de banco de dados exige perfil de administrador.', { status: 403, code: 'SEM_PERMISSAO' });
      }
      await tx.query("UPDATE implantacao_passos SET status = 'pendente', erro = NULL WHERE implantacao_id = $1 AND passo = $2", [id, passo]);
    } else if (tipo === 'personalizar' || tipo === 'testar') {
      if (!installed) throw conflict('A aplicação ainda não foi instalada e iniciada.');
    }

    const task = await tx.one('INSERT INTO tarefas_implantacao (implantacao_id, tipo, passo, solicitada_por) VALUES ($1,$2,$3,$4) RETURNING id',
      [id, tipo, tipo === 'reexecutar' ? passo : null, req.user?.id ?? null]);
    await tx.query("UPDATE implantacoes SET status = 'em_execucao' WHERE id = $1", [id]);
    await addLog(tx, id, 'info', `Tarefa #${task.id} solicitada: ${tipo}${passo && tipo === 'reexecutar' ? ` (${PASSO_ROTULO[passo] || passo})` : ''} por ${req.user?.nome || 'sistema'}.`, { tarefaId: task.id });
    await audit(req, `tarefa_${tipo}`, 'implantacao', id, { tarefa_id: task.id, passo }, tx);
    return { tarefa_id: task.id };
  }).catch((err) => {
    if (err.code === '23505' && err.constraint === 'ux_tarefa_ativa') throw conflict('Já existe uma tarefa em andamento para esta implantação.');
    throw err;
  });
}

export async function listLogs(id, query = {}) {
  if (!(await db.one('SELECT 1 FROM implantacoes WHERE id = $1', [id]))) throw notFound('Implantação');
  const after = /^\d+$/.test(String(query.depois || '')) ? Number(query.depois) : 0;
  const params = [id, after];
  let extra = '';
  if (/^\d+$/.test(String(query.tarefa || ''))) { params.push(Number(query.tarefa)); extra = `AND tarefa_id = $${params.length}`; }
  const limit = Math.min(Number(query.limite) || 500, 1000);
  const rows = await db.many(`SELECT id, tarefa_id, passo, nivel, mensagem, criado_em FROM implantacao_logs WHERE implantacao_id = $1 AND id > $2 ${extra} ORDER BY id LIMIT ${limit}`, params);
  return { itens: rows, ultimo: rows.length ? rows[rows.length - 1].id : after };
}

// ------------------------------------------------------------------ entrega e cancelamento
const deliverSchema = {
  instrucoes_acesso: v.text({ min: 10, max: 3000 }),
  observacoes: v.text({ max: 3000, nullable: true })
};

export async function deliver(id, input, req) {
  const value = parse(deliverSchema, input);
  return withTransaction(async (tx) => {
    const { imp, receita, dominio } = await loadContext(tx, id, { lock: true });
    if (imp.status !== 'pronta_para_entrega') throw conflict('A entrega só pode ser registrada depois que todas as verificações passarem.');
    // Garante que nenhuma credencial conhecida vá parar no resumo.
    const { decrypt } = await import('./secrets.js');
    const secrets = (await tx.many('SELECT valor_cifrado FROM implantacao_segredos WHERE implantacao_id = $1', [id])).map((s) => { try { return decrypt(s.valor_cifrado); } catch { return null; } });
    const text = `${value.instrucoes_acesso}\n${value.observacoes || ''}`;
    if (secrets.some((s) => s && s.length >= 6 && text.includes(s))) throw new ValidationError({ instrucoes_acesso: 'O texto contém uma credencial da instalação. Nunca inclua senhas no resumo — oriente o cliente a definir a própria senha.' });
    if (/senha\s*[:=]\s*\S+/i.test(text)) throw new ValidationError({ instrucoes_acesso: 'Não informe senhas no resumo de entrega.' });

    const produto = await tx.one('SELECT nome FROM produtos WHERE id = $1', [imp.produto_id]);
    const recursos = (await tx.many("SELECT titulo FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = 'funcionalidade' ORDER BY ordem", [imp.produto_id])).map((r) => r.titulo);
    const verificacoes = await tx.many(`SELECT descricao, ok FROM implantacao_verificacoes WHERE implantacao_id = $1
      AND tarefa_id = (SELECT max(tarefa_id) FROM implantacao_verificacoes WHERE implantacao_id = $1) ORDER BY id`, [id]);
    const resumo = {
      software: produto.nome, versao: receita.versao_app || imp.versao_instalada || receita.referencia,
      endereco: dominio ? `https://${dominio.nome}` : null, instalado_em: imp.instalada_em, entregue_em: new Date().toISOString(),
      recursos, instrucoes_acesso: value.instrucoes_acesso, orientacoes: receita.orientacoes_uso || null, observacoes: value.observacoes || null,
      verificacoes, situacao: 'Instalado, testado e entregue'
    };
    await tx.query("UPDATE implantacoes SET status = 'entregue', etapa_atual = 7, progresso = 100, entregue_em = now(), entregue_por = $2, resumo_entrega = $3 WHERE id = $1",
      [id, req.user?.id ?? null, JSON.stringify(resumo)]);
    await setEtapa(tx, id, 7, 'concluida', `Entregue por ${req.user?.nome || '—'}.`);
    await addLog(tx, id, 'info', 'Entrega registrada.');
    await audit(req, 'entregar', 'implantacao', id, {}, tx);
    return { ok: true };
  });
}

export async function cancelDeployment(id, input, req) {
  const motivo = cleanText(input?.motivo || '').slice(0, 500);
  if (motivo.length < 5) throw new ValidationError({ motivo: 'Informe o motivo do cancelamento.' });
  return withTransaction(async (tx) => {
    const imp = await tx.one('SELECT status FROM implantacoes WHERE id = $1 FOR UPDATE', [id]);
    if (!imp) throw notFound('Implantação');
    if (CLOSED.includes(imp.status)) throw conflict('Implantação já encerrada.');
    if (await tx.one(`SELECT 1 FROM tarefas_implantacao WHERE implantacao_id = $1 AND ${ACTIVE_TASK}`, [id])) throw conflict('Aguarde a tarefa em andamento terminar.');
    await tx.query("UPDATE implantacoes SET status = 'cancelada' WHERE id = $1", [id]);
    await addLog(tx, id, 'aviso', `Implantação cancelada: ${motivo}. Os recursos já criados no servidor NÃO foram removidos automaticamente.`);
    await audit(req, 'cancelar', 'implantacao', id, { motivo }, tx);
    return { ok: true };
  });
}

export { PolicyError };
