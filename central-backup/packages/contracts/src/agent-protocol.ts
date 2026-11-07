// Protocolo entre agente e gateway (/agent/v1). Todas as mensagens são validadas nos dois lados.
import { Type, type Static } from 'typebox';
import { Uuid, IsoDate } from './common.ts';

export const AGENT_PROTOCOL_VERSION = 1;

export const HostFacts = Type.Object({
  hostname: Type.String({ minLength: 1, maxLength: 253 }),
  os_name: Type.String({ maxLength: 100 }),
  os_version: Type.String({ maxLength: 100 }),
  arch: Type.String({ maxLength: 30 }),
  machine_id: Type.Optional(Type.String({ maxLength: 64, pattern: '^[0-9a-fA-F-]*$' }))
}, { additionalProperties: false });
export type HostFacts = Static<typeof HostFacts>;

export const EnrollRequest = Type.Object({
  code: Type.String({ minLength: 20, maxLength: 64 }),
  csr: Type.String({ minLength: 100, maxLength: 4000 }),
  agent_version: Type.String({ maxLength: 30, pattern: '^[0-9A-Za-z.+-]+$' }),
  facts: HostFacts,
  /** chave pública X25519 (PEM) para a central selar segredos destinados a este agente */
  encryption_public_key: Type.Optional(Type.String({ minLength: 50, maxLength: 300 }))
}, { additionalProperties: false });
export type EnrollRequest = Static<typeof EnrollRequest>;

export const EnrollResponse = Type.Object({
  agent_id: Uuid,
  certificate: Type.String(),
  ca_certificate: Type.String(),
  /** chaves públicas Ed25519 para conferir a assinatura das tarefas, por identificador */
  task_signing_keys: Type.Record(Type.String(), Type.String()),
  heartbeat_interval_s: Type.Integer()
});
export type EnrollResponse = Static<typeof EnrollResponse>;

const Num = Type.Number({ minimum: 0 });
const Nullable = <T extends ReturnType<typeof Type.Number>>(t: T) => Type.Union([t, Type.Null()]);
/** Métricas leves coletadas pelo agente (contadores do /proc; nada de varrer disco ou processos). */
export const AgentMetrics = Type.Object({
  at: IsoDate,
  cpu_pct: Nullable(Type.Number({ minimum: 0, maximum: 100 })),
  load: Type.Array(Num, { maxItems: 3 }),
  cpus: Type.Integer({ minimum: 1, maximum: 4096 }),
  mem_total: Num, mem_available: Num,
  swap_total: Num, swap_free: Num,
  disks: Type.Array(Type.Object({
    mount: Type.String({ maxLength: 300 }), fs: Type.String({ maxLength: 40 }), total: Num, used: Num, avail: Num
  }, { additionalProperties: false }), { maxItems: 30 }),
  net_rx_bps: Nullable(Num), net_tx_bps: Nullable(Num),
  failed_units: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
}, { additionalProperties: false });
export type AgentMetrics = Static<typeof AgentMetrics>;

export const HeartbeatRequest = Type.Object({
  agent_version: Type.String({ maxLength: 30, pattern: '^[0-9A-Za-z.+-]+$' }),
  protocol: Type.Integer({ minimum: 1, maximum: 100 }),
  uptime_s: Type.Integer({ minimum: 0 }),
  clock: IsoDate,
  queue: Type.Object({ pending_results: Type.Integer({ minimum: 0 }), running: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  facts: Type.Optional(HostFacts),
  encryption_public_key: Type.Optional(Type.String({ minLength: 50, maxLength: 300 })),
  metrics: Type.Optional(AgentMetrics)
}, { additionalProperties: false });
export type HeartbeatRequest = Static<typeof HeartbeatRequest>;

export const HeartbeatResponse = Type.Object({
  next_interval_s: Type.Integer(),
  has_tasks: Type.Boolean(),
  clock_skew_s: Type.Integer(),
  renew_certificate: Type.Boolean()
});
export type HeartbeatResponse = Static<typeof HeartbeatResponse>;

/** Conteúdo assinado de uma tarefa. O agente confere agent_id, expiração e assinatura. */
export const TaskPayload = Type.Object({
  task_id: Uuid,
  agent_id: Uuid,
  operation: Type.String(),
  operation_version: Type.Integer(),
  params: Type.Unknown(),
  issued_at: IsoDate,
  expires_at: IsoDate,
  timeout_s: Type.Integer(),
  /** segredos selados para a chave do agente (contexto = task_id); nunca em texto claro */
  secrets: Type.Optional(Type.Record(Type.String({ pattern: '^[a-z_]{2,40}$' }), Type.String({ maxLength: 8000 })))
});
export type TaskPayload = Static<typeof TaskPayload>;

/** A assinatura é feita na criação da tarefa (o gateway não tem a chave); a tentativa vai fora dela. */
export const SignedTask = Type.Object({ payload: TaskPayload, signature: Type.String(), key_id: Type.String(), attempt: Type.Integer({ minimum: 1 }) });
export type SignedTask = Static<typeof SignedTask>;

export const TasksResponse = Type.Object({ tasks: Type.Array(SignedTask) });

export const LogLine = Type.Object({
  at: IsoDate, level: Type.Union([Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')]), message: Type.String({ maxLength: 4000 })
}, { additionalProperties: false });

export const TaskProgress = Type.Object({
  attempt: Type.Integer({ minimum: 1 }),
  message: Type.Optional(Type.String({ maxLength: 500 })),
  percent: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  logs: Type.Array(LogLine, { maxItems: 200 })
}, { additionalProperties: false });
export type TaskProgress = Static<typeof TaskProgress>;

export const TaskResult = Type.Object({
  attempt: Type.Integer({ minimum: 1 }),
  status: Type.Union([Type.Literal('ok'), Type.Literal('erro'), Type.Literal('interrompida'), Type.Literal('recusada')]),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String({ maxLength: 4000 })),
  tool: Type.Optional(Type.Object({ name: Type.String({ maxLength: 50 }), version: Type.Optional(Type.String({ maxLength: 50 })), exit_code: Type.Optional(Type.Integer()) }, { additionalProperties: false })),
  started_at: IsoDate,
  finished_at: IsoDate,
  logs: Type.Array(LogLine, { maxItems: 500 })
}, { additionalProperties: false });
export type TaskResult = Static<typeof TaskResult>;

export const RenewRequest = Type.Object({ csr: Type.String({ minLength: 100, maxLength: 4000 }) }, { additionalProperties: false });
export const RenewResponse = Type.Object({ certificate: Type.String(), not_after: IsoDate });

/** Inventário: seções livres, mas com tamanho limitado (o detalhamento cresce por fase). */
export const InventoryUpload = Type.Object({
  collected_at: IsoDate,
  data: Type.Record(Type.String({ maxLength: 40 }), Type.Unknown())
}, { additionalProperties: false });
export type InventoryUpload = Static<typeof InventoryUpload>;
