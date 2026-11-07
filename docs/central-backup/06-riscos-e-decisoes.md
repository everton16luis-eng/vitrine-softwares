# 06 — Riscos técnicos e decisões pendentes

## 1. Riscos

| # | Risco | Impacto | Mitigação proposta |
| --- | --- | --- | --- |
| R1 | Tamanho do escopo (8 fases, 3 aplicações, laboratório) | Atraso ou entregas parciais apresentadas como prontas | Fases com critérios objetivos; nada é anunciado como concluído sem teste no laboratório |
| R2 | Central vira alvo único (acesso a todos os clientes) | Crítico | Separação do site, 2FA, IP/VPN, agentes sem poder de exclusão, aprovação dupla, auditoria encadeada |
| R3 | Perda da chave mestra ou das senhas de repositório | Backups irrecuperáveis | Custódia em 2 lugares, kit de recuperação testado, alerta se o kit estiver desatualizado |
| R4 | Prometheus é *pull*, mas os clientes não aceitam conexões de entrada | Sem métricas | Agente lê node_exporter local e faz *push* via gateway → remote write |
| R5 | Versões diferentes de ferramentas entre distribuições | Backups inconsistentes | Agente distribui binários fixos e verificados (restic); detecta versões de `pg_dump` compatíveis com o servidor; matriz de suporte documentada |
| R6 | pgBackRest/PITR exige mudar `archive_command` do PostgreSQL do cliente | Alteração de configuração de cliente (regra 15) | Operação separada e destrutiva, com autorização explícita por banco; padrão = dump lógico |
| R7 | Carga de backup e monitoramento nos clientes | Degradação de produção | `nice`/`ionice`, limite de banda, janelas, coleta a cada 60 s, testes de carga |
| R8 | Custo e egress de armazenamento externo | Custo inesperado | Dedup do restic, retenção por política, relatório de uso por cliente |
| R9 | Duas bases de código (site JS e central TS) | Mais manutenção | Contratos e padrões documentados; a central não depende do site |
| R10 | Relógio errado em servidores de clientes | Agendamento, TLS e assinaturas falham | Heartbeat compara relógio e alerta; tarefas com tolerância de ±5 min |
| R11 | DR em provedores sem API | Recuperação manual mais lenta | Roteiro manual gerado pelo plano; RTO medido separadamente |
| R12 | Dados pessoais nos backups (LGPD) | Jurídico | Cifragem, retenção acordada em contrato, auditoria de acesso |
| R13 | Desenvolvimento em Windows, alvo Linux | Agente não roda localmente | Laboratório em contêineres/VM Ubuntu; CI em Linux |

## 2. Decisões que dependem da empresa

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| **D1** | Onde fica o código | (a) pasta `central-backup/` neste repositório; (b) repositório próprio | **(b) repositório próprio** — ciclos de versão, CI e acesso diferentes; o site ganha só um link e a sincronização de clientes |
| **D2** | Onde roda a central | (a) mesmo VPS do site; (b) VPS dedicado | **(b) VPS dedicado** (2 vCPU, 4–8 GB RAM no início), em provedor/região diferente dos servidores protegidos — a central tem de sobreviver à queda deles |
| **D3** | Destinos da 1ª versão | rest-server local, S3/MinIO, R2, B2, SFTP/NAS | Fase 2 com **rest-server na central + 1 S3 compatível** (R2 ou B2) |
| **D4** | Clientes | (a) cadastro próprio; (b) sincronizar da vitrine | **(a) próprio + importação opcional** da vitrine (`external_ref`), sem dependência em tempo real |
| **D5** | Gerenciamento de segredos | (a) envelope com chave em arquivo; (b) OpenBao/Vault | **(a) agora**, com interface pronta para (b) quando houver muitos clientes |
| **D6** | Endereços | painel e gateway | ex.: `infra.<seudominio>` (restrito por IP/VPN) e `agentes.<seudominio>` (público, só mTLS) |

## 3. Decisões tomadas (07/11/2026)

| # | Decisão | Consequências no projeto |
| --- | --- | --- |
| D1 | **Pasta `central-backup/` neste repositório**, como aplicação separada | Workspace próprio (pnpm) dentro do repositório; não importa código do site nem compartilha banco, sessão ou usuários. O `package.json` da raiz não muda. CI roda os testes das duas partes |
| D2 | **Mesmo VPS do site** | Seguir as regras de [DEPLOY-VPS.md](../DEPLOY-VPS.md): só arquivos novos de Nginx, nenhuma alteração em sites existentes. Por isso o gateway de agentes **não** usa `stream`/SNI na porta 443 (exigiria mexer na configuração global do Nginx); ele escuta numa porta própria (ex.: **8443**) com mTLS no Node, liberada no firewall. Contêineres com limites de CPU/memória para não disputar recursos com o site. Banco PostgreSQL próprio (contêiner) |
| D3 | **Disco da própria central** (rest-server append-only) como primeiro destino | Simples e imutável para os agentes, mas veja o risco R14 |
| D4 | **Cadastro próprio de clientes**, sem ligação com a vitrine | `external_ref` sai do modelo; nenhum acesso ao banco da vitrine |
| D5 | Envelope com chave em arquivo (recomendação mantida) | — |
| D6 | Endereços: a definir na instalação | Painel num subdomínio restrito; gateway em `agentes.<domínio>:8443` |

**R14 — novo risco, alto.** Com a central e o único destino no mesmo VPS do site, a perda desse VPS
leva junto a central **e** os backups. Isso é crítico para os sistemas que a Central de Implantação
instala nesse mesmo servidor: os backups deles ficariam no próprio disco que se quer proteger.
Mitigação mínima até existir um segundo destino: (a) os servidores **desse** VPS não contam como
protegidos no painel (aviso permanente "cópia no mesmo servidor"); (b) a Fase 2 deixa o modelo de
destinos pronto para incluir um S3/SFTP externo sem migração; (c) recomenda-se fortemente uma cópia
externa (ex.: Backblaze B2 ou Cloudflare R2) antes de usar a central em produção. O cálculo de RPO
considera atendida só a cópia que sobrevive à perda do servidor de origem.

## 4. Próximo passo

Com as decisões D1–D6 tomadas, começa a **Fase 1 — Fundação**: monorepo, banco, autenticação com 2FA,
auditoria, clientes, servidores e todo o ciclo seguro do agente (enrollment, mTLS, heartbeat, fila de
tarefas durável e assinada, fila local, inventário). O dashboard só vem depois, alimentado por dados
reais.
