// Execução de tarefas. Antes de qualquer coisa o agente confere: formato, assinatura Ed25519 da
// central, destinatário (agent_id), validade, operação do catálogo, versão e parâmetros.
// Qualquer falha → a tarefa é recusada sem executar nada.
import { OPERATIONS, isOperationName, validate, SignedTask, type TaskResult } from '@central/contracts';
import { verifyPayload } from '@central/security/signing';
import { openSealed } from '@central/security/seal';
import { redact } from '@central/shared';
import { collectInventory } from './system.ts';
import { discover, testConnection } from './operations/db.ts';
import { backupFiles, backupDatabase } from './operations/backup.ts';
import { pgbackrestBackup, pgbackrestInfo } from './operations/pgbackrest.ts';
import { restoreFiles, restoreDatabase } from './operations/restore.ts';
import { AGENT_VERSION } from './state.ts';
import os from 'node:os';

type Log = TaskResult['logs'][number];

export interface RunContext {
  agentId: string;
  keys: Record<string, string>;
  pendingResults: () => number;
  signal?: AbortSignal;
  /** chave privada X25519 do agente (abre segredos selados) */
  sealKey?: string;
  stateDir?: string;
}

export type CheckResult = { ok: true; task: SignedTask } | { ok: false; reason: string; taskId?: string; attempt?: number };

export function checkTask(raw: unknown, ctx: Pick<RunContext, 'agentId' | 'keys'>, now = Date.now()): CheckResult {
  const v = validate(SignedTask, raw);
  const r = raw as { payload?: { task_id?: unknown }; attempt?: unknown } | null;
  const taskId = typeof r?.payload?.task_id === 'string' ? r.payload.task_id : undefined;
  const attempt = typeof r?.attempt === 'number' ? r.attempt : undefined;
  if (!v.ok) return { ok: false, reason: 'formato de tarefa inválido', taskId, attempt };
  const t = v.value;
  if (!verifyPayload({ payload: t.payload, signature: t.signature, key_id: t.key_id }, ctx.keys)) return { ok: false, reason: 'assinatura da central não confere', taskId, attempt };
  if (t.payload.agent_id !== ctx.agentId) return { ok: false, reason: 'tarefa destinada a outro agente', taskId, attempt };
  if (Date.parse(t.payload.expires_at) <= now) return { ok: false, reason: 'tarefa vencida', taskId, attempt };
  if (!isOperationName(t.payload.operation)) return { ok: false, reason: `operação desconhecida por este agente (${t.payload.operation})`, taskId, attempt };
  const spec = OPERATIONS[t.payload.operation];
  if (spec.version !== t.payload.operation_version) return { ok: false, reason: `versão da operação não suportada (${t.payload.operation_version})`, taskId, attempt };
  const p = validate(spec.params, t.payload.params);
  if (!p.ok) return { ok: false, reason: 'parâmetros inválidos para a operação', taskId, attempt };
  return { ok: true, task: t };
}

export function refusal(attempt: number, reason: string): TaskResult {
  const at = new Date().toISOString();
  return { attempt, status: 'recusada', error: `Tarefa recusada pelo agente: ${reason}.`, started_at: at, finished_at: at, logs: [{ at, level: 'warn', message: `Tarefa recusada: ${reason}` }] };
}

export interface OpContext {
  task: SignedTask;
  params: any;
  secrets: Record<string, string>;
  signal: AbortSignal;
  log: (level: Log['level'], message: string) => void;
  agent: RunContext;
}
export interface OpOutcome { status?: TaskResult['status']; result?: unknown; error?: string; tool?: TaskResult['tool'] }
export type Operation = (ctx: OpContext) => Promise<OpOutcome>;

const OPERATIONS_IMPL: Record<string, Operation> = {
  'agent.ping': async ({ agent }) => ({ result: { agent_version: AGENT_VERSION, clock: new Date().toISOString(), uptime_s: Math.round(os.uptime()), pending_results: agent.pendingResults() } }),
  'inventory.collect': async ({ params, signal, log }) => {
    const inventory = await collectInventory(params.sections, signal);
    for (const [k, v] of Object.entries(inventory)) if ((v as { indisponivel?: boolean })?.indisponivel) log('warn', `Seção ${k} indisponível: ${(v as { motivo?: string }).motivo ?? ''}`);
    log('info', `Inventário coletado: ${Object.keys(inventory).join(', ')}.`);
    return { result: { inventory } };
  },
  'db.discover': async ({ signal, log }) => {
    const r = await discover(signal);
    log('info', `${r.candidates.length} candidato(s) encontrado(s).`);
    return { result: r };
  },
  'db.test_connection': async ({ params, secrets, signal, log }) => {
    const r = await testConnection(params.target, secrets.password, signal);
    log(r.ok ? 'info' : 'warn', r.ok ? `Conexão ok: ${r.version}.` : `Conexão falhou: ${r.error}`);
    return { result: r };
  },
  'backup.files': async ({ params, secrets, signal, log, agent }) => {
    const r = await backupFiles(params, secrets as never, { signal, log, stateDir: agent.stateDir ?? os.tmpdir() });
    log(r.incomplete ? 'warn' : 'info', `Snapshot ${r.snapshot_id.slice(0, 8)}: ${r.total_files_processed} arquivo(s), ${r.data_added} bytes novos${r.incomplete ? ' (parcial)' : ''}.`);
    return { result: r, tool: { name: 'restic' } };
  },
  'backup.db': async ({ params, secrets, signal, log, agent }) => {
    const r = await backupDatabase(params, secrets as never, { signal, log, stateDir: agent.stateDir ?? os.tmpdir() });
    log('info', `Snapshot ${r.snapshot_id.slice(0, 8)}: dump de ${r.total_bytes_processed} bytes, ${r.data_added} bytes novos.`);
    return { result: r, tool: { name: 'restic' } };
  },
  'restore.files': async ({ params, secrets, signal, log, agent }) => ({ result: await restoreFiles(params, secrets as never, { signal, log, stateDir: agent.stateDir ?? os.tmpdir() }), tool: { name: 'restic' } }),
  'restore.db': async ({ params, secrets, signal, log, agent }) => ({ result: await restoreDatabase(params, secrets as never, { signal, log, stateDir: agent.stateDir ?? os.tmpdir() }), tool: { name: 'restic' } }),
  'pgbackrest.backup': async ({ params, signal, log }) => ({ result: await pgbackrestBackup(params, { signal, log }), tool: { name: 'pgbackrest' } }),
  'pgbackrest.info': async ({ params, signal, log }) => ({ result: await pgbackrestInfo(params, { signal, log }), tool: { name: 'pgbackrest' } })
};

/** Fases seguintes registram suas operações aqui. */
export function registerOperation(name: string, op: Operation) { OPERATIONS_IMPL[name] = op; }

/** O segredo e as partes dele que podem aparecer sozinhas em mensagens (senha de URL, valores de JSON). */
function secretVariants(value: string): string[] {
  const out = [value];
  try { const u = new URL(value.replace(/^rest:/, '')); if (u.password) out.push(u.password, decodeURIComponent(u.password)); } catch { /* não é URL */ }
  try { const j = JSON.parse(value); if (j && typeof j === 'object') for (const v of Object.values(j)) if (typeof v === 'string' && v.length >= 6) out.push(v); } catch { /* não é JSON */ }
  return out;
}

export async function execute(task: SignedTask, ctx: RunContext): Promise<TaskResult> {
  const startedAt = new Date().toISOString();
  const logs: Log[] = [];
  const known: string[] = [];
  const log = (level: Log['level'], message: string) => { if (logs.length < 500) logs.push({ at: new Date().toISOString(), level, message: redact(message, known).slice(0, 4000) }); };
  const timeout = AbortSignal.timeout(task.payload.timeout_s * 1000);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  const done = (status: TaskResult['status'], result?: unknown, error?: string, tool?: TaskResult['tool']): TaskResult =>
    ({ attempt: task.attempt, status, ...(result === undefined ? {} : { result }), ...(error ? { error: redact(error, known).slice(0, 4000) } : {}), ...(tool ? { tool } : {}),
      started_at: startedAt, finished_at: new Date().toISOString(), logs });

  const impl = OPERATIONS_IMPL[task.payload.operation];
  if (!impl) return done('recusada', undefined, 'operação sem implementação neste agente');

  // segredos selados: só este agente abre, e só no contexto desta tarefa
  const secrets: Record<string, string> = {};
  for (const [name, sealed] of Object.entries(task.payload.secrets ?? {})) {
    if (!ctx.sealKey) return done('recusada', undefined, 'agente sem chave de cifragem para abrir os segredos');
    try { secrets[name] = openSealed(sealed, ctx.sealKey, `task:${task.payload.task_id}`); } catch { return done('recusada', undefined, `segredo "${name}" não pôde ser aberto`); }
    known.push(...secretVariants(secrets[name]!));
  }

  try {
    log('info', `Iniciando ${task.payload.operation} (tentativa ${task.attempt}).`);
    const out = await impl({ task, params: task.payload.params, secrets, signal, log, agent: ctx });
    return done(out.status ?? 'ok', out.result, out.error, out.tool);
  } catch (err) {
    if (signal.aborted) {
      const byTimeout = timeout.aborted;
      log('error', byTimeout ? 'Tempo limite da tarefa esgotado.' : 'Execução interrompida (agente encerrando).');
      return done(byTimeout ? 'erro' : 'interrompida', undefined, byTimeout ? 'tempo limite esgotado' : 'agente encerrado durante a execução');
    }
    log('error', (err as Error).message);
    return done('erro', undefined, (err as Error).message);
  }
}
