// Fase 3 — backups REAIS de ponta a ponta: agente → restic → rest-server append-only → verificação
// pela central → retenção com retenção legal. PostgreSQL (pg_dump) e SQLite reais; corrupção real
// de um pack para provar que a verificação reprova.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import pg from 'pg';
import { Central, prepare, pump, startRestServer, hasTool, type Session } from './harness.ts';
import { ROOT } from '../../apps/api/src/config.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { backupDeps, runBackupCycleOnce } from '../../apps/api/src/worker.ts';
import { applyRetention } from '../../apps/api/src/backups/maintenance.ts';
import { repositoryAccess, type DestinationRow } from '../../apps/api/src/storage/destinations.ts';
import { restic } from '../../apps/api/src/storage/restic.ts';

const PG_BIN = process.platform === 'win32' ? 'D:\\Program Files\\PostgreSQL\\18\\bin' : '';
if (PG_BIN) process.env.PATH = `${PG_BIN};${process.env.PATH}`; // pg_dump (agente) e pg_restore (central)
const env = await prepare();
// o agente (no mesmo processo) usa o restic conferido de .tools/bin
process.env.RESTIC_BIN = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'restic.exe' : 'restic');
const SRC_DB = 'cb_fase3_origem';

describe('Fase 3 — backups', { skip: env.skip || (!hasTool('rest-server') && 'rest-server ausente') }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let rs: Awaited<ReturnType<typeof startRestServer>>;
  let deps: ReturnType<typeof backupDeps>;
  let destId = 0;
  let policyId = 0;
  let filesJob = 0;
  let dbJob = 0;
  const data = path.join(env.tmp, 'repos');
  const src = path.join(env.tmp, 'origem');
  const url = new URL(env.config?.databaseUrl ?? 'postgres://x@y/z');
  const pgPassword = decodeURIComponent(url.password);
  const cycle = (opts: Parameters<typeof runBackupCycleOnce>[3] = {}) => runBackupCycleOnce(c.db, c.config, deps, { retention: false, log: {}, ...opts });
  const run = async (jobId: number) => {
    const r = await c.call(admin, 'POST', `/api/v1/backup-jobs/${jobId}/run`);
    assert.equal(r.statusCode, 202, r.body);
    return r.json().run_id as string;
  };
  const getRun = async (id: string) => (await c.call(admin, 'GET', `/api/v1/backup-runs/${id}`)).json();
  const snapshotsOf = async (jobId: number) => (await c.call(admin, 'GET', `/api/v1/snapshots?job_id=${jobId}`)).json().items as any[];
  const maintenanceAccess = () => c.db.system(async (tx) => {
    const repo = await tx.one('SELECT * FROM backup_repositories WHERE server_id = $1', [A.serverId]);
    const dest = await tx.one('SELECT * FROM backup_destinations WHERE id = $1', [repo!.destination_id]) as DestinationRow;
    return repositoryAccess(tx, deps.store, dest, repo!);
  });

  before(async () => {
    await c.setup();
    deps = backupDeps(c.db, loadKeyring(c.config));
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    mkdirSync(data);
    rs = await startRestServer(data);
    // arquivos de origem: 3 na raiz + 1 em subpasta + 1 log excluído
    mkdirSync(path.join(src, 'sub'), { recursive: true });
    for (const [f, body] of [['a.txt', 'alfa'], ['b.txt', 'beta'.repeat(1000)], ['c.bin', Buffer.alloc(200_000, 7).toString('latin1')], ['sub/d.txt', 'delta'], ['app.log', 'ruído']]) {
      writeFileSync(path.join(src, f!), body!);
    }
    // banco PostgreSQL de origem com dados reais
    const admin_pg = new pg.Client({ connectionString: c.config.databaseUrl });
    await admin_pg.connect();
    await admin_pg.query(`DROP DATABASE IF EXISTS ${SRC_DB}`);
    await admin_pg.query(`CREATE DATABASE ${SRC_DB}`);
    await admin_pg.end();
    const u = new URL(c.config.databaseUrl); u.pathname = `/${SRC_DB}`;
    const srcPg = new pg.Client({ connectionString: u.toString() });
    await srcPg.connect();
    await srcPg.query('CREATE TABLE pedidos (id serial PRIMARY KEY, cliente text NOT NULL, valor numeric(12,2) NOT NULL)');
    await srcPg.query("INSERT INTO pedidos (cliente, valor) SELECT 'cliente ' || g, g * 1.5 FROM generate_series(1, 500) g");
    await srcPg.end();
  });

  after(async () => {
    A?.agent.close();
    await rs?.stop();
    await c.teardown();
    const p = new pg.Client({ connectionString: env.config?.databaseUrl });
    try { await p.connect(); await p.query(`DROP DATABASE IF EXISTS ${SRC_DB}`); } catch { /* sem banco */ } finally { await p.end().catch(() => {}); }
  });

  test('política: agenda e retenção validadas', async () => {
    for (const bad of [{ schedule: '*/5 * * * *' }, { schedule: '0 3 * *' }, { schedule: '0 3 * * *', timezone: 'Lua/Base' }, { retention: { keep_last: 0 } }]) {
      const r = await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'ruim', schedule: '0 3 * * *', retention: { keep_last: 3 }, ...bad });
      assert.equal(r.statusCode, 422, `${JSON.stringify(bad)} → ${r.body}`);
    }
    const p = await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'Diária 03h', schedule: '0 3 * * *', timezone: 'America/Sao_Paulo', retention: { keep_last: 7, keep_daily: 7 }, verify_subset_percent: 100 });
    assert.equal(p.statusCode, 201, p.body);
    policyId = p.json().id;
  });

  test('job exige destino testado; criar o job prepara o repositório do servidor', async () => {
    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco da central', config: { agent_url: rs.url, data_dir: data }, immutable: true });
    destId = d.json().id;
    const body = { server_id: A.serverId, policy_id: policyId, destination_id: destId, name: 'Arquivos da aplicação', kind: 'arquivos', paths: [src], excludes: ['*.log'] };
    assert.equal((await c.call(admin, 'POST', '/api/v1/backup-jobs', body)).statusCode, 409, 'destino ainda não testado');
    assert.equal((await c.call(admin, 'POST', `/api/v1/storage/${destId}/test`)).json().ok, true);
    assert.equal((await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...body, paths: ['relativo/x'] })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...body, kind: 'banco' })).statusCode, 422);
    const j = await c.call(admin, 'POST', '/api/v1/backup-jobs', body);
    assert.equal(j.statusCode, 201, j.body);
    filesJob = j.json().id;
    assert.ok(new Date(j.json().next_run_at) > new Date());
    assert.equal(new Date(j.json().next_run_at).getUTCHours(), 6, '03:00 em São Paulo = 06:00 UTC');
    // o rest-server relê o .htpasswd a cada 30 s; nos testes reinicia na mesma porta
    await rs.stop(); rs = await startRestServer(data, rs.port);
  });

  test('backup de arquivos real: concluído ≠ validado; a central verifica e valida', async () => {
    const id = await run(filesJob);
    assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${filesJob}/run`)).statusCode, 409, 'uma execução por vez');
    await pump(A.agent);
    let r = await getRun(id);
    assert.equal(r.status, 'concluido', JSON.stringify(r));
    assert.equal(r.summary.total_files_processed, 4, 'o .log foi excluído');
    let [snap] = await snapshotsOf(filesJob);
    assert.equal(snap.status, 'nao_verificado');
    assert.equal((await c.call(admin, 'GET', `/api/v1/backup-jobs/${filesJob}`)).json().last_success_at, null, 'sem verificação não há sucesso');

    const out = await cycle();
    assert.equal(out?.verified, 1);
    [snap] = await snapshotsOf(filesJob);
    assert.equal(snap.status, 'validado', JSON.stringify(snap));
    assert.deepEqual(snap.verify_details.arquivos, { no_snapshot: 4, informados_pelo_agente: 4 });
    r = await getRun(id);
    assert.equal(r.status, 'validado');
    assert.ok((await c.call(admin, 'GET', `/api/v1/backup-jobs/${filesJob}`)).json().last_success_at);

    // nenhum segredo do repositório na API, nos logs nem nas tarefas
    const acc = await maintenanceAccess();
    const accessPw = new URL(acc.agentRepo.slice(5)).password;
    const everything = JSON.stringify([r, await snapshotsOf(filesJob), (await c.call(admin, 'GET', '/api/v1/tasks?limit=200')).json(), (await c.call(admin, 'GET', '/api/v1/repositories')).json()]);
    for (const secret of [acc.password, accessPw, decodeURIComponent(accessPw)]) assert.ok(!everything.includes(secret), 'segredo vazou');
    const raw = await c.db.system((tx) => tx.many('SELECT params::text AS p, coalesce(result::text, \'\') AS r FROM agent_task_queue'));
    for (const row of raw) assert.ok(!row.p.includes(acc.password) && !row.r.includes(acc.password));
  });

  test('agenda: job vencido dispara uma vez só, a próxima vem da política', async () => {
    await c.db.system((tx) => tx.query("UPDATE backup_jobs SET next_run_at = now() - interval '1 minute' WHERE id = $1", [filesJob]));
    const now = new Date();
    const first = await cycle({ now, verify: false });
    assert.equal(first?.started, 1);
    assert.equal((await cycle({ now, verify: false }))?.started, 0, 'mesmo horário não dispara de novo');
    const runs = (await c.call(admin, 'GET', `/api/v1/backup-runs?job_id=${filesJob}`)).json().items;
    assert.equal(runs[0].trigger, 'agendado');
    const job = (await c.call(admin, 'GET', `/api/v1/backup-jobs/${filesJob}`)).json();
    assert.ok(new Date(job.next_run_at) > now);
    writeFileSync(path.join(src, 'novo.txt'), 'arquivo novo');
    await pump(A.agent);
    await cycle();
    assert.equal((await getRun(runs[0].id)).status, 'validado');
  });

  test('PostgreSQL real: pg_dump direto no restic, verificado com pg_restore na central', async () => {
    const d = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'postgresql', name: 'Pedidos', db_name: SRC_DB, host: url.hostname, port: Number(url.port || 5432), tech_user: decodeURIComponent(url.username) });
    assert.equal(d.statusCode, 201, d.body);
    assert.equal((await c.call(admin, 'PUT', `/api/v1/databases/${d.json().id}/credential`, { password: 'senha-errada-proposital' })).statusCode, 204);
    const j = await c.call(admin, 'POST', '/api/v1/backup-jobs', { server_id: A.serverId, policy_id: policyId, destination_id: destId, name: 'Banco de pedidos', kind: 'banco', database_id: d.json().id });
    assert.equal(j.statusCode, 201, j.body);
    dbJob = j.json().id;

    // senha errada: o dump falha e NENHUM snapshot é criado (sem backup "ok" pela metade)
    const bad = await run(dbJob);
    await pump(A.agent);
    await c.db.system((tx) => tx.query("UPDATE agent_task_queue SET available_at = now() WHERE status = 'na_fila'"));
    await pump(A.agent);
    await cycle();
    const badRun = await getRun(bad);
    assert.equal(badRun.status, 'falhou', JSON.stringify(badRun));
    assert.ok(!JSON.stringify(badRun).includes(pgPassword));
    assert.equal((await snapshotsOf(dbJob)).length, 0);

    assert.equal((await c.call(admin, 'PUT', `/api/v1/databases/${d.json().id}/credential`, { password: pgPassword })).statusCode, 204);
    const ok = await run(dbJob);
    await pump(A.agent);
    assert.equal((await getRun(ok)).status, 'concluido', JSON.stringify(await getRun(ok)));
    await cycle();
    const [snap] = await snapshotsOf(dbJob);
    assert.equal(snap.status, 'validado', JSON.stringify(snap));
    assert.equal(snap.stdin_filename, `postgresql-${SRC_DB}.dump`);
    assert.ok(snap.verify_details.dump.objetos >= 3, JSON.stringify(snap.verify_details));
    assert.ok(!JSON.stringify(await getRun(ok)).includes(pgPassword), 'senha do banco não aparece');
  });

  test('SQLite real: cópia consistente e integrity_check na central', async () => {
    const file = path.join(env.tmp, 'loja.sqlite');
    const s = new DatabaseSync(file);
    s.exec('CREATE TABLE itens (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO itens (nome) VALUES (\'caneta\'), (\'caderno\');');
    s.close();
    const d = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'Loja', file_path: file });
    const j = await c.call(admin, 'POST', '/api/v1/backup-jobs', { server_id: A.serverId, policy_id: policyId, destination_id: destId, name: 'Banco da loja', kind: 'banco', database_id: d.json().id });
    assert.equal(j.statusCode, 201, j.body);
    await run(j.json().id);
    await pump(A.agent);
    await cycle();
    const [snap] = await snapshotsOf(j.json().id);
    assert.equal(snap.status, 'validado', JSON.stringify(snap));
    assert.equal(snap.verify_details.dump.resultado, 'ok');
  });

  test('retenção: mantém a política, respeita retenção legal e remove de verdade do repositório', async () => {
    // terceiro backup de arquivos
    writeFileSync(path.join(src, 'mais.txt'), 'mais um');
    await run(filesJob);
    await pump(A.agent);
    await cycle();
    const before = (await snapshotsOf(filesJob)).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    assert.equal(before.length, 3);
    assert.ok(before.every((s) => s.status === 'validado'));
    const [oldest, middle, newest] = before;

    // operador sem a permissão de retenção legal
    await c.createUser('operador@exemplo.com.br', ['backup_operator']);
    const op = await c.login('operador@exemplo.com.br');
    assert.equal((await c.call(op, 'POST', `/api/v1/snapshots/${oldest.id}/legal-hold`, { hold: true, reason: 'processo 123' })).statusCode, 403);
    assert.equal((await c.call(admin, 'POST', `/api/v1/snapshots/${oldest.id}/legal-hold`, { hold: true, reason: 'processo judicial 123' })).statusCode, 200);

    await c.call(admin, 'PATCH', `/api/v1/backup-policies/${policyId}`, { retention: { keep_last: 1 } });
    const repoId = before[0].repository_id;
    const out = await applyRetention(c.db, deps.store, c.config.tools.restic, repoId);
    assert.deepEqual(out?.removed, [middle.id], 'só o do meio sai: o mais antigo está retido, o mais novo é o último');
    assert.equal(out?.pruned, true);
    const after = await snapshotsOf(filesJob);
    assert.equal(after.find((s) => s.id === middle.id).status, 'removido');
    assert.equal(after.find((s) => s.id === oldest.id).status, 'validado');
    assert.equal(after.find((s) => s.id === newest.id).status, 'validado');
    // os jobs de banco (1 validado cada) ficam intactos
    assert.equal((await snapshotsOf(dbJob)).filter((s) => s.status === 'validado').length, 1);

    const acc = await maintenanceAccess();
    const list = JSON.parse((await restic(c.config.tools.restic, ['snapshots', '--json'], { repo: acc.maintenanceRepo, password: acc.password })).stdout) as { id: string }[];
    assert.ok(!list.some((s) => s.id === middle.restic_id), 'removido no repositório');
    assert.ok(list.some((s) => s.id === oldest.restic_id) && list.some((s) => s.id === newest.restic_id));
    assert.equal((await c.call(admin, 'POST', `/api/v1/snapshots/${middle.id}/legal-hold`, { hold: true, reason: 'tarde demais' })).statusCode, 409);
    const repos = (await c.call(admin, 'GET', '/api/v1/repositories')).json().items;
    assert.ok(Number(repos[0].size_bytes) > 0, 'uso de armazenamento medido');
    const auditRows = await c.db.system((tx) => tx.many("SELECT action FROM audit_logs WHERE action IN ('retencao.aplicar', 'snapshot.reter')"));
    assert.equal(auditRows.length, 2);
  });

  test('isolamento: usuário de outro cliente não vê nem executa jobs, execuções ou snapshots', async () => {
    const other = await c.call(admin, 'POST', '/api/v1/clients', { legal_name: 'Gama Ltda' });
    await c.createUser('gama@exemplo.com.br', ['backup_operator'], [other.json().id]);
    const g = await c.login('gama@exemplo.com.br');
    assert.deepEqual((await c.call(g, 'GET', '/api/v1/backup-jobs')).json().items, []);
    assert.deepEqual((await c.call(g, 'GET', '/api/v1/snapshots')).json().items, []);
    assert.deepEqual((await c.call(g, 'GET', '/api/v1/backup-runs')).json().items, []);
    assert.equal((await c.call(g, 'GET', `/api/v1/backup-jobs/${filesJob}`)).statusCode, 404);
    assert.equal((await c.call(g, 'POST', `/api/v1/backup-jobs/${filesJob}/run`)).statusCode, 404);
    assert.equal((await c.call(g, 'POST', '/api/v1/backup-policies', { name: 'Da empresa', schedule: '0 3 * * *', retention: { keep_last: 1 } })).statusCode, 403);
  });

  test('corrupção real de um pack: a verificação reprova', async () => {
    const [snap] = (await snapshotsOf(filesJob)).filter((s) => s.status === 'validado');
    // corrompe o maior pack do repositório (bytes no meio do arquivo)
    const packs: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else packs.push(p); } };
    walk(path.join(data, `c${A.clientId}-s${A.serverId}`, 'restic', 'data'));
    const target = packs.sort((a, b) => statSync(b).size - statSync(a).size)[0]!;
    const fd = openSync(target, 'r+');
    writeSync(fd, Buffer.alloc(64, 0xff), 0, 64, Math.floor(statSync(target).size / 2));
    closeSync(fd);
    assert.equal((await c.call(admin, 'POST', `/api/v1/snapshots/${snap.id}/verify`)).statusCode, 202);
    await cycle();
    const after = (await snapshotsOf(filesJob)).find((s) => s.id === snap.id);
    assert.equal(after.status, 'falha_verificacao', JSON.stringify(after));
    assert.match(after.verify_error, /check/i);
  });
});
