// Ciclo de vida do agente: registro, heartbeat, busca de tarefas, envio de resultados (com fila
// local e reenvio) e renovação do certificado. Carga baixa: um heartbeat a cada N segundos e busca
// de tarefas só quando a central avisa que há alguma.
import { MetricsSampler } from './metrics.ts';
import { readFileSync } from 'node:fs';
import { createAgentCsr, certFingerprint } from '@central/security/ca';
import { generateSealKeyPair } from '@central/security/seal';
import { createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { AGENT_PROTOCOL_VERSION, type EnrollResponse, type HeartbeatResponse, type SignedTask, type TaskResult } from '@central/contracts';
import { normalizeEnrollmentCode } from '@central/security/tokens';
import { AgentState, LocalQueue, ensureDir, writeSecure, AGENT_VERSION } from './state.ts';
import { request, GatewayClient, HttpError } from './http.ts';
import { hostFacts } from './system.ts';
import { checkTask, execute, refusal } from './runner.ts';
import os from 'node:os';

export interface Logger { info(m: string): void; warn(m: string): void; error(m: string): void }
const consoleLogger: Logger = {
  info: (m) => console.log(`[central-agent] ${m}`), warn: (m) => console.warn(`[central-agent] ${m}`), error: (m) => console.error(`[central-agent] ${m}`)
};

/** Registro: baixa a CA, confere o SHA-256 informado no painel, gera a chave local e envia o código. */
export async function enroll(opts: { url: string; caSha256: string; code: string; state?: AgentState; log?: Logger }) {
  const state = opts.state ?? new AgentState();
  const log = opts.log ?? consoleLogger;
  const base = new URL(opts.url);
  if (base.protocol !== 'https:') throw new Error('Use o endereço HTTPS da central.');
  const pin = opts.caSha256.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (pin.length !== 64) throw new Error('SHA-256 da CA inválido.');
  if (state.isEnrolled()) throw new Error(`Este agente já está registrado (${state.dir}). Para registrar de novo, remova o diretório de estado.`);

  // O certificado do servidor ainda não é confiável aqui; a CA baixada só é aceita se o hash conferir.
  const caRes = await request(new URL('/agent/v1/ca.pem', base).toString(), { tls: { insecureForPinnedFetch: true } });
  let fp: string;
  try { fp = certFingerprint(caRes.text); } catch { throw new Error('A central não devolveu um certificado de CA válido.'); }
  if (fp !== pin) throw new Error('O SHA-256 da CA não confere com o informado no painel. Registro cancelado (possível interceptação).');

  const { csrPem, keyPem } = await createAgentCsr();
  const sealPair = generateSealKeyPair();
  const code = normalizeEnrollmentCode(opts.code);
  const res = await request(new URL('/agent/v1/enroll', base).toString(), {
    method: 'POST', tls: { ca: caRes.text },
    body: { code, csr: csrPem, agent_version: AGENT_VERSION, facts: hostFacts(), encryption_public_key: sealPair.publicPem }
  });
  const body = res.json as EnrollResponse;
  if (certFingerprint(body.ca_certificate) !== pin) throw new Error('CA divergente na resposta do registro.');

  ensureDir(state.dir);
  writeSecure(state.file('ca.pem'), body.ca_certificate);
  writeSecure(state.file('key.pem'), keyPem);
  writeSecure(state.file('cert.pem'), body.certificate);
  writeSecure(state.file('seal-key.pem'), sealPair.privatePem);
  state.saveConfig({
    gateway_url: base.origin, ca_sha256: pin, agent_id: body.agent_id, task_signing_keys: body.task_signing_keys,
    heartbeat_interval_s: body.heartbeat_interval_s, enrolled_at: new Date().toISOString()
  });
  log.info(`Agente registrado: ${body.agent_id}.`);
  return { agentId: body.agent_id };
}

/** Exit code usado quando a central recusa a credencial (revogada): o systemd não reinicia. */
export const EXIT_REVOKED = 78;

export class Agent {
  private readonly state: AgentState;
  private readonly queue: LocalQueue;
  private readonly client: GatewayClient;
  private readonly log: Logger;
  private readonly abort = new AbortController();
  private config;
  private running = 0;
  private stopping = false;
  private wake: (() => void) | null = null;

  constructor(opts: { state?: AgentState; log?: Logger } = {}) {
    this.state = opts.state ?? new AgentState();
    if (!this.state.isEnrolled()) throw new Error(`Agente não registrado (${this.state.dir}). Execute "central-agent enroll".`);
    this.log = opts.log ?? consoleLogger;
    this.config = this.state.config();
    this.queue = new LocalQueue(this.state.file('state.db'));
    this.client = new GatewayClient(this.config.gateway_url, this.state.tls());
    // agentes registrados antes da Fase 2 geram a chave de cifragem agora e a informam no heartbeat
    if (!existsSync(this.state.file('seal-key.pem'))) writeSecure(this.state.file('seal-key.pem'), generateSealKeyPair().privatePem);
    this.sealKey = readFileSync(this.state.file('seal-key.pem'), 'utf8');
    this.sealPublic = createPublicKey(this.sealKey).export({ type: 'spki', format: 'pem' }).toString();
  }

  private readonly sealKey: string;
  private readonly sealPublic: string;

  get agentId() { return this.config.agent_id; }

  /** Loop principal. Resolve com o código de saída. */
  async run(): Promise<number> {
    this.recoverUnfinished();
    let failures = 0;
    let interval = this.config.heartbeat_interval_s;
    while (!this.stopping) {
      try {
        const hb = await this.heartbeat();
        failures = 0;
        interval = hb.next_interval_s;
        if (hb.renew_certificate) await this.renewCertificate().catch((err) => this.log.warn(`Renovação do certificado falhou: ${(err as Error).message}`));
        await this.flushResults();
        if (hb.has_tasks) await this.drainTasks();
        await this.flushResults();
      } catch (err) {
        if (err instanceof HttpError && err.status === 403) {
          this.log.error('A central recusou a credencial deste agente (revogada ou vencida). Encerrando.');
          return EXIT_REVOKED;
        }
        failures++;
        this.log.warn(`Sem contato com a central (${(err as Error).message}). Nova tentativa em breve.`);
      }
      this.queue.prune();
      const base = failures ? Math.min(interval * 2 ** Math.min(failures - 1, 4), 300) : interval;
      await this.sleep((base + Math.random() * Math.min(5, base / 5)) * 1000);
    }
    return 0;
  }

  async stop() {
    this.stopping = true;
    this.abort.abort();
    this.wake?.();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { clearTimeout(t); this.wake = null; resolve(); };
    });
  }

  private readonly sampler = new MetricsSampler();

  async heartbeat() {
    const metrics = await this.sampler.sample().catch(() => undefined);
    return this.client.call<HeartbeatResponse>('POST', '/agent/v1/heartbeat', {
      agent_version: AGENT_VERSION, protocol: AGENT_PROTOCOL_VERSION, uptime_s: Math.round(os.uptime()), clock: new Date().toISOString(),
      queue: { pending_results: this.queue.pending(), running: this.running }, encryption_public_key: this.sealPublic, ...(metrics ? { metrics } : {})
    });
  }

  /** Execuções interrompidas por queda do processo viram resultado "interrompida" (a central decide se repete). */
  private recoverUnfinished() {
    for (const u of this.queue.unfinished()) {
      const at = new Date().toISOString();
      this.queue.finish(u.task_id, u.attempt, { attempt: u.attempt, status: 'interrompida', error: 'O agente foi reiniciado durante a execução.', started_at: at, finished_at: at, logs: [] } satisfies TaskResult);
      this.log.warn(`Tarefa ${u.task_id} (tentativa ${u.attempt}) interrompida por reinício do agente.`);
    }
  }

  async drainTasks() {
    for (let i = 0; i < 20 && !this.stopping; i++) {
      const { tasks } = await this.client.call<{ tasks: unknown[] }>('GET', '/agent/v1/tasks?limit=1&wait=0');
      if (!tasks.length) return;
      for (const raw of tasks) await this.handle(raw);
      await this.flushResults();
    }
  }

  private async handle(raw: unknown) {
    const check = checkTask(raw, { agentId: this.config.agent_id, keys: this.config.task_signing_keys });
    if (!check.ok) {
      this.log.warn(`Tarefa recusada: ${check.reason}.`);
      if (check.taskId && check.attempt && this.queue.claim(check.taskId, check.attempt)) this.queue.finish(check.taskId, check.attempt, refusal(check.attempt, check.reason));
      return;
    }
    const t: SignedTask = check.task;
    if (!this.queue.claim(t.payload.task_id, t.attempt)) {
      this.log.warn(`Tarefa ${t.payload.task_id} (tentativa ${t.attempt}) já recebida antes; não será executada de novo.`);
      return;
    }
    this.running++;
    // mantém o lease enquanto a tarefa roda
    const keepAlive = setInterval(() => {
      this.client.call('POST', `/agent/v1/tasks/${t.payload.task_id}/progress`, { attempt: t.attempt, logs: [] }).catch(() => {});
    }, 30_000);
    try {
      const result = await execute(t, { agentId: this.config.agent_id, keys: this.config.task_signing_keys, pendingResults: () => this.queue.pending(), signal: this.abort.signal, sealKey: this.sealKey, stateDir: this.state.dir });
      this.queue.finish(t.payload.task_id, t.attempt, result);
      this.log.info(`Tarefa ${t.payload.operation} ${t.payload.task_id}: ${result.status}.`);
    } finally {
      clearInterval(keepAlive);
      this.running--;
    }
  }

  /** Envia os resultados guardados. Só apaga da fila local depois da confirmação da central. */
  async flushResults() {
    for (const item of this.queue.due()) {
      try {
        await this.client.call('POST', `/agent/v1/tasks/${item.task_id}/result`, JSON.parse(item.body));
        this.queue.remove(item.id);
      } catch (err) {
        if (err instanceof HttpError && [404, 409, 422].includes(err.status)) {
          this.log.warn(`Resultado de ${item.task_id} descartado: a central respondeu ${err.status} (${err.message}).`);
          this.queue.remove(item.id);
        } else {
          this.queue.retryLater(item.id, item.tries);
          throw err;
        }
      }
    }
  }

  async renewCertificate() {
    const { csrPem, keyPem } = await createAgentCsr();
    const res = await this.client.call<{ certificate: string; not_after: string }>('POST', '/agent/v1/certificates/renew', { csr: csrPem });
    writeSecure(this.state.file('key.pem'), keyPem);
    writeSecure(this.state.file('cert.pem'), res.certificate);
    this.client.setTls({ ca: readFileSync(this.state.file('ca.pem'), 'utf8'), cert: res.certificate, key: keyPem });
    this.log.info(`Certificado renovado (válido até ${res.not_after}).`);
  }

  close() { this.queue.close(); }
}
