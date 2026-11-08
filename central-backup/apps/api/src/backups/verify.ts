// Verificação feita pela CENTRAL (a carga não cai no servidor do cliente). Um snapshot só vira
// "validado" quando passa nas três etapas:
//   1. existe no repositório com o id informado pelo agente;
//   2. `restic check --read-data-subset=N%`: estrutura do repositório + leitura real de parte dos dados;
//   3. conteúdo: arquivos → a listagem do snapshot tem os arquivos que o agente disse ter enviado;
//      bancos → o dump é extraído do repositório e lido por um validador do motor
//      (pg_restore --list, cabeçalho/rodapé do mysqldump, cabeçalho do archive do mongodump,
//      integrity_check do SQLite).
// Falha de infraestrutura (restic ausente, repositório travado) tenta de novo até 3 vezes;
// falha de conteúdo marca "falha_verificacao" na hora.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, createWriteStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import type { Database } from '@central/database';
import { redact } from '@central/shared';
import { audit, SYSTEM } from '../audit.ts';
import type { SecretStore } from '../secrets.ts';
import { repositoryAccess, type DestinationRow } from '../storage/destinations.ts';
import { restic } from '../storage/restic.ts';

class VerifyError extends Error {
  readonly kind: 'infra' | 'conteudo';
  constructor(kind: 'infra' | 'conteudo', message: string) { super(message); this.kind = kind; }
}
const infra = (m: string) => new VerifyError('infra', m);
const content = (m: string) => new VerifyError('conteudo', m);

/** `restic dump` com a saída entregue a um consumidor de stream (sem guardar o dump em memória). */
export function resticDump<T>(bin: string, repo: string, password: string, env: Record<string, string>, args: string[],
  consume: (stdout: NodeJS.ReadableStream) => Promise<T>, timeoutMs = 30 * 60_000): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-dump-'));
  const pw = path.join(dir, 'pw');
  writeFileSync(pw, password, { mode: 0o600 });
  const child = spawn(bin, ['--no-cache', '--quiet', 'dump', ...args], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: dir, TMP: dir, HOME: dir, RESTIC_REPOSITORY: repo, RESTIC_PASSWORD_FILE: pw, ...env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: timeoutMs
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (c: string) => { if (stderr.length < 8000) stderr += c; });
  const exit = new Promise<number>((r) => child.on('close', (code) => r(code ?? -1)));
  return (async () => {
    try {
      const [value, code] = await Promise.all([consume(child.stdout), exit]);
      if (code !== 0) throw infra(`restic dump falhou (${code}): ${redact(stderr, [password, ...Object.values(env)]).slice(0, 500)}`);
      return value;
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

/** Lê o começo e o fim de um stream, contando bytes. */
async function headTail(stream: NodeJS.ReadableStream, n = 4096) {
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (head.length < n) head = Buffer.concat([head, chunk]).subarray(0, n);
    tail = Buffer.concat([tail, chunk]);
    if (tail.length > n) tail = tail.subarray(tail.length - n);
  }
  return { head, tail, bytes };
}

/** Passa o stream para um programa validador pelo stdin; devolve a saída. */
export function pipeTo(bin: string, args: string[], stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => { if (out.length < 2_000_000) out += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { if (err.length < 8000) err += c; });
    child.on('error', (e) => reject(infra(`${path.basename(bin)} indisponível na central: ${e.message}`)));
    child.stdin.on('error', () => { /* validador encerrou antes do fim do stream */ });
    stream.pipe(child.stdin);
    child.on('close', (code) => code === 0 ? resolve(out) : reject(content(`${path.basename(bin)} recusou o dump: ${err.trim().split('\n').slice(-3).join(' ')}`)));
  });
}

async function checkDump(engine: string, filename: string, dump: <T>(c: (s: NodeJS.ReadableStream) => Promise<T>) => Promise<T>, tools: { pgRestore: string }) {
  switch (engine) {
    case 'postgresql': {
      const toc = await dump((s) => pipeTo(tools.pgRestore, ['--list'], s));
      const entries = toc.split('\n').filter((l) => l && !l.startsWith(';')).length;
      if (entries === 0) throw content('o dump não tem nenhum objeto (pg_restore --list vazio).');
      return { validador: 'pg_restore --list', objetos: entries };
    }
    case 'mysql': case 'mariadb': {
      const { head, tail, bytes } = await dump((s) => headTail(s));
      const h = head.toString('utf8');
      if (!/^-- (MySQL|MariaDB) dump/m.test(h)) throw content('o arquivo não começa como um dump do mysqldump/mariadb-dump.');
      if (!/-- Dump completed/.test(tail.toString('utf8'))) throw content('o dump não termina com "Dump completed" (incompleto).');
      return { validador: 'cabeçalho e rodapé do mysqldump', bytes };
    }
    case 'mongodb': {
      const { head, bytes } = await dump((s) => headTail(s, 16));
      if (head.readUInt32LE(0) !== 0x8199e26d) throw content('o arquivo não é um archive do mongodump.');
      return { validador: 'cabeçalho do archive do mongodump', bytes };
    }
    case 'sqlite': {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-sqlite-'));
      try {
        const file = path.join(dir, 'v.sqlite');
        await dump((s) => new Promise<void>((resolve, reject) => { const w = createWriteStream(file); s.pipe(w); w.on('finish', resolve); w.on('error', reject); }));
        let check: string;
        try {
          const db = new DatabaseSync(file, { readOnly: true });
          try { check = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]).join('; '); } finally { db.close(); }
        } catch (err) { throw content(`o arquivo não abre como SQLite: ${(err as Error).message}`); }
        if (check !== 'ok') throw content(`integrity_check: ${check.slice(0, 300)}`);
        return { validador: 'PRAGMA integrity_check', resultado: 'ok' };
      } finally {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
      }
    }
    default:
      throw infra(`sem validador para ${engine} (${filename})`);
  }
}

export async function verifySnapshot(db: Database, store: SecretStore, tools: { restic: string; pgRestore: string }, snapshotId: number) {
  // 1) reserva o snapshot e lê o acesso de manutenção (transação curta)
  const ctx = await db.system(async (tx) => {
    const s = await tx.one(`SELECT s.*, j.kind, j.database_id, p.verify_subset_percent, r.summary
      FROM backup_snapshots s JOIN backup_jobs j ON j.id = s.job_id JOIN backup_policies p ON p.id = j.policy_id
      LEFT JOIN backup_runs r ON r.id = s.run_id
      WHERE s.id = $1 AND s.status = 'nao_verificado' FOR UPDATE OF s SKIP LOCKED`, [snapshotId]);
    if (!s) return null;
    const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1', [s.repository_id]);
    const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo!.destination_id]) as DestinationRow;
    const access = await repositoryAccess(tx, store, dest, repo!);
    const engine = s.database_id ? (await tx.one('SELECT engine FROM databases WHERE id = $1', [s.database_id]))?.engine : null;
    await tx.query("UPDATE backup_snapshots SET status = 'verificando', verify_attempts = verify_attempts + 1 WHERE id = $1", [s.id]);
    return { s, access, engine };
  });
  if (!ctx) return null;
  const { s, access, engine } = ctx;
  const opts = { repo: access.maintenanceRepo, password: access.password, env: access.maintenanceEnv };
  const details: Record<string, unknown> = {};
  let outcome: { ok: true } | { ok: false; error: VerifyError };
  try {
    const list = await restic(tools.restic, ['snapshots', '--json', s.restic_id], { ...opts, timeoutMs: 120_000 });
    if (list.code !== 0) throw infra(`restic snapshots falhou: ${list.stderr}`);
    const found = (JSON.parse(list.stdout || '[]') as { id: string }[]).find((x) => x.id === s.restic_id);
    if (!found) throw content('o snapshot informado pelo agente não existe no repositório.');
    details.snapshot = 'encontrado';

    const check = await restic(tools.restic, ['check', `--read-data-subset=${s.verify_subset_percent}%`], { ...opts, timeoutMs: 6 * 3600_000 });
    if (check.code !== 0) {
      if (/locked|unable to create lock/i.test(check.stderr)) throw infra(`repositório em uso: ${check.stderr}`);
      throw content(`restic check encontrou problemas: ${check.stderr.slice(0, 1500)}`);
    }
    details.check = `ok (${s.verify_subset_percent}% dos dados lidos)`;

    if (s.kind === 'arquivos') {
      const ls = await restic(tools.restic, ['ls', '--json', s.restic_id], { ...opts, timeoutMs: 30 * 60_000 });
      if (ls.code !== 0) throw infra(`restic ls falhou: ${ls.stderr}`);
      let files = 0;
      for (const line of ls.stdout.split('\n')) {
        if (!line.startsWith('{')) continue;
        try { if (JSON.parse(line).type === 'file') files++; } catch { /* ignora */ }
      }
      const expected = Number(s.summary?.total_files_processed ?? s.files ?? 0);
      details.arquivos = { no_snapshot: files, informados_pelo_agente: expected };
      if (s.summary?.incomplete ? files === 0 : files !== expected) throw content(`o snapshot tem ${files} arquivo(s); o agente informou ${expected}.`);
    } else {
      const fname = `/${s.stdin_filename}`;
      details.dump = await checkDump(engine!, s.stdin_filename, (consume) => resticDump(tools.restic, opts.repo, opts.password, opts.env, [s.restic_id, fname], consume), tools);
    }
    outcome = { ok: true };
  } catch (err) {
    outcome = { ok: false, error: err instanceof VerifyError ? err : infra((err as Error).message) };
  }

  // 3) grava o resultado
  return db.system(async (tx) => {
    let status: string;
    let error: string | null = null;
    if (outcome.ok) status = 'validado';
    else {
      error = redact(outcome.error.message, [opts.password, ...Object.values(opts.env)]).slice(0, 2000);
      status = outcome.error.kind === 'infra' && s.verify_attempts + 1 < 3 ? 'nao_verificado' : 'falha_verificacao';
    }
    await tx.query(`UPDATE backup_snapshots SET status = $2, verified_at = CASE WHEN $2 = 'nao_verificado' THEN verified_at ELSE now() END,
      verify_details = $3, verify_error = $4 WHERE id = $1`, [s.id, status, JSON.stringify(details), error]);
    if (status !== 'nao_verificado') {
      if (s.run_id) await tx.query("UPDATE backup_runs SET status = $2 WHERE id = $1 AND status = 'concluido'", [s.run_id, status]);
      await tx.query(`UPDATE backup_jobs SET last_status = $2, last_success_at = CASE WHEN $2 = 'validado' THEN $3 ELSE last_success_at END WHERE id = $1`,
        [s.job_id, status, s.taken_at]);
      await tx.query('UPDATE backup_repositories SET last_check_at = now(), last_check_ok = $2 WHERE id = $1', [s.repository_id, status === 'validado']);
      await audit(tx, SYSTEM, { action: `snapshot.${status}`, entity: 'snapshot', entityId: s.id, clientId: s.client_id, details: { erro: error?.slice(0, 300) } });
    }
    return { status, error, details };
  });
}

export async function verifyPending(db: Database, store: SecretStore, tools: { restic: string; pgRestore: string }, limit = 2) {
  const rows = await db.system((tx) => tx.many("SELECT id FROM backup_snapshots WHERE status = 'nao_verificado' ORDER BY id LIMIT $1", [limit]));
  const out = [];
  for (const r of rows) out.push(await verifySnapshot(db, store, tools, Number(r.id)));
  return out.filter(Boolean);
}
