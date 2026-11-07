// Armazenamento, agregação e exposição das métricas.
import type { Database, Tx } from '@central/database';
import type { AgentMetrics } from '@central/contracts';

const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);

/** Grava a amostra do heartbeat (no máximo uma por minuto por servidor). */
export async function storeMetrics(tx: Tx, server: { id: number; client_id: number }, m: AgentMetrics) {
  const at = new Date(m.at);
  // relógio do agente fora do razoável: usa a hora da central
  const when = Math.abs(at.getTime() - Date.now()) > 10 * 60_000 ? new Date() : at;
  const last = await tx.one('SELECT last_metrics_at FROM servers WHERE id = $1', [server.id]);
  const diskMax = m.disks.reduce((mx, d) => Math.max(mx, pct(d.used, d.used + d.avail) ?? 0), 0);
  const summary = {
    ...m, at: when.toISOString(), mem_used_pct: pct(m.mem_total - m.mem_available, m.mem_total),
    swap_used_pct: m.swap_total ? pct(m.swap_total - m.swap_free, m.swap_total) : null, disk_max_pct: m.disks.length ? diskMax : null
  };
  await tx.query('UPDATE servers SET last_metrics = $2, last_metrics_at = $3 WHERE id = $1', [server.id, JSON.stringify(summary), when]);
  if (last?.last_metrics_at && when.getTime() - new Date(last.last_metrics_at).getTime() < 50_000) return false;
  await tx.query(`INSERT INTO server_metrics (server_id, client_id, at, cpu_pct, load1, mem_used_pct, swap_used_pct, disk_max_pct, net_rx_bps, net_tx_bps, failed_units, data)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
  [server.id, server.client_id, when, m.cpu_pct, m.load[0] ?? null, summary.mem_used_pct, summary.swap_used_pct, summary.disk_max_pct,
    m.net_rx_bps, m.net_tx_bps, m.failed_units, JSON.stringify({ disks: m.disks, load: m.load, cpus: m.cpus, mem_total: m.mem_total })]);
  return true;
}

/** Agrega as horas fechadas e apaga brutas com mais de `keepDays`. Idempotente. */
export async function rollupMetrics(db: Database, { keepDays = 14, keepHourlyDays = 400 } = {}) {
  return db.system(async (tx) => {
    const got = await tx.one('SELECT pg_try_advisory_xact_lock(727003) AS ok');
    if (!got?.ok) return null;
    const r = await tx.query(`INSERT INTO server_metrics_hourly (server_id, client_id, hour, samples, cpu_avg, cpu_max, load1_avg, mem_used_avg, mem_used_max, disk_max_pct, net_rx_avg, net_tx_avg)
      SELECT server_id, client_id, date_trunc('hour', at), count(*), avg(cpu_pct), max(cpu_pct), avg(load1), avg(mem_used_pct), max(mem_used_pct), max(disk_max_pct), avg(net_rx_bps)::bigint, avg(net_tx_bps)::bigint
      FROM server_metrics WHERE at < date_trunc('hour', now()) AND at >= date_trunc('hour', now()) - interval '48 hours'
      GROUP BY server_id, client_id, date_trunc('hour', at)
      ON CONFLICT (server_id, hour) DO UPDATE SET samples = EXCLUDED.samples, cpu_avg = EXCLUDED.cpu_avg, cpu_max = EXCLUDED.cpu_max, load1_avg = EXCLUDED.load1_avg,
        mem_used_avg = EXCLUDED.mem_used_avg, mem_used_max = EXCLUDED.mem_used_max, disk_max_pct = EXCLUDED.disk_max_pct, net_rx_avg = EXCLUDED.net_rx_avg, net_tx_avg = EXCLUDED.net_tx_avg`);
    const purged = await tx.query("DELETE FROM server_metrics WHERE at < now() - make_interval(days => $1)", [keepDays]);
    await tx.query("DELETE FROM server_metrics_hourly WHERE hour < now() - make_interval(days => $1)", [keepHourlyDays]);
    return { hours: r.rowCount ?? 0, purged: purged.rowCount ?? 0 };
  });
}

// ------------------------------------------------------------------ Prometheus (formato texto 0.0.4)
const esc = (v: unknown) => String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (l: Record<string, unknown>) => (Object.keys(l).length ? `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "");

export async function prometheusText(db: Database, { offlineAfterS = 120 } = {}) {
  const out: string[] = [];
  const metric = (name: string, help: string, type: 'gauge' | 'counter', rows: [Record<string, unknown>, number | null][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [l, v] of rows) if (v !== null && Number.isFinite(v)) out.push(`${name}${labels(l)} ${v}`);
  };
  const data = await db.system(async (tx) => ({
    servers: await tx.many(`SELECT s.id, s.name, c.legal_name AS client, s.connection_status, s.last_seen_at, s.last_metrics
      FROM servers s JOIN clients c ON c.id = s.client_id WHERE s.archived_at IS NULL`),
    jobs: await tx.many(`SELECT j.id, j.name, s.name AS server, c.legal_name AS client, j.last_status, j.last_success_at, j.enabled
      FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN clients c ON c.id = j.client_id WHERE j.archived_at IS NULL`),
    snaps: await tx.many('SELECT status, count(*) AS n FROM backup_snapshots GROUP BY status'),
    repos: await tx.many(`SELECT r.id, s.name AS server, d.name AS destination, r.size_bytes FROM backup_repositories r JOIN servers s ON s.id = r.server_id JOIN backup_destinations d ON d.id = r.destination_id`),
    tasks: await tx.many("SELECT status, count(*) AS n FROM agent_task_queue WHERE status NOT IN ('concluido', 'validado', 'falhou', 'cancelado') GROUP BY status"),
    drills: await tx.many(`SELECT j.id, j.name, s.name AS server, c.legal_name AS client, j.last_restore_test_at, j.last_restore_test_status
      FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN clients c ON c.id = j.client_id WHERE j.archived_at IS NULL AND j.last_restore_test_at IS NOT NULL`),
    pgbr: await tx.many(`SELECT x.id, x.stanza, s.name AS server, c.legal_name AS client, x.status, x.last_backup_at FROM pgbackrest_stanzas x
      JOIN servers s ON s.id = x.server_id JOIN clients c ON c.id = x.client_id WHERE x.archived_at IS NULL`),
    self: await tx.one("SELECT max(finished_at) FILTER (WHERE status = 'validado') AS ok_at, (array_agg(status ORDER BY id DESC))[1] AS last FROM system_backups")
  }));
  const sl = (s: Record<string, any>) => ({ client: s.client, server: s.name, server_id: s.id });
  const up = (s: Record<string, any>) => (s.connection_status === 'online' && s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < offlineAfterS * 1000 ? 1 : 0);
  metric('central_server_up', 'Agente do servidor respondendo (1) ou não (0).', 'gauge', data.servers.map((s) => [sl(s), up(s)]));
  metric('central_server_cpu_percent', 'Uso de CPU (%).', 'gauge', data.servers.map((s) => [sl(s), s.last_metrics?.cpu_pct ?? null]));
  metric('central_server_load1', 'Load average de 1 minuto.', 'gauge', data.servers.map((s) => [sl(s), s.last_metrics?.load?.[0] ?? null]));
  metric('central_server_memory_used_percent', 'Memória em uso (%).', 'gauge', data.servers.map((s) => [sl(s), s.last_metrics?.mem_used_pct ?? null]));
  const disks: [Record<string, unknown>, number | null][] = [];
  for (const s of data.servers) for (const d of s.last_metrics?.disks ?? []) disks.push([{ ...sl(s), mount: d.mount }, d.used + d.avail > 0 ? Math.round((d.used / (d.used + d.avail)) * 1000) / 1000 : null]);
  metric('central_server_disk_used_ratio', 'Fração usada do sistema de arquivos.', 'gauge', disks);
  metric('central_server_failed_units', 'Unidades systemd com falha.', 'gauge', data.servers.map((s) => [sl(s), s.last_metrics?.failed_units ?? null]));
  const jl = (j: Record<string, any>) => ({ client: j.client, server: j.server, job: j.name, job_id: j.id });
  metric('central_backup_last_success_timestamp_seconds', 'Horário do último backup VALIDADO.', 'gauge', data.jobs.map((j) => [jl(j), j.last_success_at ? Math.floor(new Date(j.last_success_at).getTime() / 1000) : null]));
  metric('central_backup_last_ok', 'Última execução do job validada (1) ou não (0).', 'gauge', data.jobs.filter((j) => j.last_status).map((j) => [jl(j), j.last_status === 'validado' ? 1 : 0]));
  metric('central_backup_snapshots', 'Snapshots por situação.', 'gauge', data.snaps.map((s) => [{ status: s.status }, Number(s.n)]));
  metric('central_repository_size_bytes', 'Espaço ocupado pelo repositório.', 'gauge', data.repos.map((r) => [{ server: r.server, destination: r.destination, repository_id: r.id }, r.size_bytes == null ? null : Number(r.size_bytes)]));
  metric('central_restore_test_ok', 'Último teste automático de restauração do job passou (1) ou não (0).', 'gauge', data.drills.map((j) => [jl(j), j.last_restore_test_status === 'ok' ? 1 : 0]));
  metric('central_restore_test_timestamp_seconds', 'Horário do último teste automático de restauração.', 'gauge', data.drills.map((j) => [jl(j), Math.floor(new Date(j.last_restore_test_at).getTime() / 1000)]));
  const pl = (x: Record<string, any>) => ({ client: x.client, server: x.server, stanza: x.stanza });
  metric('central_pgbackrest_ok', 'Stanza do pgBackRest sem erro (1) ou com erro (0).', 'gauge', data.pgbr.filter((x) => x.status !== 'nao_verificado').map((x) => [pl(x), x.status === 'ok' ? 1 : 0]));
  metric('central_pgbackrest_last_backup_timestamp_seconds', 'Horário do último backup do pgBackRest listado no info.', 'gauge', data.pgbr.map((x) => [pl(x), x.last_backup_at ? Math.floor(new Date(x.last_backup_at).getTime() / 1000) : null]));
  metric('central_self_backup_last_success_timestamp_seconds', 'Horário do último backup VALIDADO do banco da própria central.', 'gauge', [[{}, data.self?.ok_at ? Math.floor(new Date(data.self.ok_at).getTime() / 1000) : null]]);
  metric('central_self_backup_last_ok', 'Último backup da central validado (1) ou não (0).', 'gauge', data.self?.last ? [[{}, data.self.last === 'validado' ? 1 : 0]] : []);
  metric('central_tasks_open', 'Tarefas de agente em aberto por situação.', 'gauge', data.tasks.map((t) => [{ status: t.status }, Number(t.n)]));
  return out.join('\n') + '\n';
}
