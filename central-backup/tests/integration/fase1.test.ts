// Integração da Fase 1 com PostgreSQL real (DATABASE_URL_TEST, nome terminado em _test), painel,
// gateway mTLS real (porta local) e o agente real. Recria o schema do banco de testes a cada execução.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { Database, migrate, seed } from '@central/database';
import { hashPassword, totpCode } from '@central/security';
import { loadConfig, loadDotEnv, type Config } from '../../apps/api/src/config.ts';
import { ensureKekFile, loadKeyring, initSystemKeys, loadGatewayMaterial } from '../../apps/api/src/keys.ts';
import { buildPanel } from '../../apps/api/src/panel.ts';
import { buildGateway } from '../../apps/api/src/gateway/app.ts';
import { runMaintenanceOnce } from '../../apps/api/src/worker.ts';
import { claimTasks } from '../../apps/api/src/tasks/service.ts';
import { Agent, enroll, EXIT_REVOKED } from '../../apps/agent/src/agent.ts';
import { AgentState } from '../../apps/agent/src/state.ts';
import { HttpError } from '../../apps/agent/src/http.ts';

loadDotEnv();
const tmp = mkdtempSync(path.join(os.tmpdir(), 'central-it-'));
let config: Config | null = null;
let skip: string | false = false;
try {
  config = loadConfig({ NODE_ENV: 'test', KEK_FILE: path.join(tmp, 'kek'), GATEWAY_DIR: path.join(tmp, 'gateway'), GATEWAY_HOSTNAMES: 'localhost', GATEWAY_HOST: '127.0.0.1' });
  const probe = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000 });
  await probe.connect();
  await probe.end();
} catch (err) {
  skip = `PostgreSQL de testes indisponível (${(err as { code?: string }).code ?? ((err as Error).message || "erro de conexão")}) — rode "npm test" com o banco no ar`;
}

const PASSWORD = 'Teste-Integracao-Senha-2026';
const silent = { info() {}, warn() {}, error() {} };

interface Session { cookie: string; csrf: string }

describe('Fase 1 — integração', { skip }, () => {
  const cfg = config!;
  let owner: Database;
  let db: Database;
  let panel: FastifyInstance;
  let gateway: FastifyInstance;
  let gatewayPort = 0;
  let gatewayUrl = '';
  const secrets = new Map<string, string>();
  let admin: Session;
  let restricted: Session;
  let clientA = 0; let clientB = 0; let serverA = 0;
  let agent: Agent;
  let agentId = '';

  async function startCentral() {
    db = new Database({ connectionString: cfg.databaseUrl, appRole: cfg.dbAppRole });
    panel = await buildPanel({ db, config: cfg, keyring: loadKeyring(cfg), logger: false });
    gateway = await buildGateway({ db, config: cfg, material: loadGatewayMaterial(cfg), logger: false, identityCacheMs: 0 });
    await gateway.listen({ host: '127.0.0.1', port: gatewayPort });
    gatewayPort = (gateway.server.address() as { port: number }).port;
    gatewayUrl = `https://127.0.0.1:${gatewayPort}`;
  }
  async function stopCentral() {
    await gateway.close();
    await panel.close();
    await db.close();
  }

  const call = (s: Session | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    panel.inject({ method: method as 'GET', url, payload: payload as object, headers: s ? { cookie: `cb_session=${s.cookie}`, 'x-csrf-token': s.csrf, ...headers } : headers });

  async function login(email: string): Promise<Session> {
    const res = await call(null, 'POST', '/api/v1/auth/login', { email, password: PASSWORD });
    assert.equal(res.statusCode, 200, res.body);
    const s = { cookie: res.cookies.find((c) => c.name === 'cb_session')!.value, csrf: res.json().csrf };
    if (res.json().mfa === 'configurar') {
      const setup = await call(s, 'POST', '/api/v1/auth/mfa/setup');
      assert.equal(setup.statusCode, 200, setup.body);
      secrets.set(email, setup.json().secret);
      const en = await call(s, 'POST', '/api/v1/auth/mfa/enable', { code: totpCode(setup.json().secret) });
      assert.equal(en.statusCode, 200, en.body);
    } else {
      // passo seguinte: o código do passo atual pode já ter sido usado (anti-replay)
      const v = await call(s, 'POST', '/api/v1/auth/mfa/verify', { code: totpCode(secrets.get(email)!, Date.now() + 30_000) });
      assert.equal(v.statusCode, 200, v.body);
    }
    return s;
  }

  async function taskStatus(id: string) {
    const r = await call(admin, 'GET', `/api/v1/tasks/${id}`);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }

  before(async () => {
    owner = new Database({ connectionString: cfg.databaseUrl, appRole: null });
    await owner.owner((c) => c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'));
    await migrate(owner, { log: () => {} });
    await seed(owner);
    ensureKekFile(cfg.kekFile);
    const appDb = new Database({ connectionString: cfg.databaseUrl, appRole: cfg.dbAppRole });
    await initSystemKeys(appDb, loadKeyring(cfg), cfg);
    const hash = await hashPassword(PASSWORD);
    await appDb.system(async (tx) => {
      const u = await tx.one("INSERT INTO users (email, name, password_hash) VALUES ('admin@exemplo.com.br', 'Admin Teste', $1) RETURNING id", [hash]);
      await tx.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'admin'", [u!.id]);
    });
    await appDb.close();
    await startCentral();
  });

  after(async () => {
    agent?.close();
    await stopCentral().catch(() => {});
    await owner?.close();
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows */ }
  });

  test('login exige senha correta e 2FA; CSRF é obrigatório', async () => {
    const bad = await call(null, 'POST', '/api/v1/auth/login', { email: 'admin@exemplo.com.br', password: 'errada-errada-1' });
    assert.equal(bad.statusCode, 401);
    const res = await call(null, 'POST', '/api/v1/auth/login', { email: 'admin@exemplo.com.br', password: PASSWORD });
    const s = { cookie: res.cookies.find((c) => c.name === 'cb_session')!.value, csrf: res.json().csrf };
    assert.equal(res.json().mfa, 'configurar');
    const blocked = await call(s, 'GET', '/api/v1/clients');
    assert.equal(blocked.statusCode, 401);
    assert.equal(blocked.json().code, 'MFA_PENDENTE');
    const setup = await call(s, 'POST', '/api/v1/auth/mfa/setup');
    secrets.set('admin@exemplo.com.br', setup.json().secret);
    const wrong = await call(s, 'POST', '/api/v1/auth/mfa/enable', { code: '000000' });
    assert.equal(wrong.statusCode, 422);
    const en = await call(s, 'POST', '/api/v1/auth/mfa/enable', { code: totpCode(setup.json().secret) });
    assert.equal(en.json().recovery_codes.length, 10);
    const noCsrf = await panel.inject({ method: 'POST', url: '/api/v1/clients', payload: { legal_name: 'X Ltda' }, headers: { cookie: `cb_session=${s.cookie}` } });
    assert.equal(noCsrf.statusCode, 403);
    assert.equal(noCsrf.json().code, 'CSRF');

    // código de recuperação: vale uma única vez
    const recovery = en.json().recovery_codes[0];
    const r2 = await call(null, 'POST', '/api/v1/auth/login', { email: 'admin@exemplo.com.br', password: PASSWORD });
    const s2 = { cookie: r2.cookies.find((c) => c.name === 'cb_session')!.value, csrf: r2.json().csrf };
    assert.equal((await call(s2, 'POST', '/api/v1/auth/mfa/verify', { code: recovery })).statusCode, 200);
    const r3 = await call(null, 'POST', '/api/v1/auth/login', { email: 'admin@exemplo.com.br', password: PASSWORD });
    const s3 = { cookie: r3.cookies.find((c) => c.name === 'cb_session')!.value, csrf: r3.json().csrf };
    assert.equal((await call(s3, 'POST', '/api/v1/auth/mfa/verify', { code: recovery })).statusCode, 401);
    admin = s2;
  });

  test('cadastro de clientes e servidores, com validação', async () => {
    const a = await call(admin, 'POST', '/api/v1/clients', { legal_name: 'Cliente A Ltda', cnpj: '11.222.333/0001-81' });
    assert.equal(a.statusCode, 201, a.body);
    const b = await call(admin, 'POST', '/api/v1/clients', { legal_name: 'Cliente B Ltda' });
    clientA = a.json().id; clientB = b.json().id;
    assert.equal((await call(admin, 'POST', '/api/v1/clients', { legal_name: 'Dup', cnpj: '11222333000181' })).statusCode, 409);
    assert.equal((await call(admin, 'POST', '/api/v1/clients', { legal_name: 'Ruim', cnpj: '11222333000100' })).statusCode, 422);
    assert.equal((await call(admin, 'POST', '/api/v1/clients', { legal_name: 'Extra', hack: 1 })).statusCode, 422);
    const sa = await call(admin, 'POST', '/api/v1/servers', { client_id: clientA, name: 'srv-a', ip_addresses: ['10.0.0.5'] });
    assert.equal(sa.statusCode, 201, sa.body);
    serverA = sa.json().id;
    assert.equal((await call(admin, 'POST', '/api/v1/servers', { client_id: clientB, name: 'srv-b' })).statusCode, 201);
    assert.equal((await call(admin, 'POST', '/api/v1/servers', { client_id: clientA, name: 'srv-x', ip_addresses: ['999.1.1.1'] })).statusCode, 422);
  });

  test('isolamento entre clientes (RLS) e RBAC', async () => {
    const u = await call(admin, 'POST', '/api/v1/users', { email: 'infra@exemplo.com.br', name: 'Infra A', password: PASSWORD, roles: ['infra_engineer'], client_ids: [clientA] });
    assert.equal(u.statusCode, 201, u.body);
    restricted = await login('infra@exemplo.com.br');

    const list = await call(restricted, 'GET', '/api/v1/clients');
    assert.deepEqual(list.json().items.map((c: { id: number }) => c.id), [clientA]);
    assert.equal((await call(restricted, 'GET', `/api/v1/clients/${clientB}`)).statusCode, 404);
    const servers = await call(restricted, 'GET', '/api/v1/servers');
    assert.deepEqual(servers.json().items.map((s: { name: string }) => s.name), ['srv-a']);
    assert.equal((await call(restricted, 'POST', '/api/v1/servers', { client_id: clientB, name: 'invasor' })).statusCode, 422);
    assert.equal((await call(restricted, 'PATCH', `/api/v1/clients/${clientA}`, { notes: 'x' })).statusCode, 403);
    assert.equal((await call(restricted, 'POST', '/api/v1/users', { email: 'x@exemplo.com.br', name: 'X', password: PASSWORD, roles: ['admin'] })).statusCode, 403);
    assert.equal((await call(restricted, 'GET', '/api/v1/audit')).statusCode, 403);

    // no próprio banco: escopo restrito não lê nem grava dados de outro cliente
    const rows = await db.withScope([clientA], (tx) => tx.many('SELECT client_id FROM servers'));
    assert.ok(rows.every((r) => r.client_id === clientA));
    await assert.rejects(db.withScope([clientA], (tx) => tx.query("INSERT INTO servers (client_id, name) VALUES ($1, 'x')", [clientB])), { code: '42501' }); // RLS
    // FK composta: agente não pode ligar servidor de um cliente a outro cliente
    await assert.rejects(db.system((tx) => tx.query('INSERT INTO agents (server_id, client_id) VALUES ($1, $2)', [serverA, clientB])), { code: '23503' }); // FK composta
  });

  test('registro do agente com código de uso único e CA fixada', async () => {
    const code = await call(admin, 'POST', `/api/v1/servers/${serverA}/enrollment-codes`, { ttl_minutes: 10 });
    assert.equal(code.statusCode, 201, code.body);
    const { code: enrollCode, ca_sha256 } = code.json();
    assert.match(code.json().command, /central-agent enroll/);

    const s1 = new AgentState(path.join(tmp, 'agent1'));
    await assert.rejects(enroll({ url: gatewayUrl, caSha256: 'ab'.repeat(32), code: enrollCode, state: s1, log: silent }), /não confere/);
    const out = await enroll({ url: gatewayUrl, caSha256: ca_sha256, code: enrollCode, state: s1, log: silent });
    agentId = out.agentId;
    await assert.rejects(enroll({ url: gatewayUrl, caSha256: ca_sha256, code: enrollCode, state: new AgentState(path.join(tmp, 'agent2')), log: silent }),
      (err: unknown) => err instanceof HttpError && err.status === 403);

    agent = new Agent({ state: s1, log: silent });
    const hb = await agent.heartbeat();
    assert.equal(hb.has_tasks, false);
    const detail = await call(admin, 'GET', `/api/v1/servers/${serverA}`);
    assert.equal(detail.json().connection_status, 'online');
    assert.equal(detail.json().agent.public_id, agentId);
  });

  test('tarefa assinada: inventário real coletado e gravado', async () => {
    assert.equal((await call(restricted, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'shell.exec', params: { cmd: 'id' } })).statusCode, 422);
    assert.equal((await call(restricted, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'inventory.collect', params: { sections: ['sistema'], x: 1 } })).statusCode, 422);
    const t = await call(restricted, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'inventory.collect', params: { sections: ['sistema', 'rede'] } }, { 'idempotency-key': 'inv-0001-abcd' });
    assert.equal(t.statusCode, 201, t.body);
    const again = await call(restricted, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'inventory.collect', params: { sections: ['sistema', 'rede'] } }, { 'idempotency-key': 'inv-0001-abcd' });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().id, t.json().id);

    assert.equal((await agent.heartbeat()).has_tasks, true);
    await agent.drainTasks();
    await agent.flushResults();
    const done = await taskStatus(t.json().id);
    assert.equal(done.status, 'concluido', JSON.stringify(done));
    const inv = await call(restricted, 'GET', `/api/v1/servers/${serverA}/inventory`);
    assert.equal(inv.json().data.sistema.hostname, os.hostname());
  });

  test('offline e volta a online; tarefas esperam o agente', async () => {
    await owner.owner((c) => c.query("UPDATE agents SET last_heartbeat_at = now() - interval '10 minutes'"));
    await runMaintenanceOnce(db, cfg);
    assert.equal((await call(admin, 'GET', `/api/v1/servers/${serverA}`)).json().connection_status, 'offline');
    const t = await call(admin, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'agent.ping', params: {} });
    await runMaintenanceOnce(db, cfg);
    assert.equal((await taskStatus(t.json().id)).status, 'aguardando_agente');
    const hb = await agent.heartbeat();
    assert.equal(hb.has_tasks, true);
    assert.equal((await call(admin, 'GET', `/api/v1/servers/${serverA}`)).json().connection_status, 'online');
    await agent.drainTasks();
    await agent.flushResults();
    assert.equal((await taskStatus(t.json().id)).status, 'concluido');
  });

  test('lease vencido devolve a tarefa à fila e a nova tentativa conclui', async () => {
    const t = await call(admin, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'agent.ping', params: {} });
    const internal = await db.system((tx) => tx.one('SELECT agent_id FROM agent_task_queue WHERE public_id = $1', [t.json().id]));
    const claimed = await db.system((tx) => claimTasks(tx, internal!.agent_id, { limit: 1 })); // "agente" pegou e morreu
    assert.equal(claimed.length, 1);
    await owner.owner((c) => c.query("UPDATE agent_task_queue SET lease_until = now() - interval '1 second' WHERE public_id = $1", [t.json().id]));
    await runMaintenanceOnce(db, cfg);
    const back = await taskStatus(t.json().id);
    assert.equal(back.status, 'na_fila');
    assert.equal(back.attempt, 1);
    await owner.owner((c) => c.query('UPDATE agent_task_queue SET available_at = now() WHERE public_id = $1', [t.json().id]));
    await agent.drainTasks();
    await agent.flushResults();
    const done = await taskStatus(t.json().id);
    assert.equal(done.status, 'concluido');
    assert.equal(done.attempt, 2);
  });

  test('reinício da central não perde tarefas nem resultados guardados no agente', async () => {
    // a primeira (id menor) é entregue ao agente; a segunda fica na fila durante a queda
    const running = await call(admin, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'inventory.collect', params: { sections: ['sistema'] } });
    const queued = await call(admin, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'agent.ping', params: { note: 'antes-do-reinicio' } });
    const internals = agent as unknown as {
      client: { call: (m: string, p: string) => Promise<{ tasks: { payload: { task_id: string } }[] }> };
      handle: (raw: unknown) => Promise<void>;
      queue: { pending(): number; db: { exec(sql: string): void } };
    };
    const { tasks } = await internals.client.call('GET', '/agent/v1/tasks?limit=1&wait=0');
    assert.equal(tasks[0]?.payload.task_id, running.json().id);
    // o agente executa, mas a central cai antes de receber o resultado
    await stopCentral();
    await internals.handle(tasks[0]);
    assert.equal(internals.queue.pending(), 1);
    await assert.rejects(agent.flushResults());

    await startCentral();
    assert.equal((await taskStatus(queued.json().id)).status, 'na_fila');
    assert.equal((await taskStatus(running.json().id)).status, 'executando');
    internals.queue.db.exec('UPDATE outbox SET next_at = 0'); // dispensa o backoff local no teste
    await agent.flushResults();
    assert.equal(internals.queue.pending(), 0);
    assert.equal((await taskStatus(running.json().id)).status, 'concluido');
    assert.equal((await agent.heartbeat()).has_tasks, true);
    await agent.drainTasks();
    await agent.flushResults();
    assert.equal((await taskStatus(queued.json().id)).status, 'concluido');
  });

  test('revogação: credencial recusada e agente encerra', async () => {
    const r = await call(restricted, 'POST', `/api/v1/agents/${agentId}/revoke`, { reason: 'teste de revogação' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await call(admin, 'GET', `/api/v1/servers/${serverA}`)).json().connection_status, 'sem_agente');
    await assert.rejects(agent.heartbeat(), (err: unknown) => err instanceof HttpError && err.status === 403);
    assert.equal(await agent.run(), EXIT_REVOKED);
    assert.equal((await call(admin, 'POST', `/api/v1/agents/${agentId}/tasks`, { operation: 'agent.ping', params: {} })).statusCode, 409);
  });

  test('auditoria encadeada e imutável', async () => {
    const v = await call(admin, 'GET', '/api/v1/audit/verify');
    assert.equal(v.statusCode, 200);
    assert.equal(v.json().ok, true);
    assert.ok(v.json().checked > 10);
    const log = await call(admin, 'GET', '/api/v1/audit?action=agente.');
    assert.ok(log.json().items.some((i: { action: string }) => i.action === 'agente.revogar'));
    assert.ok(!JSON.stringify(log.json()).includes(PASSWORD));
    await assert.rejects(db.system((tx) => tx.query("UPDATE audit_logs SET action = 'x'")), { code: '42501' }); // privilégio revogado
    await assert.rejects(owner.owner((c) => c.query("UPDATE audit_logs SET action = 'x'")), /somente inclusão/);
    await assert.rejects(owner.owner((c) => c.query('DELETE FROM audit_logs')), /somente inclusão/);
  });
});
