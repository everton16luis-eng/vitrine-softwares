// Fase 7 — recuperação de desastre: plano a partir de dados reais (inventário coletado pelo agente,
// job com snapshot validado, restauração medida), pendências de cobertura, cloud-init que de fato
// registra um agente novo, playbook Ansible, exercícios com tempos medidos e isolamento.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { Central, prepare, pump, startRestServer, hasTool, silent, type Session } from './harness.ts';
import { ROOT } from '../../apps/api/src/config.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { backupDeps, runBackupCycleOnce } from '../../apps/api/src/worker.ts';
import { enroll } from '../../apps/agent/src/agent.ts';
import { AgentState } from '../../apps/agent/src/state.ts';

const env = await prepare();
process.env.RESTIC_BIN = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'restic.exe' : 'restic');
const TARGET = { os_name: 'Ubuntu', os_version: '24.04', arch: 'x86_64', disk_bytes: 4 * 1024 ** 4, provision_minutes: 8, dns_ttl_minutes: 5 };

describe('Fase 7 — recuperação de desastre', { skip: env.skip || (!hasTool('rest-server') && 'rest-server ausente') }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session; let infra: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let rs: Awaited<ReturnType<typeof startRestServer>>;
  let deps: ReturnType<typeof backupDeps>;
  let appId = 0; let jobId = 0; let planId = 0; let snapId = 0; let restoreId = '';
  let betaClient = 0;
  const data = path.join(env.tmp, 'repos');
  const src = path.join(env.tmp, 'site');
  const cycle = () => runBackupCycleOnce(c.db, c.config, deps, { retention: false, log: {} });

  before(async () => {
    await c.setup();
    deps = backupDeps(c.db, loadKeyring(c.config));
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    betaClient = (await c.call(admin, 'POST', '/api/v1/clients', { legal_name: 'Beta Ltda' })).json().id;
    mkdirSync(data); mkdirSync(src);
    for (let i = 0; i < 20; i++) writeFileSync(path.join(src, `pagina-${i}.html`), `<p>${i}</p>`.repeat(200));
    rs = await startRestServer(data);

    // inventário real (em Windows "pacotes" e "servicos" voltam indisponíveis — o plano precisa dizer isso)
    const inv = await c.call(admin, 'POST', `/api/v1/agents/${A.agentId}/tasks`, { operation: 'inventory.collect', params: { sections: ['sistema', 'hardware', 'pacotes', 'servicos'] } });
    assert.equal(inv.statusCode, 201, inv.body);
    await pump(A.agent);

    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco', config: { agent_url: rs.url, data_dir: data }, immutable: true });
    assert.equal((await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`)).json().ok, true);
    const p = await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'Diária', schedule: '0 3 * * *', retention: { keep_last: 10 }, verify_subset_percent: 100 });
    const app = await c.call(admin, 'POST', '/api/v1/applications', { server_id: A.serverId, name: 'Site', data_dirs: [src], config_files: [path.join(env.tmp, 'site.conf')], domains: ['site.exemplo.com.br'], rto_minutes: 600 });
    assert.equal(app.statusCode, 201, app.body);
    appId = app.json().id;
    const j = await c.call(admin, 'POST', '/api/v1/backup-jobs', { server_id: A.serverId, policy_id: p.json().id, destination_id: d.json().id, name: 'Site', kind: 'arquivos', paths: [src] });
    assert.equal(j.statusCode, 201, j.body);
    jobId = j.json().id;
    await rs.stop(); rs = await startRestServer(data, rs.port);
    assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${jobId}/run`)).statusCode, 202);
    await pump(A.agent); await pump(A.agent);
    await cycle(); await cycle();
    snapId = (await c.call(admin, 'GET', `/api/v1/snapshots?job_id=${jobId}&status=validado`)).json().items[0].id;

    // restauração real, para o plano usar a vazão medida e o exercício citar
    const r = await c.call(admin, 'POST', '/api/v1/restores', { snapshot_id: snapId, mode: 'temporario', reason: 'exercício de DR' });
    assert.equal(r.statusCode, 201, r.body);
    restoreId = r.json().id;
    await pump(A.agent); await cycle();
    assert.equal((await c.call(admin, 'GET', `/api/v1/restores/${restoreId}`)).json().status, 'concluido');

    await c.createUser('infra@exemplo.com.br', ['infra_engineer']);
    infra = await c.login('infra@exemplo.com.br');
  });

  after(async () => {
    A?.agent.close();
    await rs?.stop();
    await c.teardown();
  });

  test('plano real: pendência de cobertura, RPO atual, ponto de restauração e avisos honestos do inventário', async () => {
    const r = await c.call(infra, 'POST', '/api/v1/dr-plans', { server_id: A.serverId, name: 'Perda total do srv-alfa', target: TARGET });
    assert.equal(r.statusCode, 201, r.body);
    planId = r.json().id;
    const plan = r.json().plan;
    assert.equal(r.json().ready, false);
    const miss = plan.findings.find((f: { code: string }) => f.code === 'caminho_sem_backup');
    assert.ok(miss && miss.message.includes('site.conf'), JSON.stringify(plan.findings));
    assert.ok(!plan.findings.some((f: { message: string; code: string }) => f.code === 'caminho_sem_backup' && f.message.includes('pagina')), 'o diretório do site está coberto');
    if (process.platform !== 'linux') {
      assert.ok(plan.findings.some((f: { code: string }) => f.code === 'inventario_pacotes'));
      assert.ok(plan.findings.some((f: { code: string }) => f.code === 'distro_diferente'), 'Windows → Ubuntu é incompatível');
    }
    assert.equal(plan.restore_points.length, 1);
    assert.equal(plan.restore_points[0].snapshot_id, snapId);
    assert.ok(plan.rpo.atual_min >= 0 && plan.rpo.atual_min < 30);
    assert.equal(plan.rpo.projetado_min, 1440);
    assert.equal(plan.steps[0].minutes, 8);
    assert.deepEqual(plan.domains, ['site.exemplo.com.br']);
    assert.ok(plan.source.inventory_at, 'usa o inventário coletado');

    // o operador de backup não planeja DR; o auditor só consulta
    await c.createUser('auditor@exemplo.com.br', ['auditor']);
    const aud = await c.login('auditor@exemplo.com.br');
    assert.equal((await c.call(aud, 'POST', '/api/v1/dr-plans', { server_id: A.serverId, name: 'x1', target: TARGET })).statusCode, 403);
    assert.equal((await c.call(aud, 'GET', `/api/v1/dr-plans/${planId}`)).statusCode, 200);
    assert.equal((await c.call(aud, 'POST', `/api/v1/dr-plans/${planId}/exercises`, {})).statusCode, 403);
  });

  test('cloud-init: exige origem do agente e plano sem pendências; o código gerado registra um agente novo uma única vez', async () => {
    const r0 = await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/cloud-init`, { hostname: 'srv-alfa-dr' });
    assert.equal(r0.statusCode, 422, r0.body);
    assert.match(r0.body, /AGENT_SOURCE_REPO/);
    c.config.agentSource = { repo: 'https://github.com/exemplo/vitrine-softwares.git', ref: 'v1.0.0' };
    try {
      assert.equal((await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/cloud-init`, { hostname: 'srv-alfa-dr' })).statusCode, 409);
      // resolve a pendência (o arquivo de configuração passa a ficar dentro do diretório coberto) e o destino Linux
      // fica compatível quando a origem for Linux; em Windows a distro difere, então o alvo imita a origem
      assert.equal((await c.call(admin, 'PATCH', `/api/v1/applications/${appId}`, { config_files: [] })).statusCode, 200);
      const src0 = (await c.call(admin, 'GET', `/api/v1/servers/${A.serverId}`)).json();
      const target = process.platform === 'linux' ? TARGET : { ...TARGET, os_name: src0.os_name, os_version: src0.os_version, arch: src0.arch };
      const re = await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/regenerate`, { target });
      assert.equal(re.statusCode, 200, re.body);
      assert.equal(re.json().revision, 2);
      assert.equal(re.json().ready, true, JSON.stringify(re.json().plan.findings));

      const r = await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/cloud-init`, { hostname: 'srv-alfa-dr' });
      if (!/^(x64|x86_64|amd64|arm64|aarch64)$/.test(target.arch)) { assert.equal(r.statusCode, 500); return; }
      assert.equal(r.statusCode, 201, r.body);
      assert.match(String(r.headers['content-type']), /cloud-config/);
      const doc = parse(r.body);
      assert.equal(doc.hostname, 'srv-alfa-dr');
      const script: string = doc.write_files[0].content;
      assert.match(script, /git -C \/opt\/central-src checkout --quiet v1\.0\.0/);
      const m = /--ca-sha256 ([0-9a-f]{64}) --code (\S+)/.exec(script);
      assert.ok(m, script);
      const targetId = Number(r.headers['x-dr-target-server']);
      assert.ok(targetId > 0 && targetId !== A.serverId);

      // o código do cloud-init funciona de verdade: um agente novo se registra no servidor de destino
      const state = new AgentState(path.join(env.tmp, 'agent-dr'));
      const { agentId } = await enroll({ url: c.gatewayUrl, caSha256: m[1]!, code: m[2]!, state, log: silent });
      assert.ok(agentId);
      const agents = (await c.call(admin, 'GET', `/api/v1/agents?client_id=${A.clientId}`)).json().items;
      assert.ok(agents.some((a: { server_id: number }) => Number(a.server_id) === targetId));
      // uso único
      await assert.rejects(enroll({ url: c.gatewayUrl, caSha256: m[1]!, code: m[2]!, state: new AgentState(path.join(env.tmp, 'agent-dr2')), log: silent }));
      // segunda geração reaproveita o mesmo servidor de destino
      const r2 = await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/cloud-init`, { hostname: 'srv-alfa-dr' });
      assert.equal(Number(r2.headers['x-dr-target-server']), targetId);
      assert.equal((await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/cloud-init`, { hostname: 'Nome Inválido;' })).statusCode, 422);
    } finally { c.config.agentSource = null; }
  });

  test('Ansible: YAML válido, sem segredos, com diretórios da aplicação', async () => {
    const r = await c.call(infra, 'GET', `/api/v1/dr-plans/${planId}/ansible`);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['content-disposition']), /dr-srv-alfa\.yml/);
    const [play] = parse(r.body);
    assert.equal(play.hosts, 'dr_destino');
    const dirs = play.tasks.find((t: { name: string }) => t.name === 'Diretórios das aplicações');
    assert.deepEqual(dirs.loop, [src]);
    assert.doesNotMatch(r.body, /senha|password|BEGIN|secret/i);
  });

  test('exercício: RTO medido pela duração real e RPO medido pelo ponto restaurado; validações', async () => {
    const started = new Date(Date.now() - 45 * 60_000);
    const finished = new Date(Date.now() - 5 * 60_000);
    const ok = await c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/exercises`, { kind: 'simulado', outcome: 'sucesso', started_at: started.toISOString(), finished_at: finished.toISOString(), restore_ids: [restoreId], notes: 'Restauração temporária conferida.' });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(ok.json().measured_rto_minutes, 40);
    assert.equal(typeof ok.json().measured_rpo_minutes, 'number');
    assert.ok(ok.json().estimated_rto_minutes > 0);
    const bad = (body: Record<string, unknown>) => c.call(infra, 'POST', `/api/v1/dr-plans/${planId}/exercises`, { kind: 'simulado', outcome: 'sucesso', started_at: started.toISOString(), finished_at: finished.toISOString(), notes: 'teste inválido', ...body });
    assert.equal((await bad({ finished_at: new Date(started.getTime() - 1000).toISOString() })).statusCode, 422);
    assert.equal((await bad({ finished_at: new Date(Date.now() + 3600_000).toISOString() })).statusCode, 422);
    assert.equal((await bad({ restore_ids: ['00000000-0000-4000-8000-000000000000'] })).statusCode, 422);
    const detail = (await c.call(infra, 'GET', `/api/v1/dr-plans/${planId}`)).json();
    assert.equal(detail.exercises.length, 1);
    assert.equal(detail.exercises[0].plan_revision, 2);
    const list = (await c.call(infra, 'GET', `/api/v1/dr-plans?server_id=${A.serverId}`)).json().items;
    assert.ok(list[0].last_exercise_at);
    const audits = await c.db.system((tx) => tx.many("SELECT action FROM audit_logs WHERE action LIKE 'dr.%' ORDER BY id"));
    for (const a of ['dr.plano_criar', 'dr.plano_regenerar', 'dr.ansible_baixar', 'dr.exercicio_registrar']) assert.ok(audits.some((x) => x.action === a), a);
  });

  test('isolamento: quem só vê o cliente Beta não enxerga nem usa o plano do Alfa', async () => {
    await c.createUser('infra-beta@exemplo.com.br', ['infra_engineer'], [betaClient]);
    const beta = await c.login('infra-beta@exemplo.com.br');
    assert.equal((await c.call(beta, 'GET', '/api/v1/dr-plans')).json().items.length, 0);
    assert.equal((await c.call(beta, 'GET', `/api/v1/dr-plans/${planId}`)).statusCode, 404);
    assert.equal((await c.call(beta, 'GET', `/api/v1/dr-plans/${planId}/ansible`)).statusCode, 404);
    assert.equal((await c.call(beta, 'POST', '/api/v1/dr-plans', { server_id: A.serverId, name: 'invasão', target: TARGET })).statusCode, 404);
    assert.equal((await c.call(beta, 'POST', `/api/v1/dr-plans/${planId}/exercises`, { kind: 'real', outcome: 'sucesso', started_at: new Date(Date.now() - 60_000).toISOString(), finished_at: new Date().toISOString(), notes: 'não deveria' })).statusCode, 404);
  });
});
