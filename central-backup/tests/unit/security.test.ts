import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import https from 'node:https';
import {
  totpCode, verifyTotp, base32Encode, base32Decode, generateTotpSecret, Keyring, generateSigningKeyPair, signPayload, verifyPayload,
  createCa, issueServerCert, createAgentCsr, signAgentCsr, agentIdFromSubject, certFingerprint, passwordProblem, hashPassword, verifyPassword,
  enrollmentCode, normalizeEnrollmentCode, safeEqualHex, sha256Hex
} from '@central/security';

// RFC 6238, apêndice B (SHA-1, segredo "12345678901234567890"), 6 últimos dígitos
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];

test('TOTP confere com os vetores da RFC 6238', () => {
  for (const [t, code] of VECTORS) assert.equal(totpCode(RFC_SECRET, t * 1000), code, `t=${t}`);
});

test('TOTP aceita ±1 passo e recusa reutilização do mesmo código', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const code = totpCode(secret, now);
  const counter = verifyTotp(secret, code, now);
  assert.equal(typeof counter, 'number');
  assert.equal(verifyTotp(secret, code, now, counter!), null, 'replay recusado');
  assert.notEqual(verifyTotp(secret, totpCode(secret, now - 30_000), now), null, 'passo anterior aceito');
  assert.equal(verifyTotp(secret, totpCode(secret, now - 120_000), now), null, 'código antigo recusado');
  assert.equal(verifyTotp(secret, 'abcdef', now), null);
});

test('base32 ida e volta', () => {
  const buf = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
});

test('envelope AES-GCM: contexto errado ou texto adulterado falham', () => {
  const kr = new Keyring({ k1: Buffer.alloc(32, 7) }, 'k1');
  const token = kr.encrypt('segredo', 'users:totp:1');
  assert.equal(kr.decryptText(token, 'users:totp:1'), 'segredo');
  assert.throws(() => kr.decrypt(token, 'users:totp:2'));
  const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => kr.decrypt(tampered, 'users:totp:1'));
  assert.ok(!token.includes('segredo'));
});

test('envelope: rotação mantém leitura de textos antigos e recifra com a chave nova', () => {
  const old = new Keyring({ k1: Buffer.alloc(32, 1) }, 'k1');
  const token = old.encrypt('x', 'ctx');
  const rotated = new Keyring({ k1: Buffer.alloc(32, 1), k2: Buffer.alloc(32, 2) }, 'k2');
  assert.equal(rotated.decryptText(token, 'ctx'), 'x');
  const rewrapped = rotated.rewrap(token, 'ctx');
  assert.ok(rewrapped.startsWith('v1.k2.'));
  assert.equal(rotated.decryptText(rewrapped, 'ctx'), 'x');
});

test('assinatura Ed25519: payload alterado, chave desconhecida ou trocada é recusado', () => {
  const k = generateSigningKeyPair();
  const other = generateSigningKeyPair();
  const env = signPayload({ task_id: 'a', params: { b: 1, a: 2 } }, k.privatePem, 'k1');
  assert.ok(verifyPayload(env, { k1: k.publicPem }));
  assert.ok(!verifyPayload({ ...env, payload: { task_id: 'a', params: { b: 1, a: 3 } } }, { k1: k.publicPem }));
  assert.ok(!verifyPayload(env, { k2: k.publicPem }));
  assert.ok(!verifyPayload(env, { k1: other.publicPem }));
  // a ordem das chaves do objeto não altera a assinatura (JSON canônico)
  assert.ok(verifyPayload({ ...env, payload: { params: { a: 2, b: 1 }, task_id: 'a' } }, { k1: k.publicPem }));
});

test('senhas: Argon2id e regras mínimas', async () => {
  assert.ok(passwordProblem('curta'));
  assert.ok(passwordProblem('aaaaaaaaaaaaaaaa'));
  assert.ok(passwordProblem('fulano-super-seguro-1', { email: 'fulano@x.com' }));
  assert.equal(passwordProblem('Cavalo-Bateria-Grampo-42'), null);
  const h = await hashPassword('Cavalo-Bateria-Grampo-42');
  assert.ok(h.startsWith('$argon2id$'));
  assert.ok(await verifyPassword(h, 'Cavalo-Bateria-Grampo-42'));
  assert.ok(!(await verifyPassword(h, 'Cavalo-Bateria-Grampo-43')));
});

test('código de instalação: formato e normalização', () => {
  const c = enrollmentCode();
  assert.match(c, /^[A-Z0-9]{4}(-[A-Z0-9]{2,4})+$/);
  assert.equal(normalizeEnrollmentCode(c.toLowerCase()), c.replace(/-/g, ''));
  assert.ok(safeEqualHex(sha256Hex('a'), sha256Hex('a')));
  assert.ok(!safeEqualHex(sha256Hex('a'), sha256Hex('b')));
});

test('CA interna: identidade do agente vem da CA, e o mTLS recusa cliente sem certificado', async () => {
  const ca = await createCa('Central de Backup - teste');
  const server = await issueServerCert(ca, { hostnames: ['localhost'], ips: ['127.0.0.1'], days: 2 });
  const { csrPem, keyPem } = await createAgentCsr();
  const id = '7d0b1c9e-3f4a-4b5c-8d6e-1a2b3c4d5e6f';
  const agent = await signAgentCsr(ca, csrPem, { agentPublicId: id, days: 90 });
  assert.equal(certFingerprint(agent.certPem), agent.fingerprint);
  assert.ok(agent.notAfter.getTime() - Date.now() > 89 * 86_400_000);
  await assert.rejects(signAgentCsr(ca, csrPem.replace(/A/g, 'B'), { agentPublicId: id }));

  const srv = https.createServer({ key: server.keyPem, cert: server.certPem, ca: ca.certPem, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' }, (req, res) => {
    const s = req.socket as tls.TLSSocket;
    res.end(JSON.stringify({ authorized: s.authorized, id: agentIdFromSubject(`CN=${s.getPeerCertificate()?.subject?.CN ?? ''}`) }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const get = (opts: https.RequestOptions) => new Promise<{ authorized: boolean; id: string | null }>((resolve, reject) => {
    https.get({ host: '127.0.0.1', port, path: '/', servername: 'localhost', ca: ca.certPem, ...opts }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve(JSON.parse(t)));
    }).on('error', reject);
  });
  try {
    assert.deepEqual(await get({ cert: agent.certPem, key: keyPem }), { authorized: true, id });
    assert.equal((await get({})).authorized, false);
    const rogueCa = await createCa('outra CA');
    const rogue = await createAgentCsr();
    const rogueCert = await signAgentCsr(rogueCa, rogue.csrPem, { agentPublicId: id });
    assert.equal((await get({ cert: rogueCert.certPem, key: rogue.keyPem })).authorized, false);
  } finally {
    srv.close();
  }
});
