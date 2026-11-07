// Restauração executada pelo agente. Regras:
//   - arquivos: só em diretório NOVO ou vazio (temporário do agente por padrão). Restaurar por cima
//     dos arquivos de produção exige um auxiliar privilegiado que esta versão não inclui (a central
//     recusa esse modo);
//   - bancos: "novo" cria um banco/arquivo novo, sem tocar no original; "producao" sobrescreve o
//     original e só chega aqui depois de dupla aprovação e backup de segurança validado (central).
//     PostgreSQL em produção usa --single-transaction: ou restaura tudo, ou nada muda.
//   - o dump sai do repositório por `restic dump` direto para a ferramenta do motor (sem cópia
//     intermediária, exceto SQLite, que é gravado ao lado e trocado de forma atômica).
import { spawn, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync, renameSync, createWriteStream, lstatSync } from 'node:fs';
import { Transform } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import type { DbTarget } from '@central/contracts';
import { which } from './db.ts';
import { resticBin, repoEnv, type RepoSecrets } from './backup.ts';
import { run } from '../system.ts';

type Log = (level: 'info' | 'warn' | 'error', message: string) => void;
interface Ctx { signal: AbortSignal; log: Log; stateDir: string }

function resticEnv(secrets: RepoSecrets, stateDir: string) {
  const bin = resticBin();
  if (!bin) throw new Error('restic não encontrado no servidor.');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cagent-rs-'));
  const pw = path.join(tmp, 'pw');
  writeFileSync(pw, secrets.repo_password, { mode: 0o600 });
  const cache = path.join(stateDir, 'restic-cache');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin', HOME: stateDir, TMPDIR: tmp, TEMP: tmp, TMP: tmp,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    RESTIC_REPOSITORY: secrets.repository, RESTIC_PASSWORD_FILE: pw, RESTIC_CACHE_DIR: cache, ...repoEnv(secrets)
  };
  return { bin, env, tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function lowPriority(pid: number | undefined) { try { if (pid) os.setPriority(pid, 19); } catch { /* sem permissão */ } }

function collect(child: ReturnType<typeof spawn>, which: 'stdout' | 'stderr', max = 20_000) {
  let s = '';
  child[which]?.setEncoding('utf8').on('data', (c: string) => { if (s.length < max) s += c; });
  return () => s;
}

/** Conta arquivos e bytes de um diretório (sem seguir links). */
function tally(dir: string) {
  let files = 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { files++; bytes += lstatSync(p).size; }
    }
  };
  walk(dir);
  return { files, bytes };
}

export async function restoreFiles(params: { restore_id: string; snapshot: string; includes: string[]; target_dir?: string; discard?: boolean }, secrets: RepoSecrets, ctx: Ctx) {
  if (params.discard && params.target_dir) throw new Error('Teste de restauração só no diretório temporário do agente.');
  const target = params.target_dir ?? path.join(ctx.stateDir, 'restores', params.restore_id);
  if (existsSync(target) && readdirSync(target).length) throw new Error(`O destino ${target} já existe e não está vazio: a restauração não sobrescreve arquivos.`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const r = resticEnv(secrets, ctx.stateDir);
  let warnings: string[] = [];
  try {
    const args = ['restore', params.snapshot, '--target', target, '--verify', '--json', ...params.includes.flatMap((i) => ['--include', i])];
    ctx.log('info', `Restaurando snapshot ${params.snapshot.slice(0, 8)} em ${target}.`);
    warnings = await new Promise<string[]>((resolve, reject) => {
      const child = spawn(r.bin, args, { env: r.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: ctx.signal });
      lowPriority(child.pid);
      const err = collect(child, 'stderr');
      collect(child, 'stdout');
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) return resolve([]);
        // erros só de METADADOS (dono, data, atributos estendidos, ACL) não invalidam o conteúdo:
        // acontecem ao restaurar sem root no Linux ou em pastas protegidas no Windows
        const errors = err().split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter((m) => m?.message_type === 'error').map((m) => String(m.error?.message ?? ''));
        const metadata = /failed to restore timestamp|lchown|chown|xattr|security descriptor/i;
        if (code === 1 && errors.length && errors.every((e) => metadata.test(e))) return resolve(errors.slice(0, 20));
        reject(new Error(`restic restore terminou com código ${code}: ${err().trim().split('\n').slice(-5).join(' ')}`));
      });
    });
  } finally { r.cleanup(); }
  for (const w of warnings) ctx.log('warn', `Metadado não restaurado: ${w}`);
  const t = tally(target);
  ctx.log('info', `Restaurados ${t.files} arquivo(s), ${t.bytes} bytes.`);
  if (params.discard) {
    // o alvo foi criado por esta execução dentro de <estado>/restores/<id>: só ele é apagado
    discardTree(target);
    ctx.log('info', 'Teste de restauração: arquivos conferidos e descartados.');
  }
  return { target_dir: target, files_restored: t.files, bytes_restored: t.bytes, metadata_warnings: warnings, ...(params.discard ? { discarded: true } : {}) };
}

/** `restic dump` → stdin de um programa. Falha se qualquer um dos dois falhar. */
async function dumpInto(r: ReturnType<typeof resticEnv>, snapshot: string, filename: string, consumer: { cmd: string; args: string[]; env?: Record<string, string> }, ctx: Ctx, transform?: Transform) {
  const dump = spawn(r.bin, ['dump', snapshot, `/${filename}`], { env: r.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: ctx.signal });
  const tool = spawn(consumer.cmd, consumer.args, { env: { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...consumer.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal: ctx.signal });
  lowPriority(dump.pid); lowPriority(tool.pid);
  const dErr = collect(dump, 'stderr');
  const tErr = collect(tool, 'stderr');
  collect(tool, 'stdout');
  tool.stdin!.on('error', () => { /* a ferramenta encerrou antes */ });
  (transform ? dump.stdout!.pipe(transform) : dump.stdout!).pipe(tool.stdin!);
  const code = (c: ReturnType<typeof spawn>) => new Promise<number>((res, rej) => { c.on('error', rej); c.on('close', (n) => res(n ?? -1)); });
  const [dc, tc] = await Promise.all([code(dump), code(tool)]);
  if (dc !== 0) throw new Error(`restic dump terminou com código ${dc}: ${dErr().trim().split('\n').slice(-3).join(' ')}`);
  if (tc !== 0) throw new Error(`${path.basename(consumer.cmd)} terminou com código ${tc}: ${tErr().trim().split('\n').slice(-5).join(' ')}`);
}

function pgEnv(t: DbTarget, password?: string, db?: string): Record<string, string> {
  const env: Record<string, string> = { PGAPPNAME: 'central-agent-restore', PGCONNECT_TIMEOUT: '15', PGDATABASE: db ?? t.db_name ?? 'postgres' };
  if (t.socket_path) env.PGHOST = t.socket_path; else if (t.host) env.PGHOST = t.host;
  if (t.port) env.PGPORT = String(t.port);
  if (t.user) env.PGUSER = t.user;
  if (password) env.PGPASSWORD = password;
  return env;
}

function mysqlCnf(dir: string, t: DbTarget, password?: string) {
  const cnf = path.join(dir, 'client.cnf');
  const lines = ['[client]', t.user && `user=${t.user}`, password && `password="${password.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    t.socket_path ? `socket=${t.socket_path}` : t.host && `host=${t.host}`, t.port && `port=${t.port}`].filter(Boolean);
  writeFileSync(cnf, lines.join('\n') + '\n', { mode: 0o600 });
  return cnf;
}

/** Troca o nome do banco nas linhas CREATE DATABASE/USE do mysqldump --databases. */
function renameMysqlDb(from: string, to: string) {
  let rest = '';
  const fix = (line: string) => /^(CREATE DATABASE|USE) /.test(line) ? line.split(`\`${from}\``).join(`\`${to}\``) : line;
  return new Transform({
    transform(chunk, _enc, cb) {
      const s = rest + chunk.toString('utf8');
      const i = s.lastIndexOf('\n');
      rest = i >= 0 ? s.slice(i + 1) : s;
      cb(null, i >= 0 ? s.slice(0, i + 1).split('\n').map(fix).join('\n') : '');
    },
    flush(cb) { cb(null, fix(rest)); }
  });
}

/** Apaga uma árvore criada pela própria restauração. O restic devolve as permissões originais
 *  (inclusive somente leitura), então devolve a escrita antes — sem seguir links simbólicos. */
function discardTree(dir: string) {
  const walk = (d: string) => {
    try { chmodSync(d, 0o700); } catch { /* segue */ }
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) { try { chmodSync(p, 0o600); } catch { /* segue */ } }
    }
  };
  if (existsSync(dir)) walk(dir);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (err) {
    if (process.platform !== 'win32') throw err;
    // Windows: o restic também restaura as ACLs e atributos das pastas de origem; o agente é dono
    // da cópia restaurada e pode redefinir as permissões dela antes de apagar
    const sys32 = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
    const tool = (exe: string, args: string[]) => { try { execFileSync(path.join(sys32, exe), args, { stdio: 'ignore', windowsHide: true }); } catch { /* erros parciais: o rm abaixo decide */ } };
    tool('icacls.exe', [dir, '/reset', '/T', '/C', '/Q']);
    tool('attrib.exe', ['-R', '-S', '-H', path.join(dir, '*'), '/S', '/D']);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

export const DRILL_DB = /^cb_teste_[0-9a-f]{8}$/;

export async function restoreDatabase(params: { restore_id: string; snapshot: string; filename: string; target: DbTarget; mode: 'novo' | 'producao'; new_name?: string; new_file?: string; discard?: boolean },
  secrets: RepoSecrets & { password?: string }, ctx: Ctx) {
  const t = params.target;
  if (params.discard) {
    // descarte só do que o próprio teste cria: banco com prefixo reservado ou arquivo no temporário do agente
    if (params.mode !== 'novo') throw new Error('Teste de restauração só em banco novo.');
    if (t.engine === 'sqlite' ? Boolean(params.new_file) : !DRILL_DB.test(params.new_name ?? '')) throw new Error('Teste de restauração exige destino reservado (cb_teste_xxxxxxxx ou temporário do agente).');
    if (t.engine === 'mongodb' && !which('mongosh')) throw new Error('mongosh não encontrado: sem ele o banco de teste não poderia ser descartado.');
  }
  const out = await restoreDatabaseInner(params, secrets, ctx);
  if (params.discard) {
    await discardDrill(params, secrets, ctx);
    ctx.log('info', 'Teste de restauração: banco conferido e descartado.');
    return { ...out, discarded: true };
  }
  return out;
}

async function discardDrill(params: { restore_id: string; filename: string; target: DbTarget; new_name?: string }, secrets: { password?: string }, ctx: Ctx) {
  const t = params.target;
  const name = params.new_name!;
  switch (t.engine) {
    case 'postgresql':
      await run(which('psql')!, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE "${name}"`], { env: pgEnv(t, secrets.password, 'postgres'), signal: ctx.signal, timeoutMs: 120_000 });
      return;
    case 'mysql': case 'mariadb': {
      const bin = which(t.engine === 'mariadb' ? 'mariadb' : 'mysql') ?? which('mysql') ?? which('mariadb');
      const dir = mkdtempSync(path.join(os.tmpdir(), 'cagent-dd-'));
      try { await run(bin!, [`--defaults-extra-file=${mysqlCnf(dir, t, secrets.password)}`, '-e', `DROP DATABASE \`${name}\``], { signal: ctx.signal, timeoutMs: 120_000 }); } finally { rmSync(dir, { recursive: true, force: true }); }
      return;
    }
    case 'mongodb': {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'cagent-dd-'));
      try {
        // a senha vai num script 0600 (nunca na linha de comando, visível em ps)
        const script = path.join(dir, 'drop.js');
        const uri = `mongodb://${t.host ?? '127.0.0.1'}:${t.port ?? 27017}/admin`;
        writeFileSync(script, [
          `const c = connect(${JSON.stringify(uri)});`,
          t.user ? `c.auth(${JSON.stringify(t.user)}, ${JSON.stringify(secrets.password ?? '')});` : '',
          `const r = c.getSiblingDB(${JSON.stringify(name)}).dropDatabase(); if (!r.ok) throw new Error('dropDatabase falhou');`
        ].join('\n'), { mode: 0o600 });
        await run(which('mongosh')!, ['--quiet', '--nodb', script], { signal: ctx.signal, timeoutMs: 120_000 });
      } finally { rmSync(dir, { recursive: true, force: true }); }
      return;
    }
    case 'sqlite':
      discardTree(path.join(ctx.stateDir, 'restores', params.restore_id));
  }
}

async function restoreDatabaseInner(params: { restore_id: string; snapshot: string; filename: string; target: DbTarget; mode: 'novo' | 'producao'; new_name?: string; new_file?: string },
  secrets: RepoSecrets & { password?: string }, ctx: Ctx) {
  const t = params.target;
  const r = resticEnv(secrets, ctx.stateDir);
  try {
    switch (t.engine) {
      case 'postgresql': {
        const pgRestore = which('pg_restore');
        const psql = which('psql');
        if (!pgRestore || !psql) throw new Error('pg_restore/psql não encontrados no servidor (instale postgresql-client).');
        let db = t.db_name!;
        if (params.mode === 'novo') {
          db = params.new_name!;
          await run(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${db}"`], { env: pgEnv(t, secrets.password, 'postgres'), signal: ctx.signal, timeoutMs: 60_000 });
          ctx.log('info', `Banco novo criado: ${db}.`);
        } else ctx.log('warn', `Restaurando POR CIMA do banco de produção ${db} (transação única).`);
        const args = ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', db, ...(params.mode === 'producao' ? ['--clean', '--if-exists', '--single-transaction'] : [])];
        await dumpInto(r, params.snapshot, params.filename, { cmd: pgRestore, args, env: pgEnv(t, secrets.password, db) }, ctx);
        const tables = Number((await run(psql, ['-X', '-A', '-t', '-c', "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"], { env: pgEnv(t, secrets.password, db), signal: ctx.signal })).trim());
        return { database: db, tables };
      }
      case 'mysql': case 'mariadb': {
        const bin = which(t.engine === 'mariadb' ? 'mariadb' : 'mysql') ?? which('mysql') ?? which('mariadb');
        if (!bin) throw new Error('Cliente mysql/mariadb não encontrado no servidor.');
        const cnf = mysqlCnf(r.tmp, t, secrets.password);
        const db = params.mode === 'novo' ? params.new_name! : t.db_name!;
        if (params.mode === 'novo') await run(bin, [`--defaults-extra-file=${cnf}`, '-e', `CREATE DATABASE \`${db}\``], { signal: ctx.signal, timeoutMs: 60_000 });
        await dumpInto(r, params.snapshot, params.filename, { cmd: bin, args: [`--defaults-extra-file=${cnf}`] }, ctx, params.mode === 'novo' ? renameMysqlDb(t.db_name!, db) : undefined);
        return { database: db };
      }
      case 'mongodb': {
        const bin = which('mongorestore');
        if (!bin) throw new Error('mongorestore não encontrado no servidor (instale mongodb-database-tools).');
        const args = ['--host', t.host ?? '127.0.0.1', '--port', String(t.port ?? 27017), '--archive', '--gzip', '--quiet'];
        if (t.user) {
          const conf = path.join(r.tmp, 'mongorestore.yaml');
          writeFileSync(conf, `password: ${JSON.stringify(secrets.password ?? '')}\n`, { mode: 0o600 });
          args.push('--username', t.user, '--authenticationDatabase', 'admin', `--config=${conf}`);
        }
        if (params.mode === 'novo') args.push('--nsFrom', `${t.db_name}.*`, '--nsTo', `${params.new_name}.*`);
        else args.push('--drop');
        await dumpInto(r, params.snapshot, params.filename, { cmd: bin, args }, ctx);
        return { database: params.mode === 'novo' ? params.new_name : t.db_name };
      }
      case 'sqlite': {
        const final = params.mode === 'novo' ? (params.new_file ?? path.join(ctx.stateDir, 'restores', params.restore_id, params.filename)) : t.file_path!;
        if (params.mode === 'novo' && existsSync(final)) throw new Error(`O arquivo ${final} já existe: a restauração não sobrescreve.`);
        mkdirSync(path.dirname(final), { recursive: true });
        // grava ao lado do destino, confere e só então troca (rename atômico no mesmo diretório)
        const staging = `${final}.restaurando-${params.restore_id.slice(0, 8)}`;
        await new Promise<void>((resolve, reject) => {
          const child = spawn(r.bin, ['dump', params.snapshot, `/${params.filename}`], { env: r.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: ctx.signal });
          const err = collect(child, 'stderr');
          const w = createWriteStream(staging, { mode: 0o600 });
          child.stdout!.pipe(w);
          let code: number | null = null;
          let finished = false;
          const done = () => { if (code !== null && finished) code === 0 ? resolve() : reject(new Error(`restic dump terminou com código ${code}: ${err().trim()}`)); };
          w.on('finish', () => { finished = true; done(); });
          child.on('error', reject);
          child.on('close', (c) => { code = c ?? -1; done(); });
        });
        let check = '';
        try {
          const db = new DatabaseSync(staging, { readOnly: true });
          try { check = db.prepare('PRAGMA integrity_check').all().map((x) => Object.values(x)[0]).join('; '); } finally { db.close(); }
        } catch (err) { rmSync(staging, { force: true }); throw new Error(`O arquivo restaurado não abre como SQLite: ${(err as Error).message}`); }
        if (check !== 'ok') { rmSync(staging, { force: true }); throw new Error(`integrity_check do arquivo restaurado: ${check}`); }
        if (params.mode === 'producao') ctx.log('warn', `Substituindo o arquivo de produção ${final}.`);
        renameSync(staging, final);
        return { file: final, size_bytes: statSync(final).size, integrity: 'ok' };
      }
    }
  } finally { r.cleanup(); }
}
