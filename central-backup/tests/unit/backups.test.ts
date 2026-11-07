import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, checkSchedule } from '../../apps/api/src/backups/cron.ts';
import { planRetention, type SnapshotInfo } from '../../apps/api/src/backups/retention.ts';

test('cron: próxima execução no fuso do cliente', () => {
  const c = parseCron('30 2 * * *');
  // 2026-03-10 12:00 UTC → próximo 02:30 em São Paulo (UTC-3) = 05:30 UTC do dia 11
  assert.equal(nextRun(c, 'America/Sao_Paulo', new Date('2026-03-10T12:00:00Z')).toISOString(), '2026-03-11T05:30:00.000Z');
  assert.equal(nextRun(c, 'UTC', new Date('2026-03-10T02:29:00Z')).toISOString(), '2026-03-10T02:30:00.000Z');
  // estritamente depois
  assert.equal(nextRun(c, 'UTC', new Date('2026-03-10T02:30:00Z')).toISOString(), '2026-03-11T02:30:00.000Z');
});

test('cron: passos, listas, dia da semana e semântica OU', () => {
  assert.equal(nextRun(parseCron('*/20 * * * *'), 'UTC', new Date('2026-01-01T00:05:00Z')).toISOString(), '2026-01-01T00:20:00.000Z');
  // segunda e quinta 23:00; 2026-01-01 é quinta
  const c = parseCron('0 23 * * 1,4');
  assert.equal(nextRun(c, 'UTC', new Date('2026-01-01T23:00:00Z')).toISOString(), '2026-01-05T23:00:00.000Z');
  // dia 1 OU domingo (7 = 0)
  const or = parseCron('0 0 1 * 7');
  assert.equal(nextRun(or, 'UTC', new Date('2026-01-01T00:00:00Z')).toISOString(), '2026-01-04T00:00:00.000Z');
  // 29/02 mais de 400 dias à frente: recusado em vez de laço longo
  assert.throws(() => nextRun(parseCron('0 0 29 2 *'), 'UTC', new Date('2026-03-01T00:00:00Z')), /400 dias/);
  assert.equal(nextRun(parseCron('0 0 29 2 *'), 'UTC', new Date('2027-03-01T00:00:00Z')).toISOString(), '2028-02-29T00:00:00.000Z');
});

test('cron: entradas inválidas e intervalo mínimo', () => {
  for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '0 0 0 * *', '*/0 * * * *', 'a b c d e', '5-1 * * * *']) {
    assert.throws(() => parseCron(bad), Error, bad);
  }
  assert.throws(() => checkSchedule('*/5 * * * *', 'UTC'), /Intervalo mínimo/);
  assert.throws(() => checkSchedule('0 2 * * *', 'Lua/Base'), /Fuso/);
  assert.doesNotThrow(() => checkSchedule('*/15 * * * *', 'UTC'));
  assert.doesNotThrow(() => checkSchedule('0 3 * * *', 'America/Sao_Paulo'));
});

const day = (d: number, status = 'validado', legal_hold = false): SnapshotInfo => ({ id: d, taken_at: new Date(Date.UTC(2026, 0, d, 3)), status, legal_hold });

test('retenção: últimos N e diários, só validados contam', () => {
  const snaps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => day(d));
  const plan = planRetention(snaps, { keep_last: 3 });
  assert.deepEqual([...plan.keep.keys()].sort((a, b) => a - b), [8, 9, 10]);
  assert.deepEqual(plan.forget.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  const daily = planRetention(snaps, { keep_last: 1, keep_daily: 5 });
  assert.deepEqual([...daily.keep.keys()].sort((a, b) => a - b), [6, 7, 8, 9, 10]);
});

test('retenção: legal hold, não verificados e falhas de verificação', () => {
  const snaps = [day(1, 'validado', true), day(2), day(3, 'falha_verificacao'), day(4), day(5, 'nao_verificado'), day(6, 'falha_verificacao'), day(7, 'verificando')];
  const plan = planRetention(snaps, { keep_last: 1 });
  assert.ok(plan.keep.get(1)!.includes('retencao_legal'));
  assert.ok(plan.keep.has(4), 'validado mais recente');
  assert.ok(plan.keep.has(5) && plan.keep.has(7), 'ainda sem verificação');
  assert.ok(plan.keep.has(6), 'falha sem validado mais novo fica para diagnóstico');
  assert.deepEqual(plan.forget.sort((a, b) => a - b), [2, 3]);
});

test('retenção: nunca remove o único validado e exige keep_last ≥ 1', () => {
  assert.deepEqual(planRetention([day(1)], { keep_last: 1 }).forget, []);
  assert.throws(() => planRetention([day(1)], { keep_last: 0 }));
  // todos falhados e nenhum validado: nada sai
  assert.deepEqual(planRetention([day(1, 'falha_verificacao'), day(2, 'falha_verificacao')], { keep_last: 1 }).forget, []);
});

test('retenção: semanal e mensal escolhem o mais novo de cada período', () => {
  const snaps = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, taken_at: new Date(Date.UTC(2026, 0, 1 + i, 3)), status: 'validado', legal_hold: false }));
  const plan = planRetention(snaps, { keep_last: 1, keep_weekly: 2, keep_monthly: 2 });
  // 60 = 01/03 (domingo); semanas: 01/03 (id 60) e o domingo anterior 22/02 (id 53); meses: 01/03 (60) e 28/02 (59)
  assert.deepEqual([...plan.keep.keys()].sort((a, b) => a - b), [53, 59, 60]);
});
