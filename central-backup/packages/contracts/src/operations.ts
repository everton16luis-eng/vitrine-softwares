// Catálogo fechado de operações que a central pode pedir a um agente. Não existe operação genérica
// de "executar comando": cada uma tem esquema de parâmetros, permissão, tempo limite e indicação de
// idempotência/destrutividade. Novas operações entram por código revisado e versão nova do agente.
import { Type, type Static, type TSchema } from 'typebox';
import { SAFE_PATH_PATTERN } from './common.ts';

export interface OperationSpec<P extends TSchema = TSchema> {
  name: string;
  version: number;
  params: P;
  /** permissão exigida no painel para solicitar */
  permission: string;
  timeoutSeconds: number;
  idempotent: boolean;
  destructive: boolean;
  /** recurso bloqueado enquanto a operação roda (no máximo uma tarefa ativa por chave) */
  lockKey: (ctx: { agentId: number; serverId: number }, params: Static<P>) => string;
  description: string;
  /** nomes dos segredos que a operação recebe selados (nunca nos parâmetros) */
  secrets?: readonly string[];
  /** criada só pela central (fluxos de backup, restauração, DR), nunca pedida diretamente no painel */
  internal?: boolean;
}

const define = <P extends TSchema>(spec: OperationSpec<P>) => spec;

export const InventoryParams = Type.Object({
  sections: Type.Array(Type.Union([Type.Literal('sistema'), Type.Literal('hardware'), Type.Literal('rede'), Type.Literal('servicos'), Type.Literal('pacotes')]), { minItems: 1, maxItems: 5, uniqueItems: true })
}, { additionalProperties: false });

export const PingParams = Type.Object({ note: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false });

const Engine = Type.Union([Type.Literal('postgresql'), Type.Literal('mysql'), Type.Literal('mariadb'), Type.Literal('sqlite'), Type.Literal('mongodb')]);
const SafePath = Type.String({ minLength: 1, maxLength: 1024, pattern: SAFE_PATH_PATTERN });
const Ident = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.@$-]+$' });
const Host = Type.String({ minLength: 1, maxLength: 253, pattern: '^[A-Za-z0-9.:-]+$' });

/** Como chegar ao banco a partir do agente (sem senha: ela vai selada). */
export const DbTarget = Type.Object({
  engine: Engine,
  host: Type.Optional(Host),
  port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  socket_path: Type.Optional(SafePath),
  db_name: Type.Optional(Ident),
  user: Type.Optional(Ident),
  file_path: Type.Optional(SafePath)
}, { additionalProperties: false });
export type DbTarget = Static<typeof DbTarget>;

export const DiscoverParams = Type.Object({}, { additionalProperties: false });
export const TestConnectionParams = Type.Object({ target: DbTarget }, { additionalProperties: false });

const Tag = Type.String({ pattern: '^[a-z0-9:_.-]{1,80}$' });
const BackupCommon = {
  job_id: Type.Integer({ minimum: 1 }),
  tags: Type.Array(Tag, { maxItems: 10 }),
  limit_upload_kbps: Type.Optional(Type.Integer({ minimum: 64, maximum: 10_000_000 }))
};
/** Padrão de exclusão do restic (glob); sem caracteres de controle. */
const ExcludePattern = Type.String({ minLength: 1, maxLength: 500, pattern: '^[^\\x00-\\x1f]+$' });
export const BackupFilesParams = Type.Object({
  ...BackupCommon,
  paths: Type.Array(SafePath, { minItems: 1, maxItems: 50, uniqueItems: true }),
  excludes: Type.Array(ExcludePattern, { maxItems: 100 })
}, { additionalProperties: false });
export const BackupDbParams = Type.Object({
  ...BackupCommon,
  target: DbTarget,
  /** nome do arquivo do dump dentro do snapshot */
  filename: Type.String({ pattern: '^[A-Za-z0-9._-]{1,120}$' })
}, { additionalProperties: false });
const SnapshotHex = Type.String({ pattern: '^[0-9a-f]{64}$' });
const RestoreCommon = { restore_id: Type.String({ pattern: '^[0-9a-f-]{36}$' }), job_id: Type.Integer({ minimum: 1 }), snapshot: SnapshotHex };
export const RestoreFilesParams = Type.Object({
  ...RestoreCommon,
  includes: Type.Array(SafePath, { maxItems: 50 }),
  /** ausente = diretório temporário do agente; presente = diretório novo ou vazio */
  target_dir: Type.Optional(SafePath),
  /** teste de restauração: confere e apaga o que ESTA execução restaurou (só no temporário do agente) */
  discard: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
export const RestoreDbParams = Type.Object({
  ...RestoreCommon,
  filename: Type.String({ pattern: '^[A-Za-z0-9._-]{1,120}$' }),
  target: DbTarget,
  mode: Type.Union([Type.Literal('novo'), Type.Literal('producao')]),
  new_name: Type.Optional(Type.String({ pattern: '^[a-z][a-z0-9_]{2,62}$' })),
  new_file: Type.Optional(SafePath),
  /** teste de restauração: só em modo "novo" com nome cb_teste_xxxxxxxx; o banco criado é apagado depois de conferido */
  discard: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
/** pgBackRest: o repositório, a cifra e o PGDATA ficam no pgbackrest.conf do servidor; a central só escolhe stanza e tipo */
export const PgbackrestBackupParams = Type.Object({
  run_id: Type.Integer({ minimum: 1 }),
  stanza: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' }),
  type: Type.Union([Type.Literal('full'), Type.Literal('diff'), Type.Literal('incr')])
}, { additionalProperties: false });
export const PgbackrestInfoParams = Type.Object({
  run_id: Type.Integer({ minimum: 1 }),
  stanza: PgbackrestBackupParams.properties.stanza
}, { additionalProperties: false });
/** repositório (URL com credencial de acesso), senha do repositório e variáveis do backend (JSON) */
const REPO_SECRETS = ['repository', 'repo_password', 'repo_env'] as const;

export const OPERATIONS = {
  'agent.ping': define({
    name: 'agent.ping', version: 1, params: PingParams, permission: 'agentes.operar', timeoutSeconds: 30, idempotent: true, destructive: false,
    lockKey: ({ agentId }) => `agent:${agentId}:ping`,
    description: 'Teste de ida e volta: o agente responde com versão, hora local e tamanho da fila.'
  }),
  'inventory.collect': define({
    name: 'inventory.collect', version: 1, params: InventoryParams, permission: 'servidores.editar', timeoutSeconds: 300, idempotent: true, destructive: false,
    lockKey: ({ serverId }) => `server:${serverId}:inventory`,
    description: 'Coleta o inventário do servidor (sistema, hardware, rede, serviços e pacotes).'
  }),
  'db.discover': define({
    name: 'db.discover', version: 1, params: DiscoverParams, permission: 'bancos.editar', timeoutSeconds: 60, idempotent: true, destructive: false,
    lockKey: ({ serverId }) => `server:${serverId}:db-discover`,
    description: 'Procura serviços de banco de dados no servidor (portas, unidades systemd e ferramentas instaladas). Não lê dados.'
  }),
  'db.test_connection': define({
    name: 'db.test_connection', version: 1, params: TestConnectionParams, permission: 'bancos.editar', timeoutSeconds: 60, idempotent: true, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:db-test:${p.target.engine}:${p.target.db_name ?? p.target.file_path ?? ''}`,
    description: 'Testa a conexão com um banco cadastrado e lê versão e tamanho.', secrets: ['password'], internal: true
  }),
  'backup.files': define({
    name: 'backup.files', version: 1, params: BackupFilesParams, permission: 'backups.executar', timeoutSeconds: 6 * 3600, idempotent: true, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:backup:${p.job_id}`,
    description: 'Backup de arquivos e diretórios com restic, com prioridade baixa de CPU e disco.', secrets: REPO_SECRETS, internal: true
  }),
  'backup.db': define({
    name: 'backup.db', version: 1, params: BackupDbParams, permission: 'backups.executar', timeoutSeconds: 6 * 3600, idempotent: true, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:backup:${p.job_id}`,
    description: 'Dump lógico do banco enviado direto ao restic (sem arquivo intermediário); o snapshot só é criado se o dump terminar sem erro.',
    secrets: ['password', ...REPO_SECRETS], internal: true
  }),
  // restauração usa a mesma chave de lock do backup do job: as duas nunca rodam juntas
  'restore.files': define({
    name: 'restore.files', version: 1, params: RestoreFilesParams, permission: 'restauracoes.solicitar', timeoutSeconds: 6 * 3600, idempotent: false, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:backup:${p.job_id}`,
    description: 'Restaura arquivos de um snapshot em diretório novo ou vazio (nunca sobrescreve).', secrets: REPO_SECRETS, internal: true
  }),
  'pgbackrest.backup': define({
    name: 'pgbackrest.backup', version: 1, params: PgbackrestBackupParams, permission: 'backups.executar', timeoutSeconds: 12 * 3600, idempotent: true, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:pgbackrest:${p.stanza}`,
    description: 'Backup físico do PostgreSQL com o pgBackRest do servidor (full/diff/incr), seguido de "check" do arquivamento de WAL e "info".', internal: true
  }),
  'pgbackrest.info': define({
    name: 'pgbackrest.info', version: 1, params: PgbackrestInfoParams, permission: 'backups.ver', timeoutSeconds: 300, idempotent: true, destructive: false,
    lockKey: ({ serverId }, p) => `server:${serverId}:pgbackrest-info:${p.stanza}`,
    description: 'Lê o estado da stanza do pgBackRest (backups, WAL, erros) e confere o arquivamento ("check").', internal: true
  }),
  'restore.db': define({
    name: 'restore.db', version: 1, params: RestoreDbParams, permission: 'restauracoes.solicitar', timeoutSeconds: 6 * 3600, idempotent: false, destructive: true,
    lockKey: ({ serverId }, p) => `server:${serverId}:backup:${p.job_id}`,
    description: 'Restaura um dump em banco novo ou, com dupla aprovação e backup de segurança, por cima do banco de produção.',
    secrets: ['password', ...REPO_SECRETS], internal: true
  })
} as const;

export type OperationName = keyof typeof OPERATIONS;
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];
export const isOperationName = (name: string): name is OperationName => Object.hasOwn(OPERATIONS, name);
