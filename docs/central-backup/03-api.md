# 03 — API e protocolo do agente

Contratos escritos uma vez em `packages/contracts` com **TypeBox** (JSON Schema): o Fastify valida
entrada e saída e gera a especificação **OpenAPI 3.1** (`/api/v1/docs`, só para usuários autenticados),
o agente e o frontend usam os mesmos tipos.

## 1. Convenções

- Prefixo e versão: `/api/v1/...` (painel) e `/agent/v1/...` (agentes, só no gateway com mTLS).
- Paginação por cursor: `?limit=50&cursor=...` → `{ items, next_cursor }`. Filtros por query string
  validados por esquema; ordenação só por colunas permitidas.
- **Idempotência**: todo `POST` que cria operação aceita `Idempotency-Key` (guardado 24 h; repetir a
  chave devolve a mesma resposta).
- Erros padronizados (RFC 9457 *problem details*):
  `{ "type": "…/validacao", "title": "Verifique os campos", "status": 422, "code": "VALIDACAO", "fields": { "port": "…" }, "request_id": "…" }`.
- Concorrência otimista: recursos editáveis retornam `ETag`; `PUT/PATCH` exigem `If-Match`.
- Autenticação do painel por cookie de sessão `HttpOnly; Secure; SameSite=Strict` + cabeçalho CSRF.

## 2. Painel — `/api/v1`

| Módulo | Endpoints (resumo) | Permissão |
| --- | --- | --- |
| `auth` | `POST /auth/login`, `POST /auth/mfa/verify`, `POST /auth/mfa/setup`, `POST /auth/logout`, `GET /auth/me`, `GET/DELETE /auth/sessions/:id` | — |
| `users` / `roles` | CRUD de usuários, perfis e escopo de clientes | `usuarios.gerenciar` |
| `clients` | `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/archive` | `clientes.*` |
| `servers` | `GET/POST /servers`, `GET/PATCH /servers/:id`, `GET /servers/:id/{inventory,services,storage,history}` | `servidores.*` |
| `agents` | `POST /servers/:id/enrollment-codes`, `GET /agents`, `GET /agents/:id`, `POST /agents/:id/revoke`, `POST /agents/:id/update` (operação `agent.update` autorizada), `GET /agents/:id/{tasks,logs}` | `agentes.*` |
| `databases` | CRUD, `PUT /databases/:id/credential` (só escrita), `POST /databases/:id/test-connection`, `POST /servers/:id/discover-databases` | `bancos.*`, `segredos.gerenciar` |
| `applications` | CRUD, `PUT /applications/:id/recovery-profile` | `aplicacoes.*` |
| `storage` | CRUD de destinos, `POST /storage/:id/test`, `GET /storage/:id/usage` | `armazenamento.*` |
| `backups` | políticas, jobs, `POST /backups/jobs/:id/run` (manual), `GET /backups/executions`, `POST /backups/executions/:id/cancel`, `GET /backups/snapshots`, `POST /backups/snapshots/:id/{verify,hold,release}` | `backups.*` |
| `restores` | `POST /restores/preview` (consequências), `POST /restores`, `POST /restores/:id/approve`, `POST /restores/:id/cancel`, `GET /restores/:id` | `restauracoes.solicitar`, `restauracoes.aprovar`, `restaurar.producao` |
| `monitoring` | `GET /monitoring/servers/:id/series?metric=&from=&to=&step=` (PromQL montado no servidor, nunca recebido do cliente), `GET /monitoring/overview` | `monitoramento.ver` |
| `alerts` | `GET /alerts`, `POST /alerts/:id/{ack,resolve}`, CRUD de regras e canais | `alertas.*` |
| `disaster-recovery` | perfis, `POST /dr/plans` (gera plano), `POST /dr/jobs`, `POST /dr/jobs/:id/approve`, `GET /dr/jobs/:id/report`, metas RPO/RTO | `dr.*` |
| `audit` | `GET /audit` (filtros), `GET /audit/verify` (confere a cadeia de hash) | `auditoria.ver` |
| `reports` | relatórios de conformidade de backup, RPO/RTO, uso de armazenamento (CSV/PDF) | `relatorios.ver` |
| `system` | `GET /system/health` (central se monitora), configurações | `configuracoes.*` |

Operações longas respondem `202 Accepted` com o recurso da tarefa; o andamento chega por consulta
ou por **SSE** (`GET /api/v1/events`, filtrado pelo escopo do usuário).

## 3. Agente — `/agent/v1` (mTLS)

| Endpoint | Uso |
| --- | --- |
| `POST /enroll` | único endpoint sem certificado de cliente: `{ code, csr, host_fingerprint, facts }` → certificado + CA + chave pública de assinatura de tarefas. Limitado por IP e por código |
| `POST /heartbeat` | `{ version, uptime_s, queue: { pending, results_unsent }, clock }` → `{ next_interval_s, has_tasks, update?: { version, url, sha256, signature } }` |
| `GET /tasks?wait=25` | long-poll; devolve até N tarefas assinadas para **este** agente |
| `POST /tasks/:id/progress` | `{ seq, percent?, message, logs[] }` — renova o lease |
| `POST /tasks/:id/result` | `{ attempt, status: "ok" \| "erro" \| "interrompida", result, error?, tool: { name, version, exit_code }, logs[] }` com `Idempotency-Key = task_id:attempt` |
| `POST /metrics` | lote compactado de amostras `{ metric, labels, value, ts }[]` → remote write |
| `POST /inventory` | inventário completo ou diff; segredos detectados são enviados cifrados para a chave pública da central |
| `POST /certificates/renew` | CSR novo → certificado novo; o anterior vale até o fim da sobreposição (24 h) |

O gateway identifica o agente **pelo certificado**, nunca por campo do corpo, e só aceita `task_id`
que pertença a ele.

## 4. Catálogo de operações (versão 1)

Cada operação: nome, versão, esquema de parâmetros, permissão exigida no painel, se precisa do
auxiliar root, tempo limite, se é idempotente, se é destrutiva (exige aprovação).

| Operação | Root? | Destrutiva? |
| --- | --- | --- |
| `inventory.collect`, `metrics.collect`, `services.status` | leitura (auxiliar) | não |
| `db.discover`, `db.test_connection`, `db.stats` | não | não |
| `backup.files.restic` | leitura via `CAP_DAC_READ_SEARCH` | não |
| `backup.postgres.dump`, `backup.postgres.pgbackrest` | executa como usuário `postgres` via auxiliar | não |
| `backup.mysql.dump`, `backup.mysql.physical`, `backup.sqlite.online`, `backup.mongodb.dump` | conforme acesso | não |
| `verify.restic.check`, `verify.dump.list`, `verify.restore_test` (em diretório/banco temporário) | auxiliar | não |
| `restore.files`, `restore.database` (alvo temporário) | auxiliar | não |
| `restore.files.production`, `restore.database.production` | auxiliar | **sim** — aprovação dupla |
| `dr.bootstrap` (`ansible-pull` de pacote assinado) | auxiliar | **sim** (servidor novo vazio) |
| `pgbackrest.configure` (altera `archive_command` do cliente) | auxiliar | **sim** — mexe em configuração do cliente, exige autorização explícita |
| `agent.update` | auxiliar | não (pacote assinado, rollback automático) |

Não existe operação genérica de "executar comando". Novas operações entram por código revisado e
versão nova do agente.
