// Executor REAL para Ubuntu/Debian. Operações que exigem root são delegadas ao script
// auxiliar (deploy/implantacao/helper.mjs, instalado como root) por meio de UMA regra de
// sudoers. Os parâmetros vão em JSON pela entrada padrão — nunca na linha de comando,
// para que senhas não apareçam na lista de processos.
import { spawn } from 'node:child_process';
import tls from 'node:tls';
import pg from 'pg';
import { env } from '../../config/env.js';

const NODE_BIN = process.env.IMPLANTACAO_NODE || '/usr/bin/node';

function helper(op, params = {}, { timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', NODE_BIN, env.implantacao.helper, op], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Tempo esgotado em ${op}.`)); }, timeoutMs + 10_000);
    child.stdout.on('data', (d) => { out += d; if (out.length > 2_000_000) out = out.slice(-1_000_000); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200_000) err = err.slice(-100_000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Não foi possível chamar o auxiliar (${e.message}). O servidor foi preparado com deploy/implantacao/preparar-servidor.sh?`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').pop() || '';
      let res;
      try { res = JSON.parse(line); } catch { res = null; }
      if (res?.ok) return resolve(res);
      const msg = res?.erro || err.trim().split('\n').slice(-5).join(' ') || `código ${code}`;
      if (/a password is required|sudo:/.test(err)) return reject(new Error('sudo recusou a operação: confira /etc/sudoers.d/vitrine-implantacao.'));
      const e = new Error(msg);
      e.saida = res?.saida;
      reject(e);
    });
    child.stdin.end(JSON.stringify({ ...params, timeoutMs }));
  });
}

async function withOutput(promise) {
  try { return await promise; } catch (err) {
    if (err.saida) err.message = `${err.message}\n${err.saida}`;
    throw err;
  }
}

export function createLinuxExecutor() {
  return {
    nome: 'linux',
    pollMs: 2000,
    checkRequirements: (o) => helper('requisitos', o).then((r) => r.info),
    ensureUser: (r) => helper('criar-usuario', { slug: r.slug }),
    prepareDirs: (r, dirs) => helper('preparar-diretorios', { slug: r.slug, dirs }),
    fetchCode: (r, o) => withOutput(helper('obter-codigo', { slug: r.slug, ...o }, { timeoutMs: 10 * 60_000 })),
    ensureDatabase: (r, { password }) => helper('criar-banco', { slug: r.slug, password }),
    writeEnv: (r, vars) => helper('gravar-env', { slug: r.slug, vars }),
    runAppCommand: (r, argv, { cwd, timeoutMs, useEnvFile }) => withOutput(helper('executar', { slug: r.slug, argv, cwd, useEnvFile }, { timeoutMs })),
    activateRelease: (r, o) => helper('ativar-versao', { slug: r.slug, ...o }),
    backupDatabase: (r, o) => helper('backup-banco', { slug: r.slug, ...o }, { timeoutMs: 30 * 60_000 }),
    installService: (r, { inicio }) => helper('instalar-servico', { slug: r.slug, inicio }),
    serviceAction: (r, action) => helper('servico', { slug: r.slug, acao: action }),
    writeNginx: (r, o) => withOutput(helper('nginx', { slug: r.slug, ...o })),
    issueCertificate: (r, o) => withOutput(helper('certificado', { slug: r.slug, ...o }, { timeoutMs: 5 * 60_000 })),

    async certificateInfo(dominio) {
      const validTo = await new Promise((resolve, reject) => {
        // Conecta no próprio servidor apresentando o domínio (SNI): a cadeia e o nome são validados pelo Node.
        const socket = tls.connect({ host: '127.0.0.1', port: 443, servername: dominio, timeout: 10_000 }, () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert?.valid_to) return reject(new Error('Nenhum certificado apresentado.'));
          resolve(new Date(cert.valid_to).toISOString());
        });
        socket.on('error', reject);
        socket.on('timeout', () => { socket.destroy(); reject(new Error('Tempo esgotado na conexão TLS.')); });
      });
      const renew = await helper('renovacao', {}).then((x) => x.ativa).catch(() => false);
      return { expira_em: validTo, renovacao_automatica: renew };
    },

    async dbPing(url) {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
      try { await client.connect(); await client.query('SELECT 1'); } finally { await client.end().catch(() => {}); }
    },

    async httpGet(url) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        const body = (await res.text()).slice(0, 200_000);
        return { status: res.status, body };
      } catch (err) {
        return { error: err.cause?.code || err.message };
      }
    }
  };
}
