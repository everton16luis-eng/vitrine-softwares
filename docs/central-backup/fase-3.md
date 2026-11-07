# Fase 3 — Políticas, jobs, execução, verificação e retenção

Código em [`central-backup/`](../../central-backup). Continua a [Fase 2](fase-2.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Migration | `0003_backups.sql`: `backup_policies`, `backup_jobs`, `backup_runs`, `backup_snapshots`, uso e manutenção em `backup_repositories`; RLS; a aplicação não tem `DELETE` nessas tabelas (snapshot removido fica registrado como `removido`) | `packages/database/migrations` |
| Políticas | Agenda cron de 5 campos **no fuso do cliente**, intervalo mínimo de 15 min, retenção (`keep_last` ≥ 1, horária, diária, semanal, mensal, anual), porcentagem dos dados lida na verificação, limite de upload | `backups/cron.ts`, `modules/backups.ts` |
| Jobs | Arquivos (caminhos ou diretórios de uma aplicação cadastrada, com exclusões) ou banco cadastrado. Só aceita **destino já testado com sucesso**; criar o job prepara o repositório do servidor | `modules/backups.ts` |
| Agenda | O worker transforma jobs vencidos em execuções. O horário agendado é único por job, então dois workers ou um reinício não disparam duas vezes. Depois de uma parada longa roda **uma vez**, sem rajada | `backups/service.ts` (`scheduleDue`) |
| Execução no agente | `backup.files` e `backup.db`, operações internas do catálogo. Repositório, senha e credenciais chegam selados; a senha vai por arquivo 0600. restic com `nice 19` (e a unit aplica CPU 25 % e IO idle) | `apps/agent/src/operations/backup.ts` |
| Bancos | `pg_dump -Fc`, `mysqldump`/`mariadb-dump --single-transaction` e `mongodump --archive --gzip` rodam via `restic --stdin-from-command`: **se o dump falhar, nenhum snapshot é criado**. SQLite usa cópia consistente (`VACUUM INTO`). Senhas por variável de ambiente ou arquivo 0600, nunca na linha de comando | idem |
| Verificação | Feita pela **central**, não pelo servidor do cliente. Um snapshot só vira `validado` depois de três etapas: (1) o snapshot existe no repositório; (2) `restic check --read-data-subset=N%`; (3) o conteúdo confere. Para arquivos, a contagem bate com o que o agente enviou. Para bancos, o dump é extraído e lido por `pg_restore --list`, pelo cabeçalho e rodapé do mysqldump, pelo cabeçalho do archive do mongodump ou pelo `integrity_check` do SQLite. `concluido` não conta como sucesso: o job só registra `last_success_at` com o snapshot validado | `backups/verify.ts` |
| Retenção | Calculada pela central. Só snapshots validados ocupam vagas. Retenção legal nunca sai. O validado mais recente nunca sai. Não verificados nunca saem. Um snapshot que falhou na verificação só sai quando existe um validado mais novo. O `forget` roda com as linhas travadas (uma retenção legal concorrente espera) e depois vem o `prune`. Tudo é auditado | `backups/retention.ts`, `backups/maintenance.ts` |
| Uso | `restic stats --mode raw-data` após a retenção → `size_bytes` do repositório | `maintenance.ts` |
| API | Políticas (CRUD), jobs (CRUD, executar agora, arquivar), execuções (lista, detalhe com logs do agente), snapshots (lista, retenção legal com motivo obrigatório, nova verificação), repositórios (uso) | `modules/backups.ts` |

## 2. Testes

`npm test`: **56/56**. `npm run typecheck`: sem erros.

- **Unitários** (`tests/unit/backups.test.ts`, 7 testes):
  - cron: fuso, passos, listas, semântica OU entre dia do mês e dia da semana, entradas inválidas e intervalo mínimo;
  - retenção: últimos N, diária, semanal e mensal, retenção legal, não verificados, falhas de verificação, nunca remover o único validado.
- **Integração** (`tests/integration/fase3.test.ts`, 9 testes, com restic 0.19.1, rest-server append-only, PostgreSQL 18 e SQLite **reais**):
  - Política inválida recusada (agenda curta demais, fuso inexistente, `keep_last` 0).
  - Job recusado enquanto o destino não foi testado; a próxima execução às 03:00 de São Paulo cai às 06:00 UTC.
  - Backup de arquivos real:
    - 4 arquivos, com o `.log` excluído;
    - o resultado fica `concluido` e só passa a `validado` depois da verificação da central;
    - nenhum segredo do repositório aparece na API, nas tarefas ou nos logs.
  - Agenda: um job vencido dispara uma única vez e a próxima execução vem da política.
  - PostgreSQL real:
    - com a senha errada, o dump falha e **nenhum snapshot é criado**;
    - com a senha certa, o snapshot é validado pelo `pg_restore --list` na central;
    - a senha não aparece em lugar nenhum.
  - SQLite real: cópia consistente validada por `integrity_check`.
  - Retenção com `keep_last: 1` e três snapshots, com o mais antigo em retenção legal:
    - sai **só o do meio**, removido de verdade do repositório;
    - o operador sem a permissão recebe 403;
    - pedir retenção legal do snapshot removido devolve 409;
    - o uso do repositório é medido e a operação é auditada.
  - Isolamento: o usuário de outro cliente não vê nem executa nada e não cria política da empresa.
  - **Corrupção real de um pack**: a nova verificação reprova (`falha_verificacao`).

## 3. Instalação no Ubuntu

### Central

1. Instale o restic ≥ 0.17 (o pacote do Ubuntu 24.04 é 0.16) e o rest-server, binários oficiais.
   Confira cada um pelo `SHA256SUMS` da release:

   ```bash
   cd /tmp
   curl -LO https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2
   curl -LO https://github.com/restic/restic/releases/download/v0.19.1/SHA256SUMS
   grep restic_0.19.1_linux_amd64.bz2 SHA256SUMS | sha256sum -c -
   bunzip2 restic_0.19.1_linux_amd64.bz2
   sudo install -m 0755 restic_0.19.1_linux_amd64 /usr/local/bin/restic
   ```

   O rest-server é instalado do mesmo jeito (release v0.14.0 de `restic/rest-server`), em
   `/usr/local/bin/rest-server`.
2. Instale `postgresql-client` (o `pg_restore` verifica os dumps de PostgreSQL).
3. Crie o diretório dos repositórios (dono é o usuário `central`, o mesmo do worker):

   ```bash
   sudo install -d -o central -g central -m 0700 /srv/central-backup/repos
   sudo -u central touch /srv/central-backup/repos/.htpasswd
   ```

4. Instale e ative a unit do rest-server:

   ```bash
   sudo cp deploy/systemd/central-rest-server.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now central-rest-server
   ```

   O rest-server escuta em `127.0.0.1:8000`. Os agentes precisam de HTTPS: publique-o com um
   proxy TLS próprio (uma porta dedicada, sem alterar os sites existentes) e use esse endereço como
   `agent_url` no destino.
5. O worker (`npm run start:worker`) agora carrega a KEK: ele cria as execuções agendadas, verifica
   e aplica a retenção. Rode **uma** instância (há advisory lock, mas uma basta).

> Correção da Fase 2: o rest-server roda como o mesmo usuário da central (e não como um usuário
> separado), porque a central faz `forget`/`prune` direto no disco e o restic cria os arquivos com
> permissão 0600.

### Servidor do cliente (agente)

- Instale o restic ≥ 0.17 (o mesmo procedimento). O `install.sh` avisa se ele faltar ou for antigo.
- Para bancos: `postgresql-client` na versão do servidor, `mysqldump` ou `mariadb-dump`, `mongodump` (mongodb-database-tools).
- A unit do agente ganhou `CAP_DAC_READ_SEARCH`: ele **lê** qualquer arquivo para o backup, mas
  continua sem escrita fora do diretório de estado e sem root. A memória máxima subiu para 1 GB
  (o restic usa memória proporcional ao índice).

## 4. Limitações conhecidas

| Item | Situação |
| --- | --- |
| MySQL/MariaDB e MongoDB | Código de dump e de verificação pronto, **não executado** (sem esses bancos aqui); validar no Ubuntu |
| Linux | Tudo foi verificado no Windows de desenvolvimento; repetir `npm test` no Ubuntu e o aceite em VM |
| Verificação | Roda no worker, uma por vez; para repositórios grandes ajuste `verify_subset_percent` (o check lê essa fração dos dados a cada verificação) |
| Cancelar backup em andamento | Ainda não: a tarefa termina ou atinge o tempo limite (6 h) |
| S3 | Mesma credencial para o agente e a manutenção (veja a Fase 2) |
| Telas | Endpoints prontos; telas na etapa do frontend |
| BullMQ/Redis | Não usado: a agenda e a fila continuam no PostgreSQL (fonte da verdade), com locks e idempotência. Um broker extra não traria garantia nova, por isso não entrou |
