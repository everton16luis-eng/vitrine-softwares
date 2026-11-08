// Manutenção dos repositórios pela central: retenção (forget + prune) e uso de armazenamento.
// No destino local é feita direto no disco (os agentes só têm acesso append-only pelo rest-server).
import type { Database } from '@central/database';
import { audit, SYSTEM } from '../audit.ts';
import type { SecretStore } from '../secrets.ts';
import { repositoryAccess, type DestinationRow } from '../storage/destinations.ts';
import { restic } from '../storage/restic.ts';
import { planRetention, type RetentionPolicy } from './retention.ts';

export async function applyRetention(db: Database, store: SecretStore, resticBin: string, repositoryId: number, { prune = true } = {}) {
  // forget dentro da transação, com as linhas dos snapshots travadas: uma retenção legal pedida ao
  // mesmo tempo espera, e depois vê o snapshot como removido (e recusa).
  const result = await db.system(async (tx) => {
    const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1 FOR UPDATE SKIP LOCKED', [repositoryId]);
    if (!repo) return null;
    const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo.destination_id]) as DestinationRow;
    const access = await repositoryAccess(tx, store, dest, repo);
    const jobs = await tx.many(`SELECT j.id, p.retention, p.timezone FROM backup_jobs j JOIN backup_policies p ON p.id = j.policy_id WHERE j.repository_id = $1`, [repositoryId]);
    const forget: { id: number; restic_id: string; job_id: number }[] = [];
    for (const j of jobs) {
      // snapshot com restauração em andamento conta como retido
      const snaps = await tx.many(`SELECT s.id, s.restic_id, s.taken_at, s.status, (s.legal_hold OR EXISTS (SELECT 1 FROM restore_requests rr WHERE rr.snapshot_id = s.id
          AND rr.status IN ('aguardando_aprovacao', 'backup_seguranca', 'na_fila', 'executando'))) AS legal_hold
        FROM backup_snapshots s WHERE s.job_id = $1 AND s.repository_id = $2 AND s.status <> 'removido' FOR UPDATE OF s`, [j.id, repositoryId]);
      const plan = planRetention(snaps.map((s) => ({ ...s, taken_at: new Date(s.taken_at) })), j.retention as RetentionPolicy, j.timezone);
      for (const id of plan.forget) forget.push({ id, restic_id: snaps.find((s) => s.id === id)!.restic_id, job_id: Number(j.id) });
    }
    if (forget.length) {
      const out = await restic(resticBin, ['forget', ...forget.map((f) => f.restic_id)], { repo: access.maintenanceRepo, password: access.password, env: access.maintenanceEnv, timeoutMs: 10 * 60_000 });
      if (out.code !== 0) {
        await tx.query('UPDATE backup_repositories SET retention_error = $2 WHERE id = $1', [repositoryId, `forget falhou: ${out.stderr}`.slice(0, 2000)]);
        return { access, removed: [] as typeof forget, error: out.stderr };
      }
      await tx.query("UPDATE backup_snapshots SET status = 'removido', removed_at = now() WHERE id = ANY($1::bigint[])", [forget.map((f) => f.id)]);
      await audit(tx, SYSTEM, { action: 'retencao.aplicar', entity: 'repositorio', entityId: repositoryId, clientId: Number(repo.client_id),
        details: { removidos: forget.length, snapshots: forget.map((f) => f.restic_id.slice(0, 8)) } });
    }
    await tx.query('UPDATE backup_repositories SET last_retention_at = now(), retention_error = NULL WHERE id = $1', [repositoryId]);
    return { access, removed: forget, error: null as string | null };
  });
  if (!result) return null;
  let pruned = false;
  let pruneError: string | null = null;
  if (prune && result.removed.length) {
    const p = await restic(resticBin, ['prune'], { repo: result.access.maintenanceRepo, password: result.access.password, env: result.access.maintenanceEnv, timeoutMs: 6 * 3600_000 });
    pruned = p.code === 0;
    if (!pruned) {
      pruneError = p.stderr;
      await db.system((tx) => tx.query('UPDATE backup_repositories SET retention_error = $2 WHERE id = $1', [repositoryId, `prune falhou: ${p.stderr}`.slice(0, 2000)]));
    }
  }
  await updateStats(db, store, resticBin, repositoryId).catch(() => null);
  return { removed: result.removed.map((r) => r.id), error: result.error ?? pruneError, pruned };
}

/** Tamanho real ocupado (dados deduplicados e comprimidos) do repositório. */
export async function updateStats(db: Database, store: SecretStore, resticBin: string, repositoryId: number) {
  const access = await db.system(async (tx) => {
    const repo = await tx.one('SELECT * FROM backup_repositories WHERE id = $1', [repositoryId]);
    const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo!.destination_id]) as DestinationRow;
    return repositoryAccess(tx, store, dest, repo!);
  });
  const out = await restic(resticBin, ['stats', '--json', '--mode', 'raw-data'], { repo: access.maintenanceRepo, password: access.password, env: access.maintenanceEnv, timeoutMs: 30 * 60_000 });
  if (out.code !== 0) throw new Error(out.stderr);
  const size = Number(JSON.parse(out.stdout).total_size);
  await db.system((tx) => tx.query('UPDATE backup_repositories SET size_bytes = $2, stats_at = now() WHERE id = $1', [repositoryId, size]));
  return size;
}

/** Repositórios cuja retenção não roda há mais de `everyH` horas. */
export async function retentionDue(db: Database, everyH = 6) {
  return db.system((tx) => tx.many(`SELECT id FROM backup_repositories WHERE initialized_at IS NOT NULL
    AND (last_retention_at IS NULL OR last_retention_at < now() - make_interval(hours => $1)) ORDER BY id LIMIT 10`, [everyH]));
}
