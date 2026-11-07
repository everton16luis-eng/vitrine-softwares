import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, retryDelayMs, redact, stripSecrets, canTransition } from '@central/shared';
import { validate, OPERATIONS, ClientInput } from '@central/contracts';

test('JSON canônico ordena chaves em qualquer profundidade', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
});

test('backoff cresce, tem teto e jitter dentro do limite', () => {
  assert.equal(retryDelayMs(1, { random: () => 0 }), 30_000);
  assert.equal(retryDelayMs(1, { random: () => 1 }), 60_000);
  assert.equal(retryDelayMs(3, { random: () => 1 }), 240_000);
  assert.equal(retryDelayMs(50, { random: () => 1 }), 30 * 60_000);
});

test('mascaramento de segredos em logs e na auditoria', () => {
  const out = redact('senha=abc123 conectando postgres://app:SuperSecreta@db/x token: xyz', ['minha-chave-conhecida']);
  assert.ok(!out.includes('abc123'));
  assert.ok(!out.includes('SuperSecreta'));
  assert.ok(!out.includes('xyz'));
  assert.equal(redact('usa minha-chave-conhecida aqui', ['minha-chave-conhecida']), 'usa *** aqui');
  assert.ok(redact('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----').includes('***chave privada***'));
  assert.deepEqual(stripSecrets({ email: 'a@b', password: 'x', nested: [{ token: 'y', ok: 1 }] }), { email: 'a@b', password: '***', nested: [{ token: '***', ok: 1 }] });
});

test('máquina de estados das tarefas', () => {
  assert.ok(canTransition('na_fila', 'executando'));
  assert.ok(!canTransition('concluido', 'executando'));
  assert.ok(!canTransition('cancelado', 'na_fila'));
});

test('catálogo: parâmetros fora do esquema são recusados', () => {
  assert.ok(validate(OPERATIONS['inventory.collect'].params, { sections: ['sistema'] }).ok);
  assert.ok(!validate(OPERATIONS['inventory.collect'].params, { sections: [] }).ok);
  assert.ok(!validate(OPERATIONS['inventory.collect'].params, { sections: ['sistema'], cmd: 'rm -rf /' }).ok);
  assert.ok(!validate(OPERATIONS['agent.ping'].params, { note: 'x'.repeat(101) }).ok);
  assert.ok(!validate(ClientInput, { legal_name: 'Empresa', extra: 1 }).ok);
});
