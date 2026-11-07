// Plano de recuperação de desastre gerado a partir de dados REAIS da central: inventário do servidor,
// aplicações, bancos, jobs, snapshots validados e histórico de restaurações. Função pura (testável):
// quem chama monta a entrada a partir do banco.
import { parseCron, nextRun } from '../backups/cron.ts';

export interface DrTarget {
  os_name: string; os_version: string; arch: string;
  memory_bytes?: number | null; disk_bytes?: number | null;
  /** minutos para criar a máquina no provedor (depende do provedor; padrão 15) */
  provision_minutes?: number;
  /** TTL do DNS a trocar (minutos) */
  dns_ttl_minutes?: number;
}

export interface DrInput {
  now: Date;
  server: { id: number; name: string; os_name: string | null; os_version: string | null; arch: string | null; memory_bytes: number | null; disk_used_bytes: number | null };
  inventory: { collected_at: string | null; packages: { name: string; version: string }[] | null; services: { name: string; active: string; sub: string }[] | null };
  applications: { id: number; name: string; technology: string | null; install_dir: string | null; data_dirs: string[]; config_files: string[]; systemd_unit: string | null; domains: string[]; rpo_minutes: number | null; rto_minutes: number | null }[];
  databases: { id: number; name: string; engine: string; db_name: string | null; file_path: string | null; version: string | null; size_bytes: number | null }[];
  jobs: { id: number; name: string; kind: string; database_id: number | null; paths: string[]; enabled: boolean; schedule: string; timezone: string; last_success_at: string | null;
    latest_valid: { id: number; restic_id: string; taken_at: string; size_bytes: number | null } | null }[];
  /** restaurações concluídas: bytes e segundos (para medir a vazão real) */
  restoreHistory: { bytes: number; seconds: number }[];
  target: DrTarget;
}

export type Severity = 'critico' | 'aviso' | 'info';
export interface Finding { severity: Severity; code: string; message: string }
export interface Step { order: number; phase: string; title: string; how: string; automated: boolean; minutes: number; basis: string }

/** Pacotes de servidor que importam para reconstruir (o resto vem com o sistema). */
const RELEVANT = /^(nginx|apache2|haproxy|caddy|postgresql-\d+|postgresql-client-\d+|mysql-server|mariadb-server|mongodb-org|redis-server|memcached|rabbitmq-server|php\d+(\.\d+)?-(fpm|cli|pgsql|mysql|curl|gd|mbstring|xml|zip|intl)|nodejs|python3|python3-venv|python3-pip|openjdk-\d+-jre(-headless)?|docker-ce|docker\.io|containerd\.io|certbot|python3-certbot-nginx|fail2ban|ufw|supervisor|pm2|git|rsync|imagemagick|ffmpeg)$/;
const SYSTEM_UNIT = /^(systemd-|dbus|ssh|sshd|cron|rsyslog|getty|serial-getty|user@|polkit|snapd|cloud-|apparmor|ufw|networkd|networking|multipathd|udisks|unattended|apt-|fwupd|ModemManager|packagekit|thermald|irqbalance|accounts-daemon|central-agent|lvm2|blk-|console-|dm-|e2scrub|keyboard|kmod|plymouth|setvtrgb|finalrd|grub|rc-local|lxd|open-iscsi|iscsid|rpcbind|chrony|ntp|qemu-guest|atd|emergency|rescue|motd|ua-|ubuntu-|secureboot|wpa_supplicant|NetworkManager|avahi|bluetooth|cups|gdm|lightdm|upower|colord|kerneloops|whoopsie|snap\.)/;

const MIN = 60_000;
const GB = 1024 ** 3;

/** Nomes equivalentes de arquitetura (Node usa x64/arm64; uname usa x86_64/aarch64). */
export const normArch = (a: string) => (/^(x64|x86_64|amd64)$/i.test(a) ? 'amd64' : /^(arm64|aarch64)$/i.test(a) ? 'arm64' : a.toLowerCase());
function majorOf(v: string | null | undefined) { return v ? (/(\d+)/.exec(v)?.[1] ?? null) : null; }
function sameDistro(a: string | null, b: string) { return (a ?? '').toLowerCase().split(/\s+/)[0] === b.toLowerCase().split(/\s+/)[0]; }
const covered = (p: string, jobs: DrInput['jobs']) => jobs.some((j) => j.kind === 'arquivos' && j.enabled && j.paths.some((jp) => p === jp || p.startsWith(jp.endsWith('/') ? jp : `${jp}/`)));

/** Intervalo projetado entre dois backups (o RPO de projeto do job). */
function scheduleGapMinutes(schedule: string, tz: string, now: Date) {
  try {
    const c = parseCron(schedule);
    let prev = nextRun(c, tz, now);
    let worst = 0;
    for (let i = 0; i < 20; i++) { const n = nextRun(c, tz, prev); worst = Math.max(worst, (n.getTime() - prev.getTime()) / MIN); prev = n; }
    return Math.round(worst);
  } catch { return null; }
}

export function buildPlan(input: DrInput) {
  const f: Finding[] = [];
  const t = input.target;
  const s = input.server;

  // ------------------------------------------------------------ compatibilidade
  if (!s.os_name) f.push({ severity: 'aviso', code: 'inventario_sistema', message: 'O inventário do sistema operacional de origem não foi coletado.' });
  else if (!sameDistro(s.os_name, t.os_name)) f.push({ severity: 'critico', code: 'distro_diferente', message: `Origem ${s.os_name} ${s.os_version ?? ''} e destino ${t.os_name} ${t.os_version}: nomes de pacotes e caminhos podem mudar.` });
  else if (majorOf(s.os_version) !== majorOf(t.os_version)) f.push({ severity: 'aviso', code: 'versao_so_diferente', message: `Versão do sistema muda de ${s.os_version} para ${t.os_version}: confira as versões de PHP/Python/PostgreSQL disponíveis no destino.` });
  if (s.arch && t.arch && normArch(s.arch) !== normArch(t.arch)) f.push({ severity: 'critico', code: 'arquitetura_diferente', message: `Arquitetura muda de ${s.arch} para ${t.arch}: binários próprios das aplicações precisam ser recompilados.` });
  if (t.memory_bytes && s.memory_bytes && t.memory_bytes < s.memory_bytes) f.push({ severity: 'aviso', code: 'memoria_menor', message: `Destino com menos memória (${(t.memory_bytes / GB).toFixed(1)} GB) que a origem (${(s.memory_bytes / GB).toFixed(1)} GB).` });
  if (t.disk_bytes && s.disk_used_bytes && t.disk_bytes < s.disk_used_bytes * 1.2) f.push({ severity: 'critico', code: 'disco_insuficiente', message: `Disco do destino (${(t.disk_bytes / GB).toFixed(0)} GB) não comporta os ${(s.disk_used_bytes / GB).toFixed(0)} GB usados na origem com folga de 20%.` });
  if (!input.inventory.packages) f.push({ severity: 'aviso', code: 'inventario_pacotes', message: 'Lista de pacotes não coletada: o playbook não terá os pacotes da origem (rode a coleta de inventário com a seção "pacotes").' });
  if (!input.inventory.services) f.push({ severity: 'aviso', code: 'inventario_servicos', message: 'Lista de serviços não coletada: o playbook não habilitará serviços da origem.' });

  for (const d of input.databases) {
    const job = input.jobs.find((j) => j.database_id === d.id && j.enabled);
    if (!job) f.push({ severity: 'critico', code: 'banco_sem_backup', message: `O banco ${d.name} não tem job de backup ativo: não há como recuperá-lo.` });
    else if (!job.latest_valid) f.push({ severity: 'critico', code: 'banco_sem_validado', message: `O banco ${d.name} não tem nenhum snapshot validado.` });
    if (d.engine === 'postgresql' && d.version) f.push({ severity: 'info', code: 'versao_postgresql', message: `${d.name}: PostgreSQL ${majorOf(d.version.replace(/^PostgreSQL\s*/i, ''))} na origem; instale a MESMA versão principal no destino (repositório PGDG) — o dump também restaura em versão maior.` });
  }
  for (const a of input.applications) {
    for (const p of [...a.data_dirs, ...a.config_files, ...(a.install_dir ? [a.install_dir] : [])]) {
      if (!covered(p, input.jobs)) f.push({ severity: 'critico', code: 'caminho_sem_backup', message: `${a.name}: ${p} não está em nenhum job de arquivos ativo.` });
    }
  }
  for (const j of input.jobs.filter((x) => x.enabled && !x.latest_valid)) f.push({ severity: 'critico', code: 'job_sem_validado', message: `O job ${j.name} não tem snapshot validado.` });

  // ------------------------------------------------------------ RPO
  const rpoNow = input.jobs.filter((j) => j.enabled).map((j) => ({ job: j.name, minutes: j.latest_valid ? Math.round((input.now.getTime() - new Date(j.latest_valid.taken_at).getTime()) / MIN) : null }));
  const rpoDesign = input.jobs.filter((j) => j.enabled).map((j) => ({ job: j.name, minutes: scheduleGapMinutes(j.schedule, j.timezone, input.now) }));
  const worstNow = rpoNow.some((r) => r.minutes === null) ? null : Math.max(0, ...rpoNow.map((r) => r.minutes!));
  const worstDesign = rpoDesign.some((r) => r.minutes === null) ? null : Math.max(0, ...rpoDesign.map((r) => r.minutes!));

  // ------------------------------------------------------------ RTO (passos com base explícita)
  const measured = input.restoreHistory.filter((h) => h.seconds > 0 && h.bytes > 0);
  const totalBytes = measured.reduce((x, h) => x + h.bytes, 0);
  const totalSec = measured.reduce((x, h) => x + h.seconds, 0);
  const throughput = totalSec > 0 && totalBytes > 50 * 1024 ** 2 ? totalBytes / totalSec : null; // só confia com volume mínimo
  const bps = throughput ?? 30 * 1024 ** 2;
  const basisRestore = throughput ? `vazão medida em ${measured.length} restauração(ões): ${(throughput / 1024 ** 2).toFixed(1)} MB/s` : 'vazão estimada de 30 MB/s (ainda sem restaurações suficientes para medir)';
  const steps: Step[] = [];
  const add = (phase: string, title: string, how: string, automated: boolean, minutes: number, basis: string) => steps.push({ order: steps.length + 1, phase, title, how, automated, minutes: Math.max(1, Math.round(minutes)), basis });
  add('infra', 'Criar o servidor de destino', `${t.os_name} ${t.os_version} (${t.arch}) com o cloud-init gerado pela central (instala restic e o agente e registra na central).`, true, t.provision_minutes ?? 15, t.provision_minutes ? 'informado no plano' : 'padrão de 15 min (ajuste para o seu provedor)');
  add('infra', 'Preparar pacotes e diretórios', 'Playbook Ansible gerado (tag "base"): pacotes da origem, diretórios das aplicações.', true, 10, 'estimativa fixa de 10 min');
  for (const d of input.databases) {
    const j = input.jobs.find((x) => x.database_id === d.id && x.enabled);
    const size = j?.latest_valid?.size_bytes ?? d.size_bytes ?? 0;
    add('dados', `Restaurar o banco ${d.name}`, j?.latest_valid ? `Snapshot ${j.latest_valid.restic_id.slice(0, 8)} de ${new Date(j.latest_valid.taken_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} → restauração em banco novo no servidor de destino.` : 'SEM snapshot validado: não há o que restaurar.', true, 5 + size / bps / 60 * 1.5, `${(size / 1024 ** 2).toFixed(0)} MB; ${basisRestore}; ×1,5 para recriar índices`);
  }
  for (const j of input.jobs.filter((x) => x.kind === 'arquivos' && x.enabled)) {
    const size = j.latest_valid?.size_bytes ?? 0;
    add('dados', `Restaurar os arquivos do job ${j.name}`, j.latest_valid ? `Snapshot ${j.latest_valid.restic_id.slice(0, 8)} → diretório novo no destino e cópia para os caminhos originais (${j.paths.join(', ')}).` : 'SEM snapshot validado.', true, 2 + size / bps / 60, `${(size / 1024 ** 2).toFixed(0)} MB; ${basisRestore}`);
  }
  add('aplicacao', 'Subir serviços e conferir as aplicações', `Playbook (tag "servicos") e conferência: ${input.applications.map((a) => `${a.name}${a.systemd_unit ? ` (${a.systemd_unit})` : ''}`).join(', ') || 'nenhuma aplicação cadastrada'}.`, false, 15 + 5 * input.applications.length, 'estimativa: 15 min + 5 min por aplicação');
  const domains = [...new Set(input.applications.flatMap((a) => a.domains))];
  add('rede', 'Apontar o DNS para o novo servidor', domains.length ? `Domínios: ${domains.join(', ')}.` : 'Nenhum domínio cadastrado nas aplicações.', false, 5 + (t.dns_ttl_minutes ?? 5), `TTL de ${t.dns_ttl_minutes ?? 5} min ${t.dns_ttl_minutes ? '(informado)' : '(padrão; confira o TTL real)'}`);
  const rto = steps.reduce((x, st) => x + st.minutes, 0);

  // ------------------------------------------------------------ metas das aplicações
  for (const a of input.applications) {
    if (a.rpo_minutes && worstDesign !== null && worstDesign > a.rpo_minutes) f.push({ severity: 'critico', code: 'rpo_acima_da_meta', message: `${a.name}: meta de RPO ${a.rpo_minutes} min, mas os backups rodam a cada ${worstDesign} min.` });
    if (a.rpo_minutes && worstNow !== null && worstNow > a.rpo_minutes) f.push({ severity: 'aviso', code: 'rpo_atual_acima_da_meta', message: `${a.name}: o último backup validado tem ${worstNow} min (meta ${a.rpo_minutes} min).` });
    if (a.rto_minutes && rto > a.rto_minutes) f.push({ severity: 'critico', code: 'rto_acima_da_meta', message: `${a.name}: meta de RTO ${a.rto_minutes} min, plano estima ${rto} min.` });
  }

  // ------------------------------------------------------------ pacotes e serviços a reproduzir
  const packages = (input.inventory.packages ?? []).filter((p) => RELEVANT.test(p.name)).map((p) => p.name);
  const appUnits = input.applications.map((a) => a.systemd_unit).filter((u): u is string => Boolean(u));
  const services = [...new Set([...(input.inventory.services ?? []).filter((u) => u.active === 'active' && u.sub === 'running' && !SYSTEM_UNIT.test(u.name)).map((u) => u.name), ...appUnits])].sort();
  const order: Severity[] = ['critico', 'aviso', 'info'];
  f.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const ready = !f.some((x) => x.severity === 'critico');
  return {
    generated_at: input.now.toISOString(), source: { server: s.name, os: `${s.os_name ?? '?'} ${s.os_version ?? ''}`.trim(), arch: s.arch, inventory_at: input.inventory.collected_at },
    target: t, ready, findings: f, steps,
    rpo: { atual_min: worstNow, projetado_min: worstDesign, por_job: rpoNow.map((r, i) => ({ ...r, projetado: rpoDesign[i]!.minutes })) },
    rto: { estimado_min: rto, vazao: throughput ? 'medida' : 'estimada', base: basisRestore },
    packages, services, domains,
    restore_points: input.jobs.filter((j) => j.latest_valid).map((j) => ({ job_id: j.id, job: j.name, snapshot_id: j.latest_valid!.id, restic_id: j.latest_valid!.restic_id, taken_at: j.latest_valid!.taken_at }))
  };
}
export type DrPlan = ReturnType<typeof buildPlan>;
