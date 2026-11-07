// pgBackRest: backup físico do PostgreSQL com o pgBackRest JÁ configurado no servidor
// (/etc/pgbackrest/pgbackrest.conf com repositório, cifra e pg1-path). O agente só escolhe a stanza
// e o tipo; nenhum outro argumento vem da central.
//
// O agente roda sem privilégios (NoNewPrivileges, sistema de arquivos somente leitura), então não
// executa o pgBackRest como "postgres" diretamente. Modo padrão ("systemd"): pede ao systemd para
// iniciar a unidade auxiliar `central-pgbackrest@<stanza>.<tipo>.service` (User=postgres), autorizada
// por uma regra polkit que só permite ESTA família de unidades, e lê o resultado gravado por ela em
// /var/lib/central-pgbackrest/<instância>/. Modo "direto" (PGBACKREST_MODE=direto) executa o binário
// no próprio processo — só para instalações em que o agente já roda como dono do PGDATA.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { which } from './db.ts';
import { run } from '../system.ts';

type Log = (level: 'info' | 'warn' | 'error', message: string) => void;
export type Exec = (cmd: string, args: string[], opts: { signal: AbortSignal; timeoutMs: number }) => Promise<string>;
export interface PgbrCtx { signal: AbortSignal; log: Log; exec?: Exec; mode?: 'systemd' | 'direto'; resultDir?: string }

const STANZA = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
type Kind = 'full' | 'diff' | 'incr' | 'info';
const defaultExec: Exec = (cmd, args, o) => run(cmd, args, { signal: o.signal, timeoutMs: o.timeoutMs, maxBuffer: 32 * 1024 * 1024 });
const tail = (s: string) => s.trim().split('\n').filter(Boolean).slice(-4).join(' ').slice(0, 1200);

function parseInfo(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Saída de "pgbackrest info" não é JSON.'); }
  if (!Array.isArray(parsed)) throw new Error('Saída de "pgbackrest info" inesperada.');
  return parsed;
}

/** Executa backup (se pedido) + check + info e devolve { check, info }. */
async function execute(stanza: string, kind: Kind, ctx: PgbrCtx) {
  if (!STANZA.test(stanza)) throw new Error('Stanza inválida.');
  const exec = ctx.exec ?? defaultExec;
  const mode = ctx.mode ?? (process.env.PGBACKREST_MODE === 'direto' ? 'direto' : 'systemd');
  if (mode === 'systemd') {
    const unit = `central-pgbackrest@${stanza}.${kind}.service`;
    const dir = path.join(ctx.resultDir ?? '/var/lib/central-pgbackrest', `${stanza}.${kind}`);
    let failure: string | null = null;
    try { await exec(which('systemctl') ?? '/usr/bin/systemctl', ['start', unit], { signal: ctx.signal, timeoutMs: 13 * 3600_000 }); } catch (err) {
      failure = tail(String((err as { stderr?: string }).stderr ?? (err as Error).message));
    }
    const read = (f: string) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : null);
    const rc = read('rc');
    if (rc === null) throw new Error(`A unidade ${unit} não gravou resultado${failure ? `: ${failure}` : ''} (instalada? polkit autorizado? veja docs/central-backup/fase-8.md).`);
    if (rc.trim() !== '0') throw new Error(`pgbackrest backup falhou (código ${rc.trim()}): ${tail(read('stderr') ?? '')}`);
    const info = read('info.json');
    if (!info) throw new Error(`pgbackrest info não gerou saída: ${tail(read('stderr') ?? '')}`);
    return { check: (read('check') ?? 'não executado').trim() || 'ok', info: parseInfo(info) };
  }
  const bin = process.env.PGBACKREST_BIN || which('pgbackrest');
  if (!bin) throw new Error('pgbackrest não encontrado no servidor (apt install pgbackrest).');
  const pg = async (args: string[], timeoutMs: number) => {
    try { return await exec(bin, args, { signal: ctx.signal, timeoutMs }); } catch (err) {
      throw new Error(`pgbackrest ${args.at(-1)} falhou: ${tail(String((err as { stderr?: string }).stderr ?? '') || (err as Error).message)}`);
    }
  };
  if (kind !== 'info') await pg([`--stanza=${stanza}`, `--type=${kind}`, '--log-level-console=warn', 'backup'], 12 * 3600_000);
  let check = 'ok';
  try { await pg([`--stanza=${stanza}`, '--log-level-console=warn', 'check'], 300_000); } catch (err) { check = (err as Error).message; ctx.log('warn', check); }
  return { check, info: parseInfo(await pg([`--stanza=${stanza}`, '--output=json', 'info'], 120_000)) };
}

export async function pgbackrestInfo(params: { stanza: string }, ctx: PgbrCtx) {
  return { stanza: params.stanza, ...(await execute(params.stanza, 'info', ctx)) };
}

export async function pgbackrestBackup(params: { stanza: string; type: 'full' | 'diff' | 'incr' }, ctx: PgbrCtx) {
  if (!['full', 'diff', 'incr'].includes(params.type)) throw new Error('Tipo de backup inválido.');
  ctx.log('info', `pgBackRest: backup ${params.type} da stanza ${params.stanza}.`);
  const started = Date.now();
  const r = await execute(params.stanza, params.type, ctx);
  const duration = Math.round((Date.now() - started) / 1000);
  ctx.log(r.check === 'ok' ? 'info' : 'warn', `pgBackRest: backup terminou em ${duration} s; check: ${r.check}.`);
  return { stanza: params.stanza, type: params.type, duration_s: duration, ...r };
}
