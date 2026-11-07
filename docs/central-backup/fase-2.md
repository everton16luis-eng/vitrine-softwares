# Fase 2 — Cadastros, segredos e destinos de armazenamento

Código em [`central-backup/`](../../central-backup). Continua a [Fase 1](fase-1.md).

## 1. O que foi construído

| Área | Entrega | Onde |
| --- | --- | --- |
| Migration | `0002_cadastros.sql`: `client_keys`, `secrets`, `databases`, `applications`, `application_databases`, `backup_destinations`, `backup_repositories`; RLS em todas; itens da empresa (`client_id` nulo) exigem escopo total | `packages/database/migrations` |
| Permissões | Catálogo completo de todas as fases (bancos, segredos, aplicações, armazenamento, backups, restaurações, monitoramento, alertas, DR, relatórios). Os perfis padrão só recebem a permissão quando ela é criada; mudanças feitas por um administrador são mantidas | `seed.ts` |
| Segredos | Criptografia em envelope: KEK (arquivo) → DEK por cliente (AES-256-GCM) → segredo. A API **nunca devolve** um segredo; credenciais são só de escrita (`PUT …/credential` → 204). `rewrapAll` já existe para a rotação da KEK (Fase 8) | `apps/api/src/secrets.ts` |
| Entrega ao agente | O agente gera um par X25519 (`seal-key.pem`) e envia a chave pública no registro ou no heartbeat. O segredo da tarefa é selado (X25519 + HKDF-SHA256 + AES-256-GCM) com o contexto `task:<id>`, faz parte do payload assinado e só abre naquele agente e naquela tarefa | `packages/security/src/seal.ts`, `tasks/service.ts` |
| Bancos | Cadastro por motor (PostgreSQL, MySQL, MariaDB, SQLite, MongoDB) com validação de formato; teste real de conexão feito **pelo agente** (versão, tamanho, erro); descoberta de ferramentas, portas e clusters no servidor | `modules/catalog.ts`, `apps/agent/src/operations/db.ts` |
| Aplicações | Diretórios de instalação e dados, arquivos de configuração e exclusões (todos validados como caminhos absolutos sem `..`), unit systemd, domínios, RPO/RTO desejados, vínculo com bancos do mesmo servidor | `modules/catalog.ts` |
| Destinos | `local_rest`: disco da central servido pelo **rest-server em `--append-only --private-repos`** (obrigatoriamente imutável). `s3`: AWS, MinIO, R2, B2 ou outro compatível. O teste é real: `restic init` + leitura em um repositório descartável, espaço livre e, no local, a resposta 401 do rest-server | `storage/destinations.ts`, `modules/storage.ts` |
| Repositórios | Um repositório restic por servidor × destino, com senha própria gerada pela central. No local, cada servidor tem usuário próprio no `.htpasswd` e só alcança `/<usuário>/…`. A central inicializa e faz a manutenção direto no disco | `ensureRepository` |
| Operações novas | `db.discover` (pedido pelo painel) e `db.test_connection` (interna: só a central cria, com a senha selada) | `contracts/src/operations.ts` |

## 2. Testes

`npm test` (PostgreSQL de testes, restic 0.19.1 e rest-server 0.14.0 reais): **40/40**.
`npm run typecheck`: sem erros.

Fase 2 (`tests/integration/fase2.test.ts`, 10 testes):

- validação de bancos por motor;
- **PostgreSQL real**: com senha errada o teste dá erro; com a certa dá ok, com versão e tamanho. A senha não aparece na API, nas tarefas, nos logs, na auditoria nem na tabela de segredos;
- segredo selado não abre com outro contexto de tarefa nem com a chave de outro agente;
- SQLite real (`quick_check` e cabeçalho do arquivo);
- descoberta encontra as ferramentas instaladas;
- operações internas recusadas pelo `POST /agents/:id/tasks`;
- aplicações: caminhos inválidos recusados, banco de outro servidor recusado;
- isolamento: usuário de outro cliente não vê bancos nem aplicações (RLS);
- **destino local real**:
  - o teste do destino passa;
  - o repositório de cada servidor é criado uma única vez;
  - a credencial do servidor A recebe 401 no caminho do B;
  - o backup grava;
  - `forget --prune` com a credencial do agente é **recusado** (append-only);
  - nenhum segredo aparece na listagem;
- destino S3: a credencial é só de escrita; sem credencial o teste dá 409; com o endpoint fora do ar, o erro real volta sem vazar a chave.

### Defeitos encontrados pelos testes e corrigidos

- O tipo de segredo `s3_access` violava a restrição `^[a-z_]` da tabela. A restrição passou a aceitar dígitos (`^[a-z0-9_]{3,40}$`).
- O rest-server com autenticação **encerra na hora se o `.htpasswd` não existir**. O teste do destino agora cria o arquivo vazio (`htpasswd_criado` nos detalhes). Na instalação, criar o arquivo antes de iniciar o serviço (veja a seção 3).
- `bigint[]` chegava como texto: incluído o conversor no pool.

## 3. Preparar o destino local no Ubuntu

Veja a [Fase 3, seção 3](fase-3.md#3-instalação-no-ubuntu): unit do rest-server, diretório e `.htpasswd`.

## 4. Limitações conhecidas (honestas)

| Item | Situação |
| --- | --- |
| S3 | Uma única credencial serve ao agente e à manutenção. Para imutabilidade real no S3 é preciso Object Lock no bucket e uma credencial do agente sem `DeleteObject`; separar as duas credenciais fica para a Fase 3 |
| SFTP | Não suportado ainda |
| MySQL/MariaDB e MongoDB | Código do teste de conexão pronto, **não verificado** (sem esses bancos neste ambiente); verificar no Ubuntu |
| `.htpasswd` | O rest-server relê o arquivo a cada ~30 s; um repositório novo fica acessível ao agente em até 30 s |
| restic/rest-server | Verificados no Windows de desenvolvimento; repetir os testes no Ubuntu |
| Interface web | Endpoints prontos; telas na etapa do frontend |
