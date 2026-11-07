// Fase 5 — monitoramento: métricas reais do agente no heartbeat, limite de uma amostra por minuto,
// agregação horária, visão geral com problemas detectados, séries por servidor, exportação Prometheus
// protegida por token e isolamento entre clientes.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validate, AgentMetrics } from '@central/contracts';
import { Central, prepare, type Session } from './harness.ts';
import { MetricsSampler } from '../../apps/agent/src/metrics.ts';
import { rollupMetrics } from '../../apps/api/src/monitoring/metrics.ts';

const env = await prepare();
const TOKEN = 'token-prometheus-de-teste-com-mais-de-32-caracteres';

test('amostrador do agente: formato válido e números coerentes', async () => {
  const s = new MetricsSampler();
  await new Promise((r) => setTimeout(r, 300));
  const m = await s.sample();
  const v = validate(AgentMetrics, m);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  assert.ok(m.mem_total > 0 && m.mem_available <= m.mem_total);
  assert.ok(m.disks.length >= 1 && m.disks.every((d) => d.total > 0 && d.used <= d.total));
  assert.ok(m.cpu_pct === null || (m.cpu_pct >= 0 && m.cpu_pct <= 100));
});

describe('Fase 5 — monitoramento', { skip: env.skip }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let B: Awaited<ReturnType<Central['clientWithAgent']>>;

  before(async () => {
    c.config.metricsToken = TOKEN;
    await c.setup();
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa "Matriz"');
    B = await c.clientWithAgent(admin, 'Beta');
  });
  after(async () => { A?.agent.close(); B?.agent.close(); await c.teardown(); });

  test('heartbeat leva métricas reais; no máximo uma amostra gravada por minuto', async () => {
    await A.agent.heartbeat();
    await A.agent.heartbeat();
    const rows = await c.db.system((tx) => tx.many('SELECT * FROM server_metrics WHERE server_id = $1', [A.serverId]));
    assert.equal(rows.length, 1, 'clientWithAgent já mandou um heartbeat; os seguintes dentro de 1 min só atualizam a última leitura');
    const s = await c.db.system((tx) => tx.one('SELECT last_metrics, last_metrics_at FROM servers WHERE id = $1', [A.serverId]));
    assert.ok(s!.last_metrics.mem_used_pct > 0);
    assert.ok(s!.last_metrics.disk_max_pct > 0);
    assert.ok(new Date(s!.last_metrics_at) > new Date(rows[0].at), 'última leitura mais nova que a amostra gravada');
  });

  test('agregação horária e séries por servidor', async () => {
    await c.db.system(async (tx) => {
      for (let i = 0; i < 6; i++) {
        await tx.query(`INSERT INTO server_metrics (server_id, client_id, at, cpu_pct, load1, mem_used_pct, disk_max_pct, data)
          VALUES ($1, $2, date_trunc('hour', now()) - interval '2 hours' + make_interval(mins => $3), $4, 0.5, 40, 70, '{}')`, [A.serverId, A.clientId, i * 10, 10 + i * 10]);
      }
    });
    assert.ok((await rollupMetrics(c.db))!.hours >= 1);
    assert.ok((await rollupMetrics(c.db))!.hours >= 1, 'idempotente');
    const h = await c.call(admin, 'GET', `/api/v1/servers/${A.serverId}/metrics?resolution=hora&from=${new Date(Date.now() - 6 * 3600_000).toISOString()}`);
    assert.equal(h.statusCode, 200, h.body);
    const hour = h.json().points.find((p: { cpu_max: number }) => p.cpu_max === 60);
    assert.ok(hour, JSON.stringify(h.json().points));
    assert.equal(Math.round(hour.cpu_pct), 35, 'média de 10..60');
    const raw = await c.call(admin, 'GET', `/api/v1/servers/${A.serverId}/metrics`);
    assert.equal(raw.json().resolution, 'bruta');
    assert.ok(raw.json().points.length >= 6);
    assert.equal((await c.call(admin, 'GET', `/api/v1/servers/${A.serverId}/metrics?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z`)).statusCode, 422);
  });

  test('visão geral aponta disco cheio e agente sem contato', async () => {
    let o = (await c.call(admin, 'GET', '/api/v1/monitoring/overview')).json().items;
    assert.equal(o.find((s: { id: number }) => s.id === B.serverId).health, 'ok');
    await c.db.system((tx) => tx.query(`UPDATE servers SET last_metrics = jsonb_set(last_metrics, '{disk_max_pct}', '96') WHERE id = $1`, [A.serverId]));
    await c.db.system((tx) => tx.query(`UPDATE servers SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, [B.serverId]));
    o = (await c.call(admin, 'GET', '/api/v1/monitoring/overview')).json().items;
    const a = o.find((s: { id: number }) => s.id === A.serverId);
    assert.equal(a.health, 'atencao');
    assert.ok(a.problems.includes('disco 96%'));
    const b = o.find((s: { id: number }) => s.id === B.serverId);
    assert.equal(b.health, 'critico');
    assert.ok(b.problems.includes('agente sem contato'));
  });

  test('Prometheus: exige token; formato texto com rótulos escapados', async () => {
    assert.equal((await c.call(null, 'GET', '/api/v1/metrics')).statusCode, 401);
    assert.equal((await c.call(null, 'GET', '/api/v1/metrics', undefined, { authorization: 'Bearer errado' })).statusCode, 401);
    const r = await c.call(null, 'GET', '/api/v1/metrics', undefined, { authorization: `Bearer ${TOKEN}` });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'] as string, /text\/plain; version=0\.0\.4/);
    assert.match(r.body, /# TYPE central_server_up gauge/);
    assert.ok(r.body.includes(`central_server_up{client="Alfa \\"Matriz\\" Ltda",server="srv-alfa \\"matriz\\"",server_id="${A.serverId}"} 1`), r.body.split('\n').filter((l) => l.startsWith('central_server_up')).join('\n'));
    assert.match(r.body, /central_server_disk_used_ratio\{[^}]*mount="[^"]+"\} 0\.\d+/);
    for (const line of r.body.trim().split('\n')) assert.match(line, /^(# (HELP|TYPE) \w+ .+|\w+\{.*\} -?[\d.e+-]+)$/, line);
  });

  test('desligado sem token configurado', async () => {
    c.config.metricsToken = null;
    await c.stop(); await c.start();
    assert.equal((await c.call(null, 'GET', '/api/v1/metrics', undefined, { authorization: `Bearer ${TOKEN}` })).statusCode, 404);
  });

  test('isolamento: outro cliente não vê servidores nem métricas do Alfa', async () => {
    await c.createUser('beta@exemplo.com.br', ['infra_engineer'], [B.clientId]);
    const b = await c.login('beta@exemplo.com.br');
    const o = (await c.call(b, 'GET', '/api/v1/monitoring/overview')).json().items;
    assert.deepEqual(o.map((s: { id: number }) => s.id), [B.serverId]);
    assert.equal((await c.call(b, 'GET', `/api/v1/servers/${A.serverId}/metrics`)).statusCode, 404);
  });
});
