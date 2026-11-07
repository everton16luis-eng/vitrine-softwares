// Bancos de dados: descoberta e teste de conexão. Senhas chegam seladas e vão para a ferramenta
// por variável de ambiente do processo filho ou arquivo temporário 0600 — nunca por argumento.
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import type { DbTarget } from '@central/contracts';
import { run } from '../system.ts';

export function which(cmd: string): string | null {
  const dirs = (process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin').split(path.delimiter).concat(['/usr/local/bin', '/usr/bin', '/usr/lib/postgresql']);
  for (const d of dirs) {
    for (const name of process.platform === 'win32' ? [`${cmd}.exe`, cmd] : [cmd]) {
      const p = path.join(d, name);
      try { if (statSync(p).isFile()) return p; } catch { /* segue */ }
    }
  }
  // PostgreSQL no Debian/Ubuntu: /usr/lib/postgresql/<versão>/bin
  if (process.platform === 'linux' && existsSync('/usr/lib/postgresql')) {
    const versions = readdirSync('/usr/lib/postgresql').filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) { const p = `/usr/lib/postgresql/${v}/bin/${cmd}`; if (existsSync(p)) return p; }
  }
  return null;
}

async function toolVersion(bin: string): Promise<string | null> {
  try { return (await run(bin, ['--version'], { timeoutMs: 5000 })).trim().split('\n')[0]!.slice(0, 200); } catch { return null; }
}

function listeningPorts(): Set<number> {
  const ports = new Set<number>();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols[3] === '0A') ports.add(parseInt(cols[1]!.split(':').pop()!, 16)); // 0A = LISTEN
      }
    } catch { /* não-Linux */ }
  }
  return ports;
}

const TOOLS = ['psql', 'pg_dump', 'pg_restore', 'pgbackrest', 'mysql', 'mysqldump', 'mariadb', 'mariadb-dump', 'mongosh', 'mongodump', 'mongorestore', 'sqlite3', 'restic'];
const PORTS: [number, DbTarget['engine']][] = [[5432, 'postgresql'], [3306, 'mysql'], [27017, 'mongodb']];

export async function discover(signal?: AbortSignal) {
  const tools: Record<string, { path: string; version: string | null } | null> = {};
  for (const t of TOOLS) {
    signal?.throwIfAborted();
    const p = which(t);
    tools[t] = p ? { path: p, version: await toolVersion(p) } : null;
  }
  const candidates: { engine: string; host?: string; port?: number; source: string; detail?: string }[] = [];
  const ports = listeningPorts();
  for (const [port, engine] of PORTS) if (ports.has(port)) candidates.push({ engine, host: '127.0.0.1', port, source: 'porta em escuta' });
  if (existsSync('/etc/postgresql')) {
    for (const v of readdirSync('/etc/postgresql')) {
      for (const cluster of readdirSync(path.join('/etc/postgresql', v))) {
        let port: number | undefined;
        try { port = Number(/^\s*port\s*=\s*(\d+)/m.exec(readFileSync(path.join('/etc/postgresql', v, cluster, 'postgresql.conf'), 'utf8'))?.[1]) || undefined; } catch { /* sem leitura */ }
        candidates.push({ engine: 'postgresql', port, source: 'cluster PostgreSQL', detail: `${v}/${cluster}` });
      }
    }
  }
  let units: string[] = [];
  if (process.platform === 'linux') {
    try {
      units = (await run('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'], { signal }))
        .split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '').filter((u) => /postgres|mysql|mariadb|mongod/i.test(u));
    } catch { /* sem systemd */ }
  }
  return { candidates, systemd_units: units, tools, note: 'Bancos SQLite não são descobertos automaticamente: cadastre o caminho do arquivo.' };
}

type TestResult = { ok: boolean; version?: string; size_bytes?: number; error?: string };
const fail = (error: string): TestResult => ({ ok: false, error: error.slice(0, 1000) });

export async function testConnection(target: DbTarget, password: string | undefined, signal?: AbortSignal): Promise<TestResult> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cagent-'));
  try {
    switch (target.engine) {
      case 'postgresql': {
        const psql = which('psql');
        if (!psql) return fail('Ferramenta psql não encontrada no servidor (instale postgresql-client).');
        const env: Record<string, string> = { PGCONNECT_TIMEOUT: '10', PGDATABASE: target.db_name ?? 'postgres', PGAPPNAME: 'central-agent' };
        if (target.socket_path) env.PGHOST = target.socket_path; else if (target.host) env.PGHOST = target.host;
        if (target.port) env.PGPORT = String(target.port);
        if (target.user) env.PGUSER = target.user;
        if (password) env.PGPASSWORD = password;
        try {
          const out = await run(psql, ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT current_setting('server_version') || '|' || pg_database_size(current_database())"], { signal, timeoutMs: 20_000, env });
          const [version, size] = out.trim().split('|');
          return { ok: true, version: `PostgreSQL ${version}`, size_bytes: Number(size) };
        } catch (err) { return fail(stderrOf(err)); }
      }
      case 'mysql': case 'mariadb': {
        const bin = which(target.engine === 'mariadb' ? 'mariadb' : 'mysql') ?? which('mysql') ?? which('mariadb');
        if (!bin) return fail('Cliente mysql/mariadb não encontrado no servidor.');
        const cnf = path.join(tmp, 'client.cnf');
        const lines = ['[client]', target.user && `user=${target.user}`, password && `password="${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
          target.socket_path ? `socket=${target.socket_path}` : target.host && `host=${target.host}`, target.port && `port=${target.port}`, 'connect-timeout=10'].filter(Boolean);
        writeFileSync(cnf, lines.join('\n') + '\n', { mode: 0o600 });
        try {
          const out = await run(bin, [`--defaults-extra-file=${cnf}`, '-N', '-B', '-e',
            'SELECT VERSION(), (SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE())', target.db_name ?? ''], { signal, timeoutMs: 20_000 });
          const [version, size] = out.trim().split('\t');
          return { ok: true, version: `${target.engine === 'mariadb' || /mariadb/i.test(version ?? '') ? 'MariaDB' : 'MySQL'} ${version}`, size_bytes: Number(size) };
        } catch (err) { return fail(stderrOf(err)); }
      }
      case 'sqlite': {
        if (!target.file_path || !existsSync(target.file_path)) return fail(`Arquivo ${target.file_path} não encontrado.`);
        const head = Buffer.alloc(16);
        const fd = openSync(target.file_path, 'r');
        try { readSync(fd, head, 0, 16, 0); } finally { closeSync(fd); }
        if (head.toString('latin1') !== 'SQLite format 3\u0000') return fail('O arquivo não é um banco SQLite.');
        try {
          const db = new DatabaseSync(target.file_path, { readOnly: true });
          try {
            const check = db.prepare('PRAGMA quick_check').all().map((r) => Object.values(r)[0]).join('; ');
            const version = String(Object.values(db.prepare('SELECT sqlite_version() AS v').get() ?? {})[0]);
            if (check !== 'ok') return { ok: false, version: `SQLite ${version}`, error: `quick_check: ${check}`.slice(0, 1000) };
            return { ok: true, version: `SQLite ${version}`, size_bytes: statSync(target.file_path).size };
          } finally { db.close(); }
        } catch (err) { return fail((err as Error).message); }
      }
      case 'mongodb': {
        const mongosh = which('mongosh');
        if (!mongosh) return fail('Ferramenta mongosh não encontrada no servidor.');
        const auth = target.user ? `${encodeURIComponent(target.user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
        const uri = `mongodb://${auth}${target.host ?? '127.0.0.1'}:${target.port ?? 27017}/${target.db_name ?? 'admin'}?serverSelectionTimeoutMS=10000${target.user ? '&authSource=admin' : ''}`;
        const script = path.join(tmp, 'teste.js');
        writeFileSync(script, `const d = connect(${JSON.stringify(uri)}); const s = d.stats(); print(JSON.stringify({ v: d.version(), size: (s.dataSize || 0) + (s.indexSize || 0) }));\n`, { mode: 0o600 });
        try {
          const out = JSON.parse((await run(mongosh, ['--nodb', '--quiet', '--file', script], { signal, timeoutMs: 30_000 })).trim().split('\n').pop()!);
          return { ok: true, version: `MongoDB ${out.v}`, size_bytes: Number(out.size) };
        } catch (err) { return fail(stderrOf(err).replace(uri, '***')); }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function stderrOf(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return String(e.stderr || e.message || err).trim().split('\n').slice(-3).join(' ');
}
