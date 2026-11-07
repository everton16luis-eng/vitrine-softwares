// Ambiente de integração reaproveitado pelas fases 2+: banco _test recriado, painel (inject),
// gateway mTLS real em porta local, worker sob demanda, login com 2FA e agente real registrado.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { Database, migrate, seed } from '@central/database';
import { hashPassword, totpCode } from '@central/security';
import { loadConfig, loadDotEnv, ROOT, type Config } from '../../apps/api/src/config.ts';
import { ensureKekFile, loadKeyring, initSystemKeys, loadGatewayMaterial } from '../../apps/api/src/keys.ts';
import { buildPanel } from '../../apps/api/src/panel.ts';
import { buildGateway } from '../../apps/api/src/gateway/app.ts';
import { Agent, enroll } from '../../apps/agent/src/agent.ts';
import { AgentState } from '../../apps/agent/src/state.ts';

export const PASSWORD = 'Teste-Integracao-Senha-2026';
export const silent = { info() {}, warn() {}, error() {} };
export interface Session { cookie: string; csrf: string }

/** Pré-condição: banco de testes acessível. Devolve o motivo para pular, ou false. */
export async function prepare(): Promise<{ config: Config | null; tmp: string; skip: string | false }> {
  loadDotEnv();
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'central-it-'));
  try {
    const config = loadConfig({ NODE_ENV: 'test', KEK_FILE: path.join(tmp, 'kek'), GATEWAY_DIR: path.join(tmp, 'gateway'), GATEWAY_HOSTNAMES: 'localhost', GATEWAY_HOST: '127.0.0.1' });
    const probe = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
    await probe.connect();
    await probe.end();
    return { config, tmp, skip: false };
  } catch (err) {
    return { config: null, tmp, skip: `PostgreSQL de testes indisponível (${(err as { code?: string }).code ?? 'erro de conexão'})` };
  }
}

export class Central {
  owner!: Database;
  db!: Database;
  panel!: FastifyInstance;
  gateway!: FastifyInstance;
  gatewayUrl = '';
  private gatewayPort = 0;
  private readonly secrets = new Map<string, string>();
  private readonly cfg: Config;
  readonly tmp: string;
  constructor(cfg: Config, tmp: string) { this.cfg = cfg; this.tmp = tmp; }
  get config() { return this.cfg; }

  async setup() {
    this.owner = new Database({ connectionString: this.cfg.databaseUrl, appRole: null });
    await this.owner.owner((c) => c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'));
    await migrate(this.owner, { log: () => {} });
    await seed(this.owner);
    ensureKekFile(this.cfg.kekFile);
    const appDb = new Database({ connectionString: this.cfg.databaseUrl, appRole: this.cfg.dbAppRole });
    await initSystemKeys(appDb, loadKeyring(this.cfg), this.cfg);
    await appDb.close();
    await this.start();
  }

  async start() {
    this.db = new Database({ connectionString: this.cfg.databaseUrl, appRole: this.cfg.dbAppRole });
    this.panel = await buildPanel({ db: this.db, config: this.cfg, keyring: loadKeyring(this.cfg), logger: false });
    this.gateway = await buildGateway({ db: this.db, config: this.cfg, material: loadGatewayMaterial(this.cfg), logger: false, identityCacheMs: 0 });
    await this.gateway.listen({ host: '127.0.0.1', port: this.gatewayPort });
    this.gatewayPort = (this.gateway.server.address() as { port: number }).port;
    this.gatewayUrl = `https://127.0.0.1:${this.gatewayPort}`;
  }

  async stop() {
    await this.gateway.close();
    await this.panel.close();
    await this.db.close();
  }

  async teardown() {
    await this.stop().catch(() => {});
    await this.owner?.close();
    try { rmSync(this.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows */ }
  }

  call(s: Session | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
    return this.panel.inject({ method: method as 'GET', url, payload: payload as object, headers: s ? { cookie: `cb_session=${s.cookie}`, 'x-csrf-token': s.csrf, ...headers } : headers });
  }

  async createUser(email: string, roles: string[], clientIds?: number[]) {
    const hash = await hashPassword(PASSWORD);
    await this.db.system(async (tx) => {
      const u = await tx.one('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id', [email, email.split('@')[0], hash]);
      await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = ANY($2)', [u!.id, roles]);
      for (const c of clientIds ?? []) await tx.query('INSERT INTO user_client_scopes (user_id, client_id) VALUES ($1, $2)', [u!.id, c]);
    });
  }

  async login(email: string): Promise<Session> {
    const res = await this.call(null, 'POST', '/api/v1/auth/login', { email, password: PASSWORD });
    assert.equal(res.statusCode, 200, res.body);
    const s = { cookie: res.cookies.find((c) => c.name === 'cb_session')!.value, csrf: res.json().csrf };
    if (res.json().mfa === 'configurar') {
      const setup = await this.call(s, 'POST', '/api/v1/auth/mfa/setup');
      this.secrets.set(email, setup.json().secret);
      assert.equal((await this.call(s, 'POST', '/api/v1/auth/mfa/enable', { code: totpCode(setup.json().secret) })).statusCode, 200);
    } else {
      assert.equal((await this.call(s, 'POST', '/api/v1/auth/mfa/verify', { code: totpCode(this.secrets.get(email)!, Date.now() + 30_000) })).statusCode, 200);
    }
    return s;
  }

  /** Cria cliente + servidor e registra um agente real (estado em diretório temporário). */
  async clientWithAgent(admin: Session, name: string) {
    const c = await this.call(admin, 'POST', '/api/v1/clients', { legal_name: `${name} Ltda` });
    assert.equal(c.statusCode, 201, c.body);
    const s = await this.call(admin, 'POST', '/api/v1/servers', { client_id: c.json().id, name: `srv-${name.toLowerCase()}` });
    assert.equal(s.statusCode, 201, s.body);
    const code = await this.call(admin, 'POST', `/api/v1/servers/${s.json().id}/enrollment-codes`, {});
    const state = new AgentState(path.join(this.tmp, `agent-${s.json().id}`));
    const { agentId } = await enroll({ url: this.gatewayUrl, caSha256: code.json().ca_sha256, code: code.json().code, state, log: silent });
    const agent = new Agent({ state, log: silent });
    await agent.heartbeat();
    return { clientId: c.json().id as number, serverId: s.json().id as number, agentId, agent, state };
  }

  async task(admin: Session, id: string) {
    const r = await this.call(admin, 'GET', `/api/v1/tasks/${id}`);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }
}

/** Agente processa tudo o que houver e envia os resultados. */
export async function pump(agent: Agent) {
  await agent.heartbeat();
  await agent.drainTasks();
  await agent.flushResults();
}

/** rest-server oficial (.tools/bin) em modo append-only com repositórios privados. */
export async function startRestServer(dataDir: string, fixedPort?: number): Promise<{ url: string; port: number; stop: () => Promise<void> }> {
  const bin = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'rest-server.exe' : 'rest-server');
  // sem .htpasswd o rest-server com autenticação encerra na hora
  const htpasswd = path.join(dataDir, '.htpasswd');
  if (!existsSync(htpasswd)) writeFileSync(htpasswd, '', { mode: 0o600 });
  const port = fixedPort ?? 20000 + Math.floor(Math.random() * 20000);
  const child: ChildProcess = spawn(bin, ['--path', dataDir, '--listen', `127.0.0.1:${port}`, '--append-only', '--private-repos'], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  const exit = new Promise<void>((r) => child.once('exit', () => { exited = true; r(); }));
  const url = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 50 && !exited && !up; i++) {
    try { up = (await fetch(url, { signal: AbortSignal.timeout(500) })).status === 401; } catch { /* subindo */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  if (!up) { child.kill(); throw new Error(`rest-server não subiu em ${url}`); }
  return { url, port, stop: async () => { if (!exited) child.kill(); await exit; } };
}

export const hasTool = (name: string) => existsSync(path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? `${name}.exe` : name));
