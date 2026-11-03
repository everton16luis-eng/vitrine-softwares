// Fila de tarefas no PostgreSQL (FOR UPDATE SKIP LOCKED): vários agentes podem
// rodar ao mesmo tempo sem pegar a mesma tarefa.
import { db } from '../database/pool.js';
import { addLog } from '../modules/deployments/deployments.service.js';

export const STALE_SECONDS = 120;
export const MAX_ATTEMPTS = 3;

export async function registerAgent(name, executor, versao) {
  await db.query(`INSERT INTO agentes_implantacao (nome, executor, versao, visto_em) VALUES ($1,$2,$3,now())
    ON CONFLICT (nome) DO UPDATE SET executor = EXCLUDED.executor, versao = EXCLUDED.versao, visto_em = now()`, [name, executor, versao]);
}

export async function claimTask(agentName) {
  return db.one(`UPDATE tarefas_implantacao SET status = 'executando', iniciada_em = now(), heartbeat_em = now(), agente = $1, tentativas = tentativas + 1
    WHERE id = (SELECT id FROM tarefas_implantacao WHERE status = 'pendente' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`, [agentName]);
}

export const heartbeat = (taskId) => db.query("UPDATE tarefas_implantacao SET heartbeat_em = now() WHERE id = $1 AND status = 'executando'", [taskId]);

export async function finishTask(taskId, status, erro = null) {
  await db.query('UPDATE tarefas_implantacao SET status = $2, erro = $3, finalizada_em = now() WHERE id = $1', [taskId, status, erro]);
}

/**
 * Tarefas cujo agente parou de dar sinal (queda, reinício do servidor): voltam para a
 * fila e são retomadas do último passo concluído. Depois de MAX_ATTEMPTS, falham.
 */
export async function recoverStaleTasks() {
  const stale = await db.many(`SELECT id, implantacao_id, tentativas FROM tarefas_implantacao
    WHERE status = 'executando' AND heartbeat_em < now() - make_interval(secs => $1)`, [STALE_SECONDS]);
  for (const t of stale) {
    const giveUp = t.tentativas >= MAX_ATTEMPTS;
    await db.query("UPDATE implantacao_passos SET status = $2 WHERE implantacao_id = $1 AND status = 'executando'", [t.implantacao_id, giveUp ? 'falhou' : 'pendente']);
    if (giveUp) {
      await finishTask(t.id, 'falhou', 'Execução interrompida repetidamente.');
      await db.query("UPDATE implantacoes SET status = 'falhou' WHERE id = $1", [t.implantacao_id]);
      await addLog(db, t.implantacao_id, 'erro', `Tarefa #${t.id} interrompida ${t.tentativas} vezes; marcada como falha. Verifique o servidor e reexecute.`, { tarefaId: t.id });
    } else {
      await db.query("UPDATE tarefas_implantacao SET status = 'pendente', agente = NULL WHERE id = $1", [t.id]);
      await addLog(db, t.implantacao_id, 'aviso', `Tarefa #${t.id} foi interrompida (agente sem resposta). Ela será retomada a partir do último passo concluído.`, { tarefaId: t.id });
    }
  }
  return stale.length;
}
