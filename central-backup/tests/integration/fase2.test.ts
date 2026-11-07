// Fase 2 — cadastros: bancos (teste de conexão REAL com PostgreSQL e SQLite pelo agente), segredos
// por envelope que nunca voltam pela API, aplicações, destinos (rest-server real) e repositórios.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Central, prepare, pump, startRestServer, hasTool, type Session } from './harness.ts';
import { SecretStore } from '../../apps/api/src/secrets.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { ensureRepository, type DestinationRow } from '../../apps/api/src/storage/destinations.ts';
import { restic } from '../../apps/api/src/storage/restic.ts';

const env = await prepare();
const PG_BIN = process.platform === 'win32' ? 'D:\\Program Files\\PostgreSQL\\18\\bin' : '';
if (PG_BIN) process.env.PATH = `${PG_BIN};${process.env.PATH}`; // o agente procura psql no PATH

describe('Fase 2 — cadastros', { skip: env.skip }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let B: Awaited<ReturnType<Central['clientWithAgent']>>;
  let pgDbId = 0;
  const url = new URL(env.config?.databaseUrl ?? 'postgres://x@y/z');
  const realPassword = decodeURIComponent(url.password);

  before(async () => {
    await c.setup();
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    B = await c.clientWithAgent(admin, 'Beta');
  });
  after(async () => { A?.agent.close(); B?.agent.close(); await c.teardown(); });

  test('cadastro de bancos valida o formato por motor', async () => {
    assert.equal((await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'postgresql', name: 'sem nome' })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'x', file_path: '/a.db', host: 'h' })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'x', file_path: '/var/../etc/passwd' })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'oracle', name: 'x', db_name: 'x' })).statusCode, 422);
  });

  test('PostgreSQL: teste de conexão real pelo agente, com senha selada que nunca aparece', async () => {
    const d = await c.call(admin, 'POST', '/api/v1/databases', {
      server_id: A.serverId, engine: 'postgresql', name: 'banco de teste', host: url.hostname, port: Number(url.port || 5432),
      db_name: url.pathname.slice(1), tech_user: decodeURIComponent(url.username)
    });
    assert.equal(d.statusCode, 201, d.body);
    pgDbId = d.json().id;
    assert.equal(d.json().has_credential, false);

    // senha errada → teste roda e reporta falha de autenticação
    assert.equal((await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: 'senha-errada-123' })).statusCode, 204);
    let t = await c.call(admin, 'POST', `/api/v1/databases/${pgDbId}/test-connection`);
    assert.equal(t.statusCode, 202, t.body);
    await pump(A.agent);
    assert.equal((await c.task(admin, t.json().task_id)).status, 'concluido');
    let row = (await c.call(admin, 'GET', `/api/v1/databases/${pgDbId}`)).json();
    assert.equal(row.connection_status, 'erro');
    assert.ok(row.last_test_error && !row.last_test_error.includes('senha-errada-123'));

    // senha certa → ok, versão e tamanho reais
    assert.equal((await c.call(admin, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: realPassword })).statusCode, 204);
    t = await c.call(admin, 'POST', `/api/v1/databases/${pgDbId}/test-connection`);
    await pump(A.agent);
    row = (await c.call(admin, 'GET', `/api/v1/databases/${pgDbId}`)).json();
    assert.equal(row.connection_status, 'ok', row.last_test_error);
    assert.match(row.version, /^PostgreSQL \d+/);
    assert.ok(row.size_bytes > 0);
    assert.equal(row.has_credential, true);

    // a senha não aparece em nenhuma resposta, tarefa, log ou auditoria
    const everywhere = JSON.stringify([
      row, (await c.task(admin, t.json().task_id)), (await c.call(admin, 'GET', '/api/v1/databases')).json(), (await c.call(admin, 'GET', '/api/v1/audit?limit=200')).json(),
      await c.owner.owner((x) => x.query('SELECT params, sealed_secrets, result, error FROM agent_task_queue').then((r) => r.rows)),
      await c.owner.owner((x) => x.query('SELECT message FROM agent_task_logs').then((r) => r.rows)),
      await c.owner.owner((x) => x.query('SELECT ciphertext FROM secrets').then((r) => r.rows))
    ]);
    for (const secret of [realPassword, 'senha-errada-123']) assert.ok(!everywhere.includes(secret), 'segredo vazou');
    const sealed = await c.owner.owner((x) => x.query('SELECT sealed_secrets FROM agent_task_queue WHERE public_id = $1', [t.json().task_id]).then((r) => r.rows[0].sealed_secrets));
    assert.match(sealed.password, /^s1\./);
  });

  test('segredo selado não abre em outra tarefa nem em outro agente', async () => {
    const { openSealed } = await import('@central/security/seal');
    const { readFileSync } = await import('node:fs');
    const t = await c.owner.owner((x) => x.query("SELECT public_id, sealed_secrets FROM agent_task_queue WHERE sealed_secrets IS NOT NULL ORDER BY id DESC LIMIT 1").then((r) => r.rows[0]));
    const keyA = readFileSync(A.state.file('seal-key.pem'), 'utf8');
    const keyB = readFileSync(B.state.file('seal-key.pem'), 'utf8');
    assert.equal(openSealed(t.sealed_secrets.password, keyA, `task:${t.public_id}`), realPassword);
    assert.throws(() => openSealed(t.sealed_secrets.password, keyA, 'task:outra'));
    assert.throws(() => openSealed(t.sealed_secrets.password, keyB, `task:${t.public_id}`));
  });

  test('SQLite: integridade real conferida pelo agente', async () => {
    const file = path.join(c.tmp, 'app.sqlite');
    const s = new DatabaseSync(file);
    s.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES (\'a\'), (\'b\');');
    s.close();
    const d = await c.call(admin, 'POST', '/api/v1/databases', { server_id: A.serverId, engine: 'sqlite', name: 'app local', file_path: file });
    assert.equal(d.statusCode, 201, d.body);
    assert.equal((await c.call(admin, 'PUT', `/api/v1/databases/${d.json().id}/credential`, { password: 'x' })).statusCode, 409);
    await c.call(admin, 'POST', `/api/v1/databases/${d.json().id}/test-connection`);
    await pump(A.agent);
    const row = (await c.call(admin, 'GET', `/api/v1/databases/${d.json().id}`)).json();
    assert.equal(row.connection_status, 'ok', row.last_test_error);
    assert.match(row.version, /^SQLite 3\./);
  });

  test('descoberta lista ferramentas reais do servidor', async () => {
    const t = await c.call(admin, 'POST', `/api/v1/servers/${A.serverId}/discover-databases`);
    assert.equal(t.statusCode, 202);
    await pump(A.agent);
    const task = await c.task(admin, t.json().task_id);
    assert.equal(task.status, 'concluido');
    assert.ok(Array.isArray(task.result.candidates));
    if (PG_BIN) assert.ok(task.result.tools.psql, 'psql deveria ser encontrado');
  });

  test('operações internas não podem ser pedidas diretamente', async () => {
    const r = await c.call(admin, 'POST', `/api/v1/agents/${A.agentId}/tasks`, { operation: 'db.test_connection', params: { target: { engine: 'sqlite', file_path: '/etc/shadow' } } });
    assert.equal(r.statusCode, 422);
  });

  test('aplicações: caminhos validados e bancos do mesmo servidor', async () => {
    const ok = await c.call(admin, 'POST', '/api/v1/applications', {
      server_id: A.serverId, name: 'Loja', technology: 'Node.js', data_dirs: ['/var/www/loja/uploads'], config_files: ['/etc/loja/config.json'],
      systemd_unit: 'loja.service', database_ids: [pgDbId], excludes: ['*.tmp']
    });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.deepEqual(ok.json().database_ids, [pgDbId]);
    assert.equal((await c.call(admin, 'POST', '/api/v1/applications', { server_id: A.serverId, name: 'X1', data_dirs: ['../etc'] })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/applications', { server_id: A.serverId, name: 'X2', data_dirs: ['relativo'] })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/applications', { server_id: A.serverId, name: 'X3', systemd_unit: 'rm -rf' })).statusCode, 422);
    assert.equal((await c.call(admin, 'POST', '/api/v1/applications', { server_id: B.serverId, name: 'X4', database_ids: [pgDbId] })).statusCode, 422);
  });

  test('isolamento: usuário de outro cliente não vê bancos nem aplicações', async () => {
    await c.createUser('beta@exemplo.com.br', ['infra_engineer'], [B.clientId]);
    const beta = await c.login('beta@exemplo.com.br');
    assert.equal((await c.call(beta, 'GET', '/api/v1/databases')).json().items.length, 0);
    assert.equal((await c.call(beta, 'GET', `/api/v1/databases/${pgDbId}`)).statusCode, 404);
    assert.equal((await c.call(beta, 'POST', `/api/v1/databases/${pgDbId}/test-connection`)).statusCode, 404);
    assert.equal((await c.call(beta, 'PUT', `/api/v1/databases/${pgDbId}/credential`, { password: 'x' })).statusCode, 404);
    assert.equal((await c.call(beta, 'GET', '/api/v1/applications')).json().items.length, 0);
  });

  test('destino local (rest-server append-only): teste real, repositório isolado por servidor', { skip: !hasTool('rest-server') && 'rest-server ausente' }, async () => {
    const step = (m: string) => { if (process.env.CB_DEBUG) console.error(`[passo ${new Date().toISOString().slice(11, 19)}] ${m}`); };
    const data = path.join(c.tmp, 'repos');
    mkdirSync(data);
    let rs = await startRestServer(data);
    try {
      const cfg = { agent_url: rs.url, data_dir: data };
      assert.equal((await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco da central', config: cfg })).statusCode, 422, 'precisa ser imutável');
      const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco da central', config: cfg, immutable: true });
      assert.equal(d.statusCode, 201, d.body);
      step('teste do destino');
      const tst = await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`);
      assert.equal(tst.json().ok, true, JSON.stringify(tst.json()));
      assert.ok(tst.json().details.capacity_bytes > 0);

      step('ensureRepository');
      const store = new SecretStore(loadKeyring(c.config));
      const dest = await c.db.system((tx) => tx.one('SELECT * FROM backup_destinations WHERE id = $1', [d.json().id])) as DestinationRow;
      const accA = await c.db.system((tx) => ensureRepository(tx, store, dest, { id: A.serverId, client_id: A.clientId }, c.config.tools.restic));
      const accB = await c.db.system((tx) => ensureRepository(tx, store, dest, { id: B.serverId, client_id: B.clientId }, c.config.tools.restic));
      // segunda chamada não recria nada
      const again = await c.db.system((tx) => ensureRepository(tx, store, dest, { id: A.serverId, client_id: A.clientId }, c.config.tools.restic));
      assert.equal(again.repositoryId, accA.repositoryId);

      step('reinicia rest-server');
      await rs.stop(); rs = await startRestServer(data); // relê o .htpasswd na hora
      const fix = (u: string) => u.replace(/127\.0\.0\.1:\d+/, new URL(rs.url).host);
      const asAgentA = { repo: fix(accA.agentRepo), password: accA.password };
      assert.equal((await restic(c.config.tools.restic, ['snapshots', '--json'], asAgentA)).code, 0, 'agente A acessa o próprio repositório');
      // credencial de A no caminho de B: recusado pelo rest-server
      step('acesso cruzado');
      const crossed = fix(accA.agentRepo).replace(/c\d+-s\d+\/restic$/, `c${B.clientId}-s${B.serverId}/restic`);
      const cross = await restic(c.config.tools.restic, ['snapshots'], { repo: crossed, password: accB.password });
      assert.notEqual(cross.code, 0);
      assert.match(cross.stderr, /401|unauthorized/i);
      // append-only: o agente grava mas não apaga
      step('backup');
      const bk = await restic(c.config.tools.restic, ['backup', '--json', path.join(c.tmp, 'app.sqlite')], asAgentA);
      assert.equal(bk.code, 0, bk.stderr);
      step('forget');
      const forget = await restic(c.config.tools.restic, ['forget', '--keep-last', '0', 'latest', '--prune'], asAgentA);
      assert.notEqual(forget.code, 0, 'append-only deveria recusar a exclusão');
      const snaps = JSON.parse((await restic(c.config.tools.restic, ['snapshots', '--json'], asAgentA)).stdout);
      assert.equal(snaps.length, 1);
      // nada de segredo nas respostas de destino
      const list = JSON.stringify((await c.call(admin, 'GET', '/api/v1/storage')).json());
      assert.ok(!list.includes(accA.password) && !list.includes(new URL(asAgentA.repo.slice(5)).password));
    } finally {
      await rs.stop();
    }
  });

  test('destino S3: credencial só de escrita; teste reporta erro real quando o endpoint não responde', async () => {
    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 's3', name: 'S3 inexistente', config: { provider: 'minio', endpoint: 'http://127.0.0.1:1', bucket: 'backups' } });
    assert.equal(d.statusCode, 201, d.body);
    const noCred = await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`);
    assert.equal(noCred.statusCode, 409);
    assert.equal((await c.call(admin, 'PUT', `/api/v1/storage/${d.json().id}/credential`, { access_key_id: 'AKIATESTE', secret_access_key: 'segredo-s3-super' })).statusCode, 204);
    const t = await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`);
    assert.equal(t.json().ok, false);
    assert.ok(!JSON.stringify(t.json()).includes('segredo-s3-super'));
    const row = (await c.call(admin, 'GET', `/api/v1/storage/${d.json().id}`)).json();
    assert.equal(row.status, 'erro');
    assert.equal(row.has_credential, true);
  });
});
