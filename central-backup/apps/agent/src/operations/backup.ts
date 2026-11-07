// Backups executados pelo agente com restic.
//   - Repositório, senha do repositório e credenciais do backend chegam selados; a senha vai por
//     arquivo temporário 0600 (RESTIC_PASSWORD_FILE), nunca por argumento.
//   - Prioridade baixa: nice 19 no processo do restic (a unit systemd ainda aplica CPUQuota e IO idle).
//   - Bancos: o dump roda via `restic backup --stdin-from-command`; se o dump falhar, o restic não
//     grava snapshot (nada de backup "ok" com dump pela metade). SQLite usa cópia consistente
//     (VACUUM INTO) enviada por stdin.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import type { DbTarget } from '@central/contracts';
import { which } from './db.ts';

type Log = (level: 'info' | 'warn' | 'error', message: string) => void;
export interface BackupSummary {
  snapshot_id: string;
  files_new: number; files_changed: number; files_unmodified: number;
  total_files_processed: number; total_bytes_processed: number; data_added: number;
  duration_s: number;
  /** restic saiu com código 3: snapshot criado, mas algum arquivo não pôde ser lido */
  incomplete: boolean;
  errors: string[];
}

export function resticBin() {
  return process.env.RESTIC_BIN || which('restic');
}

export interface RepoSecrets { repository: string; repo_password: string; repo_env?: string }

export function repoEnv(s: RepoSecrets): Record<string, string> {
  if (!s.repository || !s.repo_password) throw new Error('Repositório ou senha ausentes na tarefa.');
  const extra = s.repo_env ? JSON.parse(s.repo_env) as Record<string, unknown> : {};
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (!/^(AWS_[A-Z_]+|B2_[A-Z_]+|RESTIC_[A-Z_]+)$/.test(k) || typeof v !== 'string') throw new Error(`Variável de backend não permitida: ${k}`);
    if (k === 'RESTIC_PASSWORD_COMMAND') throw new Error('RESTIC_PASSWORD_COMMAND não é permitido.');
    env[k] = v;
  }
  return env;
}

/** Executa `restic backup --json …` e devolve o resumo. */
async function resticBackup(args: string[], opts: {
  secrets: RepoSecrets; signal: AbortSignal; log: Log; stateDir: string; childEnv?: Record<string, string>; stdinFile?: string; limitKbps?: number; tags: string[];
}): Promise<BackupSummary> {
  const bin = resticBin();
  if (!bin) throw new Error('restic não encontrado no servidor (instale o pacote restic ≥ 0.17).');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cagent-bk-'));
  const pw = path.join(tmp, 'pw');
  writeFileSync(pw, opts.secrets.repo_password, { mode: 0o600 });
  const cache = path.join(opts.stateDir, 'restic-cache');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const full = ['backup', '--json', '--cache-dir', cache, ...opts.tags.flatMap((t) => ['--tag', t]),
    ...(opts.limitKbps ? ['--limit-upload', String(opts.limitKbps)] : []), ...args];
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin', HOME: opts.stateDir, TMPDIR: tmp, TEMP: tmp, TMP: tmp,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    RESTIC_REPOSITORY: opts.secrets.repository, RESTIC_PASSWORD_FILE: pw, ...repoEnv(opts.secrets), ...opts.childEnv
  };
  const started = Date.now();
  try {
    return await new Promise<BackupSummary>((resolve, reject) => {
      const child = spawn(bin, full, { env, stdio: [opts.stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true, signal: opts.signal });
      try { if (child.pid) os.setPriority(child.pid, 19); } catch { /* sem permissão para mudar prioridade */ }
      if (opts.stdinFile) {
        const rs = createReadStream(opts.stdinFile);
        rs.on('error', (e) => { child.kill(); reject(e); });
        rs.pipe(child.stdin!);
      }
      let summary: Record<string, any> | null = null;
      const errors: string[] = [];
      let buf = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('{')) continue;
          try {
            const m = JSON.parse(line);
            if (m.message_type === 'summary') summary = m;
            else if (m.message_type === 'error' && errors.length < 50) {
              const msg = `${m.item ?? ''}: ${m.error?.message ?? JSON.stringify(m.error)}`;
              errors.push(msg);
              opts.log('warn', `restic: ${msg}`);
            }
          } catch { /* linha não-JSON */ }
        }
      });
      child.stderr!.setEncoding('utf8').on('data', (c: string) => { if (stderr.length < 20_000) stderr += c; });
      child.on('error', reject);
      child.on('close', (code) => {
        const tail = stderr.trim().split('\n').slice(-5).join(' ');
        if ((code === 0 || code === 3) && summary?.snapshot_id) {
          resolve({
            snapshot_id: String(summary.snapshot_id), files_new: summary.files_new ?? 0, files_changed: summary.files_changed ?? 0,
            files_unmodified: summary.files_unmodified ?? 0, total_files_processed: summary.total_files_processed ?? 0,
            total_bytes_processed: summary.total_bytes_processed ?? 0, data_added: summary.data_added ?? 0,
            duration_s: Math.round((Date.now() - started) / 1000), incomplete: code === 3, errors
          });
        } else {
          reject(new Error(`restic backup terminou com código ${code}${tail ? `: ${tail}` : ''}`));
        }
      });
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function backupFiles(params: { paths: string[]; excludes: string[]; tags: string[]; limit_upload_kbps?: number }, secrets: RepoSecrets, ctx: { signal: AbortSignal; log: Log; stateDir: string }) {
  const missing = params.paths.filter((p) => { try { statSync(p); return false; } catch { return true; } });
  if (missing.length === params.paths.length) throw new Error(`Nenhum dos caminhos existe no servidor: ${missing.join(', ')}`);
  for (const m of missing) ctx.log('warn', `Caminho não encontrado (ignorado): ${m}`);
  const present = params.paths.filter((p) => !missing.includes(p));
  const summary = await resticBackup([...params.excludes.flatMap((e) => ['--exclude', e]), '--', ...present], { ...ctx, secrets, tags: params.tags, limitKbps: params.limit_upload_kbps });
  return { ...summary, missing_paths: missing };
}

/** Comando de dump por motor; senhas por variável de ambiente ou arquivo 0600 (nunca na linha de comando). */
function dumpCommand(target: DbTarget, password: string | undefined, tmp: string): { cmd: string[]; env: Record<string, string> } {
  switch (target.engine) {
    case 'postgresql': {
      const bin = which('pg_dump');
      if (!bin) throw new Error('pg_dump não encontrado no servidor (instale postgresql-client na versão do servidor).');
      const env: Record<string, string> = { PGAPPNAME: 'central-agent-backup', PGCONNECT_TIMEOUT: '15' };
      if (target.socket_path) env.PGHOST = target.socket_path; else if (target.host) env.PGHOST = target.host;
      if (target.port) env.PGPORT = String(target.port);
      if (target.user) env.PGUSER = target.user;
      if (password) env.PGPASSWORD = password;
      return { cmd: [bin, '--format=custom', '--no-password', '--dbname', target.db_name!], env };
    }
    case 'mysql': case 'mariadb': {
      const bin = (target.engine === 'mariadb' ? which('mariadb-dump') : null) ?? which('mysqldump') ?? which('mariadb-dump');
      if (!bin) throw new Error('mysqldump/mariadb-dump não encontrado no servidor.');
      const cnf = path.join(tmp, 'client.cnf');
      const lines = ['[client]', target.user && `user=${target.user}`, password && `password="${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        target.socket_path ? `socket=${target.socket_path}` : target.host && `host=${target.host}`, target.port && `port=${target.port}`].filter(Boolean);
      writeFileSync(cnf, lines.join('\n') + '\n', { mode: 0o600 });
      return { cmd: [bin, `--defaults-extra-file=${cnf}`, '--single-transaction', '--quick', '--routines', '--triggers', '--events', '--databases', target.db_name!], env: {} };
    }
    case 'mongodb': {
      const bin = which('mongodump');
      if (!bin) throw new Error('mongodump não encontrado no servidor (instale mongodb-database-tools).');
      const args = [bin, '--host', target.host ?? '127.0.0.1', '--port', String(target.port ?? 27017), '--db', target.db_name!, '--archive', '--gzip', '--quiet'];
      if (target.user) {
        const conf = path.join(tmp, 'mongodump.yaml');
        writeFileSync(conf, `password: ${JSON.stringify(password ?? '')}\n`, { mode: 0o600 });
        args.push('--username', target.user, '--authenticationDatabase', 'admin', `--config=${conf}`);
      }
      return { cmd: args, env: {} };
    }
    default:
      throw new Error(`Motor sem dump por comando: ${target.engine}`);
  }
}

export async function backupDatabase(params: { target: DbTarget; filename: string; tags: string[]; limit_upload_kbps?: number }, secrets: RepoSecrets & { password?: string }, ctx: { signal: AbortSignal; log: Log; stateDir: string }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cagent-dump-'));
  const common = { ...ctx, secrets, tags: params.tags, limitKbps: params.limit_upload_kbps };
  try {
    if (params.target.engine === 'sqlite') {
      // cópia consistente mesmo com o banco em uso (sem travar escritores por muito tempo)
      const copy = path.join(tmp, 'copia.sqlite');
      const db = new DatabaseSync(params.target.file_path!, { readOnly: true });
      try { db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`); } finally { db.close(); }
      ctx.log('info', `Cópia consistente do SQLite: ${statSync(copy).size} bytes.`);
      return await resticBackup(['--stdin', '--stdin-filename', params.filename], { ...common, stdinFile: copy });
    }
    const { cmd, env } = dumpCommand(params.target, secrets.password, tmp);
    ctx.log('info', `Dump de ${params.target.engine} (${params.target.db_name}) enviado direto ao restic.`);
    return await resticBackup(['--stdin-filename', params.filename, '--stdin-from-command', '--', ...cmd], { ...common, childEnv: env });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
