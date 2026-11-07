// O que a central faz com o resultado "ok" de cada operação. Um erro aqui marca a tarefa como
// falha ("resultado recusado pela central"): a central nunca aceita resultado incoerente.
import type { Tx } from '@central/database';
import type { TaskResult } from '@central/contracts';
import { storeInventory } from '../servers/inventory.ts';
import type { ResultHandler } from './service.ts';
import { backupResult } from '../backups/service.ts';
import { restoreResult } from '../restores/service.ts';
import { pgbackrestResult } from '../pgbackrest/service.ts';

async function agentServer(tx: Tx, agentId: number) {
  const a = await tx.one('SELECT server_id, client_id FROM agents WHERE id = $1', [agentId]);
  if (!a) throw new Error('agente inexistente');
  return { id: Number(a.server_id), client_id: Number(a.client_id) };
}

const handlers: Partial<Record<string, ResultHandler>> = {
  'backup.files': backupResult,
  'backup.db': backupResult,
  'restore.files': restoreResult,
  'restore.db': restoreResult,
  'pgbackrest.backup': pgbackrestResult,
  'pgbackrest.info': pgbackrestResult,

  'inventory.collect': async (tx, task, result) => {
    const data = (result.result as { inventory?: Record<string, unknown> } | undefined)?.inventory;
    if (!data || typeof data !== 'object') throw new Error('inventário ausente no resultado');
    await storeInventory(tx, await agentServer(tx, task.agent_id), result.finished_at, data);
  },

  'db.discover': async (_tx, _task, result) => {
    const r = result.result as { candidates?: unknown } | undefined;
    if (!r || !Array.isArray(r.candidates)) throw new Error('lista de candidatos ausente');
  },

  /** O teste "ok" significa que o teste rodou; a conexão em si pode ter falhado (result.ok = false). */
  'db.test_connection': async (tx, task, result: TaskResult) => {
    const r = result.result as { ok?: boolean; version?: string; size_bytes?: number; error?: string } | undefined;
    if (!r || typeof r.ok !== 'boolean') throw new Error('resultado do teste incompleto');
    if (task.origin_type !== 'database' || !task.origin_id) return;
    await tx.query(`UPDATE databases SET connection_status = $2, last_test_at = now(), last_test_error = $3,
        version = coalesce($4, version), size_bytes = coalesce($5, size_bytes) WHERE id = $1 AND client_id = $6`,
    [task.origin_id, r.ok ? 'ok' : 'erro', r.ok ? null : String(r.error ?? 'falha sem detalhes').slice(0, 1000),
      typeof r.version === 'string' ? r.version.slice(0, 200) : null, Number.isFinite(r.size_bytes) ? Math.round(r.size_bytes!) : null, task.client_id]);
  }
};

const extra: Partial<Record<string, ResultHandler>> = {};
/** Fases seguintes registram seus tratadores aqui. */
export function registerHandler(operation: string, handler: ResultHandler) { extra[operation] = handler; }
export const resultHandlers = new Proxy(handlers, { get: (t, k: string) => extra[k] ?? t[k] }) as Partial<Record<string, ResultHandler>>;
