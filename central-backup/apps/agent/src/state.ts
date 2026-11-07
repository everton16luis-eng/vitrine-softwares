// Estado local do agente: configuração, certificados e banco SQLite (fila de resultados e
// proteção contra repetição). Arquivos sensíveis com permissão 0600; diretório 0700.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const AGENT_VERSION = '0.1.0';

export interface AgentConfig {
  gateway_url: string;
  ca_sha256: string;
  agent_id: string;
  task_signing_keys: Record<string, string>;
  heartbeat_interval_s: number;
  enrolled_at: string;
}

export function stateDir(): string {
  return process.env.CENTRAL_AGENT_DIR || (process.platform === 'linux' ? '/var/lib/central-agent' : path.resolve('.data/agent'));
}

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
}

/** Escrita atômica (arquivo temporário + rename) com permissão restrita. */
export function writeSecure(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
}

export class AgentState {
  readonly dir: string;
  constructor(dir = stateDir()) { this.dir = dir; }
  file(name: string) { return path.join(this.dir, name); }
  isEnrolled() { return existsSync(this.file('agent.json')) && existsSync(this.file('cert.pem')) && existsSync(this.file('key.pem')); }
  config(): AgentConfig { return JSON.parse(readFileSync(this.file('agent.json'), 'utf8')) as AgentConfig; }
  saveConfig(c: AgentConfig) { writeSecure(this.file('agent.json'), JSON.stringify(c, null, 2) + '\n'); }
  tls() {
    return { ca: readFileSync(this.file('ca.pem'), 'utf8'), cert: readFileSync(this.file('cert.pem'), 'utf8'), key: readFileSync(this.file('key.pem'), 'utf8') };
  }
}

export interface OutboxItem { id: number; task_id: string; attempt: number; body: string; tries: number }

/** Fila local: resultados ficam gravados até a central confirmar o recebimento. */
export class LocalQueue {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS seen (task_id TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (task_id, attempt));
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, attempt INTEGER NOT NULL, body TEXT NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, UNIQUE (task_id, attempt));`);
    if (process.platform !== 'win32') chmodSync(file, 0o600);
  }

  /** Marca a tentativa como recebida. false = já recebida antes (repetição: não executar de novo). */
  claim(taskId: string, attempt: number): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO seen (task_id, attempt, status, at) VALUES (?, ?, 'executando', ?)").run(taskId, attempt, Date.now());
    return Number(r.changes) === 1;
  }
  finish(taskId: string, attempt: number, body: unknown) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE seen SET status = 'terminado' WHERE task_id = ? AND attempt = ?").run(taskId, attempt);
      this.db.prepare('INSERT OR IGNORE INTO outbox (task_id, attempt, body) VALUES (?, ?, ?)').run(taskId, attempt, JSON.stringify(body));
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  /** Execuções que o agente não terminou (processo caiu no meio). */
  unfinished(): { task_id: string; attempt: number }[] {
    return this.db.prepare("SELECT task_id, attempt FROM seen WHERE status = 'executando'").all().map((r) => ({ task_id: String(r.task_id), attempt: Number(r.attempt) }));
  }
  due(limit = 20): OutboxItem[] {
    return this.db.prepare('SELECT id, task_id, attempt, body, tries FROM outbox WHERE next_at <= ? ORDER BY id LIMIT ?').all(Date.now(), limit)
      .map((r) => ({ id: Number(r.id), task_id: String(r.task_id), attempt: Number(r.attempt), body: String(r.body), tries: Number(r.tries) }));
  }
  remove(id: number) { this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id); }
  retryLater(id: number, tries: number) {
    const delay = Math.min(30_000 * 2 ** Math.min(tries, 6), 30 * 60_000);
    this.db.prepare('UPDATE outbox SET tries = tries + 1, next_at = ? WHERE id = ?').run(Date.now() + delay, id);
  }
  pending(): number { return Number((this.db.prepare('SELECT count(*) AS n FROM outbox').get() as { n: number }).n); }
  prune(days = 30) { this.db.prepare("DELETE FROM seen WHERE status = 'terminado' AND at < ?").run(Date.now() - days * 86_400_000); }
  close() { this.db.close(); }
}
