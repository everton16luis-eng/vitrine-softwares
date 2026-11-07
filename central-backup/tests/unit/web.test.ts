import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { webHandler, PANEL_CSP } from '../../apps/api/src/http/web.ts';

function app(dist: string) {
  const a = Fastify();
  const web = webHandler(dist);
  a.get('/api/v1/health', async () => ({ ok: true }));
  a.setNotFoundHandler((req, reply) => { if (web.serve(req, reply)) return; return reply.code(404).send({ code: 'NAO_ENCONTRADO' }); });
  return a;
}

test('painel web: serve o build, cai na SPA, não sai do diretório e não engole a API', async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'cb-web-'));
  const dist = path.join(base, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Central</title>');
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(path.join(base, 'segredo.txt'), 'nao pode sair');
  const a = app(dist);

  const home = await a.inject('/');
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Central/);
  assert.equal(home.headers['content-security-policy'], PANEL_CSP);
  assert.equal(home.headers['cache-control'], 'no-cache');

  const spa = await a.inject('/servidores/12');
  assert.equal(spa.statusCode, 200);
  assert.match(spa.body, /Central/);

  const asset = await a.inject('/assets/index-abc.js');
  assert.equal(asset.statusCode, 200);
  assert.match(String(asset.headers['content-type']), /javascript/);
  assert.match(String(asset.headers['cache-control']), /immutable/);

  assert.equal((await a.inject('/assets/nao-existe.js')).statusCode, 404);
  for (const url of ['/../segredo.txt', '/%2e%2e/segredo.txt', '/assets/..%2f..%2fsegredo.txt', '/%E0%A4%A']) {
    const r = await a.inject(url);
    assert.doesNotMatch(r.body, /nao pode sair/, url);
  }
  const api = await a.inject('/api/v1/nao-existe');
  assert.equal(api.statusCode, 404);
  assert.match(api.body, /NAO_ENCONTRADO/);
  assert.equal((await a.inject({ method: 'POST', url: '/qualquer' })).statusCode, 404);
  await a.close();

  // sem build, o painel continua respondendo só a API (404 nas outras rotas)
  const b = app(path.join(base, 'sem-build'));
  assert.equal((await b.inject('/')).statusCode, 404);
  await b.close();
});
