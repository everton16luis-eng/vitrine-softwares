# Central de Implantação — proposta de implementação

Status: **implementada** — guia de uso em [IMPLANTACOES.md](IMPLANTACOES.md).

## 1. O que existe hoje e como a central se encaixa

| Item atual | Como será aproveitado |
| --- | --- |
| Node 20+/Express 5, PostgreSQL, migrations versionadas (`database/migrations/NNN_*.sql`) | Nova migration `002_implantacoes.sql`; nenhuma tabela existente é alterada de forma destrutiva |
| Painel SPA com rotas por hash e menu filtrado por permissão (`frontend/public/assets/js/admin`) | Novo grupo de menu **Implantação**: Implantações, Domínios, Receitas de implantação |
| Permissões em `permissoes`/`perfis` (seed `01-acesso.js`) | Novas permissões `implantacoes.ver`, `implantacoes.editar`, `implantacoes.executar`, `implantacoes.receitas`, `implantacoes.segredos` |
| `clientes`, `produtos`, `pedidos`, `contratos`, `licencas` | A implantação referencia cliente + produto e, opcionalmente, pedido/contrato/licença. Pode ser criada a partir de um pedido |
| `auditoria` | Toda ação de implantação é auditada (sem segredos) |
| Rotina horária em `server.js` | **Não** é usada para instalar. A instalação roda num processo separado (agente) |

O site e o painel continuam como estão. O painel **nunca executa comandos**: ele só grava pedidos de tarefa no banco.

## 2. Arquitetura

```
Painel (Express, usuário "vitrine")  ──grava tarefa──▶  PostgreSQL (fila)  ◀──busca tarefa──  Agente de implantação (processo separado)
        ▲                                                       │                                     │
        └──────────── lê andamento, logs e resultados ──────────┘                                     ▼
                                                                                  Operações autorizadas (lista fechada)
                                                                                  + scripts auxiliares de root com
                                                                                    parâmetros validados (sudoers restrito)
```

- **Fila no PostgreSQL** (`FOR UPDATE SKIP LOCKED`), sem Redis. A página pode ser fechada: o agente continua e o painel acompanha por atualização periódica.
- **Agente** (`npm run agente`): processo próprio, serviço systemd, usuário de sistema `implantador`. Executa somente operações de um catálogo fechado no código, com `execFile` (sem shell) e argumentos em lista.
- **Privilégios mínimos**: o que exige root (criar usuário Linux, escrever site do Nginx, `nginx -t`/reload, certbot, unidade systemd) passa por poucos scripts auxiliares instalados em `/usr/local/lib/vitrine-implantacao/`, de propriedade do root, liberados no `sudoers` **apenas** para esses caminhos. Cada script revalida os parâmetros (slug `^[a-z0-9-]{3,40}$`, domínio válido, porta na faixa reservada).
- **Simulação**: o agente tem um modo `simulado` (padrão em desenvolvimento/testes) que percorre o fluxo inteiro sem tocar no sistema — usado pelos testes automatizados e para ensaiar uma receita nova.

## 3. Isolamento por instalação

Cada implantação recebe um identificador (`slug`, ex.: `acme-churchflow`) e, a partir dele:

| Recurso | Padrão |
| --- | --- |
| Usuário Linux | `app-<slug>` (sem login) |
| Diretório | `/srv/clientes/<slug>/` com `releases/<versão>`, `current` (link), `shared/.env`, `shared/storage`, `logs/`, `backups/` |
| Banco | `cli_<slug>` + papel `cli_<slug>` com senha própria, sem superusuário |
| Porta interna | alocada de uma faixa (ex.: 4100–4999), única no banco |
| Serviço | `vitrine-app-<slug>.service` (systemd) |
| Nginx | `/etc/nginx/sites-available/vitrine-<slug>.conf` — só arquivos com esse prefixo são criados/alterados |
| Certificado | Let's Encrypt via certbot, por domínio |

Nada fora desses prefixos é tocado: outros sites do Nginx, outros bancos e outros serviços ficam intactos.

## 4. Receitas de implantação (configuração por software)

Cada produto pode ter uma ou mais **receitas** versionadas (tabela `receitas_implantacao`), editadas no painel em formulário (com validação), cobrindo: origem (repositório Git + ref/tag, ou pacote enviado), tecnologia (`node`, `php`, `estatico`; extensível), versões mínimas, banco necessário, comandos de instalação/build/migrations/seed/início, variáveis de ambiente (com origem de cada valor), trecho extra do Nginx, verificações pós-instalação e campos que o cliente precisa fornecer.

**Comandos não são texto livre executado em shell.** Cada comando é uma lista de argumentos cujo executável precisa estar numa lista permitida por tecnologia (ex.: Node: `npm ci`, `npm run <script>`, `node <arquivo do projeto>`; PHP: `composer install`, `php artisan <comando permitido>`). Eles rodam como `app-<slug>`, dentro do diretório da instalação, com tempo limite e saída registrada.

Variáveis de ambiente têm origem declarada: `fixo`, `gerado` (segredo aleatório), `banco` (URL montada pelo agente), `dominio`, `porta`, `cliente` (campo do formulário do cliente). Assim um software novo é cadastrado sem programar a central de novo — basta escrever a receita.

## 5. Fluxo e estados

Etapas: **1 Contratação → 2 Informações do cliente → 3 Infraestrutura → 4 Instalação → 5 Personalização → 6 Testes → 7 Entrega**.

Situação de cada etapa: `pendente`, `em_andamento`, `aguardando_cliente`, `aguardando_tecnico`, `concluida`, `falhou`.

A instalação (etapas 3, 4 e 6) é dividida em passos idempotentes com ponto de controle (`passos_implantacao`): diretório, usuário, código, dependências, banco, `.env`, migrations, serviço, Nginx, DNS, SSL, início, verificações. Se o agente cair no meio, a retomada continua do último passo concluído; um passo que falhou pode ser reexecutado sozinho. Antes de migrations ou alterações em instalação existente, `pg_dump` em `backups/`.

Regras: uma implantação ativa por cliente+produto+domínio (índice único); só uma tarefa em execução por implantação (trava); domínio único entre instalações.

## 6. Domínios

Tela própria: registra o domínio, consulta A/AAAA (`dns.resolve4/6`) e compara com os IPs do servidor configurados em `IMPLANTACAO_IPS`, testa HTTP no desafio do Let's Encrypt, emite o certificado, mostra validade e se a renovação automática (`certbot.timer`) está ativa. Se o DNS não aponta, a etapa fica **aguardando cliente** com instruções prontas ("crie um registro A para `app.cliente.com.br` apontando para `203.0.113.10`") e uma nova verificação é agendada automaticamente.

## 7. Segredos e entrega

- Senhas de banco, segredos gerados e credenciais de serviços externos ficam cifrados (AES-256-GCM) com chave própria `IMPLANTACAO_CHAVE`, fora do banco. A API nunca devolve o valor; o painel mostra apenas "definido em 02/11/2026".
- Logs passam por mascaramento de segredos conhecidos antes de serem gravados.
- O acesso inicial do cliente é entregue por **link de definição de senha de uso único** gerado pelo próprio software instalado (quando a receita suportar) — nunca senha em texto no resumo.
- Resumo de entrega (HTML imprimível/PDF pelo navegador): software, versão, domínio, data, recursos, como acessar, orientações e situação.

## 8. O que será entregue, em fases testáveis

1. **Banco, permissões e receitas** — migration, CRUD de receitas com validação, testes.
2. **Implantações e formulário do cliente** — criação a partir de pedido/cliente+produto, campos obrigatórios/opcionais/automáticos, linha do tempo, auditoria, testes.
3. **Agente e fila** — catálogo de operações, executor simulado e real, logs, retomada, reexecução, travas, testes (com executor simulado).
4. **Domínios e SSL** — verificação de DNS real, instruções, certbot, testes de validação.
5. **Testes pós-instalação, entrega e documentação** — verificações, resumo de entrega, `docs/IMPLANTACOES.md` e script de preparação do servidor.

## 9. Limites honestos

- A execução real (Nginx, systemd, certbot, criação de usuários Linux) **só pode ser testada num servidor Linux**. Nesta máquina (Windows) os testes automatizados usam o executor simulado; a verificação real depende de um servidor de homologação.
- O servidor precisa de uma preparação única feita por você como root (script fornecido): criar o usuário `implantador`, instalar os scripts auxiliares e a regra de `sudoers`, criar `/srv/clientes`.
- Configuração de DNS no provedor do cliente continua sendo ação do cliente (a central só verifica e orienta).
