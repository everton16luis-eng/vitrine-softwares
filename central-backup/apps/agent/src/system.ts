// Coleta de informações do servidor. Somente leitura, comandos fixos (sem shell), com tempo limite.
// O que não puder ser lido é informado como indisponível — nunca preenchido com valores inventados.
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';

export function run(cmd: string, args: string[], { timeoutMs = 20_000, signal, env, stdin, maxBuffer = 16 * 1024 * 1024 }: { timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string>; stdin?: string; maxBuffer?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {
      timeout: timeoutMs, maxBuffer, signal, windowsHide: true,
      env: { PATH: process.platform === 'win32' ? process.env.PATH ?? '' : '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', HOME: process.env.HOME ?? os.tmpdir(), ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}), ...env }
    }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(stdout)));
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

export function osRelease(): Record<string, string> {
  for (const f of ['/etc/os-release', '/usr/lib/os-release']) {
    if (!existsSync(f)) continue;
    const out: Record<string, string> = {};
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
    }
    return out;
  }
  return {};
}

export function machineId(): string | undefined {
  try {
    const id = readFileSync('/etc/machine-id', 'utf8').trim();
    return /^[0-9a-f]{32}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export function hostFacts() {
  const rel = osRelease();
  const facts = {
    hostname: os.hostname().slice(0, 253),
    os_name: (rel.NAME ?? os.type()).slice(0, 100),
    os_version: (rel.VERSION_ID ?? rel.VERSION ?? os.release()).slice(0, 100),
    arch: os.arch().slice(0, 30)
  };
  const id = machineId();
  return id ? { ...facts, machine_id: id } : facts;
}

type Section = 'sistema' | 'hardware' | 'rede' | 'servicos' | 'pacotes';
const unavailable = (err: unknown) => ({ indisponivel: true, motivo: String((err as Error).message ?? err).slice(0, 300) });

async function sistema() {
  const rel = osRelease();
  return {
    hostname: os.hostname(), os_name: rel.NAME ?? os.type(), os_version: rel.VERSION_ID ?? os.release(), os_pretty: rel.PRETTY_NAME ?? null,
    kernel: os.release(), arch: os.arch(), uptime_s: Math.round(os.uptime()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    machine_id: machineId() ?? null
  };
}

async function hardware(signal?: AbortSignal) {
  const cpus = os.cpus();
  const out: Record<string, unknown> = { cpu_model: cpus[0]?.model?.trim() ?? null, cpu_cores: cpus.length, memory_bytes: os.totalmem(), memory_free_bytes: os.freemem(), load_avg: os.loadavg() };
  if (process.platform !== 'linux') return { ...out, disks: [], disks_indisponivel: 'coleta de discos disponível apenas em Linux' };
  try {
    const lsblk = JSON.parse(await run('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL'], { signal })) as { blockdevices?: any[] };
    out.disks = (lsblk.blockdevices ?? []).filter((d) => d.type === 'disk').map((d) => ({ name: d.name, size_bytes: Number(d.size), model: d.model ?? null }));
  } catch (err) { out.disks = []; out.disks_erro = unavailable(err); }
  try {
    const df = await run('df', ['-B1', '--output=target,fstype,size,used,avail', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay'], { signal });
    out.filesystems = df.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 5)
      .map(([mount, fstype, size, used, avail]) => ({ mount, fstype, size_bytes: Number(size), used_bytes: Number(used), avail_bytes: Number(avail) }));
  } catch (err) { out.filesystems = unavailable(err); }
  return out;
}

async function rede() {
  const ifs = os.networkInterfaces();
  return {
    interfaces: Object.entries(ifs).map(([name, addrs]) => ({
      name, mac: addrs?.[0]?.mac ?? null,
      addresses: (addrs ?? []).map((a) => ({ address: a.address, family: a.family, cidr: a.cidr, internal: a.internal }))
    }))
  };
}

async function servicos(signal?: AbortSignal) {
  if (process.platform !== 'linux') return { indisponivel: true, motivo: 'systemd disponível apenas em Linux' };
  const outText = await run('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'], { signal });
  const units = outText.trim().split('\n').filter(Boolean).map((l) => {
    const [name, load, active, sub] = l.trim().split(/\s+/);
    return { name, load, active, sub };
  });
  return { gerenciador: 'systemd', total: units.length, units: units.slice(0, 2000) };
}

async function pacotes(signal?: AbortSignal) {
  if (process.platform !== 'linux') return { indisponivel: true, motivo: 'coleta de pacotes disponível apenas em Linux' };
  let manager: string; let lines: string[];
  try {
    lines = (await run('dpkg-query', ['-W', '-f', '${Package}\t${Version}\t${Status}\n'], { signal })).split('\n').filter((l) => l.endsWith('installed'));
    manager = 'dpkg';
  } catch {
    lines = (await run('rpm', ['-qa', '--qf', '%{NAME}\t%{VERSION}-%{RELEASE}\tinstalled\n'], { signal })).split('\n').filter(Boolean);
    manager = 'rpm';
  }
  const items = lines.map((l) => { const [name, version] = l.split('\t'); return { name, version }; }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { gerenciador: manager, total: items.length, items: items.slice(0, 10_000) };
}

const COLLECTORS: Record<Section, (signal?: AbortSignal) => Promise<unknown>> = { sistema, hardware, rede, servicos, pacotes };

export async function collectInventory(sections: Section[], signal?: AbortSignal) {
  const out: Record<string, unknown> = {};
  for (const s of sections) {
    signal?.throwIfAborted();
    try { out[s] = await COLLECTORS[s](signal); } catch (err) { out[s] = unavailable(err); }
  }
  return out;
}
