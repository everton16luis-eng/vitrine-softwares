// Fase 8 — continuidade: testes periódicos de restauração (arquivos, PostgreSQL e SQLite, conferidos
// e descartados de verdade), falha de teste virando alerta, pipeline do pgBackRest, backup da própria
// central restaurado num banco novo, e rotação de DEK e de KEK sem perder nenhum segredo.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import pg from 'pg';
import { Keyring } from '@central/security';
import { Central, prepare, pump, startRestServer, hasTool, type Session } from './harness.ts';
import { ROOT } from '../../apps/api/src/config.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { backupDeps, runBackupCycleOnce } from '../../apps/api/src/worker.ts';
import { scheduleDrills } from '../../apps/api/src/restores/service.ts';
import { schedulePgbackrest } from '../../apps/api/src/pgbackrest/service.ts';
import { evaluateAlerts } from '../../apps/api/src/alerts/evaluate.ts';
import { prometheusText } from '../../apps/api/src/monitoring/metrics.ts';
import { runSelfBackup, selfBackupPassword, DUMP_NAME } from '../../apps/api/src/system/selfbackup.ts';
import { resticDump, pipeTo } from '../../apps/api/src/backups/verify.ts';
import { upsertHtpasswd } from '../../apps/api/src/storage/destinations.ts';
import { kekUsage, rotateKek, retireOldKeks, rotateClientKey } from '../../apps/api/src/system/rotation.ts';
import { SecretStore } from '../../apps/api/src/secrets.ts';
import { registerOperation } from '../../apps/agent/src/runner.ts';
import { pgbackrestBackup, pgbackrestInfo, type Exec } from '../../apps/agent/src/operations/pgbackrest.ts';

const PG_BIN = process.platform === 'win32' ? 'D:\\Program Files\\PostgreSQL\\18\\bin' : '';
if (PG_BIN) process.env.PATH = `${PG_BIN};${process.env.PATH}`;
const env = await prepare();
process.env.RESTIC_BIN = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'restic.exe' : 'restic');
const SRC_DB = 'cb_fase8_origem';
const RESTORED_CENTRAL = 'cb_fase8_central_restaurada';
const DAY = 86400_000;

/** `pgbackrest info` no formato documentado, com o último backup terminando agora. */
const info = (type: string, label: string, error = false) => [{
  archive: [{ id: '16-1', min: '000000010000000000000001', max: '00000001000000000000000A' }],
  backup: [{ label, type, error, info: { size: 31000000, repository: { size: 4100000 } }, timestamp: { start: Math.floor(Date.now() / 1000) - 30, stop: Math.floor(Date.now() / 1000) + 5 } }],
  db: [{ id: 1, version: '16' }], name: 'main', status: { code: 0, message: 'ok' }
}];

describe('Fase 8 — continuidade', { skip: env.skip || (!hasTool('rest-server') && 'rest-server ausente') }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let rs: Awaited<ReturnType<typeof startRestServer>>;
  let deps: ReturnType<typeof backupDeps>;
  let policyId = 0;
  const jobs = { files: 0, pg: 0, sqlite: 0 };
  let pgDbId = 0;
  let betaClient = 0;
  const data = path.join(env.tmp, 'repos');
  const src = path.join(env.tmp, 'origem');
  const sqliteFile = path.join(env.tmp, 'loja.sqlite');
  const url = new URL(env.config?.databaseUrl ?? 'postgres://x@y/z');
  const dbUrl = (name: string) => { const u = new URL(env.config!.databaseUrl); u.pathname = `/${name}`; return u.toString(); };
  const sql = async (name: string, q: string, p: unknown[] = []) => { const cl = new pg.Client({ connectionString: dbUrl(name) }); await cl.connect(); try { return (await cl.query(q, p)).rows; } finally { await cl.end(); } };
  const cycle = () => runBackupCycleOnce(c.db, c.config, deps, { retention: false, drills: false, log: {} });
  const drills = (now = new Date()) => scheduleDrills(c.db, deps, { now, limit: 10 });
  const drillRows = () => c.db.system((tx) => tx.many('SELECT r.*, j.name AS job FROM restore_requests r JOIN backup_jobs j ON j.id = r.job_id WHERE r.drill ORDER BY r.id'));

  before(async () => {
    await c.setup();
    deps = backupDeps(c.db, loadKeyring(c.config));
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    betaClient = (await c.call(admin, 'POST', '/api/v1/clients', { legal_name: 'Beta Ltda' })).json().id;
    mkdirSync(data); mkdirSync(src);
    for (const [f, body] of [['a.txt', 'alfa'], ['b.txt', 'beta'.repeat(300)], ['c.txt', 'gama']]) writeFileSync(path.join(src, f!), body!);
    rs = await startRestServer(data);
    const root = new pg.Client({ connectionString: env.config!.databaseUrl });
    await root.connect();
    for (const d of [SRC_DB, RESTORED_CENTRAL]) await root.query(`DROP DATABASE IF EXISTS ${d}`);
    await root.query(`CREATE DATABASE ${SRC_DB}`);
    await root.end();
    await sql(SRC_DB, "CREATE TABLE pedidos (id serial PRIMARY KEY, cliente text); INSERT INTO pedidos (cliente) SELECT 'c' || g FROM generate_series(1, 200) g");
    const s = new DatabaseSync(sqliteFile);
    s.exec("CREATE TABLE itens (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO itens (nome) VALUES ('caneta');");
    s.close();

    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco', config: { agent_url: rs.url, data_dir: data }, immutable: true });
    assert.equal((await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`)).json().ok, true);
    policyId = (await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'Diária', schedule: '0 3 * * *', retention: { keep_last: 10 }, verify_subset_percent: 100 })).json().id;
    const base = { server_id: A.serverId, policy_id: policyId, destination_id: d.json().id };
    jobs.files = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Arquivos', kind: 'arquivos', paths: [src] })).json().id;
    pgDbId = (await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'postgresql', name: 'Pedidos', db_name: SRC_DB, host: url.hostname, port: Number(url.port || 5432), tech_user: decodeURIComponent(url.username) })).json().id;
    await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: decodeURIComponent(url.password) });
    jobs.pg = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Banco', kind: 'banco', database_id: pgDbId })).json().id;
    const sq = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'Loja', file_path: sqliteFile });
    jobs.sqlite = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Loja', kind: 'banco', database_id: sq.json().id })).json().id;
    await rs.stop(); rs = await startRestServer(data, rs.port);
    for (const j of Object.values(jobs)) assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${j}/run`)).statusCode, 202);
    for (let i = 0; i < 3; i++) await pump(A.agent);
    await cycle(); await cycle();
    const valid = await c.db.system((tx) => tx.one("SELECT count(*)::int AS n FROM backup_snapshots WHERE status = 'validado'"));
    assert.equal(valid!.n, 3);
  });

  after(async () => {
    A?.agent.close();
    await rs?.stop();
    await c.teardown();
    const p = new pg.Client({ connectionString: env.config?.databaseUrl });
    try { await p.connect(); for (const db of [SRC_DB, RESTORED_CENTRAL]) await p.query(`DROP DATABASE IF EXISTS ${db}`); } catch { /* sem banco */ } finally { await p.end().catch(() => {}); }
  });

  test('testes de restauração: só com a política ligada; restaura, confere e descarta de verdade', async () => {
    assert.equal(await drills(), 0, 'desligado por padrão');
    assert.equal((await c.call(admin, 'PATCH', `/api/v1/backup-policies/${policyId}`, { restore_test_days: 7 })).json().restore_test_days, 7);
    assert.equal(await drills(), 3);
    assert.equal(await drills(), 0, 'não duplica enquanto está na fila');
    const rows = await drillRows();
    const pgDrill = rows.find((r) => Number(r.job_id) === jobs.pg)!;
    assert.match(pgDrill.options.new_name, /^cb_teste_[0-9a-f]{8}$/);
    assert.equal(pgDrill.mode, 'novo_banco');
    assert.equal(pgDrill.requested_by, null);
    await pump(A.agent); await pump(A.agent);
    await cycle();
    for (const r of await drillRows()) {
      assert.equal(r.status, 'concluido', `${r.job}: ${r.error}`);
      assert.equal(r.result.discarded, true);
      assert.ok(r.duration_s >= 0);
    }
    // descarte real: diretório temporário apagado e banco de teste inexistente
    const files = (await drillRows()).find((r) => Number(r.job_id) === jobs.files)!;
    assert.equal(files.result.files_restored, 3);
    assert.equal(files.result.conferencia, 'ok');
    assert.equal(existsSync(files.result.target_dir), false);
    assert.equal((await sql('postgres', 'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1', [pgDrill.options.new_name]))[0].n, 0);
    assert.ok((await drillRows()).find((r) => Number(r.job_id) === jobs.pg)!.result.tables >= 1);
    const sqDrill = (await drillRows()).find((r) => Number(r.job_id) === jobs.sqlite)!;
    assert.equal(sqDrill.result.integrity, 'ok');
    assert.equal(existsSync(sqDrill.result.file), false);
    assert.equal(readFileSync(sqliteFile).length > 0, true, 'original intacto');
    const job = (await c.call(admin, 'GET', `/api/v1/backup-jobs/${jobs.pg}`)).json();
    assert.equal(job.last_restore_test_status, 'ok');
    // aparece na lista de restaurações, marcado como teste, sem solicitante
    const list = (await c.call(admin, 'GET', '/api/v1/restores')).json().items;
    assert.ok(list.some((r: { drill: boolean; requested_by: unknown }) => r.drill && r.requested_by === null));
    assert.equal(await drills(), 0, 'dentro dos 7 dias não repete');
    assert.equal(await drills(new Date(Date.now() + 8 * DAY)), 3, 'depois de 7 dias repete');
    await pump(A.agent); await pump(A.agent); await cycle();
    assert.ok((await drillRows()).every((r) => r.status === 'concluido'));
    // o agente nunca descarta fora do temporário ou do prefixo reservado: recusa antes de restaurar
    const { restoreDatabase } = await import('../../apps/agent/src/operations/restore.ts');
    await assert.rejects(restoreDatabase({ restore_id: '00000000-0000-4000-8000-000000000000', snapshot: 'a'.repeat(64), filename: 'x.dump', target: { engine: 'postgresql', db_name: SRC_DB } as never, mode: 'novo', new_name: 'pedidos_prod', discard: true }, { repository: 'x', repo_password: 'x' } as never, { signal: new AbortController().signal, log: () => {}, stateDir: env.tmp }), /destino reservado/);
    await assert.rejects(restoreDatabase({ restore_id: '00000000-0000-4000-8000-000000000000', snapshot: 'a'.repeat(64), filename: 'x.dump', target: { engine: 'postgresql', db_name: SRC_DB } as never, mode: 'producao', discard: true }, { repository: 'x', repo_password: 'x' } as never, { signal: new AbortController().signal, log: () => {}, stateDir: env.tmp }), /só em banco novo/);
  });

  test('teste de restauração que falha vira alerta (restic indisponível no servidor)', async () => {
    const rule = await c.call(admin, 'POST', '/api/v1/alert-rules', { kind: 'teste_restauracao_falhou', name: 'Teste de restauração falhou', severity: 'critico' });
    assert.equal(rule.statusCode, 201, rule.body);
    const bin = process.env.RESTIC_BIN;
    process.env.RESTIC_BIN = path.join(env.tmp, 'sem-restic', 'restic');
    try {
      assert.equal(await drills(new Date(Date.now() + 16 * DAY)), 3);
      await pump(A.agent); await pump(A.agent); await cycle();
      const failed = (await drillRows()).slice(-3);
      assert.ok(failed.every((r) => r.status === 'falhou'), JSON.stringify(failed.map((r) => r.error)));
      assert.equal((await c.call(admin, 'GET', `/api/v1/backup-jobs/${jobs.files}`)).json().last_restore_test_status, 'falhou');
      await evaluateAlerts(c.db, deps.store, c.config.smtp);
      const alerts = (await c.call(admin, 'GET', '/api/v1/alerts?status=ativos')).json().items.filter((a: { title: string }) => a.title.startsWith('Teste de restauração falhou'));
      assert.equal(alerts.length, 3);
      const prom = await prometheusText(c.db);
      assert.match(prom, /central_restore_test_ok\{[^}]*job="Arquivos"[^}]*\} 0/);
    } finally { process.env.RESTIC_BIN = bin; }
  });

  test('pgBackRest: cadastro, backup manual e agendado, leitura do info e erro virando alerta', async () => {
    // pgBackRest não roda em Windows: a operação do agente é a real, com a execução da unidade
    // auxiliar simulada (ela grava rc/check/info.json como o pgbackrest-run.sh grava)
    const resultDir = path.join(env.tmp, 'pgbr');
    let next: { rc: string; label: string; check?: string } = { rc: '0', label: '20261107-010000F' };
    const fakeExec: Exec = async (_cmd, args) => {
      const inst = /central-pgbackrest@(.+)\.service/.exec(args[1]!)![1]!;
      const kind = inst.split('.').at(-1)!;
      const dir = path.join(resultDir, inst);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'rc'), `${next.rc}\n`);
      writeFileSync(path.join(dir, 'check'), `${next.check ?? 'ok'}\n`);
      writeFileSync(path.join(dir, 'stderr'), next.rc === '0' ? '' : 'ERROR: [056]: unable to find primary cluster - cannot proceed\n');
      writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info(kind === 'info' ? 'full' : kind, next.label)));
      if (next.rc !== '0') throw Object.assign(new Error('falhou'), { stderr: 'Job for unit failed' });
      return '';
    };
    registerOperation('pgbackrest.backup', async ({ params, signal, log }) => ({ result: await pgbackrestBackup(params as never, { signal, log, exec: fakeExec, mode: 'systemd', resultDir }), tool: { name: 'pgbackrest' } }));
    registerOperation('pgbackrest.info', async ({ params, signal, log }) => ({ result: await pgbackrestInfo(params as never, { signal, log, exec: fakeExec, mode: 'systemd', resultDir }), tool: { name: 'pgbackrest' } }));

    assert.equal((await c.call(admin, 'POST', '/api/v1/pgbackrest-stanzas', { server_id: A.serverId, stanza: 'main;x', full_schedule: '0 1 * * 0' })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/pgbackrest-stanzas', { server_id: A.serverId, stanza: 'main', full_schedule: '* * * * *' })).statusCode, 422);
    const st = await c.call(admin, 'POST', '/api/v1/pgbackrest-stanzas', { server_id: A.serverId, database_id: pgDbId, stanza: 'main', full_schedule: '0 1 * * 0', diff_schedule: '0 1 * * 1-6' });
    assert.equal(st.statusCode, 201, st.body);
    const id = st.json().id;
    assert.ok(st.json().next_full_at && st.json().next_diff_at);
    assert.equal((await c.call(admin, 'POST', '/api/v1/pgbackrest-stanzas', { server_id: A.serverId, stanza: 'main', full_schedule: '0 1 * * 0' })).statusCode, 409);

    const run = await c.call(admin, 'POST', `/api/v1/pgbackrest-stanzas/${id}/run`, { type: 'full' });
    assert.equal(run.statusCode, 202, run.body);
    assert.equal((await c.call(admin, 'POST', `/api/v1/pgbackrest-stanzas/${id}/run`, { type: 'diff' })).statusCode, 409, 'um por vez');
    await pump(A.agent); await cycle();
    let s = (await c.call(admin, 'GET', `/api/v1/pgbackrest-stanzas/${id}`)).json();
    assert.equal(s.status, 'ok', s.last_error);
    assert.equal(s.last_backup_label, '20261107-010000F');
    assert.equal(s.last_backup_type, 'full');
    assert.equal(s.summary.wal_max, '00000001000000000000000A');
    assert.equal(s.runs[0].status, 'concluido');

    // agendado: diff vencido dispara sozinho
    await c.db.system((tx) => tx.query("UPDATE pgbackrest_stanzas SET next_diff_at = now() - interval '1 minute' WHERE id = $1", [id]));
    next = { rc: '0', label: '20261107-010000F_20261108-010000D' };
    assert.equal(await schedulePgbackrest(c.db, deps), 1);
    await pump(A.agent); await cycle();
    s = (await c.call(admin, 'GET', `/api/v1/pgbackrest-stanzas/${id}`)).json();
    assert.equal(s.last_backup_type, 'diff');
    assert.equal(s.runs[0].type, 'diff');
    assert.ok(new Date(s.next_diff_at) > new Date(), 'próximo horário recalculado');

    // check do WAL reprovado → stanza com erro mesmo com o backup gravado
    next = { rc: '0', label: '20261107-010000F', check: 'ERROR: [082]: WAL segment 00000001000000000000000B was not archived before the 60000ms timeout' };
    await c.call(admin, 'POST', `/api/v1/pgbackrest-stanzas/${id}/run`, { type: 'info' });
    await pump(A.agent); await cycle();
    s = (await c.call(admin, 'GET', `/api/v1/pgbackrest-stanzas/${id}`)).json();
    assert.equal(s.status, 'erro');
    assert.match(s.last_error, /not archived/);

    // backup que falha no servidor
    next = { rc: '56', label: 'x' };
    await c.call(admin, 'POST', `/api/v1/pgbackrest-stanzas/${id}/run`, { type: 'full' });
    await pump(A.agent); await cycle();
    s = (await c.call(admin, 'GET', `/api/v1/pgbackrest-stanzas/${id}`)).json();
    assert.equal(s.runs[0].status, 'falhou');
    assert.match(s.last_error, /primary cluster/);
    await c.call(admin, 'POST', '/api/v1/alert-rules', { kind: 'pgbackrest_com_erro', name: 'pgBackRest com erro', severity: 'critico' });
    await evaluateAlerts(c.db, deps.store, c.config.smtp);
    assert.ok((await c.call(admin, 'GET', '/api/v1/alerts?status=ativos')).json().items.some((a: { title: string }) => a.title.startsWith('pgBackRest com erro: main')));
    assert.match(await prometheusText(c.db), /central_pgbackrest_ok\{[^}]*stanza="main"\} 0/);

    // isolamento
    await c.createUser('beta@exemplo.com.br', ['infra_engineer'], [betaClient]);
    const beta = await c.login('beta@exemplo.com.br');
    assert.equal((await c.call(beta, 'GET', '/api/v1/pgbackrest-stanzas')).json().items.length, 0);
    assert.equal((await c.call(beta, 'GET', `/api/v1/pgbackrest-stanzas/${id}`)).statusCode, 404);
    assert.equal((await c.call(beta, 'POST', `/api/v1/pgbackrest-stanzas/${id}/run`, { type: 'full' })).statusCode, 404);
    assert.equal((await c.call(beta, 'GET', '/api/v1/system/backups')).statusCode, 403);
  });

  test('backup da central: dump validado e restaurado de verdade num banco novo', async () => {
    const pw = 'senha-http-da-central-123';
    upsertHtpasswd(data, 'central', pw);
    await rs.stop(); rs = await startRestServer(data, rs.port);
    c.config.selfBackup.repository = `rest:http://central:${pw}@127.0.0.1:${rs.port}/central`;
    c.config.selfBackup.passwordFile = path.join(env.tmp, 'self-backup.pw');
    const r = await runSelfBackup(c.db, c.config, 'manual');
    assert.equal(r.status, 'validado', JSON.stringify(r));
    assert.ok(r.tables! > 20);
    const api = (await c.call(admin, 'GET', '/api/v1/system/backups')).json();
    assert.equal(api.items[0].status, 'validado');
    assert.equal(api.repository, `rest:http://127.0.0.1:${rs.port}/central`, 'sem credencial');
    assert.doesNotMatch(JSON.stringify(api), new RegExp(pw));
    assert.match(await prometheusText(c.db), /central_self_backup_last_ok 1/);

    // restauração: restic dump → pg_restore num banco novo e comparação com o original
    await sql('postgres', `CREATE DATABASE ${RESTORED_CENTRAL}`);
    const env2 = {} as Record<string, string>;
    await resticDump(c.config.tools.restic, c.config.selfBackup.repository, selfBackupPassword(c.config), env2, [r.snapshot_id!, `/${DUMP_NAME}`],
      (s) => pipeTo(c.config.tools.pgRestore, ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', dbUrl(RESTORED_CENTRAL)], s));
    const origName = new URL(c.config.databaseUrl).pathname.slice(1);
    for (const t of ['clients', 'backup_snapshots', 'secrets', 'audit_logs', 'system_keys']) {
      const a = (await sql(origName, `SELECT count(*)::int AS n FROM ${t}`))[0].n;
      const b = (await sql(RESTORED_CENTRAL, `SELECT count(*)::int AS n FROM ${t}`))[0].n;
      if (t === 'audit_logs') assert.ok(b >= 1 && b <= a); else assert.equal(b, a, t);
    }
    // com a KEK (do kit) os segredos do banco restaurado abrem
    const restored = await sql(RESTORED_CENTRAL, "SELECT dek_enc FROM client_keys WHERE client_id = $1", [A.clientId]);
    assert.equal(loadKeyring(c.config).decrypt(restored[0].dek_enc, `client_keys:${A.clientId}`).length, 32);
    // sem repositório: a API recusa com mensagem clara
    const saved = c.config.selfBackup.repository;
    c.config.selfBackup.repository = null;
    assert.equal((await c.call(admin, 'POST', '/api/v1/system/backups/run')).statusCode, 422);
    c.config.selfBackup.repository = saved;
  });

  test('rotação: DEK do cliente e KEK sem perder segredos; a KEK antiga só sai quando nada a usa', async () => {
    const before = await c.db.system((tx) => tx.many('SELECT id, ciphertext FROM secrets WHERE client_id = $1 ORDER BY id', [A.clientId]));
    const revealAll = (store: SecretStore, rows: { id: unknown }[]) => c.db.system(async (tx) => { const out: string[] = []; for (const s of rows) out.push(await store.reveal(tx, Number(s.id))); return out; });
    const plain = await revealAll(deps.store, before);
    const r = await rotateClientKey(c.db, loadKeyring(c.config), A.clientId);
    assert.equal(r.secrets, before.length);
    const after1 = await c.db.system((tx) => tx.many('SELECT id, ciphertext FROM secrets WHERE client_id = $1 ORDER BY id', [A.clientId]));
    assert.ok(after1.every((s, i) => s.ciphertext !== before[i]!.ciphertext), 'tudo recifrado');
    assert.deepEqual(await revealAll(deps.store, after1), plain);
    // depois da rotação da DEK o backup continua funcionando (senha do repositório recifrada)
    assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${jobs.files}/run`)).statusCode, 202);
    await pump(A.agent); await cycle(); await cycle();
    assert.equal((await c.call(admin, 'GET', `/api/v1/backup-jobs/${jobs.files}`)).json().last_status, 'validado');

    const oldId = loadKeyring(c.config).currentId;
    const rot = await rotateKek(c.db, c.config.kekFile);
    assert.notEqual(rot.newId, oldId);
    assert.deepEqual(Object.keys(await kekUsage(c.db)), [rot.newId]);
    assert.ok(rot.deks >= 1 && rot.systemKeys === 3 && rot.totp >= 1, JSON.stringify(rot));
    const kr = Keyring.fromFile(c.config.kekFile);
    assert.equal(kr.currentId, rot.newId);
    const fresh = new SecretStore(kr);
    assert.deepEqual(await revealAll(fresh, after1), plain);
    const ret = await retireOldKeks(c.db, c.config.kekFile);
    assert.deepEqual(ret.removed, [oldId]);
    assert.equal(readFileSync(c.config.kekFile, 'utf8').split('\n').filter((l) => l.includes(':') && !l.startsWith('#')).length, 1);
    assert.ok(readdirSync(env.tmp).some((f) => f.startsWith('kek.antes-')), 'cópia de segurança da KEK anterior');
    // a central reinicia com a KEK nova e tudo continua: gateway, painel, backup
    await c.stop(); await c.start();
    admin = await c.login('admin@exemplo.com.br');
    deps = backupDeps(c.db, loadKeyring(c.config));
    const keys = (await c.call(admin, 'GET', '/api/v1/system/keys')).json();
    assert.equal(keys.current_kek, rot.newId);
    assert.equal(keys.rotation_pending, false);
    assert.doesNotMatch(JSON.stringify(keys), /:[A-Za-z0-9+/]{40,}=*/);
    assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${jobs.pg}/run`)).statusCode, 202);
    await pump(A.agent); await cycle(); await cycle();
    assert.equal((await c.call(admin, 'GET', `/api/v1/backup-jobs/${jobs.pg}`)).json().last_status, 'validado');
  });
});
