# 05 — Estrutura, plano por fases, testes e critérios de aceitação

## 1. Estrutura do monorepo

Workspaces do **pnpm**, Node.js **22 LTS**, TypeScript estrito, ESLint + Prettier.

> Ajustado na Fase 1 (npm workspaces, `pg`, `node:test`, `node:sqlite`, BullMQ adiado): ver
> [fase-1.md § 2](fase-1.md#2-desvios-do-plano-05-planomd-e-motivo).

```
central-backup/
  apps/
    api/            Fastify — modos painel | gateway | worker (src/modules/<módulo>/{routes,service,repo,schemas}.ts)
    web/            React + Vite + Tailwind + shadcn/ui + React Router + TanStack Query + Recharts
    agent/          agente Linux (src/{transport,queue,operations,tools,helper}) + unidade systemd + instalador
  packages/
    contracts/      esquemas TypeBox: API, protocolo do agente, catálogo de operações
    shared/         erros, estados, utilitários de tempo/cron, logger (pino)
    security/       envelope de segredos, assinatura Ed25519, CA/CSR, Argon2id, TOTP
    database/       migrations SQL versionadas, Kysely (tipos gerados), seeds de perfis/permissões
  infrastructure/
    docker/         Dockerfiles, docker-compose.yml (+ compose.test.yml com MinIO, rest-server e "laboratório")
    nginx/          painel (http) e gateway (stream/SNI)
    prometheus/     configuração com remote-write receiver e retenção
    ansible/        playbooks/ e roles/ dos perfis de reconstrução
  scripts/          instalação da central, backup da central, kit de recuperação
  docs/
  tests/            e2e (Playwright) e cenários de laboratório
```

Escolhas que o escopo deixou em aberto: **Kysely** (SQL tipado sem ORM pesado), **TypeBox** (esquema
único para Fastify/OpenAPI), **pino** (logs JSON), **Recharts** (gráficos), **Vitest** (testes),
**Playwright** (ponta a ponta), **better-sqlite3** (fila local do agente). Todas mantidas ativamente.

## 2. Fases

Cada fase termina com: testes passando, integração com as fases anteriores verificada,
documentação atualizada e relatório do que foi concluído e do que ficou pendente.

| Fase | Entrega | Pronto quando |
| --- | --- | --- |
| **0** (esta) | Arquitetura, modelo de dados, contratos, segurança, plano, riscos | Aprovada pela empresa, decisões D1–D6 tomadas |
| **1 — Fundação** | Monorepo, Docker Compose, migrations, login Argon2id + 2FA, sessões, RBAC, auditoria append-only, clientes, servidores, **CA interna, código de instalação, enrollment mTLS, heartbeat, fila durável de tarefas com lease/lock/idempotência/assinatura, agente com fila local e `inventory.collect`** | Um agente real (VM Ubuntu de teste) se registra, envia inventário, fica online/offline corretamente, é revogado e para de ser aceito; reiniciar central e Redis não perde tarefas |
| **2 — Cadastros** | Bancos (descoberta + teste de conexão + segredos por envelope), aplicações, serviços, destinos de armazenamento (rest-server local, S3/MinIO, SFTP) com teste | Teste de conexão real para PostgreSQL/MySQL/SQLite/Mongo no laboratório; nenhum segredo aparece em API/log |
| **3 — Motor de backup** | Políticas, agendador, jobs, execuções, restic (arquivos) e dumps lógicos, várias cópias, verificação, retenção/prune central, histórico | Backups agendados rodam, falhas e retentativas são registradas, só verificados viram "validado", prune respeita dependências e hold |
| **4 — Restauração** | Assistente, alvo temporário, produção com aprovação dupla e backup de segurança, arquivos/diretórios/bancos | Restauração temporária e na produção (laboratório) validadas automaticamente |
| **5 — Monitoramento** | node_exporter + coleta do agente, remote write, gráficos 1 h/24 h/7 d/30 d/personalizado, métricas de bancos e serviços, dashboard com dados reais | Gráficos batem com o servidor; carga do agente < 1% de CPU em média |
| **6 — Alertas e relatórios** | Regras, deduplicação, supressão, ack/resolve, e-mail, interface WhatsApp, relatórios, auditoria avançada | Todos os alertas da lista disparam e resolvem no laboratório |
| **7 — Disaster Recovery** | Inventário completo, perfis Ansible, cloud-init, planos, compatibilidade, recuperação manual e via API de 1 provedor, RPO/RTO | Servidor de laboratório destruído e reconstruído a partir do plano |
| **8 — Endurecimento** | pgBackRest/PITR, backup físico MySQL, testes periódicos de recuperação, backup da central, kit de recuperação, rotação de chaves, revisão de segurança, documentação final | Teste de desastre da própria central executado com sucesso |

## 3. Estratégia de testes

- **Unitários** (Vitest): validação de esquemas, máquina de estados, cálculo de próximos
  agendamentos, retenção e dependências, RPO/RTO, envelope de segredos, assinatura de tarefas,
  máscara de logs, deduplicação de alertas.
- **Integração** (Vitest + `compose.test.yml`): PostgreSQL e Redis descartáveis por execução, API real
  com Fastify `inject`, gateway com certificados de teste, worker real. Cobre todos os itens
  obrigatórios do escopo, inclusive **isolamento entre clientes** (cada rota é testada com usuário de
  escopo restrito e IDs de outro cliente), recuperação de tarefas após reinício e Redis indisponível.
- **Laboratório** (contêineres Ubuntu com systemd + PostgreSQL, MySQL, MariaDB, MongoDB, SQLite e uma
  aplicação Node/PHP de exemplo): agente real executando backup → verificação → restauração em
  temporário → restauração na "produção" do laboratório → reconstrução DR.
- **Ponta a ponta** (Playwright): login com 2FA, cadastro de cliente/servidor, geração de código,
  política, execução manual, assistente de restauração com aprovação de outro usuário.
- **Falhas injetadas**: queda do agente no meio do backup, rede intermitente, destino S3 fora do ar,
  disco cheio, ferramenta retornando erro, relógio defasado, certificado revogado/vencido.
- Nunca dados de produção: tudo gerado pelos testes; bancos com sufixo `_test` obrigatório.

## 4. Critérios de aceitação gerais

1. Nenhuma tela mostra número fictício; vazio é mostrado como vazio.
2. Nenhum botão sem efeito real; o que não existe aparece rotulado como "não implementado".
3. Nenhum segredo em texto puro no banco, na API, em logs, na auditoria ou em inventários.
4. Nenhum acesso cruzado entre clientes nos testes automatizados.
5. Nenhum backup marcado como válido sem verificação; nenhum erro de ferramenta ignorado.
6. Nenhuma exclusão de snapshot com dependentes ou em hold; agentes não conseguem apagar backups.
7. Restaurações destrutivas só com confirmação reforçada e aprovação de outra pessoa.
8. Central, Redis ou agente reiniciados não perdem nem duplicam tarefas.
9. Toda ação administrativa importante aparece na auditoria, e a verificação da cadeia passa.
10. Documentação de instalação, operação e recuperação suficiente para outra pessoa da equipe.
