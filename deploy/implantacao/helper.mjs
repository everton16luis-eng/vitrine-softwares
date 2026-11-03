#!/usr/bin/env node
// Auxiliar ROOT da Central de Implantação.
//
// Instalado por preparar-servidor.sh em /usr/local/lib/vitrine-implantacao/ (dono root, somente
// leitura) e chamado pelo agente com:  sudo -n <node> helper.mjs <operação>   (parâmetros em JSON
// pela entrada padrão). É o ÚNICO ponto com privilégio de root, por isso:
//
//   - aceita apenas as operações listadas em OPS — não existe "executar comando arbitrário";
//   - valida todos os parâmetros com a mesma política do painel (policy.mjs);
//   - todos os recursos (usuário, diretório, banco, serviço, site Nginx) são derivados do
//     identificador da instalação: nunca toca em serviços, portas, sites ou bancos de outros projetos;
//   - nunca usa shell: todos os processos são criados com lista de argumentos;
//   - comandos da aplicação rodam como o usuário isolado da instalação (runuser), não como root;
//   - toda alteração de Nginx passa por "nginx -t" e é desfeita se a validação falhar.
//
// A saída é uma única linha JSON: {"ok":true,...} ou {"ok":false,"erro":"...","saida":"..."}.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let policy;
try {
  policy = await import('./policy.mjs'); // cópia instalada ao lado do auxiliar
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  policy = await import('../../backend/src/modules/deployments/policy.js'); // execução a partir do repositório (testes)
}
const {
  PolicyError, resourcesFor, normalizeDomain, assertPort, assertGitUrl, assertGitRef, assertSharedDir,
  validateCommand, renderEnv, renderNginx, renderSystemdUnit, normalizeNginxOptions, maskSecrets
} = policy;

const ACME_ROOT = '/var/www/vitrine-acme';
const SYSTEMD_DIR = '/etc/systemd/system';
const PATH_ENV = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const RELEASE_RE = /^\d{14}$/;
const DB_PASSWORD_RE = /^[A-Za-z0-9_-]{24,128}$/; // gerada pelo agente (base64url)
const KEEP_RELEASES = 3;
const MAX_OUTPUT = 200_000;
const NODE_BIN = process.execPath;
const NPM_BIN = [path.join(path.dirname(NODE_BIN), 'npm'), '/usr/bin/npm', '/usr/local/bin/npm'].find((p) => fs.existsSync(p)) || '/usr/bin/npm';

class HelperError extends Error {
  constructor(message, saida) { super(message); this.saida = saida; }
}

// ------------------------------------------------------------------ processos (sem shell)
/**
 * Executa um programa com lista de argumentos. `asUser` troca de usuário com runuser
 * (que também ajusta os grupos suplementares). Mata o grupo de processos ao estourar o tempo.
 */
export function run(cmd, args = [], { asUser, cwd, env, input, timeoutMs = 120_000, stdoutFile, allowFail = false } = {}) {
  const argv = asUser ? ['runuser', '-u', asUser, '--', cmd, ...args] : [cmd, ...args];
  return new Promise((resolve, reject) => {
    const outFd = stdoutFile ? fs.openSync(stdoutFile, 'wx', 0o600) : null;
    const child = spawn(argv[0], argv.slice(1), {
      cwd: cwd || '/', env: env || { PATH: PATH_ENV, LANG: 'C.UTF-8' }, detached: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', outFd ?? 'pipe', 'pipe']
    });
    if (outFd !== null) fs.closeSync(outFd);
    let out = '';
    const keep = (d) => { out += d; if (out.length > MAX_OUTPUT * 2) out = out.slice(-MAX_OUTPUT); };
    child.stdout?.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* já terminou */ } }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(new HelperError(`Não foi possível executar ${cmd}: ${err.message}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const saida = out.slice(-MAX_OUTPUT).trim();
      if (code === 0 || allowFail) return resolve({ code, saida });
      reject(new HelperError(signal === 'SIGKILL' ? `${path.basename(cmd)}: tempo limite de ${Math.round(timeoutMs / 1000)}s esgotado.` : `${path.basename(cmd)} terminou com código ${code}.`, saida));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const exists = (p) => fs.existsSync(p);
const userExists = async (u) => (await run('id', ['-u', u], { allowFail: true })).code === 0;

async function idsOf(user) {
  const u = Number((await run('id', ['-u', user])).saida.trim());
  const g = Number((await run('id', ['-g', user])).saida.trim());
  return { u, g };
}

/**
 * Diretório com dono/permissão definidos. Usado SOMENTE dentro de diretórios controlados
 * pelo root (/srv/clientes e /srv/clientes/<slug>), onde o usuário da aplicação não pode
 * criar ou trocar entradas. Dentro dos diretórios da aplicação, o trabalho é feito como
 * o próprio usuário da aplicação (asApp), para que links simbólicos não sejam explorados.
 */
async function ensureDir(dir, owner, mode) {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (st && !st.isDirectory()) throw new HelperError(`${dir} existe e não é um diretório.`);
  if (!st) fs.mkdirSync(dir, { mode });
  fs.chmodSync(dir, mode);
  await run('chown', ['-h', owner, dir]);
}

/** Executa como o usuário isolado da instalação. */
const asApp = (r, cmd, args, opts = {}) => run(cmd, args, { asUser: r.usuario, env: appEnv(r), ...opts });

/** Lê um arquivo sem seguir link simbólico (o usuário da aplicação controla shared/). */
function readNoFollow(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
}

/** Lê o .env no formato gerado por renderEnv (aspas duplas, escapes \\ \" \$). */
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]{0,63})="((?:[^"\\]|\\.)*)"$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}

/** Diretório de trabalho permitido: a versão em preparação ou a versão ativa. */
export function assertCwd(r, cwd) {
  if (cwd === r.current) return cwd;
  const rel = path.posix.relative(r.releases, String(cwd || ''));
  if (RELEASE_RE.test(rel)) return cwd;
  throw new PolicyError('Diretório de execução não permitido.');
}

function appEnv(r, extra = {}) {
  return { PATH: PATH_ENV, LANG: 'C.UTF-8', HOME: r.shared, npm_config_cache: `${r.shared}/.npm`, npm_config_update_notifier: 'false', npm_config_fund: 'false', ...extra };
}

/** Garante que nenhum outro site do Nginx (de outros projetos) já atende o domínio. */
function assertDomainFree(dominio, ownFile) {
  const dirs = ['/etc/nginx/sites-enabled', '/etc/nginx/conf.d'];
  const re = new RegExp(`server_name[^;]*(?:\\s|^)${dominio.replace(/\./g, '\\.')}(?:\\s|;)`, 'm');
  for (const dir of dirs) {
    if (!exists(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let real;
      try { real = fs.realpathSync(full); } catch { continue; }
      if (path.basename(real) === ownFile) continue;
      let text;
      try { text = fs.readFileSync(real, 'utf8'); } catch { continue; }
      if (re.test(text)) throw new HelperError(`O domínio ${dominio} já está configurado em ${full}, que não pertence a esta instalação. Nenhuma alteração foi feita.`);
    }
  }
}

function nginxPaths(site) {
  if (exists('/etc/nginx/sites-available') && exists('/etc/nginx/sites-enabled')) {
    return { file: `/etc/nginx/sites-available/${site}`, link: `/etc/nginx/sites-enabled/${site}` };
  }
  return { file: `/etc/nginx/conf.d/${site}`, link: null };
}

/**
 * Grava de forma atômica: arquivo temporário exclusivo (O_EXCL não segue links), dono
 * ajustado pelo descritor (fchown) e rename sobre o destino.
 */
function writeAtomic(file, content, mode, owner = null) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, content);
    if (owner) fs.fchownSync(fd, owner.u, owner.g);
    fs.fchmodSync(fd, mode);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function binFor(exe) {
  if (exe === 'node') return NODE_BIN;
  if (exe === 'npm') return NPM_BIN;
  throw new PolicyError(`Executável não autorizado: ${exe}.`);
}

// ------------------------------------------------------------------ operações
const OPS = {
  async requisitos({ nodeMin = 20, requerBanco = true, discoMb = null }) {
    const info = {};
    const faltas = [];
    const major = Number(process.versions.node.split('.')[0]);
    info.node = process.version;
    if (major < Number(nodeMin)) faltas.push(`Node.js ${nodeMin}+ (instalado: ${process.version})`);
    for (const [nome, cmd, args] of [['git', 'git', ['--version']], ['nginx', 'nginx', ['-v']], ['certbot', 'certbot', ['--version']], ['runuser', 'runuser', ['--version']]]) {
      const r = await run(cmd, args, { allowFail: true }).catch(() => ({ code: 127, saida: '' }));
      if (r.code === 0) info[nome] = (r.saida.split('\n')[0] || 'ok').replace(/^nginx version: /, '').slice(0, 60);
      else faltas.push(nome);
    }
    if (requerBanco) {
      const r = await run('runuser', ['-u', 'postgres', '--', 'psql', '-tAc', 'SHOW server_version'], { allowFail: true }).catch(() => ({ code: 1 }));
      if (r.code === 0) info.postgresql = r.saida.trim(); else faltas.push('PostgreSQL local (usuário "postgres" com psql)');
      const d = await run('which', ['pg_dump'], { allowFail: true });
      if (d.code !== 0) faltas.push('pg_dump');
    }
    if (!exists(ACME_ROOT)) faltas.push(`${ACME_ROOT} (execute preparar-servidor.sh)`);
    const st = fs.statfsSync(policy.BASE_DIR);
    const livreMb = Math.floor((st.bavail * st.bsize) / 1048576);
    info.disco_livre = `${livreMb} MB`;
    if (discoMb && livreMb < Number(discoMb)) faltas.push(`espaço em disco (${discoMb} MB necessários, ${livreMb} MB livres)`);
    if (faltas.length) throw new HelperError(`Requisitos ausentes: ${faltas.join('; ')}.`);
    return { info };
  },

  async 'criar-usuario'({ slug }) {
    const r = resourcesFor(slug);
    if (await userExists(r.usuario)) {
      const home = (await run('getent', ['passwd', r.usuario])).saida.split(':')[5];
      if (home !== r.dir) throw new HelperError(`O usuário ${r.usuario} já existe e não pertence a esta instalação (home ${home}).`);
      return { criado: false };
    }
    await run('useradd', ['--system', '--user-group', '--home-dir', r.dir, '--no-create-home', '--shell', '/usr/sbin/nologin', '--comment', `Central de Implantacao ${slug}`, r.usuario]);
    return { criado: true };
  },

  async 'preparar-diretorios'({ slug, dirs = [] }) {
    const r = resourcesFor(slug);
    const u = r.usuario;
    if (!exists(policy.BASE_DIR)) throw new HelperError(`${policy.BASE_DIR} não existe (execute preparar-servidor.sh).`);
    await ensureDir(r.dir, `root:${u}`, 0o750);
    for (const d of [r.releases, r.shared, r.logs]) await ensureDir(d, `${u}:${u}`, 0o750);
    await ensureDir(r.backups, 'root:root', 0o700);
    for (const raw of dirs) await asApp(r, 'mkdir', ['-p', '-m', '750', `${r.shared}/${assertSharedDir(raw)}`]);
    return {};
  },

  async 'obter-codigo'({ slug, url, ref, token, release, timeoutMs }) {
    const r = resourcesFor(slug);
    assertGitUrl(url);
    assertGitRef(ref);
    if (!RELEASE_RE.test(String(release))) throw new PolicyError('Identificador de versão inválido.');
    if (token !== null && token !== undefined && (typeof token !== 'string' || !/^[\x21-\x7e]{8,500}$/.test(token))) throw new PolicyError('Token inválido.');
    const dest = `${r.releases}/${release}`;
    if (fs.lstatSync(dest, { throwIfNoEntry: false })) await asApp(r, 'rm', ['-rf', '--one-file-system', dest]);
    await asApp(r, 'mkdir', ['-m', '750', dest]);
    // O token vai por variável de ambiente (GIT_CONFIG_*): não aparece na lista de processos
    // nem fica gravado no repositório clonado.
    const gitEnv = appEnv(r, { GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https', GIT_CONFIG_NOSYSTEM: '1' });
    if (token) Object.assign(gitEnv, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` });
    const git = (args, t = 60_000) => run('git', args, { asUser: r.usuario, cwd: dest, env: gitEnv, timeoutMs: t });
    try {
      await git(['init', '--quiet']);
      await git(['remote', 'add', 'origin', url]);
      await git(['fetch', '--depth', '1', '--no-tags', '--quiet', 'origin', ref], Math.min(Number(timeoutMs) || 600_000, 900_000));
      await git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD']);
      const commit = (await git(['rev-parse', '--short=12', 'HEAD'])).saida.trim();
      await asApp(r, 'rm', ['-rf', '--one-file-system', `${dest}/.git`]);
      return { commit };
    } catch (err) {
      err.saida = maskSecrets(err.saida || '', token ? [token] : []);
      throw err;
    }
  },

  async 'criar-banco'({ slug, password }) {
    const r = resourcesFor(slug);
    if (!DB_PASSWORD_RE.test(String(password || ''))) throw new PolicyError('Senha do banco em formato inesperado.');
    // Variáveis do psql pela entrada padrão (nunca na linha de comando); nomes com %I e valores com %L.
    const sql = `\\set ON_ERROR_STOP on
\\set papel '${r.papelBanco}'
\\set senha '${password}'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'papel') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'papel') \\gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'papel', :'senha') \\gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'papel', :'papel') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'papel') \\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'papel') \\gexec
SELECT format('GRANT ALL ON DATABASE %I TO %I', :'papel', :'papel') \\gexec
`;
    try {
      await run('runuser', ['-u', 'postgres', '--', 'psql', '-q', '-X', '-d', 'postgres'], { input: sql });
    } catch (err) {
      err.saida = maskSecrets(err.saida || '', [password]);
      throw err;
    }
    return {};
  },

  async 'gravar-env'({ slug, vars }) {
    const r = resourcesFor(slug);
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) throw new PolicyError('Variáveis inválidas.');
    writeAtomic(r.envFile, renderEnv(vars), 0o600, await idsOf(r.usuario));
    return {};
  },

  async executar({ slug, argv, cwd, useEnvFile, timeoutMs }) {
    const r = resourcesFor(slug);
    const [exe, ...args] = validateCommand(argv);
    assertCwd(r, cwd);
    const extra = useEnvFile && exists(r.envFile) ? parseEnvFile(readNoFollow(r.envFile)) : {};
    const res = await run(binFor(exe), args, { asUser: r.usuario, cwd, env: appEnv(r, extra), timeoutMs: Math.min(Number(timeoutMs) || 600_000, 3_600_000) })
      .catch((err) => { err.saida = maskSecrets(err.saida || '', Object.values(extra)); throw err; });
    return { saida: maskSecrets(res.saida, Object.values(extra)).slice(-20_000) };
  },

  async 'ativar-versao'({ slug, release, sharedDirs = [] }) {
    const r = resourcesFor(slug);
    if (!RELEASE_RE.test(String(release))) throw new PolicyError('Identificador de versão inválido.');
    const dir = `${r.releases}/${release}`;
    if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new HelperError(`Versão ${release} não encontrada.`);
    // Diretórios persistentes e o .env ficam em shared/ e são ligados à versão.
    // Feito como o usuário da aplicação: a versão pertence a ele.
    for (const raw of sharedDirs) {
      const d = assertSharedDir(raw);
      const target = `${dir}/${d}`;
      await asApp(r, 'rm', ['-rf', '--one-file-system', target]);
      await asApp(r, 'mkdir', ['-p', path.posix.dirname(target)]);
      await asApp(r, 'ln', ['-sfn', `${r.shared}/${d}`, target]);
    }
    await asApp(r, 'ln', ['-sfn', r.envFile, `${dir}/.env`]);
    // Troca atômica do link "current".
    const tmp = `${r.dir}/current.tmp-${process.pid}`;
    fs.symlinkSync(dir, tmp);
    fs.renameSync(tmp, r.current);
    // Mantém as versões mais recentes para retorno rápido; remove as antigas.
    const old = fs.readdirSync(r.releases).filter((n) => RELEASE_RE.test(n) && n !== release).sort().reverse().slice(KEEP_RELEASES - 1);
    for (const n of old) await asApp(r, 'rm', ['-rf', '--one-file-system', `${r.releases}/${n}`]);
    return { removidas: old };
  },

  async 'backup-banco'({ slug, timeoutMs }) {
    const r = resourcesFor(slug);
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const arquivo = `${r.backups}/${r.banco}-${stamp}.dump`;
    try {
      await run('runuser', ['-u', 'postgres', '--', 'pg_dump', '-Fc', '--no-owner', r.banco], { stdoutFile: arquivo, timeoutMs: Math.min(Number(timeoutMs) || 1_800_000, 7_200_000) });
    } catch (err) {
      fs.rmSync(arquivo, { force: true });
      throw err;
    }
    return { arquivo, tamanho: fs.statSync(arquivo).size };
  },

  async 'instalar-servico'({ slug, inicio }) {
    const r = resourcesFor(slug);
    const [exe, ...args] = validateCommand(inicio);
    const unit = renderSystemdUnit({ slug, execStart: [binFor(exe), ...args] });
    const file = `${SYSTEMD_DIR}/${r.servico}.service`;
    const current = exists(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current !== unit) {
      writeAtomic(file, unit, 0o644);
      await run('systemctl', ['daemon-reload']);
    }
    await run('systemctl', ['enable', '--quiet', `${r.servico}.service`]);
    return { alterado: current !== unit };
  },

  async servico({ slug, acao }) {
    const r = resourcesFor(slug);
    const unit = `${r.servico}.service`;
    if (acao === 'is-active') {
      const res = await run('systemctl', ['is-active', unit], { allowFail: true });
      return { estado: res.saida.trim() || 'desconhecido' };
    }
    if (!['start', 'restart', 'stop'].includes(acao)) throw new PolicyError('Ação de serviço não permitida.');
    if (!exists(`${SYSTEMD_DIR}/${unit}`)) throw new HelperError(`Serviço ${unit} não instalado.`);
    await run('systemctl', [acao, unit], { timeoutMs: 90_000 });
    return {};
  },

  async nginx({ slug, dominio, porta, ssl, opcoes }) {
    const r = resourcesFor(slug);
    const d = normalizeDomain(dominio);
    assertPort(porta);
    const conf = renderNginx({ slug, dominio: d, porta, ssl: Boolean(ssl), opcoes: normalizeNginxOptions(opcoes || {}), acmeRoot: ACME_ROOT });
    if (ssl && !exists(`/etc/letsencrypt/live/${d}/fullchain.pem`)) throw new HelperError(`Certificado de ${d} não encontrado.`);
    assertDomainFree(d, r.nginxSite);
    const { file, link } = nginxPaths(r.nginxSite);
    const previous = exists(file) ? fs.readFileSync(file, 'utf8') : null;
    const hadLink = link ? Boolean(fs.lstatSync(link, { throwIfNoEntry: false })) : true;
    writeAtomic(file, conf, 0o644);
    if (link && !hadLink) fs.symlinkSync(file, link);
    const test = await run('nginx', ['-t'], { allowFail: true });
    if (test.code !== 0) {
      // Desfaz: o Nginx continua exatamente como estava (os outros sites não são afetados).
      if (previous === null) fs.rmSync(file, { force: true }); else writeAtomic(file, previous, 0o644);
      if (link && !hadLink) fs.rmSync(link, { force: true });
      throw new HelperError('A configuração do Nginx não passou na validação (nginx -t). Nada foi aplicado.', test.saida);
    }
    await run('systemctl', ['reload', 'nginx']);
    return {};
  },

  async certificado({ slug, dominio, email }) {
    const r = resourcesFor(slug);
    const d = normalizeDomain(dominio);
    // Só emite para o domínio que esta instalação já atende no Nginx.
    const { file } = nginxPaths(r.nginxSite);
    if (!exists(file) || !fs.readFileSync(file, 'utf8').includes(`server_name ${d};`)) throw new HelperError('Configure o Nginx da instalação antes de emitir o certificado.');
    const args = ['certonly', '--webroot', '-w', ACME_ROOT, '-d', d, '--cert-name', d, '--non-interactive', '--agree-tos', '--keep-until-expiring',
      '--deploy-hook', 'systemctl reload nginx'];
    if (email) {
      if (!/^[^\s@"'\\]{1,64}@[a-z0-9.-]{3,190}$/i.test(String(email))) throw new PolicyError('E-mail para o certificado inválido.');
      args.push('--email', String(email));
    } else args.push('--register-unsafely-without-email');
    await run('certbot', args, { timeoutMs: 300_000 });
    return {};
  },

  async renovacao() {
    const timer = await run('systemctl', ['is-active', 'certbot.timer'], { allowFail: true });
    const ativa = timer.saida.trim() === 'active' || exists('/etc/cron.d/certbot');
    return { ativa };
  }
};

// ------------------------------------------------------------------ entrada
async function readStdin(limit = 1_000_000) {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > limit) throw new PolicyError('Parâmetros grandes demais.');
  }
  return data ? JSON.parse(data) : {};
}

async function main() {
  const op = process.argv[2];
  const reply = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  try {
    if (!Object.hasOwn(OPS, op)) throw new PolicyError(`Operação não permitida: ${String(op).slice(0, 40)}.`);
    if (process.getuid?.() !== 0) throw new HelperError('O auxiliar precisa ser executado como root (via sudo).');
    process.umask(0o027);
    const params = await readStdin();
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new PolicyError('Parâmetros inválidos.');
    reply({ ok: true, ...(await OPS[op](params)) });
  } catch (err) {
    reply({ ok: false, erro: err.message, saida: err.saida ? String(err.saida).slice(-20_000) : undefined });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export const OPERACOES = Object.keys(OPS);
