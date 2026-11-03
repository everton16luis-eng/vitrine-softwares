# Vitrine de Softwares

Plataforma web para **apresentar, divulgar, comercializar e administrar softwares** de um profissional independente ou pequena empresa de tecnologia: site público otimizado para SEO, catálogo com páginas individuais e demonstrações, captação de contatos e orçamentos, gestão comercial (leads, clientes, orçamentos, pedidos, pagamentos, contratos e licenças), painel administrativo com permissões, área do cliente e auditoria.

> **Estado atual:** os quatro produtos cadastrados (ChurchFlow, SpaceControl, FleetManager e Sistemas Personalizados) são **registros demonstrativos**, com nomes provisórios e sem preços. Os três sistemas aparecem como "Em desenvolvimento" e oferecem demonstrações visuais com dados fictícios. Ajuste tudo pelo painel antes de divulgar o site.

---

## Sumário

1. [Tecnologias](#tecnologias)
2. [Requisitos e versões recomendadas](#requisitos-e-versões-recomendadas)
3. [Instalação passo a passo (Windows / PowerShell)](#instalação-passo-a-passo-windows--powershell)
4. [Criação segura do primeiro administrador](#criação-segura-do-primeiro-administrador)
5. [Execução em desenvolvimento e produção](#execução)
6. [Testes](#testes)
7. [Backup e restauração](#backup-e-restauração)
8. [Uso do painel: cadastrar produtos](#como-cadastrar-novos-produtos)
   - [Identidade visual provisória](#identidade-visual-provisória)
9. [E-mails transacionais](#como-configurar-e-mails)
10. [Pagamentos (integração futura)](#pagamentos-integração-futura)
11. [Deploy](#deploy)
12. [Estrutura do projeto](#estrutura-do-projeto)
13. [Pendências e integrações que exigem configuração](#pendências-e-integrações-que-exigem-configuração)

Documentação complementar em [`docs/`](docs/):
[API](docs/API.md) · [Banco de dados](docs/BANCO-DE-DADOS.md) · [Segurança e LGPD](docs/SEGURANCA-E-LGPD.md) · [Pagamentos](docs/PAGAMENTOS.md) · [Imagens e licenças](docs/IMAGENS.md) · [Deploy](docs/DEPLOY.md) · [Deploy em VPS compartilhada](docs/DEPLOY-VPS.md) · [Central de Implantação](docs/IMPLANTACOES.md)

---

## Tecnologias

| Camada | Escolha |
| --- | --- |
| Backend | Node.js + Express 5, JavaScript (ES Modules) |
| Banco | PostgreSQL, biblioteca `pg` com consultas parametrizadas |
| Site público | HTML renderizado no servidor (templates com escape automático) + Bootstrap 5 + JS modular |
| Painel e área do cliente | SPA em JavaScript modular (sem framework), Bootstrap 5, Bootstrap Icons, Chart.js |
| Senhas | Argon2id (`argon2`) |
| Uploads | `multer` em memória + validação por conteúdo + reprocessamento com `sharp` |
| Segurança | `helmet` (CSP estrita), `express-rate-limit`, sessões próprias em banco, CSRF |
| E-mail | `nodemailer` (SMTP configurável) |
| Testes | `node:test` + `supertest` |

**Justificativa de uma decisão técnica:** o site público é **renderizado no servidor** (e não uma SPA) para que títulos, descrições, Open Graph, dados estruturados e o conteúdo de cada produto cheguem prontos aos buscadores. Os templates usam uma função `html` com escape automático (sem dependência de motor de templates). O painel e a área do cliente são SPAs porque não precisam de indexação.

---

## Requisitos e versões recomendadas

| Software | Versão recomendada | Mínima |
| --- | --- | --- |
| Node.js | 22 LTS ou 24 | 20.11 |
| npm | 10+ | 9 |
| PostgreSQL | 16, 17 ou 18 | 14 |
| Git | 2.40+ | — |

Testado em Windows 11 com Node.js 24.18 e PostgreSQL 18.

---

## Instalação passo a passo (Windows / PowerShell)

### 1. Instalar o Node.js

Baixe o instalador LTS em <https://nodejs.org/pt> ou use o winget:

```powershell
winget install OpenJS.NodeJS.LTS
```

Confira:

```powershell
node -v
```

### 2. Instalar e configurar o PostgreSQL

Baixe o instalador em <https://www.postgresql.org/download/windows/> (ou `winget install PostgreSQL.PostgreSQL.17`). Durante a instalação, defina a senha do usuário `postgres` e mantenha a porta `5432`. Verifique se o serviço está ativo:

```powershell
Get-Service postgresql*
```

> Recomendado em produção: criar um usuário próprio para a aplicação em vez de usar `postgres`. Exemplo (no `psql` ou pgAdmin):
> `CREATE ROLE vitrine LOGIN PASSWORD 'senha-forte'; ALTER ROLE vitrine CREATEDB;`

### 3. Obter o código e instalar as dependências

```powershell
cd C:\caminho\para\vitrine-softwares
```

```powershell
npm install
```

> O npm 11+ pode avisar que scripts de instalação de `argon2` e `sharp` foram bloqueados. Ambos trazem binários pré-compilados para Windows/Linux/macOS e funcionam mesmo assim. Se aparecer erro ao carregá-los, autorize com `npm install-scripts approve argon2 sharp` e rode `npm install` de novo.

### 4. Configurar o arquivo `.env`

```powershell
Copy-Item .env.example .env
```

Edite o `.env` e ajuste no mínimo:

- `DATABASE_URL` — banco de desenvolvimento, ex.: `postgres://postgres:SUA_SENHA@localhost:5432/vitrine_softwares`
- `DATABASE_URL_TEST` — banco **exclusivo** para testes (o nome deve terminar com `_test`; ele é apagado a cada execução)
- `APP_SECRET` — gere um valor aleatório:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Senhas com caracteres especiais (`@`, `#`, `/`, `:`) precisam ser codificadas na URL (ex.: `@` vira `%40`).

### 5. Criar os bancos, executar as migrations e carregar os dados iniciais

```powershell
npm run db:setup
```

Esse comando executa, em sequência:

| Comando | O que faz |
| --- | --- |
| `npm run db:create` | Cria os bancos de `DATABASE_URL` e `DATABASE_URL_TEST`, se não existirem |
| `npm run db:migrate` | Aplica as migrations versionadas de `database/migrations` (controle em `schema_migrations`) |
| `npm run db:seed` | Insere perfis, permissões, configurações, textos, páginas jurídicas-modelo, serviços e produtos demonstrativos (idempotente: não sobrescreve edições feitas no painel) |

---

## Criação segura do primeiro administrador

O primeiro administrador **não pode** ser criado pelo site. Use o comando interativo (a senha não aparece no terminal):

```powershell
npm run admin:create
```

- O comando recusa a execução se já existir um administrador ativo — os demais usuários devem ser criados no painel (**Usuários e perfis**), recebendo um link de uso único para definir a própria senha.
- Para automação (ex.: deploy), é possível definir `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` no ambiente apenas durante a execução e removê-los depois.
- Política de senha: mínimo de 10 caracteres, com letras e números.

### Esqueci a senha / conta bloqueada

Sem SMTP configurado, o link de "esqueci minha senha" não chega por e-mail. Redefina pelo terminal do servidor (a senha não aparece na tela):

```powershell
npm run admin:reset-password
```

O comando pede o e-mail e a nova senha, desbloqueia a conta (após 5 tentativas erradas o acesso fica bloqueado por 15 minutos), encerra as sessões abertas e registra a ação na auditoria.

---

## Execução

### Desenvolvimento

```powershell
npm run dev
```

Acesse:

- Site: <http://localhost:3000>
- Painel administrativo: <http://localhost:3000/admin>
- Área do cliente: <http://localhost:3000/cliente>

### Produção

Defina no `.env` (ou nas variáveis do provedor): `NODE_ENV=production`, `APP_URL=https://seu-dominio.com.br`, `TRUST_PROXY=1` (atrás de proxy HTTPS) e um `APP_SECRET` forte. Então:

```powershell
npm ci --omit=dev
```

```powershell
npm run db:migrate
```

```powershell
npm start
```

Em produção os cookies são `Secure` e usam o prefixo `__Host-`, o HSTS é ativado e a aplicação se recusa a iniciar sem `APP_SECRET` válido. Veja [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Testes

```powershell
npm test
```

| Comando | Escopo |
| --- | --- |
| `npm run test:unit` | Funções puras: dinheiro, validação, XSS, uploads, tokens, assinaturas de webhook, máquinas de estado |
| `npm run test:integration` | API e páginas com PostgreSQL real (`DATABASE_URL_TEST`) |
| `npm test` | Tudo |

Os testes de integração **recriam o banco de testes a cada arquivo** e só executam se o nome do banco terminar com `_test`. Sem `DATABASE_URL_TEST`, eles são marcados como ignorados.

Cobertura dos fluxos críticos: inicialização do banco; login válido/inválido, bloqueio por tentativas, CSRF, logout e redefinição de senha; bloqueio de acesso administrativo; permissões por perfil e escalonamento de privilégios; criação, edição, publicação, despublicação e arquivamento de produtos; catálogo público só com produtos autorizados; filtros, busca e paginação; envio de contatos, anti-spam e consentimento; orçamentos e suas transições; cálculos monetários de pedidos; estados de pedidos e pagamentos; isolamento de dados entre clientes; validação de uploads; entradas inválidas; cabeçalhos de segurança; LGPD.

Último resultado registrado: **109 testes, 109 aprovados** (18 suítes).

---

## Backup e restauração

Os utilitários `pg_dump`/`pg_restore` ficam em `C:\Program Files\PostgreSQL\<versão>\bin`. Adicione essa pasta ao `PATH` ou use o caminho completo.

**Backup** (formato compactado, inclui estrutura e dados):

```powershell
New-Item -ItemType Directory -Force backups
```

```powershell
pg_dump --format=custom --no-owner --file "backups\vitrine-$(Get-Date -Format yyyyMMdd-HHmm).dump" "postgres://usuario:senha@localhost:5432/vitrine_softwares"
```

**Arquivos enviados** (imagens públicas e documentos privados dos clientes) ficam em `storage\`. Inclua essa pasta no backup:

```powershell
Compress-Archive -Path storage -DestinationPath "backups\storage-$(Get-Date -Format yyyyMMdd-HHmm).zip"
```

**Restauração** (em um banco vazio):

```powershell
pg_restore --clean --if-exists --no-owner --dbname "postgres://usuario:senha@localhost:5432/vitrine_softwares" "backups\vitrine-AAAAMMDD-HHMM.dump"
```

```powershell
Expand-Archive -Path "backups\storage-AAAAMMDD-HHMM.zip" -DestinationPath . -Force
```

Recomendações: backups diários automatizados (Agendador de Tarefas do Windows ou `cron`), cópia fora do servidor, retenção de pelo menos 30 dias e **teste periódico de restauração** em um banco separado. Os backups contêm dados pessoais: armazene-os criptografados e com acesso restrito.

---

## Como cadastrar novos produtos

1. Entre em `/admin` → **Categorias** e confirme que a categoria existe e está ativa.
2. **Biblioteca de mídia** → envie capturas de tela reais do sistema (JPG, PNG ou WEBP), preenchendo o texto alternativo e a origem/licença.
3. **Produtos** → **Novo produto** → preencha os dados gerais e salve.
4. Na página do produto, use as abas **Funcionalidades**, **Benefícios**, **Galeria**, **Perguntas** e **Planos**.
5. Defina o **status comercial** real. Somente "Disponível para contratação" exibe o botão **Contratar**; nos demais casos aparece "Solicitar orçamento".
6. Clique em **Publicar**. O produto aparece no catálogo e no sitemap; a URL é `/softwares/<slug>`.
7. Para tirar do ar, use **Despublicar**; para preservar o histórico, use **Arquivar**. A exclusão definitiva só é permitida para produtos sem histórico comercial.

Demonstrações: escolha "Interna" apenas para os produtos que possuem módulo de demonstração em `frontend/public/assets/js/demos/` (ChurchFlow, SpaceControl, FleetManager) ou "Link externo" para um ambiente online, informando a URL e eventuais avisos.

## Clientes e parceiros na página inicial

A seção **"Empresas que confiam em nossas soluções"** (logo abaixo do destaque da página inicial) é gerenciada em `/admin` → **Conteúdo** → **Clientes e parceiros** (permissões `parceiros.ver` / `parceiros.editar`).

1. **Nova empresa** → informe o nome, a ordem de exibição, o site (opcional, vira link) e escolha a logomarca.
2. Marque **Ativo** e **Empresa autorizou a divulgação da marca**. Só aparecem no site as empresas ativas, autorizadas e com logomarca; sem nenhuma, a seção fica oculta.
3. A logomarca pode ser **PNG** (com ou sem transparência), **JPG**, **WebP** ou **SVG**, em qualquer proporção. O servidor:
   - valida o arquivo pelo conteúdo (não pela extensão) e recusa SVG com scripts, eventos, entidades ou referências externas; o SVG é convertido em imagem e **nunca** é publicado;
   - remove fundo liso (comum em JPG), recorta as bordas vazias e centraliza a marca numa área padrão de 480×240 px, sem cortes nem distorções, com tamanho visual equivalente entre marcas horizontais, quadradas e verticais;
   - gera uma versão **monocromática clara** (exibição padrão, preservando letras vazadas e detalhes) e uma **colorida** (ao passar o mouse), ambas em WebP leve;
   - guarda o **arquivo original** em `storage/private` (baixável pelo painel) para permitir reprocessar.
4. Para substituir a logo, edite a empresa e escolha outro arquivo. O botão **Reprocessar** (por empresa ou **Reprocessar todas**) gera novamente as versões publicadas a partir do original.

Com mais de 10 marcas a seção vira um carrossel contínuo (pausa ao passar o mouse; sem animação para quem prefere reduzir movimento). Título e texto da seção ficam em **Páginas e textos** → grupo *home*.

> Bancos já existentes: rode `npm run db:migrate` e `npm run db:seed`. O perfil *Administrador* recebe as novas permissões automaticamente; para *Editor de conteúdo* criado antes desta versão, marque `parceiros.ver`/`parceiros.editar` em **Usuários** → cartão do perfil → **Editar permissões**.

---

## Identidade visual provisória

O site público é uma vitrine de serviços de desenvolvimento com **identidade provisória**: nome neutro, espaço reservado para a logo e paleta azul (`#0EA5E9`), roxo (`#8B5CF6`), azul-marinho (`#0F172A`) e branco (`#F8FAFC`), com a fonte Montserrat hospedada no próprio site.

Quando a marca definitiva estiver pronta:

| O quê | Onde trocar |
| --- | --- |
| Nome da empresa e slogan | Painel → **Configurações** → Nome comercial / Slogan |
| Logo | Envie em **Biblioteca de mídia** e informe a URL em **Configurações** → URL do logotipo (o espaço reservado some automaticamente) |
| Cores | Painel → **Configurações** (cor base, destaque e secundária) ou os padrões em `frontend/public/assets/css/brand.css` |
| Fonte | `frontend/public/assets/css/brand.css` (`@font-face` e `--brand-font`) |
| Favicon e imagem de compartilhamento | `scripts/generate-images.js` (depois `npm run images`) ou **Configurações** → URL do favicon |
| Textos da página inicial | Painel → **Conteúdo** (grupo "home") e **Páginas** → Sobre |

Em bancos já existentes, rode `npm run db:seed` para aplicar os textos e a paleta novos. O seed só substitui valores que ainda estão iguais aos padrões antigos; o que foi editado no painel é preservado.

---

## Como configurar e-mails

Preencha no `.env` os dados do seu provedor SMTP (ex.: Amazon SES, Brevo, Mailgun, Resend, Zoho, Google Workspace):

```
SMTP_HOST=smtp.seuprovedor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASS=senha-ou-chave
MAIL_FROM="Sua Empresa <contato@seudominio.com.br>"
```

Reinicie a aplicação. O status aparece em **Configurações → Integrações**. Os textos ficam em **Configurações → Modelos de e-mail**, com variáveis como `{{nome}}` e `{{protocolo}}`.

Sem SMTP configurado, **nenhum e-mail é enviado**: a aplicação continua funcionando, registra cada tentativa como "Não enviado (sem provedor)" em **Configurações → Últimos envios** e, nos convites de usuários e clientes, mostra o link de acesso ao administrador uma única vez para envio por canal seguro. Configure SPF, DKIM e DMARC no seu domínio para evitar que as mensagens caiam no spam.

---

## Pagamentos (integração futura)

Nesta versão **não há cobrança online**. O sistema registra pagamentos **manuais** (PIX, transferência, boleto emitido fora do sistema), e somente usuários com a permissão "Confirmar pagamentos" podem marcá-los como confirmados após conferir o recebimento. Um pedido nunca é marcado como pago apenas por ter sido criado: a situação de pagamento é calculada a partir dos pagamentos confirmados.

A arquitetura para Mercado Pago e Stripe já existe (`backend/src/modules/payments/gateways.js`): rota de webhook, verificação de assinatura, idempotência de eventos e atualização do pedido. Enquanto as credenciais não estão no `.env`, o webhook responde `503` e nada é confirmado. Passo a passo em [docs/PAGAMENTOS.md](docs/PAGAMENTOS.md).

---

## Deploy

Resumo (detalhes e exemplos em [docs/DEPLOY.md](docs/DEPLOY.md); passo a passo completo para uma VPS Linux que já hospeda outros sites em [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md)):

1. Servidor com Node.js 22+ e PostgreSQL gerenciado ou próprio.
2. Variáveis de ambiente de produção (`NODE_ENV=production`, `APP_URL`, `APP_SECRET`, `DATABASE_URL`, `TRUST_PROXY`, SMTP).
3. `npm ci --omit=dev` → `npm run db:migrate` → `npm run db:seed` (somente na primeira vez) → `npm run admin:create` (somente na primeira vez) → `npm start` com um gerenciador de processos (PM2, systemd, serviço do Windows ou o próprio provedor).
4. Proxy reverso com HTTPS (Nginx, Caddy, IIS ou o do provedor).
5. Disco persistente para `storage/` (ou um driver de armazenamento externo).
6. Backups automáticos do banco e de `storage/`.

### Central de Implantação

O painel inclui a **Central de Implantação** (menu *Implantação*), que instala, configura, testa e entrega os sistemas contratados em ambiente isolado por cliente (usuário Linux, diretório, banco, porta, serviço e site Nginx próprios). Em produção ela depende de um agente separado e de um auxiliar root com lista fechada de operações:

```bash
sudo bash deploy/implantacao/preparar-servidor.sh
```

Em desenvolvimento, `npm run agente` roda o agente em modo simulado (nada é alterado no servidor). Guia completo em [docs/IMPLANTACOES.md](docs/IMPLANTACOES.md).

---

## Estrutura do projeto

```
vitrine-softwares/
├── backend/src/
│   ├── app.js, server.js          # montagem do Express e inicialização
│   ├── config/env.js              # variáveis de ambiente
│   ├── database/                  # pool, migrator, seeder e CLIs (create, migrate, seed, admin)
│   ├── middlewares/               # sessão/autorização, CSRF, segurança, erros
│   ├── modules/                   # regras de negócio por domínio
│   │   ├── auth/ users/ settings/ media/ content/ reports/
│   │   ├── products/ categories/ services/ plans/
│   │   ├── leads/ customers/ quotes/ orders/ payments/ contracts/ support/
│   │   └── shared/                # CRUD genérico, itens comerciais, numeração
│   ├── routes/                    # site público, API admin, API do cliente
│   ├── services/                  # auditoria, e-mail, notificações, armazenamento
│   ├── utils/                     # validação, dinheiro, HTML seguro, Markdown
│   └── views/                     # páginas públicas renderizadas no servidor
├── frontend/public/
│   ├── admin/index.html           # painel (SPA)
│   ├── cliente/index.html         # área do cliente (SPA)
│   └── assets/                    # css, js (site, admin, cliente, demos, shared), imagens
├── database/
│   ├── migrations/                # SQL versionado
│   └── seeds/                     # dados iniciais idempotentes
├── storage/                       # uploads (fora do Git)
├── scripts/generate-images.js     # gera as ilustrações de interface
├── tests/unit, tests/integration
└── docs/
```

As regras de negócio ficam nos serviços (`*.service.js`); as rotas apenas validam a entrada, verificam permissões e delegam.

---

## Pendências e integrações que exigem configuração

| Item | Situação |
| --- | --- |
| Primeiro administrador | Executar `npm run admin:create` |
| Identidade e contatos | Nome comercial está como "Sua empresa de tecnologia" (provisório) e a logo é um espaço reservado. Preencha nome, logotipo, e-mail, telefone, WhatsApp, redes sociais e dados do fornecedor em **Configurações** (veja [Identidade visual provisória](#identidade-visual-provisória)) |
| Textos institucionais | A seção "Sobre" da página inicial e a página `/sobre` têm texto provisório; substitua pela apresentação real em **Conteúdo** e **Páginas** |
| Textos institucionais | "Sobre" e o texto de abertura estão em primeira pessoa como modelo; ajuste em **Conteúdo** |
| Documentos jurídicos | Política de Privacidade, Termos de Uso e Política de Cookies são **modelos** marcados como "em revisão"; devem ser revisados por profissional habilitado |
| Produtos | Nomes provisórios, sem preços; confirme status comercial real antes de divulgar. "Sistemas Personalizados" está como "Disponível para contratação" por representar a oferta de desenvolvimento sob medida — altere se não for o caso |
| E-mail | Configurar SMTP (sem ele, nada é enviado) |
| Pagamentos online | Não implementados; arquitetura preparada (ver docs/PAGAMENTOS.md) |
| Armazenamento externo | Driver local; para múltiplos servidores, implementar driver S3/R2 (interface em `services/storage`) |
| Fotografias | Nenhuma foto de pessoas foi usada; ao adicionar, registre origem e licença (docs/IMAGENS.md) |
| Chaves de licença | O sistema registra licenças administrativamente; geração/validação de chaves não foi implementada (fora do escopo, sem monitoramento nos clientes) |
