// Configuração por variáveis de ambiente (ver .env.example). Valores inválidos impedem a inicialização.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const int = (name: string, def: number, min = 1, max = 65535) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} inválido: ${raw}`);
  return n;
};
const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

/** Em desenvolvimento usa .tools/bin (binários oficiais conferidos por SHA-256); em produção, o PATH. */
function defaultTool(name: string) {
  const local = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(local) ? local : name;
}

export interface Config {
  env: 'development' | 'test' | 'production';
  databaseUrl: string;
  dbAppRole: string;
  kekFile: string;
  gatewayDir: string;
  panel: { host: string; port: number; secureCookies: boolean; trustProxy: boolean; webDist: string };
  gateway: { host: string; port: number; hostnames: string[]; publicUrl: string };
  agent: { heartbeatIntervalS: number; offlineAfterS: number; leaseS: number; certDays: number; renewBeforeDays: number };
  session: { idleMinutes: number; absoluteHours: number };
  /** ferramentas usadas pela própria central (teste de destino, manutenção de repositórios) */
  tools: { restic: string; pgRestore: string };
  /** token do Prometheus para /api/v1/metrics (nulo = endpoint desligado) */
  metricsToken: string | null;
  /** SMTP para alertas por e-mail (ex.: smtps://usuario:senha@smtp.exemplo.com.br:465) */
  smtp: { url: string | null; from: string | null };
  /** origem do agente para o cloud-init de DR (repositório git https + ref fixada) */
  agentSource: { repo: string; ref: string } | null;
  /** backup da própria central (banco) — repositório restic separado, de preferência FORA desta máquina */
  selfBackup: { repository: string | null; passwordFile: string; schedule: string; timezone: string; keepLast: number | null; pgDump: string };
}

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;
  const env = (process.env.NODE_ENV ?? 'development') as Config['env'];
  if (!['development', 'test', 'production'].includes(env)) throw new Error(`NODE_ENV inválido: ${env}`);
  const databaseUrl = env === 'test' ? process.env.DATABASE_URL_TEST ?? '' : process.env.DATABASE_URL ?? '';
  if (!databaseUrl) throw new Error(env === 'test' ? 'DATABASE_URL_TEST não configurado.' : 'DATABASE_URL não configurado.');
  if (env === 'test' && !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('O banco de testes precisa terminar com "_test".');
  const hostnames = (process.env.GATEWAY_HOSTNAMES ?? 'localhost').split(',').map((s) => s.trim()).filter(Boolean);
  const gatewayPort = int('GATEWAY_PORT', 8443);
  return {
    env,
    databaseUrl,
    dbAppRole: process.env.DB_APP_ROLE || 'central_app',
    kekFile: resolve(process.env.KEK_FILE ?? '.data/kek'),
    gatewayDir: resolve(process.env.GATEWAY_DIR ?? '.data/gateway'),
    panel: { host: process.env.PANEL_HOST || '127.0.0.1', port: int('PANEL_PORT', 4300), secureCookies: env === 'production', trustProxy: process.env.TRUST_PROXY === '1', webDist: resolve(process.env.WEB_DIST ?? 'apps/web/dist') },
    gateway: { host: process.env.GATEWAY_HOST || '0.0.0.0', port: gatewayPort, hostnames, publicUrl: process.env.GATEWAY_PUBLIC_URL || `https://${hostnames[0]}:${gatewayPort}` },
    agent: {
      heartbeatIntervalS: int('AGENT_HEARTBEAT_S', 30, 5, 600),
      offlineAfterS: int('AGENT_OFFLINE_AFTER_S', 120, 15, 3600),
      leaseS: int('TASK_LEASE_S', 120, 10, 3600),
      certDays: int('AGENT_CERT_DAYS', 90, 1, 397),
      renewBeforeDays: int('AGENT_CERT_RENEW_BEFORE_DAYS', 30, 1, 200)
    },
    session: { idleMinutes: int('SESSION_IDLE_MINUTES', 30, 5, 1440), absoluteHours: int('SESSION_ABSOLUTE_HOURS', 12, 1, 72) },
    tools: { restic: process.env.RESTIC_BIN || defaultTool('restic'), pgRestore: process.env.PG_RESTORE_BIN || 'pg_restore' },
    metricsToken: (process.env.METRICS_TOKEN ?? '').length >= 32 ? process.env.METRICS_TOKEN! : null,
    smtp: { url: process.env.SMTP_URL || null, from: process.env.SMTP_FROM || null },
    selfBackup: {
      repository: process.env.SELF_BACKUP_REPOSITORY || null,
      passwordFile: resolve(process.env.SELF_BACKUP_PASSWORD_FILE ?? '.data/self-backup.pw'),
      schedule: process.env.SELF_BACKUP_SCHEDULE || '30 1 * * *',
      timezone: process.env.SELF_BACKUP_TZ || 'America/Sao_Paulo',
      keepLast: process.env.SELF_BACKUP_KEEP_LAST ? int('SELF_BACKUP_KEEP_LAST', 30, 1, 3650) : null,
      pgDump: process.env.PG_DUMP_BIN || 'pg_dump'
    },
    agentSource: process.env.AGENT_SOURCE_REPO && process.env.AGENT_SOURCE_REF ? { repo: process.env.AGENT_SOURCE_REPO, ref: process.env.AGENT_SOURCE_REF } : null
  };
}
