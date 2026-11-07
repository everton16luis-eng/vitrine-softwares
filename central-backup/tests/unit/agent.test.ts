import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSigningKeyPair, signPayload } from '@central/security/signing';
import { checkTask, execute } from '../../apps/agent/src/runner.ts';
import { LocalQueue } from '../../apps/agent/src/state.ts';

const AGENT = '11111111-2222-4333-8444-555555555555';
const keys = generateSigningKeyPair();
const KEYS = { k1: keys.publicPem };

function task(over: Record<string, unknown> = {}, signWith = keys.privatePem, attempt = 1) {
  const payload = {
    task_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', agent_id: AGENT, operation: 'agent.ping', operation_version: 1, params: {},
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), timeout_s: 30, ...over
  };
  return { ...signPayload(payload, signWith, 'k1'), attempt };
}

test('agente executa somente tarefa assinada, destinada a ele, válida e do catálogo', () => {
  assert.ok(checkTask(task(), { agentId: AGENT, keys: KEYS }).ok);
  const cases: [unknown, RegExp][] = [
    [task({}, generateSigningKeyPair().privatePem), /assinatura/],
    [task({ agent_id: '99999999-2222-4333-8444-555555555555' }), /outro agente/],
    [task({ expires_at: new Date(Date.now() - 1000).toISOString() }), /vencida/],
    [task({ operation: 'shell.exec', params: { cmd: 'id' } }), /desconhecida/],
    [task({ operation_version: 2 }), /versão/],
    [task({ operation: 'inventory.collect', params: { sections: ['sistema'], extra: 1 } }), /parâmetros/],
    [{ payload: 'x' }, /formato/]
  ];
  for (const [raw, reason] of cases) {
    const r = checkTask(raw, { agentId: AGENT, keys: KEYS });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, reason);
  }
  // payload alterado depois de assinado
  const t = task();
  (t.payload as { params: unknown }).params = { note: 'alterado' };
  assert.match((checkTask(t, { agentId: AGENT, keys: KEYS }) as { reason: string }).reason, /assinatura/);
});

test('agent.ping e inventory.collect devolvem dados reais da máquina', async () => {
  const ping = await execute(task() as never, { agentId: AGENT, keys: KEYS, pendingResults: () => 3 });
  assert.equal(ping.status, 'ok');
  assert.equal((ping.result as { pending_results: number }).pending_results, 3);
  const inv = await execute(task({ operation: 'inventory.collect', params: { sections: ['sistema', 'rede'] }, timeout_s: 60 }) as never, { agentId: AGENT, keys: KEYS, pendingResults: () => 0 });
  assert.equal(inv.status, 'ok');
  const data = (inv.result as { inventory: { sistema: { hostname: string }; rede: { interfaces: unknown[] } } }).inventory;
  assert.equal(data.sistema.hostname, os.hostname());
  assert.ok(Array.isArray(data.rede.interfaces));
});

test('fila local: repetição não executa duas vezes e resultado sobrevive a reinício', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  try {
    const file = path.join(dir, 'state.db');
    let q = new LocalQueue(file);
    assert.ok(q.claim('t1', 1));
    assert.ok(!q.claim('t1', 1), 'mesma tentativa recusada');
    assert.ok(q.claim('t1', 2), 'nova tentativa aceita');
    q.finish('t1', 1, { status: 'ok' });
    q.close();
    q = new LocalQueue(file);
    assert.equal(q.pending(), 1);
    assert.deepEqual(q.unfinished(), [{ task_id: 't1', attempt: 2 }]);
    const [item] = q.due();
    q.retryLater(item!.id, 0);
    assert.equal(q.due().length, 0, 'aguarda backoff');
    q.remove(item!.id);
    assert.equal(q.pending(), 0);
    q.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows pode manter o WAL aberto por instantes */ }
  }
});
