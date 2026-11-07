// Monta painel e gateway sem banco: compila todos os esquemas no Fastify/ajv e confere respostas
// que não dependem do PostgreSQL (rotas protegidas recusam sem sessão; validação devolve 422).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@central/database';
import { Keyring, createCa, issueServerCert } from '@central/security';
import { loadConfig } from '../../apps/api/src/config.ts';
import { buildPanel } from '../../apps/api/src/panel.ts';
import { buildGateway } from '../../apps/api/src/gateway/app.ts';

const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgres://ninguem:x@127.0.0.1:1/nada' });
const db = new Database({ connectionString: config.databaseUrl });

test('painel: esquemas compilam, rotas exigem sessão e corpo inválido dá 422', async () => {
  const app = await buildPanel({ db, config, keyring: new Keyring({ k1: Buffer.alloc(32, 1) }, 'k1'), logger: false });
  await app.ready();
  // sem cookie a sessão nem é consultada no banco
  for (const [method, url] of [['GET', '/api/v1/clients'], ['GET', '/api/v1/agents'], ['GET', '/api/v1/tasks'], ['GET', '/api/v1/audit'], ['GET', '/api/v1/openapi.json']] as const) {
    const r = await app.inject({ method, url });
    assert.equal(r.statusCode, 401, `${method} ${url}`);
  }
  const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'não-é-email', password: 'x', extra: 1 } });
  assert.equal(bad.statusCode, 422);
  assert.ok(bad.json().fields);
  const spec = app.swagger() as { paths: Record<string, unknown> };
  assert.ok(Object.keys(spec.paths).length >= 25, 'OpenAPI gerado');
  await app.close();
});

test('gateway: esquemas compilam e rotas mTLS recusam conexão sem certificado', async () => {
  const ca = await createCa('teste');
  const tls = await issueServerCert(ca, { hostnames: ['localhost'], ips: ['127.0.0.1'], days: 1 });
  const app = await buildGateway({ db, config, material: { caCertPem: ca.certPem, caKeyPem: ca.keyPem, tlsCertPem: tls.certPem + ca.certPem, tlsKeyPem: tls.keyPem } });
  await app.ready();
  const r = await app.inject({ method: 'POST', url: '/agent/v1/heartbeat', payload: {} });
  assert.equal(r.statusCode, 401);
  const ca1 = await app.inject({ method: 'GET', url: '/agent/v1/ca.pem' });
  assert.equal(ca1.statusCode, 200);
  assert.match(String(ca1.headers['x-ca-sha256']), /^[0-9a-f]{64}$/);
  const enroll = await app.inject({ method: 'POST', url: '/agent/v1/enroll', payload: { code: 'curto' } });
  assert.equal(enroll.statusCode, 422);
  await app.close();
  await db.close();
});
