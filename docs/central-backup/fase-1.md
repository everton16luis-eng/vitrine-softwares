# Fase 1 — Fundação: estado, instalação e testes

Código em [`central-backup/`](../../central-backup). Aplicação separada do site (decisão D1), no
mesmo VPS (D2), com cadastro próprio de clientes (D4).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Monorepo | npm workspaces, TypeScript estrito executado direto pelo Node (≥ 22.18), sem etapa de build | `package.json`, `tsconfig.json` |
| Banco | Migration `0001_fundacao.sql`: usuários, perfis, permissões, sessões, clientes, servidores, inventário, agentes, códigos de instalação, credenciais, fila de tarefas, logs, chaves do sistema, auditoria | `packages/database` |
| Isolamento | Row Level Security em todas as tabelas de cliente + chaves estrangeiras compostas `(id, client_id)`; a aplicação roda como `central_app` (não dona das tabelas) | migration + `pool.ts` |
| Acesso | Login Argon2id, bloqueio após 5 falhas, **2FA TOTP obrigatório** (anti-replay, 10 códigos de recuperação), sessão em cookie HttpOnly/SameSite=Strict, CSRF, expiração por inatividade (30 min) e absoluta (12 h) | `modules/auth.ts`, `http/auth.ts` |
| RBAC | 12 permissões, 4 perfis (admin, engenheiro de infra, operador de backup, auditor), escopo por cliente; quem gerencia usuários não concede o que não tem | `seed.ts`, `modules/users.ts` |
| Auditoria | Somente inclusão (triggers bloqueiam UPDATE/DELETE/TRUNCATE; privilégio revogado), encadeada por SHA-256, verificação `GET /api/v1/audit/verify`; segredos removidos dos detalhes | migration, `audit.ts` |
| Cadastros | Clientes (CNPJ validado, arquivamento lógico), servidores (IPs validados), detalhe e inventário | `modules/records.ts` |
| PKI | CA interna ECDSA P-256; certificado do gateway; certificado por agente (90 dias, renovação automática faltando 30, sobreposição de 24 h); identidade definida pela CA | `packages/security/ca.ts`, `keys.ts` |
| Gateway | HTTPS TLS 1.3 com mTLS na porta 8443; `/enroll` com código de uso único (hash no banco, validade curta); heartbeat; entrega de tarefas; progresso; resultado; inventário; renovação | `gateway/app.ts` |
| Fila de tarefas | PostgreSQL como fonte da verdade; catálogo fechado (`agent.ping`, `inventory.collect`), parâmetros por esquema, **assinatura Ed25519 na criação**, idempotência, lock por recurso, lease, retentativa com backoff, expiração, "aguardando agente" quando offline | `tasks/service.ts`, `contracts/operations.ts` |
| Worker | Manutenção a cada 10 s (lease vencido, prazos, offline, promoção de pendentes) com advisory lock | `worker.ts` |
| Agente | Registro com **CA fixada por SHA-256**, chave privada gerada localmente, heartbeat, busca de tarefas só quando há tarefas, verificação de assinatura/destinatário/validade/catálogo, proteção contra repetição, fila local SQLite de resultados com reenvio, recuperação após queda, renovação do certificado, encerra se revogado | `apps/agent` |
| Instalação do agente | `install.sh` + unit systemd endurecida: usuário próprio sem root, sistema de arquivos somente leitura, CPU 25 %, memória 256 MB, prioridade baixa | `apps/agent/install` |

**Não existe execução de comando livre**: o agente só conhece as operações do catálogo e recusa o
resto; os comandos de coleta são fixos, sem shell, com tempo limite.

## 2. Desvios do plano (05-plano.md) e motivo

| Plano | Feito | Motivo |
| --- | --- | --- |
| pnpm | npm workspaces | o repositório já usa npm; uma ferramenta a menos no VPS |
| Kysely | `pg` com SQL parametrizado | consultas simples e explícitas, compatíveis com `SET LOCAL ROLE`/RLS; menos dependências |
| Vitest | `node:test` | executor nativo, roda TypeScript direto |
| better-sqlite3 | `node:sqlite` | sem compilação nativa nos servidores dos clientes |
| Redis/BullMQ na Fase 1 | adiado para a Fase 3 | a fila durável é o PostgreSQL (fonte da verdade); BullMQ entra se o agendador precisar |
| Nginx stream para o gateway | gateway direto na 8443 | já decidido na Fase 0 (não mexe no Nginx dos outros sites) |

## 3. Preparar a central (Ubuntu, sem interface)

```bash
cd vitrine-softwares/central-backup
npm ci
cp .env.example .env && nano .env        # DATABASE_URL, GATEWAY_HOSTNAMES, GATEWAY_PUBLIC_URL
sudo -u postgres createuser --createrole -P central
sudo -u postgres createdb -O central central_backup
npm run ca:init                           # KEK, migrations, perfis, CA, certificado do gateway, chave de assinatura
npm run admin:create -- --email voce@empresa.com.br --name "Seu Nome"
npm run web:build                         # painel web (apps/web/dist), servido pelo próprio painel
```

Faça uma cópia da KEK (`.data/kek`) **fora do servidor**: sem ela os segredos não podem ser lidos.

Processos (PM2 ou systemd): `npm run start:panel`, `npm run start:gateway`, `npm run start:worker`.
Libere a porta 8443/TCP no firewall para os servidores dos clientes. O painel escuta só em
127.0.0.1:4300 e serve a API e o painel web; para publicar com HTTPS veja
[painel-web.md](painel-web.md) e `deploy/nginx/central-painel.conf.example`.

## 4. Instalar e registrar um agente (VM Ubuntu de teste)

```bash
# no servidor do cliente, com uma cópia de central-backup/ e Node.js >= 22.18
sudo ./apps/agent/install/install.sh
# o painel gera o comando com código, endereço e SHA-256 da CA (POST /api/v1/servers/:id/enrollment-codes)
sudo central-agent enroll --url https://central.exemplo.com.br:8443 --ca-sha256 <hash> --code <código>
sudo systemctl enable --now central-agent
journalctl -u central-agent -f
```

## 5. Testes

```bash
npm run typecheck
npm test            # unitários + integração (precisa de DATABASE_URL_TEST; o banco _test é recriado)
```

- **Unitários (19)**: montagem do painel e do gateway (esquemas, OpenAPI, 401/422), vetores TOTP da RFC 6238, anti-replay, envelope AES-GCM e rotação, Ed25519,
  Argon2id, código de instalação, CA + handshake mTLS real (com e sem certificado, CA estranha),
  JSON canônico, backoff, mascaramento de segredos, catálogo, verificação de tarefas no agente,
  inventário real, fila local.
- **Integração (`tests/integration/fase1.test.ts`)**: login com 2FA e códigos de recuperação, CSRF,
  cadastros e validação, isolamento por RLS (API e banco), RBAC, registro do agente (CA errada
  recusada, código reutilizado recusado), inventário real via tarefa assinada, idempotência,
  offline/online, lease vencido, **reinício da central sem perda de tarefas nem de resultados**,
  revogação (gateway recusa e agente encerra), auditoria encadeada e imutável.

### Resultado (07/11/2026, Windows 11 + PostgreSQL 18 local)

- `npm test`: **29/29** (19 unitários + 10 de integração), repetido 3 vezes sem falhas intermitentes.
- `npm run ca:init` aplicou a migration e gerou as chaves; rodar de novo não troca nenhuma chave.
- Painel, gateway e worker sobem por `main.ts`; o gateway serve a CA com o hash, recusa heartbeat sem
  certificado (401) e conexões em TLS 1.2.
- Defeito encontrado e corrigido pela integração: a validação do corpo rodava antes da autorização,
  então um usuário sem permissão recebia 422 com os campos da rota em vez de 403. Sessão e permissão
  agora rodam em `preValidation`.

## 6. Pendências da Fase 1

- **Teste de aceite numa VM Ubuntu real** (instalador + systemd, registrar, inventário, online/offline,
  revogar, reiniciar a central). O fluxo já passou com o agente real em processo, mas não em Linux
  com a unit systemd.
- Frontend do painel (React/Vite/Tailwind/shadcn): ainda não existe; a Fase 1 entrega a API.
- Docker Compose da central.
- Empacotamento do agente (hoje o instalador copia o código e roda `npm ci`; um pacote único vem depois).
- Revogação vale em até 15 s no gateway (cache de identidade).
- Cancelar tarefa **em execução** responde que ainda não está implementado (só pendentes/na fila).
