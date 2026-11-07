import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeInfo } from '../../apps/api/src/pgbackrest/service.ts';
import { pgbackrestBackup, pgbackrestInfo, type Exec } from '../../apps/agent/src/operations/pgbackrest.ts';
import { sealKit, openKit, type KitContent } from '../../apps/api/src/system/kit.ts';
import { safeRepo } from '../../apps/api/src/modules/system.ts';

// formato do `pgbackrest info --output=json` (pgBackRest 2.x, documentação oficial)
export const INFO = (stop = 1781000060, error = false, code = 0) => [{
  archive: [{ database: { id: 1, 'repo-key': 1 }, id: '16-1', max: '000000010000000000000009', min: '000000010000000000000001' }],
  backup: [
    { archive: { start: '000000010000000000000002', stop: '000000010000000000000002' }, backrest: { format: 5, version: '2.54' }, database: { id: 1, 'repo-key': 1 }, error: false,
      info: { delta: 30000000, repository: { delta: 4000000, size: 4000000 }, size: 30000000 }, label: '20260601-010000F', prior: null, reference: null, timestamp: { start: 1780275600, stop: 1780275660 }, type: 'full' },
    { archive: { start: '000000010000000000000008', stop: '000000010000000000000008' }, backrest: { format: 5, version: '2.54' }, database: { id: 1, 'repo-key': 1 }, error,
      info: { delta: 1000000, repository: { delta: 200000, size: 200000 }, size: 30500000 }, label: '20260601-010000F_20260608-010000D', prior: '20260601-010000F', reference: ['20260601-010000F'], timestamp: { start: 1781000000, stop }, type: 'diff' }
  ],
  cipher: 'aes-256-cbc', db: [{ id: 1, 'repo-key': 1, 'system-id': 7000000000000000000, version: '16' }], name: 'main',
  repo: [{ cipher: 'aes-256-cbc', key: 1, status: { code: 0, message: 'ok' } }],
  status: { code, lock: { backup: { held: false } }, message: code === 0 ? 'ok' : 'missing stanza path' }
}];

test('pgBackRest: resumo do info (último backup, WAL, versão, problemas)', () => {
  const s = summarizeInfo(INFO(), 'main');
  assert.equal(s.ok, true, s.problems.join());
  assert.equal(s.last!.label, '20260601-010000F_20260608-010000D');
  assert.equal(s.last!.type, 'diff');
  assert.equal(s.last!.repo_size, 200000);
  assert.equal(s.wal_max, '000000010000000000000009');
  assert.equal(s.db_version, '16');
  assert.equal(s.backups.length, 2);
  assert.equal(summarizeInfo(INFO(1781000060, true), 'main').ok, false);
  assert.equal(summarizeInfo(INFO(1781000060, false, 2), 'main').ok, false);
  assert.match(summarizeInfo(INFO(), 'outra').problems[0]!, /não aparece/);
  assert.match(summarizeInfo(INFO(), 'main', 'ERROR: [082]: WAL segment was not archived').problems.join(), /check:/);
  assert.equal(summarizeInfo('lixo', 'main').ok, false);
});

const ctx = (exec: Exec, extra: Record<string, unknown> = {}) => ({ signal: new AbortController().signal, log: () => {}, exec, ...extra });

test('pgBackRest (agente, modo direto): só stanza e tipo viram argumentos; check e info depois do backup', async () => {
  process.env.PGBACKREST_BIN = '/usr/bin/pgbackrest';
  const calls: string[][] = [];
  const exec: Exec = async (_cmd, args) => { calls.push(args); return args.at(-1) === 'info' ? JSON.stringify(INFO()) : ''; };
  const r = await pgbackrestBackup({ stanza: 'main', type: 'diff' }, ctx(exec, { mode: 'direto' }));
  assert.deepEqual(calls.map((a) => a.at(-1)), ['backup', 'check', 'info']);
  assert.deepEqual(calls[0], ['--stanza=main', '--type=diff', '--log-level-console=warn', 'backup']);
  assert.equal(r.check, 'ok');
  assert.ok(Array.isArray(r.info));
  await assert.rejects(pgbackrestBackup({ stanza: 'main; rm -rf /', type: 'full' }, ctx(exec, { mode: 'direto' })), /Stanza inválida/);
  await assert.rejects(pgbackrestBackup({ stanza: 'main', type: 'tudo' as never }, ctx(exec, { mode: 'direto' })), /Tipo/);
  // check que falha não derruba o resultado: vira texto para a central reprovar
  const failing: Exec = async (_c, args) => { if (args.at(-1) === 'check') throw Object.assign(new Error('x'), { stderr: 'ERROR: [082]: WAL segment was not archived' }); return args.at(-1) === 'info' ? JSON.stringify(INFO()) : ''; };
  assert.match((await pgbackrestInfo({ stanza: 'main' }, ctx(failing, { mode: 'direto' }))).check, /not archived/);
  delete process.env.PGBACKREST_BIN;
});

test('pgBackRest (agente, modo systemd): inicia só a unidade auxiliar e lê o resultado gravado por ela', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-pgbr-'));
  const calls: string[][] = [];
  const write = (inst: string, files: Record<string, string>) => { mkdirSync(path.join(dir, inst), { recursive: true }); for (const [f, c] of Object.entries(files)) writeFileSync(path.join(dir, inst, f), c); };
  const exec: Exec = async (_cmd, args) => { calls.push(args); write('main.full', { rc: '0\n', check: 'ok\n', 'info.json': JSON.stringify(INFO()), stderr: '' }); return ''; };
  const r = await pgbackrestBackup({ stanza: 'main', type: 'full' }, ctx(exec, { mode: 'systemd', resultDir: dir }));
  assert.deepEqual(calls, [['start', 'central-pgbackrest@main.full.service']]);
  assert.equal(r.check, 'ok');
  const fail: Exec = async () => { write('main.diff', { rc: '56\n', stderr: 'ERROR: [056]: unable to find primary cluster\n' }); throw Object.assign(new Error('falhou'), { stderr: 'Job failed' }); };
  await assert.rejects(pgbackrestBackup({ stanza: 'main', type: 'diff' }, ctx(fail, { mode: 'systemd', resultDir: dir })), /código 56.*primary cluster/);
  const none: Exec = async () => { throw Object.assign(new Error('x'), { stderr: 'Interactive authentication required.' }); };
  await assert.rejects(pgbackrestInfo({ stanza: 'outra' }, ctx(none, { mode: 'systemd', resultDir: dir })), /não gravou resultado.*polkit/);
});

test('kit de recuperação: abre só com a frase certa; adulteração é detectada', () => {
  const content: KitContent = { created_at: '2026-11-07T00:00:00Z', kek: 'k1:' + Buffer.alloc(32, 7).toString('base64'), self_backup: { repository: 'rest:https://u:segredo@b.exemplo/central', password: 'senha-do-repo' }, database_name: 'central', gateway: { public_url: 'https://c:8443', ca_sha256: 'a'.repeat(64) }, notes: 'x' };
  const pass = 'cavalo correto bateria grampo';
  const text = sealKit(content, pass);
  assert.ok(text.startsWith('CENTRAL-BACKUP-KIT-1\n'));
  assert.doesNotMatch(text, /segredo|senha-do-repo|k1:/);
  assert.deepEqual(openKit(text, pass), content);
  assert.throws(() => openKit(text, 'frase errada mas comprida'), /incorreta/);
  const lines = text.split('\n');
  const i = lines.findIndex((l, n) => n > 2 && l.length > 20);
  const bad = [...lines]; bad[i] = (bad[i]![0] === 'A' ? 'B' : 'A') + bad[i]!.slice(1);
  assert.throws(() => openKit(bad.join('\n'), pass), /incorreta|corrompido/);
  assert.throws(() => sealKit(content, 'curta'), /16 caracteres/);
  assert.throws(() => sealKit(content, 'aaaaaaaaaaaaaaaaaaaa'), /repetitiva/);
});

test('repositório exibido sem credencial', () => {
  assert.equal(safeRepo('rest:https://central:s3nh4@backup.exemplo.com.br:8000/central'), 'rest:https://backup.exemplo.com.br:8000/central');
  assert.equal(safeRepo('s3:https://s3.amazonaws.com/bucket/central'), 's3:https://s3.amazonaws.com/bucket/central');
  assert.equal(safeRepo(null), null);
});
