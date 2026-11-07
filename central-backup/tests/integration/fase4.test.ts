// Fase 4 — restauração REAL: prévia do snapshot, restauração temporária de arquivos com conferência,
// PostgreSQL em banco novo, produção com dupla aprovação + confirmação digitada + backup de segurança
// validado (e o caso em que o backup de segurança falha e a produção não é tocada), SQLite em produção.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import pg from 'pg';
import { Central, prepare, pump, startRestServer, hasTool, type Session } from './harness.ts';
import { ROOT } from '../../apps/api/src/config.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { backupDeps, runBackupCycleOnce } from '../../apps/api/src/worker.ts';

const PG_BIN = process.platform === 'win32' ? 'D:\\Program Files\\PostgreSQL\\18\\bin' : '';
if (PG_BIN) process.env.PATH = `${PG_BIN};${process.env.PATH}`;
const env = await prepare();
process.env.RESTIC_BIN = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'restic.exe' : 'restic');
const SRC_DB = 'cb_fase4_origem';

describe('Fase 4 — restauração', { skip: env.skip || (!hasTool('rest-server') && 'rest-server ausente') }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let rs: Awaited<ReturnType<typeof startRestServer>>;
  let deps: ReturnType<typeof backupDeps>;
  const jobs = { files: 0, pg: 0, sqlite: 0 };
  const snaps = { files: 0, pg: 0, sqlite: 0 };
  let pgDbId = 0;
  const data = path.join(env.tmp, 'repos');
  const src = path.join(env.tmp, 'origem');
  const sqliteFile = path.join(env.tmp, 'loja.sqlite');
  const url = new URL(env.config?.databaseUrl ?? 'postgres://x@y/z');
  const pgPassword = decodeURIComponent(url.password);
  const dbUrl = (name: string) => { const u = new URL(env.config!.databaseUrl); u.pathname = `/${name}`; return u.toString(); };
  const sql = async (name: string, q: string) => { const cl = new pg.Client({ connectionString: dbUrl(name) }); await cl.connect(); try { return (await cl.query(q)).rows; } finally { await cl.end(); } };
  const cycle = () => runBackupCycleOnce(c.db, c.config, deps, { retention: false, log: {} });
  const restore = async (s: Session, body: Record<string, unknown>) => c.call(s, 'POST', '/api/v1/restores', { reason: 'teste de restauração', ...body });
  const getRestore = async (id: string) => (await c.call(admin, 'GET', `/api/v1/restores/${id}`)).json();
  const latestValid = async (job: number) => ((await c.call(admin, 'GET', `/api/v1/snapshots?job_id=${job}&status=validado`)).json().items[0]).id as number;
  const drain = async () => { await pump(A.agent); await c.db.system((tx) => tx.query("UPDATE agent_task_queue SET available_at = now() WHERE status = 'na_fila'")); await pump(A.agent); await cycle(); };
  const created: string[] = [];
  // o 2FA recusa reutilizar o mesmo código na mesma janela: cada usuário faz login uma vez
  const sessions = new Map<string, Session>();
  const as = async (email: string) => { if (!sessions.has(email)) sessions.set(email, await c.login(email)); return sessions.get(email)!; };

  before(async () => {
    await c.setup();
    deps = backupDeps(c.db, loadKeyring(c.config));
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    mkdirSync(data);
    rs = await startRestServer(data);
    mkdirSync(path.join(src, 'sub'), { recursive: true });
    for (const [f, body] of [['a.txt', 'alfa'], ['b.txt', 'beta'.repeat(500)], ['sub/d.txt', 'delta'], ['x.log', 'fora']]) writeFileSync(path.join(src, f!), body!);
    const root = new pg.Client({ connectionString: env.config!.databaseUrl });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${SRC_DB}`);
    await root.query(`CREATE DATABASE ${SRC_DB}`);
    await root.end();
    await sql(SRC_DB, "CREATE TABLE pedidos (id serial PRIMARY KEY, cliente text NOT NULL); INSERT INTO pedidos (cliente) SELECT 'c' || g FROM generate_series(1, 500) g");
    const s = new DatabaseSync(sqliteFile);
    s.exec("CREATE TABLE itens (id INTEGER PRIMARY KEY, nome TEXT); INSERT INTO itens (nome) VALUES ('caneta'), ('caderno');");
    s.close();

    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco', config: { agent_url: rs.url, data_dir: data }, immutable: true });
    assert.equal((await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`)).json().ok, true);
    const p = await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'Diária', schedule: '0 3 * * *', retention: { keep_last: 10 }, verify_subset_percent: 100 });
    const base = { server_id: A.serverId, policy_id: p.json().id, destination_id: d.json().id };
    jobs.files = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Arquivos', kind: 'arquivos', paths: [src], excludes: ['*.log'] })).json().id;
    const pgDb = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'postgresql', name: 'Pedidos', db_name: SRC_DB, host: url.hostname, port: Number(url.port || 5432), tech_user: decodeURIComponent(url.username) });
    pgDbId = pgDb.json().id;
    await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: pgPassword });
    jobs.pg = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Banco', kind: 'banco', database_id: pgDbId })).json().id;
    const sq = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'Loja', file_path: sqliteFile });
    jobs.sqlite = (await c.call(admin, 'POST', '/api/v1/backup-jobs', { ...base, name: 'Loja', kind: 'banco', database_id: sq.json().id })).json().id;
    await rs.stop(); rs = await startRestServer(data, rs.port);
    for (const j of Object.values(jobs)) assert.equal((await c.call(admin, 'POST', `/api/v1/backup-jobs/${j}/run`)).statusCode, 202);
    for (let i = 0; i < 3; i++) await pump(A.agent);
    await cycle(); await cycle(); // a verificação faz 2 por rodada
    snaps.files = await latestValid(jobs.files);
    snaps.pg = await latestValid(jobs.pg);
    snaps.sqlite = await latestValid(jobs.sqlite);

    await c.createUser('infra1@exemplo.com.br', ['infra_engineer']);
    await c.createUser('infra2@exemplo.com.br', ['infra_engineer']);
    await c.createUser('operador@exemplo.com.br', ['backup_operator']);
  });

  after(async () => {
    A?.agent.close();
    await rs?.stop();
    await c.teardown();
    const p = new pg.Client({ connectionString: env.config?.databaseUrl });
    try { await p.connect(); for (const db of [SRC_DB, ...created]) await p.query(`DROP DATABASE IF EXISTS ${db}`); } catch { /* sem banco */ } finally { await p.end().catch(() => {}); }
  });

  test('prévia: a central lista o conteúdo do snapshot sem tocar no servidor', async () => {
    const dir = process.platform === 'win32' ? `/${src.replace(':', '').replace(/\\/g, '/')}` : src;
    const r = await c.call(admin, 'GET', `/api/v1/snapshots/${snaps.files}/files?path=${encodeURIComponent(dir)}`);
    assert.equal(r.statusCode, 200, r.body);
    const names = r.json().items.map((i: { name: string }) => i.name);
    for (const n of ['a.txt', 'b.txt', 'sub']) assert.ok(names.includes(n), `${n} em ${names}`);
    assert.ok(!names.includes('x.log'), 'excluído não aparece');
    assert.equal((await c.call(admin, 'GET', `/api/v1/snapshots/${snaps.files}/files?path=..%2Fetc`)).statusCode, 422);
  });

  test('arquivos: restauração temporária com conferência; nunca sobrescreve um diretório com conteúdo', async () => {
    const r = await restore(admin, { snapshot_id: snaps.files, mode: 'temporario' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().status, 'na_fila');
    await pump(A.agent);
    await cycle();
    const done = await getRestore(r.json().id);
    assert.equal(done.status, 'concluido', JSON.stringify(done));
    assert.equal(done.result.files_restored, 3);
    assert.equal(done.result.conferencia, 'ok');
    const found: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'a.txt') found.push(p); } };
    walk(done.result.target_dir);
    assert.equal(readFileSync(found[0]!, 'utf8'), 'alfa', 'conteúdo restaurado igual ao original');

    // diretório de destino com conteúdo: o agente recusa
    const busy = path.join(env.tmp, 'ocupado');
    mkdirSync(busy);
    writeFileSync(path.join(busy, 'importante.txt'), 'não apagar');
    const r2 = await restore(admin, { snapshot_id: snaps.files, mode: 'caminho', target_dir: busy });
    await pump(A.agent);
    await cycle();
    const failed = await getRestore(r2.json().id);
    assert.equal(failed.status, 'falhou');
    assert.match(failed.error, /não está vazio/);
    assert.equal(readFileSync(path.join(busy, 'importante.txt'), 'utf8'), 'não apagar');
    // por cima da produção, para arquivos: recusado (sem auxiliar privilegiado)
    assert.equal((await restore(admin, { snapshot_id: snaps.files, mode: 'producao', confirmation: 'srv-alfa' })).statusCode, 409);
  });

  test('PostgreSQL: restauração em banco novo, sem tocar no original', async () => {
    const r = await restore(admin, { snapshot_id: snaps.pg, mode: 'novo_banco', new_name: 'cb_fase4_copia' });
    assert.equal(r.statusCode, 201, r.body);
    created.push('cb_fase4_copia');
    await pump(A.agent);
    await cycle();
    const done = await getRestore(r.json().id);
    assert.equal(done.status, 'concluido', JSON.stringify(done));
    assert.equal(done.result.database, 'cb_fase4_copia');
    assert.equal(Number((await sql('cb_fase4_copia', 'SELECT count(*) AS n FROM pedidos'))[0].n), 500);
    assert.ok(!JSON.stringify(done).includes(pgPassword));
    assert.equal((await restore(admin, { snapshot_id: snaps.pg, mode: 'temporario' })).statusCode, 422);
  });

  test('produção: permissão, confirmação digitada, aprovação por outra pessoa e backup de segurança validado', async () => {
    const op = await as('operador@exemplo.com.br');
    const i1 = await as('infra1@exemplo.com.br');
    const i2 = await as('infra2@exemplo.com.br');
    assert.equal((await restore(op, { snapshot_id: snaps.pg, mode: 'producao', confirmation: 'srv-alfa' })).statusCode, 403, 'operador não restaura produção');
    assert.equal((await restore(i1, { snapshot_id: snaps.pg, mode: 'producao', confirmation: 'outro' })).statusCode, 422, 'confirmação errada');

    // "acidente" na produção depois do backup
    await sql(SRC_DB, 'DELETE FROM pedidos WHERE id > 400');
    const r = await restore(i1, { snapshot_id: snaps.pg, mode: 'producao', confirmation: 'srv-alfa', reason: 'exclusão acidental de 100 pedidos' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().status, 'aguardando_aprovacao');
    assert.equal((await restore(i1, { snapshot_id: snaps.pg, mode: 'producao', confirmation: 'srv-alfa' })).statusCode, 409, 'uma por vez');
    await pump(A.agent);
    assert.equal(Number((await sql(SRC_DB, 'SELECT count(*) AS n FROM pedidos'))[0].n), 400, 'nada acontece sem aprovação');

    assert.equal((await c.call(i1, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv-alfa' })).statusCode, 403, 'não aprova a própria');
    assert.equal((await c.call(op, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv-alfa' })).statusCode, 403);
    assert.equal((await c.call(i2, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv' })).statusCode, 422);
    const ap = await c.call(i2, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv-alfa', note: 'conferido com o cliente' });
    assert.equal(ap.statusCode, 200, ap.body);
    assert.equal(ap.json().status, 'backup_seguranca');
    assert.ok(ap.json().safety_run);

    await pump(A.agent);          // backup de segurança (estado com 400 linhas)
    await cycle();                // verifica → validado → enfileira a restauração
    assert.equal((await getRestore(r.json().id)).status, 'na_fila');
    await pump(A.agent);          // restauração
    await cycle();
    const done = await getRestore(r.json().id);
    assert.equal(done.status, 'concluido', JSON.stringify(done));
    assert.equal(Number((await sql(SRC_DB, 'SELECT count(*) AS n FROM pedidos'))[0].n), 500, 'dados de volta');
    const safety = (await c.call(admin, 'GET', `/api/v1/backup-runs/${done.safety_run}`)).json();
    assert.equal(safety.trigger, 'seguranca');
    assert.equal(safety.status, 'validado', 'o estado anterior à restauração ficou guardado e verificado');
    const trail = await c.db.system((tx) => tx.many("SELECT action FROM audit_logs WHERE entity = 'restauracao' AND entity_id = $1 ORDER BY id", [r.json().id]));
    assert.deepEqual(trail.map((t) => t.action), ['restauracao.solicitar', 'restauracao.aprovar', 'restauracao.concluir']);
  });

  test('produção: se o backup de segurança falha, a restauração não acontece', async () => {
    const i1 = await as('infra1@exemplo.com.br');
    const i2 = await as('infra2@exemplo.com.br');
    await sql(SRC_DB, 'DELETE FROM pedidos WHERE id > 450');
    await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: 'senha-errada' });
    const r = await restore(i1, { snapshot_id: snaps.pg, mode: 'producao', confirmation: 'srv-alfa' });
    assert.equal((await c.call(i2, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv-alfa' })).statusCode, 200);
    await drain();
    const out = await getRestore(r.json().id);
    assert.equal(out.status, 'falhou', JSON.stringify(out));
    assert.match(out.error, /backup de segurança/);
    assert.equal(Number((await sql(SRC_DB, 'SELECT count(*) AS n FROM pedidos'))[0].n), 450, 'produção intocada');
    await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: pgPassword });
  });

  test('SQLite em produção: arquivo trocado de forma atômica depois da conferência', async () => {
    const s = new DatabaseSync(sqliteFile);
    s.exec("DELETE FROM itens; INSERT INTO itens (nome) VALUES ('errado');");
    s.close();
    const i1 = await as('infra1@exemplo.com.br');
    const i2 = await as('infra2@exemplo.com.br');
    const r = await restore(i1, { snapshot_id: snaps.sqlite, mode: 'producao', confirmation: 'srv-alfa' });
    assert.equal(r.statusCode, 201, r.body);
    await c.call(i2, 'POST', `/api/v1/restores/${r.json().id}/approve`, { confirmation: 'srv-alfa' });
    await pump(A.agent); await cycle(); await pump(A.agent); await cycle();
    const done = await getRestore(r.json().id);
    assert.equal(done.status, 'concluido', JSON.stringify(done));
    const back = new DatabaseSync(sqliteFile, { readOnly: true });
    const rows = back.prepare('SELECT nome FROM itens ORDER BY id').all().map((x) => x.nome);
    back.close();
    assert.deepEqual(rows, ['caneta', 'caderno']);
  });

  test('isolamento: outro cliente não vê restaurações nem a prévia', async () => {
    const other = await c.call(admin, 'POST', '/api/v1/clients', { legal_name: 'Gama Ltda' });
    await c.createUser('gama@exemplo.com.br', ['infra_engineer'], [other.json().id]);
    const g = await as('gama@exemplo.com.br');
    assert.deepEqual((await c.call(g, 'GET', '/api/v1/restores')).json().items, []);
    assert.equal((await c.call(g, 'GET', `/api/v1/snapshots/${snaps.files}/files`)).statusCode, 404);
    assert.equal((await restore(g, { snapshot_id: snaps.files, mode: 'temporario' })).statusCode, 404);
  });
});
