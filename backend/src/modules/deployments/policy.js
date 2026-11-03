// Política de segurança da Central de Implantação.
//
// ESTE ARQUIVO NÃO PODE TER IMPORTS: ele é copiado (como root) para
// /usr/local/lib/vitrine-implantacao/ e usado pelo script auxiliar privilegiado,
// que revalida tudo o que recebe. Painel, agente e script auxiliar compartilham
// exatamente as mesmas regras.
//
// Princípios: nenhum comando passa por shell; executáveis e subcomandos vêm de
// uma lista fechada por tecnologia; nomes de recursos são derivados do slug e
// validados por expressões regulares estritas.

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,26}[a-z0-9])$/; // usuário Linux app-<slug> ≤ 32 caracteres
export const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const SAFE_ARG_RE = /^[A-Za-z0-9@%+=:,._/-]{1,200}$/;
export const SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,59}$/;
export const PROJECT_FILE_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]{1,150}\.(?:js|mjs|cjs)$/;
export const SHARED_DIR_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_-]{1,40}(?:\/[A-Za-z0-9_-]{1,40}){0,3}$/;
export const GIT_REF_RE = /^(?!.*\.\.)(?!-)[A-Za-z0-9._/-]{1,100}$/;

export const BASE_DIR = '/srv/clientes';
export const NGINX_PREFIX = 'vitrine-';
export const SERVICE_PREFIX = 'vitrine-app-';
export const PORT_MIN = 4100;
export const PORT_MAX = 4999;

export const TECNOLOGIAS = { node: 'Node.js' };

/** Recursos isolados derivados do slug — os nomes nunca vêm da requisição. */
export function resourcesFor(slug) {
  assertSlug(slug);
  const dbName = `cli_${slug.replace(/-/g, '_')}`;
  return {
    slug,
    usuario: `app-${slug}`,
    dir: `${BASE_DIR}/${slug}`,
    releases: `${BASE_DIR}/${slug}/releases`,
    current: `${BASE_DIR}/${slug}/current`,
    shared: `${BASE_DIR}/${slug}/shared`,
    envFile: `${BASE_DIR}/${slug}/shared/.env`,
    logs: `${BASE_DIR}/${slug}/logs`,
    backups: `${BASE_DIR}/${slug}/backups`,
    banco: dbName,
    papelBanco: dbName,
    servico: `${SERVICE_PREFIX}${slug}`,
    nginxSite: `${NGINX_PREFIX}${slug}.conf`
  };
}

export class PolicyError extends Error {
  constructor(message) {
    super(message);
    this.code = 'POLITICA';
  }
}

export function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new PolicyError('Identificador da instalação inválido (use 3 a 28 letras minúsculas, números e hífens).');
  return slug;
}

export function normalizeDomain(value) {
  const d = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(d)) throw new PolicyError('Domínio inválido. Informe apenas o endereço, sem http:// e sem barras (ex.: sistema.empresa.com.br).');
  return d;
}

export function assertPort(port) {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) throw new PolicyError(`Porta fora da faixa reservada (${PORT_MIN}–${PORT_MAX}).`);
  return port;
}

export function assertGitUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new PolicyError('Endereço do repositório inválido.'); }
  if (u.protocol !== 'https:') throw new PolicyError('Use um repositório acessível por https://.');
  if (u.username || u.password) throw new PolicyError('Não inclua usuário ou token no endereço; cadastre o token como credencial da receita.');
  if (!/^[A-Za-z0-9._~/-]+$/.test(u.pathname) || u.search || u.hash) throw new PolicyError('Endereço do repositório com caracteres não permitidos.');
  return u.toString();
}

export function assertGitRef(ref) {
  if (typeof ref !== 'string' || !GIT_REF_RE.test(ref)) throw new PolicyError('Versão (branch ou tag) inválida.');
  return ref;
}

export function assertSharedDir(dir) {
  if (typeof dir !== 'string' || !SHARED_DIR_RE.test(dir)) throw new PolicyError(`Diretório persistente inválido: "${dir}".`);
  return dir;
}

/** Divide uma linha de comando em argumentos (sem aspas nem expansão — não há shell). */
export function splitCommand(line) {
  return String(line || '').trim().split(/\s+/).filter(Boolean);
}

const NPM_INSTALL_FLAGS = new Set(['--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', '--prefer-offline', '--include=dev']);

/**
 * Valida um comando (lista de argumentos) contra a lista autorizada da tecnologia.
 * Retorna o comando normalizado ou lança PolicyError.
 */
export function validateCommand(argv, tecnologia = 'node') {
  if (!Array.isArray(argv) || !argv.length || argv.length > 20) throw new PolicyError('Comando vazio ou longo demais.');
  for (const a of argv) {
    if (typeof a !== 'string' || !SAFE_ARG_RE.test(a)) throw new PolicyError(`Argumento não permitido: "${String(a).slice(0, 40)}".`);
    if (a.includes('..')) throw new PolicyError('Argumentos não podem conter "..".');
  }
  if (tecnologia !== 'node') throw new PolicyError(`Tecnologia não suportada: ${tecnologia}.`);
  const [exe, sub, ...rest] = argv;
  if (exe === 'npm') {
    if (sub === 'ci' || sub === 'install') {
      if (rest.some((f) => !NPM_INSTALL_FLAGS.has(f))) throw new PolicyError(`Opção não permitida em "npm ${sub}". Permitidas: ${[...NPM_INSTALL_FLAGS].join(', ')}.`);
      return argv;
    }
    if (sub === 'run') {
      const [script, sep, ...args] = rest;
      if (!script || !SCRIPT_NAME_RE.test(script)) throw new PolicyError('Informe o nome do script: npm run <script>.');
      if (sep !== undefined && sep !== '--') throw new PolicyError('Para passar argumentos ao script use: npm run <script> -- <argumentos>.');
      checkFlags(args);
      return argv;
    }
    throw new PolicyError('Com npm são permitidos apenas: npm ci, npm install e npm run <script>.');
  }
  if (exe === 'node') {
    if (!sub || !PROJECT_FILE_RE.test(sub)) throw new PolicyError('Use: node <arquivo .js do projeto> (caminho relativo, sem "..").');
    checkFlags(rest);
    return argv;
  }
  throw new PolicyError(`Executável não autorizado: "${exe}". Permitidos para Node.js: npm, node.`);
}

function checkFlags(args) {
  for (const a of args) if (/^--?(?:eval|e|require|r|import|inspect|loader|experimental)/.test(a)) throw new PolicyError(`Opção não permitida: ${a}.`);
}

export const ENV_ORIGINS = {
  fixo: 'Valor fixo da receita',
  gerado: 'Segredo gerado automaticamente',
  banco: 'URL do banco da instalação',
  dominio: 'URL pública (https://domínio)',
  host: 'Domínio (sem https://)',
  porta: 'Porta interna alocada',
  cliente: 'Informação do cliente',
  segredo: 'Credencial sigilosa'
};

/** Valor de .env seguro (uma linha, sem caracteres de controle). */
export function assertEnvValue(name, value) {
  const s = String(value ?? '');
  if (s.length > 4000 || /[\r\n\0]/.test(s)) throw new PolicyError(`Valor inválido para a variável ${name}.`);
  return s;
}

/** Serializa um .env com aspas e escapes — não há interpolação. */
export function renderEnv(vars) {
  const lines = ['# Gerado pela Central de Implantação. Não edite manualmente: altere pelo painel.'];
  for (const [k, v] of Object.entries(vars)) {
    if (!ENV_NAME_RE.test(k)) throw new PolicyError(`Nome de variável inválido: ${k}.`);
    lines.push(`${k}="${assertEnvValue(k, v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`);
  }
  return `${lines.join('\n')}\n`;
}

export const NGINX_DEFAULTS = { client_max_body_size_mb: 10, websocket: false, timeout_s: 60 };

export function normalizeNginxOptions(o = {}) {
  const out = { ...NGINX_DEFAULTS };
  if (o.client_max_body_size_mb !== undefined) {
    const n = Number(o.client_max_body_size_mb);
    if (!Number.isInteger(n) || n < 1 || n > 1024) throw new PolicyError('Tamanho máximo de envio deve estar entre 1 e 1024 MB.');
    out.client_max_body_size_mb = n;
  }
  if (o.timeout_s !== undefined) {
    const n = Number(o.timeout_s);
    if (!Number.isInteger(n) || n < 10 || n > 600) throw new PolicyError('Tempo limite do proxy deve estar entre 10 e 600 segundos.');
    out.timeout_s = n;
  }
  if (o.websocket !== undefined) out.websocket = Boolean(o.websocket);
  return out;
}

/**
 * Configuração Nginx de UMA instalação. Só usa valores validados (domínio, porta e
 * opções numéricas), por isso não há como injetar diretivas.
 */
export function renderNginx({ slug, dominio, porta, ssl, opcoes, acmeRoot = '/var/www/vitrine-acme' }) {
  assertSlug(slug);
  const d = normalizeDomain(dominio);
  assertPort(porta);
  const o = normalizeNginxOptions(opcoes);
  const proxy = `
    location / {
      proxy_pass http://127.0.0.1:${porta};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;${o.websocket ? `
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";` : ''}
      proxy_read_timeout ${o.timeout_s}s;
    }`;
  const head = `# Gerado pela Central de Implantação (${slug}). Não edite manualmente.\n`;
  const acme = `
    location ^~ /.well-known/acme-challenge/ {
      root ${acmeRoot};
      default_type text/plain;
    }`;
  if (!ssl) {
    return `${head}server {
    listen 80;
    listen [::]:80;
    server_name ${d};
    client_max_body_size ${o.client_max_body_size_mb}m;${acme}${proxy}
}
`;
  }
  return `${head}server {
    listen 80;
    listen [::]:80;
    server_name ${d};${acme}
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${d};
    ssl_certificate /etc/letsencrypt/live/${d}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${d}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size ${o.client_max_body_size_mb}m;
    access_log ${BASE_DIR}/${slug}/logs/nginx-access.log;
    error_log ${BASE_DIR}/${slug}/logs/nginx-error.log;${proxy}
}
`;
}

/** Unidade systemd da aplicação, com isolamento do sistema de arquivos. */
export function renderSystemdUnit({ slug, execStart }) {
  const r = resourcesFor(slug);
  if (!Array.isArray(execStart) || !execStart.length || !execStart[0].startsWith('/')) throw new PolicyError('Comando de início inválido.');
  for (const a of execStart) if (!/^[A-Za-z0-9@%+=:,._/-]+$/.test(a)) throw new PolicyError('Comando de início com caracteres não permitidos.');
  return `# Gerado pela Central de Implantação (${slug}). Não edite manualmente.
[Unit]
Description=Aplicação ${slug} (Central de Implantação)
After=network.target postgresql.service

[Service]
Type=simple
User=${r.usuario}
Group=${r.usuario}
WorkingDirectory=${r.current}
EnvironmentFile=${r.envFile}
ExecStart=${execStart.join(' ')}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${r.dir}
StandardOutput=append:${r.logs}/app.log
StandardError=append:${r.logs}/app-erro.log

[Install]
WantedBy=multi-user.target
`;
}

/** Substitui ocorrências de segredos conhecidos por "••••" antes de gravar logs. */
export function maskSecrets(text, secrets = []) {
  let s = String(text ?? '');
  for (const sec of secrets) if (sec && String(sec).length >= 4) s = s.split(String(sec)).join('••••');
  return s.replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1••••@');
}
