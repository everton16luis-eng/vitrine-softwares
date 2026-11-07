// Inventário enviado pelos agentes: versões guardadas por mudança (hash) e campos principais
// copiados para o cadastro do servidor.
import { createHash } from 'node:crypto';
import { canonicalJson } from '@central/shared';
import type { Tx } from '@central/database';

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export async function storeInventory(tx: Tx, server: { id: number; client_id: number }, collectedAt: string, data: Record<string, unknown>) {
  const text = canonicalJson(data);
  if (text.length > 2_000_000) throw new Error('Inventário grande demais.');
  const hash = createHash('sha256').update(text).digest('hex');
  await tx.query(`INSERT INTO server_inventory (server_id, client_id, collected_at, data, hash) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (server_id, hash) DO NOTHING`, [server.id, server.client_id, collectedAt, text, hash]);

  const sys = (data.sistema ?? {}) as Record<string, unknown>;
  const hw = (data.hardware ?? {}) as Record<string, unknown>;
  const net = data.rede as Record<string, unknown> | undefined;
  const ips = Array.isArray(net?.interfaces)
    ? (net.interfaces as { addresses?: { address?: string; internal?: boolean }[] }[])
      .flatMap((i) => i.addresses ?? []).filter((a) => !a.internal && typeof a.address === 'string').map((a) => a.address!.replace(/%.*$/, '')).slice(0, 20)
    : null;
  const disks = Array.isArray(hw.disks) ? hw.disks.slice(0, 50) : null;
  await tx.query(`UPDATE servers SET
      hostname = coalesce($2, hostname), os_name = coalesce($3, os_name), os_version = coalesce($4, os_version), arch = coalesce($5, arch),
      cpu_model = coalesce($6, cpu_model), cpu_cores = coalesce($7, cpu_cores), memory_bytes = coalesce($8, memory_bytes),
      uptime_s = coalesce($9, uptime_s), disks = coalesce($10, disks), storage_bytes = coalesce($11, storage_bytes),
      ip_addresses = coalesce($12::inet[], ip_addresses), network = coalesce($13, network)
    WHERE id = $1`,
  [server.id, str(sys.hostname, 253), str(sys.os_name), str(sys.os_version), str(sys.arch, 30), str(hw.cpu_model), num(hw.cpu_cores), num(hw.memory_bytes),
    num(sys.uptime_s), disks ? JSON.stringify(disks) : null, disks ? disks.reduce((s: number, d: any) => s + (num(d?.size_bytes) ?? 0), 0) : null,
    ips && ips.length ? ips : null, Array.isArray(net?.interfaces) ? JSON.stringify(net.interfaces) : null]);
  return { hash };
}
