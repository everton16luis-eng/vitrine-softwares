// Estados padronizados das tarefas/operações (ver docs/central-backup/01-arquitetura.md §4).

export const TASK_STATUS = [
  'pendente', 'na_fila', 'aguardando_agente', 'executando', 'concluido', 'validando', 'validado', 'falhou', 'cancelado', 'restaurando'
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const TASK_ACTIVE: readonly TaskStatus[] = ['na_fila', 'executando', 'restaurando'];
export const TASK_FINAL: readonly TaskStatus[] = ['concluido', 'validado', 'falhou', 'cancelado'];

/** Transições permitidas. Qualquer outra é recusada pelo serviço de tarefas. */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pendente: ['na_fila', 'aguardando_agente', 'cancelado'],
  aguardando_agente: ['na_fila', 'cancelado'],
  na_fila: ['executando', 'restaurando', 'aguardando_agente', 'cancelado', 'falhou'],
  executando: ['concluido', 'validando', 'falhou', 'na_fila', 'cancelado'],
  restaurando: ['concluido', 'validando', 'falhou', 'na_fila', 'cancelado'],
  validando: ['validado', 'falhou'],
  concluido: [],
  validado: [],
  falhou: [],
  cancelado: []
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const SERVER_CONNECTION = ['sem_agente', 'online', 'offline', 'degradado'] as const;
export type ServerConnection = (typeof SERVER_CONNECTION)[number];

export const AGENT_STATUS = ['provisionando', 'ativo', 'revogado'] as const;
export type AgentStatus = (typeof AGENT_STATUS)[number];

export const CLIENT_STATUS = ['ativo', 'suspenso', 'encerrado'] as const;
export type ClientStatus = (typeof CLIENT_STATUS)[number];

/** Atraso de retentativa com backoff exponencial e jitter (ms). */
export function retryDelayMs(attempt: number, { baseMs = 60_000, maxMs = 30 * 60_000, random = Math.random } = {}): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
