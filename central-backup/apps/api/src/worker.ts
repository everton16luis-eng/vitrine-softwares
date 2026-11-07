// Worker: manutenção periódica da fila (lease vencido, prazos, agentes offline, promoção de pendentes)
// e, com a KEK carregada, o ciclo de backup (agenda, conciliação, verificação, retenção).
// Várias instâncias podem rodar: advisory locks garantem uma rodada de cada parte por vez.
import type { Database } from '@central/database';
import type { Keyring } from '@central/security';
import type { Config } from './config.ts';
import { maintenance } from './tasks/service.ts';
import { SecretStore } from './secrets.ts';
import { loadTaskSigner } from './keys.ts';
import { scheduleDue, reconcileRuns, type BackupDeps } from './backups/service.ts';
import { verifyPending } from './backups/verify.ts';
import { applyRetention, retentionDue } from './backups/maintenance.ts';
import { progressRestores, scheduleDrills } from './restores/service.ts';
import { schedulePgbackrest, reconcilePgbackrest } from './pgbackrest/service.ts';
import { runSelfBackup, selfBackupDue } from './system/selfbackup.ts';
import { rollupMetrics } from './monitoring/metrics.ts';
import { evaluateAlerts } from './alerts/evaluate.ts';
import type { TaskSigner } from './tasks/service.ts';

const LOCK_ID = 727_001;
const BACKUP_LOCK_ID = 727_002;

export async function runMaintenanceOnce(db: Database, config: Config) {
  return db.system(async (tx) => {
    const got = await tx.one<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_ID]);
    if (!got?.ok) return null;
    return maintenance(tx, { offlineAfterS: config.agent.offlineAfterS });
  });
}

export function backupDeps(db: Database, keyring: Keyring): BackupDeps {
  let signer: TaskSigner | null = null;
  return { store: new SecretStore(keyring), signer: async () => (signer ??= await loadTaskSigner(db, keyring)) };
}

/** Uma rodada do ciclo de backup. Verificação e retenção rodam fora de transação longa. */
export async function runBackupCycleOnce(db: Database, config: Config, deps: BackupDeps, { now = new Date(), verify = true, retention = true, drills = true, log = console as { warn?: (m: string) => void } } = {}) {
  // uma instância por vez (sessão dedicada segura o lock durante a rodada)
  const client = await db.pool.connect();
  try {
    const got = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [BACKUP_LOCK_ID]);
    if (!got.rows[0]?.ok) return null;
    try {
      const reconciled = await db.system((tx) => reconcileRuns(tx)) + await db.system((tx) => reconcilePgbackrest(tx));
      const pgbackrest = await schedulePgbackrest(db, deps, now);
      const { started } = await scheduleDue(db, deps, now, log);
      const verified = verify ? await verifyPending(db, deps.store, config.tools) : [];
      const restores = await progressRestores(db, deps);
      const drillsStarted = drills ? await scheduleDrills(db, deps, { now }) : 0;
      let retained = 0;
      if (retention) {
        for (const r of await retentionDue(db)) {
          const out = await applyRetention(db, deps.store, config.tools.restic, Number(r.id)).catch((err) => { log.warn?.(`[retenção] repositório ${r.id}: ${(err as Error).message}`); return null; });
          retained += out?.removed.length ?? 0;
        }
      }
      return { reconciled, started, pgbackrest, verified: verified.length, restores, drills: drillsStarted, retained };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

export function startWorker(db: Database, config: Config, { intervalMs = 10_000, log = console, keyring }: { intervalMs?: number; log?: Pick<Console, 'info' | 'error' | 'warn'>; keyring?: Keyring } = {}) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const deps = keyring ? backupDeps(db, keyring) : null;
  let lastRollup = 0;
  let lastAlerts = 0;
  // verificação interrompida por queda do worker volta para a fila
  const reset = db.system(async (tx) => {
    await tx.query("UPDATE backup_snapshots SET status = 'nao_verificado' WHERE status = 'verificando'");
    await tx.query("UPDATE system_backups SET status = 'falhou', error = 'Interrompido (o worker reiniciou).', finished_at = now() WHERE status = 'executando'");
  }).catch(() => null);
  // backup da central: longo, roda em paralelo ao ciclo (um por vez)
  let selfBackup: Promise<unknown> | null = null;
  const tick = async () => {
    await reset;
    try {
      const stats = await runMaintenanceOnce(db, config);
      if (Date.now() - lastRollup > 5 * 60_000) { lastRollup = Date.now(); await rollupMetrics(db); }
      if (stats && Object.values(stats).some((n) => n > 0)) log.info?.(`[worker] ${JSON.stringify(stats)}`);
      if (deps) {
        const b = await runBackupCycleOnce(db, config, deps, { log });
        if (b && Object.values(b).some((n) => n > 0)) log.info?.(`[backup] ${JSON.stringify(b)}`);
      }
      if (!selfBackup && await selfBackupDue(db, config)) {
        selfBackup = runSelfBackup(db, config, 'agendado')
          .then((r) => (r.status === 'validado' ? log.info : log.error)?.(`[central] backup da central: ${JSON.stringify(r)}`))
          .catch((err) => log.error?.(`[central] backup da central: ${(err as Error).message}`))
          .finally(() => { selfBackup = null; });
      }
      if (deps && Date.now() - lastAlerts > 60_000) {
        lastAlerts = Date.now();
        const a = await evaluateAlerts(db, deps.store, config.smtp);
        if (a && Object.values(a).some((n) => n > 0)) log.info?.(`[alertas] ${JSON.stringify(a)}`);
      }
    } catch (err) {
      log.error?.(`[worker] falha na manutenção: ${(err as Error).message}`);
    }
    if (!stopped) timer = setTimeout(() => { running = tick(); }, intervalMs);
  };
  running = tick();
  return {
    async stop() { stopped = true; clearTimeout(timer); await running; }
  };
}
