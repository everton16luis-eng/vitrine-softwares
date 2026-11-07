# Fase 8 — Continuidade: testes de restauração, pgBackRest, backup da central e chaves

Código em [`central-backup/`](../../central-backup). Continua a [Fase 7](fase-7.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Migration | `0008_continuidade.sql`: restaurações de teste (`drill`, sem solicitante, só nos modos que não tocam a produção), `restore_test_days` na política, último teste no job, `pgbackrest_stanzas` e `pgbackrest_runs`, `system_backups` (só escopo total), 2 tipos novos de alerta | `packages/database/migrations` |
| Testes periódicos de restauração | Com `restore_test_days` na política, o worker restaura a cada N dias o snapshot validado mais recente de cada job. **Arquivos** vão para o temporário do agente; **bancos** para um banco novo `cb_teste_xxxxxxxx` (SQLite: arquivo no temporário). O agente **confere e descarta só o que a própria execução criou**: recusa descartar em produção ou em nome fora do prefixo reservado. No máximo 3 por rodada; um job com backup ou restauração em andamento espera. O tempo é medido (`duration_s`) | `restores/service.ts`, `agent/operations/restore.ts` |
| pgBackRest | Cadastro de stanza com agenda de **full** e **diff** (cron no fuso do cliente). Execução manual de full/diff/incr ou só consulta (`info`). Cada execução roda o backup, depois o `check` (arquivamento de WAL) e o `info`. Um backup só conta como bom com a stanza com status 0, o último backup do tipo pedido, posterior ao início, sem erro de checksum, e o `check` aprovado. Uma execução por stanza por vez | `pgbackrest/service.ts`, `modules/pgbackrest.ts` |
| pgBackRest no servidor | O agente não tem privilégio (`NoNewPrivileges`, disco somente leitura), então não usa `sudo`. Ele inicia `central-pgbackrest@<stanza>.<tipo>.service` (roda como `postgres`), autorizado por uma regra **polkit** que só permite essa família de unidades, e lê o resultado em `/var/lib/central-pgbackrest/<instância>/`. O repositório e a cifra ficam no `pgbackrest.conf` do servidor; a central só escolhe stanza e tipo | `agent/install/central-pgbackrest@.service`, `49-central-pgbackrest.rules`, `pgbackrest-run.sh` |
| Backup da central | `pg_dump -Fc` do banco da central direto para um repositório restic próprio (`--stdin-from-command`). É validado por `restic check --read-data-subset=10%` e por `pg_restore --list`, que precisa ter tabelas. Agendado (`SELF_BACKUP_SCHEDULE`), manual pela API ou pelo CLI, e com métricas no Prometheus. A KEK **não** vai neste backup | `system/selfbackup.ts`, `modules/system.ts` |
| Kit de recuperação | Arquivo cifrado com **frase-senha** (scrypt N=2¹⁷ + AES-256-GCM). Contém a KEK, o repositório e a senha do backup da central, e a URL e o SHA-256 da CA do gateway. Detecta frase errada e adulteração. A frase vem do terminal sem eco ou de `KIT_PASSPHRASE_FILE`, nunca de argumento | `system/kit.ts`, `cli/central.ts` |
| Rotação de chaves | **KEK**: chave nova acrescentada ao arquivo, com cópia do anterior. Numa transação, recifra as DEKs dos clientes, os segredos da empresa, as chaves privadas da central (CA, TLS do gateway, assinatura de tarefas) e os segredos de 2FA. A KEK antiga **só sai** quando nada mais a usa. **DEK de um cliente**: DEK nova e todos os segredos dele recifrados | `system/rotation.ts`, `secrets.ts` |
| Alertas | `teste_restauracao_falhou` e `pgbackrest_com_erro` (entram no conjunto recomendado, agora com 10 regras) | `alerts/evaluate.ts` |
| Prometheus | `central_restore_test_ok`, `central_restore_test_timestamp_seconds`, `central_pgbackrest_ok`, `central_pgbackrest_last_backup_timestamp_seconds`, `central_self_backup_last_success_timestamp_seconds`, `central_self_backup_last_ok` | `monitoring/metrics.ts` |
| API | `PATCH /backup-policies/:id {restore_test_days}`; `/api/v1/pgbackrest-stanzas` (CRUD, `POST /:id/run {type}`); `GET /api/v1/system/backups`, `POST /api/v1/system/backups/run`, `GET /api/v1/system/keys` (identificadores e contagens, nunca material de chave). A permissão nova `sistema.ver` vale para infra e auditor | |

## 2. Comandos da central (CLI)

No servidor da central, como o usuário do serviço:

```bash
npm run central -- backup
```

```bash
npm run central -- kit criar --saida /root/kit-central.txt
```

```bash
npm run central -- kit abrir --arquivo kit-central.txt --extrair-kek .data/kek --extrair-senha .data/self-backup.pw
```

```bash
npm run central -- chaves uso
```

```bash
npm run central -- chaves rotacionar-kek
```

```bash
npm run central -- chaves aposentar-kek
```

```bash
npm run central -- chaves rotacionar-cliente --cliente 12
```

Rotação da KEK, em ordem:

1. `chaves rotacionar-kek`
2. Reinicie painel, gateway e worker.
3. Gere um **kit novo**.
4. `chaves aposentar-kek`.

## 3. Reerguer a central (perda total do servidor da central)

1. Instale a central numa máquina nova (Fase 1) sem rodar `ca:init`.
2. `npm run central -- kit abrir --arquivo kit.txt --extrair-kek .data/kek --extrair-senha .data/self-backup.pw`.
3. Configure `DATABASE_URL` e `SELF_BACKUP_REPOSITORY` no `.env`; a URL com credencial está no kit.
4. Crie o banco vazio e restaure o dump mais recente:
   ```bash
   restic -r "$SELF_BACKUP_REPOSITORY" --password-file .data/self-backup.pw dump latest /central.dump | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$DATABASE_URL"
   ```
5. `npm run db:migrate` (aplica migrations mais novas, se houver) e `npm run ca:init`, que só **exporta** a CA e o TLS que já estão no banco, sem gerar outros.
6. Suba painel, gateway e worker. Os agentes reconectam sozinhos: a CA e o certificado do gateway são os mesmos.

## 4. Instalação do pgBackRest no servidor do cliente

1. Instale e configure o pgBackRest (`/etc/pgbackrest/pgbackrest.conf`, `stanza-create`,
   `archive_command`) seguindo a documentação oficial.
2. Rode (ou rode de novo) o `install.sh` do agente. Ele detecta o `pgbackrest` e instala a unidade
   auxiliar e a regra polkit.
3. Teste no servidor:
   ```bash
   sudo -u central-agent systemctl start central-pgbackrest@main.info.service && cat /var/lib/central-pgbackrest/main.info/check
   ```
4. Cadastre a stanza no painel com a agenda (ex.: full domingo `0 1 * * 0`, diff nos outros dias `0 1 * * 1-6`).

## 5. Testes

**Unitários** (`tests/unit/fase8.test.ts`, 5 testes):

- **Resumo do `pgbackrest info`**: último backup, WAL, versão; erro de checksum, status ≠ 0, stanza ausente e `check` reprovado.
- **Agente em modo direto**: só stanza e tipo viram argumentos; recusa stanza com `;` e tipo inválido.
- **Agente em modo systemd**: inicia só a unidade `central-pgbackrest@main.full.service`; código ≠ 0 vira erro com o stderr; sem resultado, a mensagem fala de polkit e instalação.
- **Kit**: ida e volta, frase errada, adulteração, frase curta ou repetitiva, e nenhum segredo em claro.
- **Repositório**: exibido sem credencial.

**Integração** (`tests/integration/fase8.test.ts`, 5 testes; agente, restic, rest-server e PostgreSQL reais):

- **Testes de restauração**:
  - desligados por padrão; ligados, criam 3 (arquivos, PostgreSQL, SQLite);
  - não duplicam enquanto estão na fila e não repetem em 7 dias; depois de 8 dias, repetem;
  - o descarte é real: o diretório temporário deixa de existir e o banco `cb_teste_*` some do `pg_database`;
  - o agente recusa descartar banco fora do prefixo reservado ou em modo produção.
- **Teste que falha** (restic ausente no servidor): as 3 execuções falham, o job fica com `falhou`, 3 incidentes abrem e a métrica fica em 0.
- **pgBackRest**: a operação do agente é a real; só a execução da unidade auxiliar é simulada.
  - Cadastro: validação (stanza e cron) e 409 de duplicata.
  - Execução: backup manual full, depois um único por vez; diff agendado disparado pelo worker, com próximo horário recalculado.
  - Falhas: `check` do WAL reprovado → erro; backup com código 56 → execução falhou, com alerta e métrica em 0.
  - Isolamento entre clientes.
- **Backup da central**:
  - **validado** em repositório real; a API mostra o repositório sem a senha;
  - **restaurado de verdade** num banco novo, com as mesmas contagens de `clients`, `backup_snapshots`, `secrets` e `system_keys`;
  - com a KEK, a DEK do cliente no banco restaurado abre.
- **Rotação**:
  - DEK do cliente: tudo recifrado, mesmos valores, backup validado depois.
  - KEK: só a nova em uso (incluindo os segredos de 2FA); a antiga é aposentada, com cópia de segurança.
  - **A central reinicia com a KEK nova**: login com 2FA, `/system/keys` sem pendência e backup de PostgreSQL validado.

Problemas reais que os testes pegaram e que foram corrigidos:
- **Segredos de 2FA fora da rotação**: aposentar a KEK quebraria o login de todos.
- **Descarte no Windows**: o restic restaura ACL e atributos das pastas de origem, então o agente redefine as permissões da própria cópia antes de apagar.
- **Arquivo da KEK no Windows**: somente leitura não pode ser substituído.

## 6. Limitações

| Item | Situação |
| --- | --- |
| pgBackRest real | **Não executado aqui** (não roda em Windows). O formato do `info` segue a documentação 2.x. A unidade auxiliar, o script e a regra polkit precisam ser testados no Ubuntu |
| polkit antigo | Ubuntu 22.04 (polkit 0.105) não lê regras JS. Use `PGBACKREST_MODE=direto` só se o agente rodar como `postgres`, ou atualize o sistema |
| Restauração com pgBackRest | O painel não restaura backups do pgBackRest (PITR é feito com `pgbackrest restore` no servidor, parando o PostgreSQL) |
| Testes de MySQL/MongoDB | O descarte usa `DROP DATABASE`/`mongosh`; não testados aqui |
| Backup da central fora da máquina | A central aceita qualquer repositório restic. Se for o rest-server da própria máquina, o backup **não** protege contra perda do disco |
| Kit | Precisa ser gerado de novo a cada rotação de KEK |
