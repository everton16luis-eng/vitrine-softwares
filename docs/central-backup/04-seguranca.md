# 04 — Modelo de segurança

## 1. Ameaças consideradas

| Ameaça | Defesa principal |
| --- | --- |
| Invasão de um servidor de cliente | Agente sem poder de apagar backups (append-only / sem DeleteObject); certificado individual revogável; tarefas assinadas pela central e vinculadas ao agente |
| Roubo de credencial de um engenheiro | 2FA obrigatório, sessões revogáveis, painel restrito por IP/VPN, aprovação de 2 pessoas para ações destrutivas |
| Invasão do site de vendas | Central em aplicação, banco e (recomendado) servidor separados |
| Invasão do gateway de agentes | Gateway não cria tarefas nem lê segredos; agentes conferem assinatura das tarefas feita pelo worker |
| Vazamento do banco central | Segredos cifrados por envelope com chave mestra fora do banco; backups dos clientes cifrados pelo restic/pgBackRest com senhas por repositório |
| Perda da chave mestra | Procedimento de custódia e recuperação (seção 4) |
| Acesso cruzado entre clientes | FK compostas + RLS + escopo do usuário em toda consulta + testes automatizados de isolamento |
| Execução arbitrária | Catálogo fechado; sem shell; parâmetros validados em 4 camadas |

## 2. Identidade dos agentes (mTLS)

- **CA interna** da central (chave da CA intermediária no servidor da central, cifrada; CA raiz
  offline). Certificados de agente com validade de 90 dias, renovação automática aos 60 dias com
  **nova chave**, CN = `agent:<public_id>`, SAN URI com `client_id`/`server_id`.
- O gateway exige certificado (`requestCert`, `rejectUnauthorized`), confere cadeia, validade e
  serial ativo em `agent_credentials`. Revogação imediata (sem depender de CRL/OCSP).
- Código de instalação: 128 bits aleatórios, guardado só o hash (SHA-256), uso único, 30 min,
  vinculado a um servidor; tentativas limitadas.
- Atualização do agente: pacote com **assinatura Ed25519** (chave de release offline/CI) e SHA-256;
  o agente instala em diretório versionado, reinicia e volta à versão anterior se não fizer heartbeat.

## 3. Painel: autenticação, sessões, RBAC

- Senhas com **Argon2id** (m=64 MiB, t=3, p=1), política de tamanho mínimo e checagem contra senhas
  vazadas comuns; bloqueio progressivo e *rate limit* por IP e por conta.
- **2FA TOTP** obrigatório (WebAuthn/passkeys como evolução); códigos de recuperação com hash.
- Sessão no servidor (token aleatório, só o hash no banco), expiração por inatividade (30 min) e
  absoluta (12 h), reautenticação + 2FA para ações sensíveis (ver segredos, aprovar restauração).
- CSRF: `SameSite=Strict` + token por sessão em cabeçalho. XSS: React (escape padrão), CSP estrita
  sem `unsafe-inline`. SQL Injection: só consultas parametrizadas (driver `pg` + query builder
  tipado — Kysely), nunca concatenação.
- **RBAC** com permissões granulares; perfis padrão:

| Perfil | Pode |
| --- | --- |
| Administrador | tudo, inclusive usuários, chaves e configurações |
| Engenheiro de infraestrutura | servidores, agentes, monitoramento, DR (planejar/executar com aprovação), alertas |
| Operador de backup | políticas, execuções, consultas, solicitar restaurações; restaurar em temporário |
| Auditor | somente leitura de históricos, relatórios e auditoria |

Aprovação de restauração na produção e de DR exige permissão própria e usuário diferente de quem
solicitou.

## 4. Segredos e chaves

- **Criptografia por envelope**: cada cliente tem uma DEK (AES‑256‑GCM) cifrada pela **KEK** (chave
  mestra). A KEK fica em arquivo `0400` fora do banco e fora do diretório de dados
  (`/etc/central-backup/kek`), carregada só pelos processos que precisam (worker e painel; **não** o
  gateway). A interface de segredos permite trocar a KEK local por **OpenBao/Vault** sem mudar o resto.
- Segredos nunca voltam pela API: só "definido em …" e ações de substituir/testar. Logs passam por
  máscara de padrões conhecidos e de todos os valores de segredos da tarefa em execução.
- Segredos de banco vão ao agente **dentro da tarefa, cifrados** para a chave pública daquele agente
  (X25519 + AES‑GCM), e o agente os entrega às ferramentas por arquivo temporário `0600`/variável de
  ambiente do processo filho — nunca por argumento de linha de comando.
- Rotação: KEK (recifra DEKs, sem recifrar dados), DEKs, senhas de repositório restic (`restic key
  add/remove`), certificados de agente, chave de assinatura de tarefas.
- **Custódia da KEK**: duas cópias offline (ex.: cofre de senhas da empresa + envelope físico) e
  divisão opcional em partes (Shamir 2-de-3). O procedimento de recuperação é testado no teste de
  desastre da própria central. Sem a KEK e sem as senhas dos repositórios, os backups são
  irrecuperáveis — por isso as senhas dos repositórios também são exportadas, cifradas, num
  "kit de recuperação" guardado separadamente dos backups.

## 5. Auditoria

- Toda ação administrativa relevante (login, 2FA, mudanças de cadastro, políticas, segredos
  definidos/rotacionados, solicitações e aprovações, revogações, exclusões, falhas de autorização)
  gera registro com ator, IP, antes/depois resumido e **sem segredos**.
- Tabela append-only: o papel do banco usado pela aplicação só tem `INSERT`/`SELECT`; trigger
  recusa `UPDATE/DELETE`; cada linha guarda `hash = sha256(prev_hash ‖ conteúdo)` e
  `GET /audit/verify` detecta adulteração. Cópia diária para o destino de backup da central.

## 6. Rede e servidor da central

- Painel publicado só por HTTPS (Nginx), idealmente restrito por IP/VPN da empresa.
- Gateway em hostname próprio (ex.: `agentes.suaempresa.com.br`). Em servidor dedicado, Nginx em modo `stream` com
  `ssl_preread` repassando por SNI sem terminar TLS; no VPS compartilhado (decisão D2), porta própria (8443) direto no Node. Em ambos os casos o mTLS é verificado no Node.
- PostgreSQL, Redis e Prometheus sem porta pública (rede interna do Docker); Redis com senha.
- Contêineres sem root, sistema de arquivos somente leitura onde possível, limites de recursos.
- Agente no cliente: usuário `central-agent`, unidade systemd com `NoNewPrivileges`,
  `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`, `CapabilityBoundingSet` mínimo
  (`CAP_DAC_READ_SEARCH` só para leitura de backup). Escrita (restauração) só pelo auxiliar root com
  lista fechada e caminhos permitidos — mesmo padrão já usado na Central de Implantação.

## 7. LGPD

Backups contêm dados pessoais dos clientes dos clientes. A central registra finalidade, retenção e
acesso (auditoria), cifra tudo em repouso e em trânsito, e a exclusão por fim de contrato segue a
retenção acordada — com registro de quem autorizou.
