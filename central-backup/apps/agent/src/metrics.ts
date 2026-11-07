// Métricas do servidor com custo mínimo: leitura de contadores do kernel (/proc) e statfs dos
// sistemas de arquivos montados. Taxas (CPU, rede) são calculadas entre duas amostras.
import { readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentMetrics } from '@central/contracts';
import { run } from './system.ts';

const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'reiserfs', 'jfs', 'nfs', 'nfs4', 'cifs']);

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function meminfo() {
  try {
    const m = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').split('\n').map((l) => l.split(/:\s+/)).filter((p) => p.length === 2).map(([k, v]) => [k, Number.parseInt(v!, 10) * 1024]));
    return { mem_total: m.MemTotal ?? os.totalmem(), mem_available: m.MemAvailable ?? os.freemem(), swap_total: m.SwapTotal ?? 0, swap_free: m.SwapFree ?? 0 };
  } catch {
    return { mem_total: os.totalmem(), mem_available: os.freemem(), swap_total: 0, swap_free: 0 };
  }
}

function disks(): AgentMetrics['disks'] {
  const seen = new Set<string>();
  const out: AgentMetrics['disks'] = [];
  let mounts: { mount: string; fs: string; dev: string }[] = [];
  try {
    mounts = readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p.length > 3 && REAL_FS.has(p[2]!))
      .map((p) => ({ dev: p[0]!, mount: p[1]!.replace(/\\040/g, ' '), fs: p[2]! }));
  } catch {
    // sem /proc (Windows/macOS em desenvolvimento): a raiz do diretório atual
    mounts = [{ dev: 'raiz', mount: path.parse(process.cwd()).root, fs: process.platform }];
  }
  for (const m of mounts) {
    if (seen.has(m.dev) || out.length >= 30) continue; // bind mounts do mesmo dispositivo contam uma vez
    seen.add(m.dev);
    try {
      const s = statfsSync(m.mount);
      const total = Number(s.blocks) * Number(s.bsize);
      if (!total) continue;
      const avail = Number(s.bavail) * Number(s.bsize);
      out.push({ mount: m.mount, fs: m.fs, total, avail, used: total - Number(s.bfree) * Number(s.bsize) });
    } catch { /* sem permissão no ponto de montagem */ }
  }
  return out;
}

function netCounters(): { rx: number; tx: number } | null {
  try {
    let rx = 0;
    let tx = 0;
    for (const line of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name!.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] ?? 0;
      tx += f[8] ?? 0;
    }
    return { rx, tx };
  } catch { return null; }
}

export class MetricsSampler {
  private prevCpu = cpuTimes();
  private prevNet = netCounters();
  private prevAt = Date.now();
  private failed: number | null = null;
  private failedAt = 0;

  /** Unidades systemd com falha, consultadas no máximo a cada 5 minutos. */
  private async failedUnits() {
    if (process.platform !== 'linux') return null;
    if (Date.now() - this.failedAt > 300_000) {
      this.failedAt = Date.now();
      try {
        const out = await run('systemctl', ['--failed', '--no-legend', '--plain', '--type=service'], { timeoutMs: 5000 });
        this.failed = out.split('\n').filter((l) => l.trim()).length;
      } catch { this.failed = null; }
    }
    return this.failed;
  }

  async sample(): Promise<AgentMetrics> {
    const now = Date.now();
    const cpu = cpuTimes();
    const dTotal = cpu.total - this.prevCpu.total;
    const cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - (cpu.idle - this.prevCpu.idle) / dTotal) * 1000) / 10)) : null;
    const net = netCounters();
    const dt = (now - this.prevAt) / 1000;
    const rate = (a?: number, b?: number) => (a !== undefined && b !== undefined && dt > 0 && a >= b ? Math.round((a - b) / dt) : null);
    const m: AgentMetrics = {
      at: new Date(now).toISOString(),
      cpu_pct: cpuPct,
      load: process.platform === 'win32' ? [] : os.loadavg().map((l) => Math.round(l * 100) / 100),
      cpus: Math.max(1, os.cpus().length),
      ...meminfo(),
      disks: disks(),
      net_rx_bps: rate(net?.rx, this.prevNet?.rx),
      net_tx_bps: rate(net?.tx, this.prevNet?.tx),
      failed_units: await this.failedUnits()
    };
    this.prevCpu = cpu;
    this.prevNet = net;
    this.prevAt = now;
    return m;
  }
}
