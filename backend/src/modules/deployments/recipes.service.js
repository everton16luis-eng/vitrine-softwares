// Receitas de implantação: como cada software é instalado. Toda a estrutura é
// validada contra a política (policy.js) antes de ser gravada.
import { createCrud } from '../shared/crud.js';
import { v } from '../../utils/validation.js';
import { ValidationError, conflict } from '../../utils/errors.js';
import {
  PolicyError, TECNOLOGIAS, ENV_ORIGINS, ENV_NAME_RE, FIELD_KEY_RE,
  assertGitUrl, assertGitRef, assertSharedDir, splitCommand, validateCommand, normalizeNginxOptions
} from './policy.js';

export const FIELD_TYPES = { texto: 'Texto', texto_longo: 'Texto longo', email: 'E-mail', url: 'Endereço (URL)', cor: 'Cor', segredo: 'Credencial sigilosa' };
export const FIELD_OWNERS = { cliente: 'Depende do cliente', equipe: 'Definida pela equipe', automatico: 'Definida automaticamente' };
export const COMMAND_GROUPS = {
  instalacao: 'Instalação de dependências', build: 'Build', migracoes: 'Migrations', seed: 'Dados iniciais (seed)',
  personalizacao: 'Personalização (após configurar os dados do cliente)', inicio: 'Inicialização da aplicação'
};
/** Valores automáticos aceitos em "padrao" dos campos. */
export const AUTO_TOKENS = ['{cliente.nome}', '{cliente.empresa}', '{cliente.email}', '{cliente.telefone}', '{dominio}', '{produto.nome}'];

/** Regra de validação que normaliza com uma função da política. */
const policyRule = (fn, o = {}) => (raw) => {
  if (raw === undefined || raw === null || raw === '') {
    if (o.default !== undefined) return { value: typeof o.default === 'function' ? o.default() : o.default };
    return o.optional ? { value: undefined } : { error: 'Campo obrigatório.' };
  }
  try { return { value: fn(raw) }; } catch (err) {
    if (err instanceof PolicyError || err instanceof ValidationError) return { error: err.message };
    throw err;
  }
};

const fail = (msg) => { throw new PolicyError(msg); };
const asArray = (raw, label) => (Array.isArray(raw) ? raw : fail(`${label}: lista inválida.`));
const toArgv = (c) => (Array.isArray(c) ? c.map(String) : splitCommand(c));

export function normalizeCommands(raw, tecnologia = 'node') {
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('Comandos: estrutura inválida.');
  const out = {};
  for (const group of Object.keys(COMMAND_GROUPS)) {
    if (group === 'inicio') continue;
    const list = raw[group] === undefined ? [] : asArray(raw[group], COMMAND_GROUPS[group]);
    if (list.length > 10) fail(`${COMMAND_GROUPS[group]}: no máximo 10 comandos.`);
    out[group] = list.map(toArgv).filter((a) => a.length).map((argv) => {
      try { return validateCommand(argv, tecnologia); } catch (err) { fail(`${COMMAND_GROUPS[group]} — "${argv.join(' ')}": ${err.message}`); }
      return argv;
    });
  }
  const inicio = toArgv(raw.inicio || []);
  if (!inicio.length) fail('Informe o comando de inicialização da aplicação (ex.: node backend/src/server.js).');
  try { out.inicio = validateCommand(inicio, tecnologia); } catch (err) { fail(`Inicialização: ${err.message}`); }
  if (out.inicio[0] === 'npm' && out.inicio[1] !== 'run') fail('Inicialização: use "node <arquivo>" ou "npm run <script>".');
  if (!out.instalacao.length) fail('Informe ao menos um comando de instalação de dependências (ex.: npm ci --omit=dev).');
  return out;
}

export function normalizeFields(raw) {
  const list = asArray(raw, 'Campos do cliente');
  if (list.length > 40) fail('No máximo 40 campos do cliente.');
  const seen = new Set();
  return list.map((f, i) => {
    if (typeof f !== 'object' || !f) fail(`Campo ${i + 1}: inválido.`);
    const chave = String(f.chave || '').trim();
    if (!FIELD_KEY_RE.test(chave)) fail(`Campo ${i + 1}: chave "${chave}" inválida (letras minúsculas, números e _).`);
    if (seen.has(chave)) fail(`Campo duplicado: ${chave}.`);
    if (chave === 'dominio') fail('O domínio já é um campo padrão de toda implantação; não o repita.');
    seen.add(chave);
    const rotulo = String(f.rotulo || '').trim();
    if (rotulo.length < 2 || rotulo.length > 120) fail(`Campo ${chave}: informe um rótulo (2 a 120 caracteres).`);
    const tipo = String(f.tipo || 'texto');
    if (!FIELD_TYPES[tipo]) fail(`Campo ${chave}: tipo inválido.`);
    const responsavel = String(f.responsavel || 'cliente');
    if (!FIELD_OWNERS[responsavel]) fail(`Campo ${chave}: responsável inválido.`);
    const padrao = f.padrao === undefined || f.padrao === null || f.padrao === '' ? null : String(f.padrao).slice(0, 500);
    if (responsavel === 'automatico' && !padrao) fail(`Campo ${chave}: campos automáticos precisam de um valor padrão (ex.: ${AUTO_TOKENS[0]}).`);
    if (tipo === 'segredo' && padrao) fail(`Campo ${chave}: credenciais sigilosas não podem ter valor padrão.`);
    return { chave, rotulo, tipo, obrigatorio: Boolean(f.obrigatorio), responsavel, padrao, ajuda: f.ajuda ? String(f.ajuda).slice(0, 300) : null };
  });
}

export function normalizeVariables(raw, { campos, requerBanco }) {
  const list = asArray(raw, 'Variáveis de ambiente');
  if (list.length > 80) fail('No máximo 80 variáveis de ambiente.');
  const byKey = new Map(campos.map((c) => [c.chave, c]));
  const seen = new Set();
  const out = list.map((x, i) => {
    const nome = String(x?.nome || '').trim();
    if (!ENV_NAME_RE.test(nome)) fail(`Variável ${i + 1}: nome "${nome}" inválido (ex.: DATABASE_URL).`);
    if (seen.has(nome)) fail(`Variável duplicada: ${nome}.`);
    seen.add(nome);
    const origem = String(x.origem || '');
    if (!ENV_ORIGINS[origem]) fail(`Variável ${nome}: origem inválida.`);
    let valor = x.valor === undefined || x.valor === null ? null : String(x.valor).trim();
    if (origem === 'fixo') {
      if (valor === null) fail(`Variável ${nome}: informe o valor fixo.`);
      if (valor.length > 500 || /[\r\n\0]/.test(valor)) fail(`Variável ${nome}: valor fixo inválido.`);
      if (/senha|secret|token|key|password/i.test(nome) && valor.length >= 8) fail(`Variável ${nome}: parece sigilosa — use a origem "gerado" ou "segredo" em vez de valor fixo.`);
    } else if (origem === 'cliente' || origem === 'segredo') {
      const campo = byKey.get(valor || '');
      if (!campo) fail(`Variável ${nome}: indique a chave de um campo do cliente existente.`);
      if (origem === 'cliente' && campo.tipo === 'segredo') fail(`Variável ${nome}: o campo ${campo.chave} é sigiloso — use a origem "segredo".`);
      if (origem === 'segredo' && campo.tipo !== 'segredo') fail(`Variável ${nome}: o campo ${campo.chave} não é sigiloso — use a origem "cliente".`);
    } else {
      valor = null;
      if (origem === 'banco' && !requerBanco) fail(`Variável ${nome}: a receita não usa banco de dados.`);
    }
    return { nome, origem, valor };
  });
  if (!out.some((x) => x.origem === 'porta')) fail('Inclua uma variável com origem "porta" (ex.: PORT): é nela que a aplicação deve escutar.');
  return out;
}

export function normalizeChecks(raw) {
  const list = asArray(raw, 'Verificações');
  if (list.length > 20) fail('No máximo 20 verificações.');
  return list.map((c, i) => {
    const caminho = String(c?.caminho || '/');
    if (!/^\/[A-Za-z0-9._~/?=&%-]{0,200}$/.test(caminho)) fail(`Verificação ${i + 1}: caminho inválido (ex.: /saude).`);
    const status = Number(c.status ?? 200);
    if (!Number.isInteger(status) || status < 100 || status > 599) fail(`Verificação ${i + 1}: código HTTP inválido.`);
    const contem = c.contem ? String(c.contem).slice(0, 200) : null;
    return { caminho, status, contem };
  });
}

const baseRecipes = createCrud({
  table: 'receitas_implantacao',
  entity: 'receita_implantacao',
  label: 'Receita de implantação',
  schema: {
    produto_id: v.id(),
    nome: v.string({ min: 3, max: 120 }),
    ativa: v.bool({ default: true }),
    tecnologia: v.enum(Object.keys(TECNOLOGIAS), { default: 'node' }),
    repositorio_url: policyRule(assertGitUrl),
    referencia: policyRule(assertGitRef, { default: 'main' }),
    versao_app: v.string({ max: 40, nullable: true }),
    node_versao_minima: v.int({ min: 16, max: 40, default: 20 }),
    requer_banco: v.bool({ default: true }),
    comandos: policyRule((x) => x),
    variaveis: policyRule((x) => x, { default: () => [] }),
    campos_cliente: policyRule((x) => x, { default: () => [] }),
    diretorios_persistentes: policyRule((x) => asArray(x, 'Diretórios persistentes').map(assertSharedDir), { default: () => [] }),
    nginx_opcoes: policyRule(normalizeNginxOptions, { default: () => normalizeNginxOptions({}) }),
    verificacoes: policyRule(normalizeChecks, { default: () => [] }),
    memoria_mb: v.int({ min: 1, max: 1048576, nullable: true }),
    disco_mb: v.int({ min: 1, max: 10485760, nullable: true }),
    orientacoes_uso: v.text({ max: 5000, nullable: true }),
    observacoes: v.text({ max: 5000, nullable: true })
  },
  search: ['nome', 'repositorio_url'],
  filters: { produto_id: { column: 'produto_id', rule: v.id({ optional: true }) } },
  orderBy: 'p.nome, t.nome',
  select: 'SELECT t.*, p.nome AS produto_nome FROM receitas_implantacao t JOIN produtos p ON p.id = t.produto_id',
  async prepare(value, { current }) {
    // Validação cruzada com os valores atuais (atualização parcial).
    const merged = { ...(current || {}), ...value };
    try {
      const tecnologia = merged.tecnologia || 'node';
      const campos = normalizeFields(merged.campos_cliente || []);
      const out = { ...value };
      if ('comandos' in value || !current) out.comandos = normalizeCommands(merged.comandos || {}, tecnologia);
      if ('campos_cliente' in value || !current) out.campos_cliente = campos;
      if ('variaveis' in value || 'campos_cliente' in value || 'requer_banco' in value || !current) {
        out.variaveis = normalizeVariables(merged.variaveis || [], { campos, requerBanco: merged.requer_banco !== false });
      }
      for (const k of ['comandos', 'variaveis', 'campos_cliente', 'diretorios_persistentes', 'nginx_opcoes', 'verificacoes']) {
        if (k in out) out[k] = JSON.stringify(out[k]);
      }
      return out;
    } catch (err) {
      if (err instanceof PolicyError) throw new ValidationError({ _receita: err.message }, err.message);
      throw err;
    }
  },
  async beforeSave(value, { tx, current }) {
    if (current && 'produto_id' in value && value.produto_id !== current.produto_id) {
      const used = await tx.one('SELECT 1 FROM implantacoes WHERE receita_id = $1 LIMIT 1', [current.id]);
      if (used) throw conflict('Esta receita já foi usada em implantações; o produto não pode ser trocado.');
    }
    if ('produto_id' in value && !(await tx.one('SELECT id FROM produtos WHERE id = $1', [value.produto_id]))) {
      throw new ValidationError({ produto_id: 'Produto inexistente.' });
    }
  },
  async beforeDelete(row, { tx }) {
    if (await tx.one('SELECT 1 FROM implantacoes WHERE receita_id = $1 LIMIT 1', [row.id])) {
      throw conflict('Receita usada em implantações. Desative-a em vez de excluir.');
    }
  }
});

export async function listRecipesForSelect(db) {
  return db.many('SELECT r.id, r.nome, r.produto_id, r.ativa, r.versao_app, p.nome AS produto_nome FROM receitas_implantacao r JOIN produtos p ON p.id = r.produto_id ORDER BY p.nome, r.nome');
}

/** O token do repositório nunca sai do servidor: só se informa se existe. */
function hideToken(row) {
  if (!row) return row;
  const { token_git_cifrado: token, ...rest } = row;
  return { ...rest, tem_token_git: Boolean(token) };
}

export const recipesService = {
  async list(q) { const r = await baseRecipes.list(q); return { ...r, items: r.items.map(hideToken) }; },
  get: async (id, conn) => hideToken(await baseRecipes.get(id, conn)),
  create: async (input, req) => hideToken(await baseRecipes.create(input, req)),
  update: async (id, input, req) => hideToken(await baseRecipes.update(id, input, req)),
  remove: (id, req) => baseRecipes.remove(id, req)
};

/** Define ou remove (valor vazio) o token de leitura do repositório. */
export async function setRecipeToken(db, id, token, req, audit) {
  const t = token === null || token === undefined ? '' : String(token).trim();
  if (t && (t.length < 8 || t.length > 500 || /\s/.test(t))) throw new ValidationError({ token: 'Token inválido.' });
  const { encrypt } = await import('./secrets.js');
  const row = await db.one('UPDATE receitas_implantacao SET token_git_cifrado = $2 WHERE id = $1 RETURNING id', [id, t ? encrypt(t) : null]);
  if (!row) throw new ValidationError({ id: 'Receita inexistente.' });
  await audit(req, t ? 'definir_token_git' : 'remover_token_git', 'receita_implantacao', id, {});
  return { tem_token_git: Boolean(t) };
}
