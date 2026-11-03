// Agente da Central de Implantação: processo separado do site/painel.
// Uso: npm run agente   (em produção, como serviço systemd do usuário "implantador")
//
// - Consome a fila tarefas_implantacao (uma tarefa por vez por agente).
// - Retoma tarefas interrompidas a partir do último passo concluído.
// - Rechecagem automática do DNS das implantações que aguardam o cliente.
import os from 'node:os';
import { env } from '../config/env.js';
import { db, closePool } from '../database/pool.js';
import { registerAgent, claimTask, recoverStaleTasks } from './queue.js';
import { runTask } from './runner.js';
import { checkDns } from '../modules/deployments/domains.service.js';
import { addLog } from '../modules/deployments/deployments.service.js';

const VERSION = '1.0.0';
const POLL_MS = 3000;
const DNS_RECHECK_MS = 5 * 60_000;

export async function createExecutor(kind = env.implantacao.executor) {
  if (kind === 'linux') return (await import('./executors/linux.js')).createLinuxExecutor();
  if (kind === 'simulado') return (await import('./executors/simulated.js')).createSimulatedExecutor({ falharEm: (process.env.IMPLANTACAO_SIMULAR_FALHA || '').split(',').filter(Boolean) });
  throw new Error(`IMPLANTACAO_EXECUTOR inválido: "${kind}" (use "linux" ou "simulado").`);
}

/** Implantações paradas no passo de DNS: se o apontamento ficou correto, retoma sozinho. */
export async function recheckWaitingDns() {
  const waiting = await db.many(`SELECT i.id, d.nome FROM implantacoes i JOIN dominios d ON d.implantacao_id = i.id
    JOIN implantacao_passos p ON p.implantacao_id = i.id AND p.passo = 'verificar_dns' AND p.status = 'aguardando'
    WHERE i.status = 'aguardando_cliente'
      AND NOT EXISTS (SELECT 1 FROM tarefas_implantacao t WHERE t.implantacao_id = i.id AND t.status IN ('pendente','executando'))`);
  let resumed = 0;
  for (const w of waiting) {
    const r = await checkDns(w.nome).catch(() => null);
    await db.query('UPDATE dominios SET status_dns = $2, ipv4 = $3, ipv6 = $4, dns_verificado_em = now(), mensagem = $5 WHERE implantacao_id = $1',
      [w.id, r?.status_dns || 'erro', r?.ipv4 || [], r?.ipv6 || [], r?.mensagem || 'Falha na consulta.']);
    if (r?.status_dns !== 'ok') continue;
    try {
      await db.query("UPDATE implantacao_passos SET status = 'pendente' WHERE implantacao_id = $1 AND status IN ('aguardando','falhou')", [w.id]);
      const t = await db.one("INSERT INTO tarefas_implantacao (implantacao_id, tipo) VALUES ($1, 'instalar') RETURNING id", [w.id]);
      await db.query("UPDATE implantacoes SET status = 'em_execucao' WHERE id = $1", [w.id]);
      await addLog(db, w.id, 'info', `DNS de ${w.nome} confirmado automaticamente. Instalação retomada (tarefa #${t.id}).`, { tarefaId: t.id });
      resumed++;
    } catch (err) {
      if (err.code !== '23505') throw err; // outra tarefa foi criada no meio tempo
    }
  }
  return resumed;
}

export async function startAgent({ executor, once = false } = {}) {
  const name = `${os.hostname()}-${process.pid}`.slice(0, 80);
  const exec = executor || (await createExecutor());
  let stopping = false;
  let lastDns = 0;
  const stop = () => { stopping = true; console.log('[agente] encerrando após a tarefa atual…'); };
  if (!once) { process.on('SIGTERM', stop); process.on('SIGINT', stop); }
  console.log(`[agente] ${name} iniciado (executor: ${exec.nome}).`);
  if (exec.nome === 'simulado') console.warn('[agente] MODO SIMULADO: nada é alterado no servidor. Use IMPLANTACAO_EXECUTOR=linux em produção.');

  while (!stopping) {
    try {
      await registerAgent(name, exec.nome, VERSION);
      const recovered = await recoverStaleTasks();
      if (recovered) console.log(`[agente] ${recovered} tarefa(s) interrompida(s) devolvida(s) à fila.`);
      if (Date.now() - lastDns > DNS_RECHECK_MS) { lastDns = Date.now(); await recheckWaitingDns(); }
      const task = await claimTask(name);
      if (task) {
        console.log(`[agente] tarefa #${task.id} (${task.tipo}) da implantação ${task.implantacao_id}`);
        await runTask(task, { executor: exec });
        continue;
      }
    } catch (err) {
      console.error('[agente]', err.message);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('agent.js')) {
  startAgent().then(() => closePool()).then(() => process.exit(0)).catch((err) => {
    console.error('[agente] falha fatal:', err);
    process.exit(1);
  });
}
