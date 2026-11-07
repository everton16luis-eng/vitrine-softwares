// Fase 6 — alertas e relatórios. Entrega REAL por protocolo: SMTP (servidor receptor local),
// webhook HTTP com assinatura HMAC conferida pelo receptor e a API do WhatsApp (imitação local que
// confere token e formato). Falha de backup REAL (caminho inexistente) vira incidente.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNet, type Server as NetServer } from 'node:net';
import { createServer as createHttp, type Server as HttpServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Central, prepare, pump, startRestServer, hasTool, type Session } from './harness.ts';
import { ROOT } from '../../apps/api/src/config.ts';
import { loadKeyring } from '../../apps/api/src/keys.ts';
import { backupDeps, runBackupCycleOnce } from '../../apps/api/src/worker.ts';
import { evaluateAlerts } from '../../apps/api/src/alerts/evaluate.ts';

const env = await prepare();
process.env.RESTIC_BIN = path.join(ROOT, '.tools', 'bin', process.platform === 'win32' ? 'restic.exe' : 'restic');
const SIGNING_KEY = 'chave-de-assinatura-do-webhook-123';
const WA_TOKEN = 'token-whatsapp-de-teste-0123456789abcdef';

/** Receptor SMTP mínimo (sem TLS, sem autenticação): guarda as mensagens recebidas. */
function smtpSink(): Promise<{ port: number; messages: string[]; server: NetServer }> {
  const messages: string[] = [];
  const server = createNet((sock) => {
    let data = false;
    let buf = '';
    sock.write('220 receptor de teste\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (data) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        messages.push(buf.slice(0, end));
        buf = buf.slice(end + 5);
        data = false;
        sock.write('250 recebido\r\n');
      }
      let i;
      while (!data && (i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-teste\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') { data = true; sock.write('354 envie\r\n'); }
        else if (cmd === 'QUIT') { sock.end('221 tchau\r\n'); return; }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as { port: number }).port, messages, server })));
}

interface Hit { path: string; headers: Record<string, string | string[] | undefined>; body: string }
function httpSink(status: () => number): Promise<{ port: number; hits: Hit[]; server: HttpServer }> {
  const hits: Hit[] = [];
  const server = createHttp((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { hits.push({ path: req.url ?? '', headers: req.headers, body }); res.writeHead(status(), { 'content-type': 'application/json' }).end('{}'); });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as { port: number }).port, hits, server })));
}

describe('Fase 6 — alertas e relatórios', { skip: env.skip || (!hasTool('rest-server') && 'rest-server ausente') }, () => {
  const c = new Central(env.config!, env.tmp);
  let admin: Session;
  let A: Awaited<ReturnType<Central['clientWithAgent']>>;
  let B: Awaited<ReturnType<Central['clientWithAgent']>>;
  let smtp: Awaited<ReturnType<typeof smtpSink>>;
  let hook: Awaited<ReturnType<typeof httpSink>>;
  let wa: Awaited<ReturnType<typeof httpSink>>;
  let hookStatus = 200;
  let rs: Awaited<ReturnType<typeof startRestServer>>;
  let deps: ReturnType<typeof backupDeps>;
  const channels: number[] = [];
  let jobId = 0;
  const evaluate = () => evaluateAlerts(c.db, deps.store, c.config.smtp);
  const alertsOf = async (s: Session, status = 'ativos') => (await c.call(s, 'GET', `/api/v1/alerts?status=${status}`)).json().items as any[];

  before(async () => {
    smtp = await smtpSink();
    hook = await httpSink(() => hookStatus);
    wa = await httpSink(() => 200);
    c.config.smtp = { url: `smtp://127.0.0.1:${smtp.port}`, from: 'Central de Backup <alertas@exemplo.com.br>' };
    await c.setup();
    deps = backupDeps(c.db, loadKeyring(c.config));
    await c.createUser('admin@exemplo.com.br', ['admin']);
    admin = await c.login('admin@exemplo.com.br');
    A = await c.clientWithAgent(admin, 'Alfa');
    B = await c.clientWithAgent(admin, 'Beta');
  });
  after(async () => {
    A?.agent.close(); B?.agent.close();
    await rs?.stop();
    await c.teardown();
    for (const s of [smtp?.server, hook?.server, wa?.server]) s?.close();
  });

  test('canais: validação, segredo só de escrita e teste com envio real', async () => {
    const bad = [
      { kind: 'email', name: 'x', config: { to: ['não-é-email'] } },
      { kind: 'webhook', name: 'externo sem TLS', config: {}, secret: { url: 'http://exemplo.com/hook', signing_key: SIGNING_KEY } },
      { kind: 'webhook', name: 'sem segredo', config: {} },
      { kind: 'whatsapp', name: 'sem token', config: { phone_number_id: '123456', to: ['5511999990000'] } }
    ];
    for (const b of bad) assert.equal((await c.call(admin, 'POST', '/api/v1/notification-channels', b)).statusCode, 422, JSON.stringify(b));
    const defs = [
      { kind: 'email', name: 'E-mail do plantão', config: { to: ['plantao@exemplo.com.br'] } },
      { kind: 'webhook', name: 'Webhook interno', config: {}, secret: { url: `http://127.0.0.1:${hook.port}/alertas`, signing_key: SIGNING_KEY } },
      { kind: 'whatsapp', name: 'WhatsApp do plantão', config: { phone_number_id: '1234567890', to: ['5511999990000'], api_base: `http://127.0.0.1:${wa.port}` }, secret: { access_token: WA_TOKEN } }
    ];
    for (const d of defs) {
      const r = await c.call(admin, 'POST', '/api/v1/notification-channels', d);
      assert.equal(r.statusCode, 201, r.body);
      channels.push(r.json().id);
    }
    const list = (await c.call(admin, 'GET', '/api/v1/notification-channels')).body;
    assert.ok(!list.includes(SIGNING_KEY) && !list.includes(WA_TOKEN) && !list.includes(`${hook.port}/alertas`), 'segredo do canal não volta pela API');

    for (const id of channels) {
      const t = await c.call(admin, 'POST', `/api/v1/notification-channels/${id}/test`);
      assert.deepEqual(t.json(), { ok: true, error: null }, `canal ${id}: ${t.body}`);
    }
    assert.equal(smtp.messages.length, 1);
    assert.match(smtp.messages[0]!, /Subject: =\?UTF-8\?Q\?|Subject: \[Central de Backup\] TESTE/);
    assert.match(smtp.messages[0]!, /To: plantao@exemplo\.com\.br/);
    const h = hook.hits[0]!;
    const expected = createHmac('sha256', SIGNING_KEY).update(`${h.headers['x-central-timestamp']}.${h.body}`).digest('hex');
    assert.equal(h.headers['x-central-assinatura'], `sha256=${expected}`, 'assinatura HMAC confere');
    assert.equal(JSON.parse(h.body).event, 'teste');
    const w = wa.hits[0]!;
    assert.equal(w.path, '/1234567890/messages');
    assert.equal(w.headers.authorization, `Bearer ${WA_TOKEN}`);
    assert.equal(JSON.parse(w.body).to, '5511999990000');
    assert.equal(JSON.parse(w.body).type, 'text');
  });

  test('regras recomendadas: criadas uma vez', async () => {
    const r = await c.call(admin, 'POST', '/api/v1/alert-rules/recommended', { channel_ids: channels });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().items.length, 10);
    assert.equal((await c.call(admin, 'POST', '/api/v1/alert-rules/recommended', { channel_ids: channels })).json().items.length, 0);
  });

  test('incidente: abre uma vez (deduplicado), notifica, é reconhecido e resolve sozinho', async () => {
    await A.agent.heartbeat(); await B.agent.heartbeat();
    await c.db.system((tx) => tx.query(`UPDATE servers SET last_metrics = jsonb_set(last_metrics, '{disk_max_pct}', '96'), last_metrics_at = now() WHERE id = $1`, [A.serverId]));
    const before = { mail: smtp.messages.length, hook: hook.hits.length, wa: wa.hits.length };
    const first = await evaluate();
    assert.equal(first?.opened, 1, JSON.stringify(first));
    assert.equal(first?.sent, 3);
    let [a] = (await alertsOf(admin)).filter((x) => x.kind === 'disco');
    assert.equal(a.title, 'Disco 96% em srv-alfa');
    assert.equal(a.client_name, 'Alfa Ltda');
    assert.deepEqual([smtp.messages.length, hook.hits.length, wa.hits.length], [before.mail + 1, before.hook + 1, before.wa + 1]);
    assert.equal(JSON.parse(hook.hits.at(-1)!.body).event, 'aberto');

    const again = await evaluate();
    assert.equal(again?.opened, 0, 'sem duplicar');
    assert.equal(again?.sent, 0, 'sem notificar de novo antes do lembrete');
    [a] = (await alertsOf(admin)).filter((x) => x.kind === 'disco');
    assert.equal(a.occurrences, 2);

    assert.equal((await c.call(admin, 'POST', `/api/v1/alerts/${a.id}/ack`, { note: 'limpando logs' })).statusCode, 200);
    assert.equal((await c.call(admin, 'POST', `/api/v1/alerts/${a.id}/ack`, { note: 'de novo' })).statusCode, 409);

    await c.db.system((tx) => tx.query(`UPDATE servers SET last_metrics = jsonb_set(last_metrics, '{disk_max_pct}', '50'), last_metrics_at = now() WHERE id = $1`, [A.serverId]));
    const fixed = await evaluate();
    assert.equal(fixed?.resolved, 1);
    assert.equal(JSON.parse(hook.hits.at(-1)!.body).event, 'resolvido');
    const resolved = (await alertsOf(admin, 'resolvido')).find((x) => x.id === a.id);
    assert.ok(resolved.resolved_at);
    const notes = (await c.call(admin, 'GET', `/api/v1/alerts/${a.id}/notifications`)).json().items;
    assert.deepEqual(notes.map((n: { event: string }) => n.event).sort(), ['aberto', 'aberto', 'aberto', 'resolvido', 'resolvido', 'resolvido']);
  });

  test('backup que falha de verdade vira incidente com o erro do agente; canal com falha não bloqueia os outros', async () => {
    const data = path.join(env.tmp, 'repos');
    mkdirSync(data);
    rs = await startRestServer(data);
    const d = await c.call(admin, 'POST', '/api/v1/storage', { kind: 'local_rest', name: 'Disco', config: { agent_url: rs.url, data_dir: data }, immutable: true });
    assert.equal((await c.call(admin, 'POST', `/api/v1/storage/${d.json().id}/test`)).json().ok, true);
    const p = await c.call(admin, 'POST', '/api/v1/backup-policies', { name: 'Diária', schedule: '0 3 * * *', retention: { keep_last: 3 } });
    const missing = path.join(env.tmp, 'nao-existe');
    const j = await c.call(admin, 'POST', '/api/v1/backup-jobs', { server_id: A.serverId, policy_id: p.json().id, destination_id: d.json().id, name: '=SOMA(1;2)', kind: 'arquivos', paths: [missing] });
    assert.equal(j.statusCode, 201, j.body);
    jobId = j.json().id;
    await rs.stop(); rs = await startRestServer(data, rs.port);
    await c.call(admin, 'POST', `/api/v1/backup-jobs/${jobId}/run`);
    await pump(A.agent);
    await c.db.system((tx) => tx.query("UPDATE agent_task_queue SET available_at = now() WHERE status = 'na_fila'"));
    await pump(A.agent);
    await runBackupCycleOnce(c.db, c.config, deps, { retention: false, log: {} });

    hookStatus = 500;
    const out = await evaluate();
    assert.equal(out?.opened, 1, JSON.stringify(out));
    assert.equal(out?.sent, 2, 'e-mail e WhatsApp saem');
    assert.equal(out?.failed, 1, 'webhook com erro');
    const a = (await alertsOf(admin)).find((x) => x.kind === 'backup_falhou');
    assert.match(a.title, /Backup falhou: =SOMA/);
    assert.match(a.details.erro, /Nenhum dos caminhos existe/);
    const ch = (await c.call(admin, 'GET', '/api/v1/notification-channels')).json().items.find((x: { kind: string }) => x.kind === 'webhook');
    assert.match(ch.last_error, /500/);
    hookStatus = 200;
    // falha de envio → nova tentativa na rodada seguinte (como lembrete)
    const retry = await evaluate();
    assert.equal(retry?.retried, 1, JSON.stringify(retry));
    assert.equal(retry?.sent, 1, 'só o webhook é reenviado');
    assert.equal(JSON.parse(hook.hits.at(-1)!.body).alert.id, a.id);
    assert.equal((await evaluate())?.retried, 0, 'entregue: não repete');
  });

  test('relatório: números das execuções reais; CSV seguro para planilha', async () => {
    const r = await c.call(admin, 'GET', '/api/v1/reports/backups');
    assert.equal(r.statusCode, 200, r.body);
    const row = r.json().items.find((i: { job: string }) => i.job === '=SOMA(1;2)');
    assert.equal(Number(row.execucoes), 1);
    assert.equal(Number(row.falhas), 1);
    assert.equal(Number(row.taxa_sucesso), 0);
    const csv = await c.call(admin, 'GET', '/api/v1/reports/backups?format=csv');
    assert.match(csv.headers['content-type'] as string, /text\/csv/);
    assert.ok(csv.body.startsWith('﻿cliente;servidor;job;'));
    assert.ok(csv.body.includes(`"'=SOMA(1;2)"`), 'fórmula neutralizada e campo com ; entre aspas');
  });

  test('isolamento: outro cliente não vê alertas do Alfa nem cria regra da empresa', async () => {
    await c.createUser('beta@exemplo.com.br', ['infra_engineer'], [B.clientId]);
    const b = await c.login('beta@exemplo.com.br');
    assert.ok((await alertsOf(b, 'resolvido')).every((x) => x.client_id === B.clientId));
    assert.ok((await alertsOf(b)).every((x) => x.client_id === B.clientId));
    assert.equal((await c.call(b, 'POST', '/api/v1/alert-rules', { kind: 'disco', name: 'global', threshold: 80 })).statusCode, 403);
    const rep = (await c.call(b, 'GET', '/api/v1/reports/backups')).json().items;
    assert.ok(rep.every((i: { cliente: string }) => i.cliente === 'Beta Ltda'));
  });
});
