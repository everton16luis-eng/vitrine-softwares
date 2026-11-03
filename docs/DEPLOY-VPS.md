# Tutorial: publicar o site de vendas em uma VPS que já tem outros sites

Este guia instala o site de vendas (site público, painel administrativo, área do cliente e, se
quiser, a Central de Implantação) em uma VPS **Ubuntu/Debian** que já hospeda outros sites com
**Nginx**, sem interromper nem alterar o que já está funcionando.

A regra geral do guia é: **primeiro olhar, depois acrescentar**. Nada existente é editado, apagado
ou reiniciado. O site novo ganha usuário Linux, pasta, banco, porta, serviço e configuração do Nginx
próprios.

> Convenções usadas nos exemplos — troque pelos seus valores:
>
> | Valor do exemplo | Significado |
> | --- | --- |
> | `seudominio.com.br` | domínio do site de vendas |
> | `203.0.113.10` | IP público da VPS |
> | `3010` | porta interna escolhida para o site (passo 1) |
> | `/var/www/vitrine-softwares` | pasta do site |
> | `vitrine` | usuário Linux que executa o site |
> | `vitrine_softwares` / `vitrine_app` | banco e usuário do PostgreSQL |
>
> Comandos começando com `sudo` rodam como administrador; os com `sudo -u vitrine` rodam como o
> usuário do site.

---

## Sumário

0. [O que você precisa](#0-o-que-você-precisa)
1. [Inventário do servidor (sem alterar nada)](#1-inventário-do-servidor-sem-alterar-nada)
2. [Apontar o domínio](#2-apontar-o-domínio)
3. [Node.js](#3-nodejs)
4. [PostgreSQL: banco e usuário exclusivos](#4-postgresql-banco-e-usuário-exclusivos)
5. [Usuário Linux e código do site](#5-usuário-linux-e-código-do-site)
6. [Configuração (.env)](#6-configuração-env)
7. [Banco de dados e primeiro administrador](#7-banco-de-dados-e-primeiro-administrador)
8. [Serviço systemd](#8-serviço-systemd)
9. [Garantir que a porta interna não fique exposta](#9-garantir-que-a-porta-interna-não-fique-exposta)
10. [Nginx: novo site, sem tocar nos outros](#10-nginx-novo-site-sem-tocar-nos-outros)
11. [HTTPS com Let's Encrypt](#11-https-com-lets-encrypt)
12. [Conferência final](#12-conferência-final)
13. [Central de Implantação (opcional)](#13-central-de-implantação-opcional)
14. [Backups automáticos](#14-backups-automáticos)
15. [Atualizar o site](#15-atualizar-o-site)
16. [Solução de problemas](#16-solução-de-problemas)
17. [Remover o site sem afetar os outros](#17-remover-o-site-sem-afetar-os-outros)

---

## 0. O que você precisa

- Acesso SSH à VPS com um usuário que tenha `sudo`.
- O domínio e acesso ao painel DNS dele.
- Acesso de leitura ao repositório (`https://github.com/everton16luis-eng/vitrine-softwares`). Se
  ele for privado, use uma **deploy key** somente leitura (passo 5).
- Dados do SMTP para os e-mails do site (pode ser configurado depois).
- Recursos mínimos livres na VPS: ~512 MB de RAM e ~1 GB de disco para o site, mais o espaço dos
  uploads e backups.

Reserve uma janela de tempo calma: nenhum passo derruba os outros sites, mas é bom poder conferir
cada um com atenção.

---

## 1. Inventário do servidor (sem alterar nada)

Estes comandos apenas **leem** informações. Anote os resultados.

Sistema, memória e disco:

```bash
cat /etc/os-release | head -3
free -h
df -h /
```

Portas em uso (para escolher uma porta livre para o site):

```bash
sudo ss -ltnp
```

Escolha uma porta que **não** apareça na lista, por exemplo `3010`. Evite a faixa **4100–4999**,
que é usada pela Central de Implantação para os sistemas dos clientes.

Sites já configurados no Nginx e domínios que eles atendem:

```bash
ls -l /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
sudo nginx -T 2>/dev/null | grep -E "^\s*server_name" | sort -u
```

Confirme que `seudominio.com.br` **não** aparece na lista (se aparecer, outro site já o atende —
resolva isso antes de continuar).

Node.js, gerenciadores de processo e PostgreSQL existentes:

```bash
node -v; which node
which pm2 && pm2 list
psql --version; systemctl is-active postgresql
```

Firewall:

```bash
sudo ufw status verbose
```

---

## 2. Apontar o domínio

No painel DNS do domínio, crie (ou ajuste):

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | `@` (ou `seudominio.com.br`) | `203.0.113.10` |
| A | `www` | `203.0.113.10` |
| AAAA | `@` e `www` | IPv6 da VPS — **somente** se ela tiver IPv6 configurado no Nginx |

Remova registros A/AAAA antigos desses nomes que apontem para outro lugar. A propagação pode levar
de minutos a algumas horas. Para conferir:

```bash
dig +short seudominio.com.br A
dig +short www.seudominio.com.br A
```

Continue os próximos passos enquanto o DNS propaga; ele só é necessário a partir do passo 11.

---

## 3. Node.js

O site precisa do **Node.js 20.11 ou superior** (recomendado: 22 LTS).

**Caso A — o `node -v` do passo 1 já mostra 20.11+ e está em `/usr/bin/node`:** use-o. Pule para o
passo 4.

**Caso B — não há Node.js no servidor:** instale o Node 22 pelo repositório oficial NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node -v
```

**Caso C — já existe um Node.js mais antigo usado pelos outros sites:** **não atualize** o Node do
sistema, isso pode quebrar os outros sites. Instale uma cópia separada, só para este site:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
NODE_TGZ=$(grep -o 'node-v22[^ ]*-linux-x64.tar.xz' SHASUMS256.txt | head -1)
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$NODE_TGZ"
grep " $NODE_TGZ\$" SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /opt/node22
sudo tar -xJf "$NODE_TGZ" -C /opt/node22 --strip-components=1
sudo chown -R root:root /opt/node22
/opt/node22/bin/node -v
```

Nos passos seguintes, onde aparecer `/usr/bin/node` e `npm`, use `/opt/node22/bin/node` e
`/opt/node22/bin/npm` (ou rode `export PATH=/opt/node22/bin:$PATH` na sessão antes dos comandos).

> Se a VPS usa processador ARM, troque `linux-x64` por `linux-arm64`.

---

## 4. PostgreSQL: banco e usuário exclusivos

**Se o PostgreSQL já está instalado** (passo 1 mostrou `active`), apenas crie um usuário e um banco
novos — nenhuma configuração do PostgreSQL é alterada. **Se não está instalado**, confira antes que a
porta 5432 está livre (`sudo ss -ltnp | grep 5432`) e instale:

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-client
```

Gere uma senha forte para o banco e guarde-a (você vai usá-la no `.env`):

```bash
openssl rand -base64 30 | tr -d '/+=' | cut -c1-32
```

Crie o usuário (sem privilégios de superusuário) e o banco. O comando abaixo pede a senha de forma
oculta, sem deixá-la no histórico:

```bash
sudo -u postgres createuser --no-superuser --no-createdb --no-createrole --pwprompt vitrine_app
sudo -u postgres createdb --owner=vitrine_app --encoding=UTF8 vitrine_softwares
sudo -u postgres psql -c "REVOKE ALL ON DATABASE vitrine_softwares FROM PUBLIC;"
```

Teste a conexão (vai pedir a senha):

```bash
psql "postgresql://vitrine_app@127.0.0.1:5432/vitrine_softwares" -c "SELECT 1;"
```

> Se der `password authentication failed` mesmo com a senha certa, o `pg_hba.conf` pode não aceitar
> senha em 127.0.0.1. Veja a seção [Solução de problemas](#16-solução-de-problemas) antes de alterar
> qualquer configuração, pois ela também vale para os outros sites.

---

## 5. Usuário Linux e código do site

Crie um usuário de sistema, sem login, só para executar o site:

```bash
sudo useradd --system --user-group --home-dir /var/www/vitrine-softwares --no-create-home --shell /usr/sbin/nologin vitrine
sudo mkdir -p /var/www/vitrine-softwares
sudo chown vitrine:vitrine /var/www/vitrine-softwares
sudo chmod 750 /var/www/vitrine-softwares
```

Instale o `git`, se ainda não houver:

```bash
sudo apt-get install -y git
```

**Repositório público:**

```bash
sudo -u vitrine git clone https://github.com/everton16luis-eng/vitrine-softwares.git /var/www/vitrine-softwares
```

**Repositório privado (deploy key somente leitura):**

```bash
sudo mkdir -p /etc/vitrine && sudo chown vitrine:vitrine /etc/vitrine && sudo chmod 700 /etc/vitrine
sudo -u vitrine ssh-keygen -t ed25519 -N "" -C "deploy vitrine" -f /etc/vitrine/deploy_key
sudo cat /etc/vitrine/deploy_key.pub
```

No GitHub: repositório → **Settings → Deploy keys → Add deploy key**, cole a chave pública e deixe
**"Allow write access" desmarcado**. Depois:

```bash
sudo -u vitrine env GIT_SSH_COMMAND="ssh -i /etc/vitrine/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/vitrine/known_hosts -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:everton16luis-eng/vitrine-softwares.git /var/www/vitrine-softwares
sudo -u vitrine git -C /var/www/vitrine-softwares config core.sshCommand "ssh -i /etc/vitrine/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/vitrine/known_hosts"
```

> O `known_hosts` fica em `/etc/vitrine` de propósito: a pasta "home" do usuário `vitrine` é a
> própria pasta do site, que precisa estar vazia no momento do `git clone`.

Instale as dependências (somente as de produção):

```bash
cd /var/www/vitrine-softwares
sudo -u vitrine env HOME=/tmp npm ci --omit=dev --no-audit --no-fund
```

> Se aparecer erro de compilação do `argon2`, instale as ferramentas de build e repita:
> `sudo apt-get install -y build-essential python3`.

---

## 6. Configuração (.env)

Crie o `.env` a partir do modelo e proteja-o:

```bash
cd /var/www/vitrine-softwares
sudo -u vitrine cp .env.example .env
sudo chmod 640 .env
```

Gere o segredo da aplicação:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Edite o arquivo:

```bash
sudo -u vitrine nano /var/www/vitrine-softwares/.env
```

Valores de produção (ajuste os seus):

```ini
NODE_ENV=production
PORT=3010
HOST=127.0.0.1
APP_URL=https://seudominio.com.br

DATABASE_URL=postgres://vitrine_app:SENHA_DO_BANCO@127.0.0.1:5432/vitrine_softwares
DATABASE_URL_TEST=
DATABASE_SSL=false

APP_SECRET=COLE_AQUI_O_VALOR_GERADO

COOKIE_SECURE=true
TRUST_PROXY=1

STORAGE_DRIVER=local
UPLOAD_MAX_MB=5

SMTP_HOST=smtp.seuprovedor.com.br
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario@seudominio.com.br
SMTP_PASS=SENHA_DO_SMTP
MAIL_FROM="Sua Empresa <nao-responda@seudominio.com.br>"

ADMIN_NAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=
```

Pontos importantes:

- `PORT` é a porta livre escolhida no passo 1.
- `HOST=127.0.0.1` faz o site aceitar conexões **somente da própria VPS** (do Nginx). Assim a porta
  interna não fica acessível pela internet, mesmo sem firewall.
- `APP_URL` deve ser exatamente o endereço público, com `https://` e sem barra no final.
- `TRUST_PROXY=1` porque o Nginx fica na frente da aplicação (necessário para o IP real dos
  visitantes e para o limite de tentativas de login funcionar corretamente).
- Se a senha do banco tiver caracteres especiais (`@ : / ? #`), codifique-os na URL ou gere uma
  senha só com letras e números.
- Não preencha `ADMIN_PASSWORD` aqui: o administrador é criado de forma interativa no próximo passo.

---

## 7. Banco de dados e primeiro administrador

Crie as tabelas e os dados iniciais (catálogo, perfis e permissões):

```bash
cd /var/www/vitrine-softwares
sudo -u vitrine node backend/src/database/cli/migrate.js
sudo -u vitrine node backend/src/database/cli/seed.js
```

Crie o primeiro administrador (pede nome, e-mail e senha; a senha não aparece na tela):

```bash
sudo -u vitrine node backend/src/database/cli/create-admin.js
```

> Não use `npm run db:create`/`db:setup` neste cenário: eles tentam criar bancos pelo usuário do
> `.env`, que propositalmente não tem essa permissão. O banco já foi criado no passo 4.

---

## 8. Serviço systemd

O site roda como serviço próprio, que inicia com o servidor e reinicia sozinho em caso de falha.
Crie o arquivo:

```bash
sudo nano /etc/systemd/system/vitrine-softwares.service
```

Conteúdo (se você usou o Node separado do caso C, troque `/usr/bin/node` por `/opt/node22/bin/node`):

```ini
[Unit]
Description=Vitrine de softwares (site, painel e área do cliente)
After=network.target postgresql.service

[Service]
Type=simple
User=vitrine
Group=vitrine
WorkingDirectory=/var/www/vitrine-softwares
Environment=NODE_ENV=production
ExecStart=/usr/bin/node backend/src/server.js
Restart=on-failure
RestartSec=5
# Isolamento: o site só consegue gravar na própria pasta de arquivos enviados.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/www/vitrine-softwares/storage

[Install]
WantedBy=multi-user.target
```

Ative e inicie **apenas este serviço**:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vitrine-softwares
sudo systemctl status vitrine-softwares --no-pager
```

Teste localmente (deve responder `{"status":"ok"}`):

```bash
curl -s http://127.0.0.1:3010/saude
```

Logs do site:

```bash
sudo journalctl -u vitrine-softwares -f
```

> **Já usa PM2 para os outros sites?** Pode usá-lo no lugar do systemd:
> `sudo -u vitrine pm2 start backend/src/server.js --name vitrine-softwares --cwd /var/www/vitrine-softwares`,
> depois `pm2 save`. Use **um** dos dois, nunca ambos.

---

## 9. Garantir que a porta interna não fique exposta

Com `HOST=127.0.0.1` no `.env` (passo 6), a aplicação só aceita conexões da própria VPS; quem a
recebe de fora é o Nginx (portas 80/443). Confirme na VPS — a coluna de endereço deve mostrar
`127.0.0.1:3010`, e não `*:3010` ou `0.0.0.0:3010`:

```bash
sudo ss -ltnp | grep 3010
```

E do **seu computador** (não da VPS):

```bash
curl -m 5 http://203.0.113.10:3010/saude
```

- **Deu tempo esgotado / conexão recusada:** ótimo, a porta está fechada. Siga para o passo 10.
- **Respondeu `{"status":"ok"}`:** a porta está aberta para a internet. Primeiro confira se o `.env`
  tem `HOST=127.0.0.1` e reinicie o serviço (`sudo systemctl restart vitrine-softwares`). Se você
  precisar manter `HOST` vazio, feche a porta de uma das formas:
  - **Firewall do provedor** (painel da VPS: Hetzner, DigitalOcean, AWS, etc.) — a forma mais
    segura, pois não mexe no servidor: libere apenas 22, 80 e 443.
  - **UFW já ativo** (`ufw status` mostrou `active`): ele bloqueia tudo o que não foi liberado;
    confira se não há uma regra liberando a porta (`sudo ufw status numbered`).
  - **UFW inativo:** **não ative o UFW às pressas** — sem liberar antes o SSH e as portas dos outros
    sites, você pode perder o acesso ou derrubar serviços. Se quiser ativá-lo, faça nesta ordem:
    `sudo ufw allow OpenSSH`, `sudo ufw allow 'Nginx Full'`, libere qualquer outra porta pública que
    os outros serviços usem (veja o `ss -ltnp` do passo 1) e só então `sudo ufw enable`.

---

## 10. Nginx: novo site, sem tocar nos outros

Instale o Nginx somente se ele ainda não existir (`sudo apt-get install -y nginx`). Crie **um arquivo
novo**, exclusivo deste site:

```bash
sudo nano /etc/nginx/sites-available/vitrine-softwares.conf
```

Conteúdo (por enquanto só HTTP; o certbot acrescenta o HTTPS no passo 11):

```nginx
# Site de vendas (vitrine-softwares) — proxy para o Node.js na porta interna 3010
server {
    listen 80;
    listen [::]:80;
    server_name seudominio.com.br www.seudominio.com.br;

    # Uploads do painel (UPLOAD_MAX_MB=5 + margem)
    client_max_body_size 6m;

    access_log /var/log/nginx/vitrine-softwares.access.log;
    error_log  /var/log/nginx/vitrine-softwares.error.log;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

> Se a VPS não tem IPv6, remova a linha `listen [::]:80;`. Se os outros sites usam a pasta
> `/etc/nginx/conf.d/` em vez de `sites-available`, crie o arquivo como
> `/etc/nginx/conf.d/vitrine-softwares.conf` e pule o comando `ln` abaixo.

Ative o site, **valide antes de aplicar** e recarregue (o `reload` não derruba conexões nem os outros
sites; se o `nginx -t` acusar erro, nada é aplicado):

```bash
sudo ln -s /etc/nginx/sites-available/vitrine-softwares.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Se `nginx -t` falhar, leia a mensagem, corrija **somente** o arquivo `vitrine-softwares.conf` (ou
remova o link criado) e teste de novo. Nunca edite os arquivos dos outros sites para "resolver".

Teste (com o DNS já propagado):

```bash
curl -sI http://seudominio.com.br/saude
```

---

## 11. HTTPS com Let's Encrypt

Instale o certbot se ainda não houver:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

Emita o certificado **apenas para os domínios deste site**. O certbot altera somente o bloco
`server` que tem esses nomes (o arquivo `vitrine-softwares.conf`):

```bash
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br --redirect
```

Confirme a renovação automática (normalmente já existe por causa dos outros sites):

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Opcional — redirecionar `www` para o domínio principal (ou o contrário) para não duplicar páginas
nos buscadores: no arquivo `vitrine-softwares.conf`, dentro do bloco `listen 443`, adicione no início
do `server`:

```nginx
if ($host = www.seudominio.com.br) { return 301 https://seudominio.com.br$request_uri; }
```

Depois: `sudo nginx -t && sudo systemctl reload nginx`. O endereço escolhido deve ser o mesmo do
`APP_URL`.

---

## 12. Conferência final

| Verificação | Como |
| --- | --- |
| Site no ar com HTTPS | abrir `https://seudominio.com.br` |
| HTTP redireciona para HTTPS | `curl -sI http://seudominio.com.br` → `301` |
| Saúde | `curl -s https://seudominio.com.br/saude` → `{"status":"ok"}` |
| Painel | `https://seudominio.com.br/admin/` → entrar com o administrador do passo 7 |
| E-mail | formulário de contato ou "Esqueci minha senha" com um e-mail seu |
| Upload | enviar uma imagem na Biblioteca de mídia do painel |
| Porta interna fechada | passo 9, de fora da VPS |
| **Outros sites** | abrir cada um deles e conferir que continuam normais |
| Reinício | `sudo systemctl restart vitrine-softwares` e o site volta em segundos |

No painel, revise **Configurações** (nome da empresa, contatos, WhatsApp, redes sociais) e o
catálogo de produtos.

---

## 13. Central de Implantação (opcional)

Só é necessária se você for usar o painel para instalar os sistemas dos clientes **nesta mesma
VPS**. Leia antes o [guia da Central](IMPLANTACOES.md).

1. Requisitos: `git`, `nginx`, `certbot`, PostgreSQL local e `pg_dump` (já instalados nos passos
   anteriores).
2. Execute o script de preparação. Ele não altera Nginx, PostgreSQL nem outros serviços; só cria o
   usuário `implantador`, as pastas `/srv/clientes` e `/var/www/vitrine-acme`, o auxiliar root e uma
   regra de sudoers validada:

   ```bash
   cd /var/www/vitrine-softwares
   sudo bash deploy/implantacao/preparar-servidor.sh --sem-agente
   ```

   Com o Node separado do caso C: `sudo env PATH=/opt/node22/bin:$PATH bash deploy/implantacao/preparar-servidor.sh --sem-agente`.

3. Dê ao agente permissão de **leitura** no projeto e no `.env`:

   ```bash
   sudo usermod -aG vitrine implantador
   sudo chmod -R g+rX /var/www/vitrine-softwares
   sudo chmod 640 /var/www/vitrine-softwares/.env
   ```

4. No `.env`, acrescente:

   ```ini
   IMPLANTACAO_EXECUTOR=linux
   IMPLANTACAO_IPS=203.0.113.10
   IMPLANTACAO_EMAIL_SSL=voce@seudominio.com.br
   IMPLANTACAO_CHAVE=COLE_32_OU_MAIS_CARACTERES_ALEATORIOS
   ```

   Gere a chave com `openssl rand -hex 32` e **guarde uma cópia segura** fora do servidor.

5. Agora instale e inicie o agente, e reinicie o site para ler o `.env` novo:

   ```bash
   sudo bash deploy/implantacao/preparar-servidor.sh
   sudo systemctl restart vitrine-softwares
   systemctl status vitrine-implantacao-agente --no-pager
   ```

6. No painel, **Implantação › Implantações** não deve mais mostrar o aviso "O agente de implantação
   não está em execução".

A Central usa as portas **4100–4999**: confirme no `ss -ltnp` do passo 1 que nenhum outro serviço
usa essa faixa.

---

## 14. Backups automáticos

Crie a pasta de backups (acessível só pelo root):

```bash
sudo install -d -m 700 /var/backups/vitrine-softwares
```

Crie o script:

```bash
sudo nano /usr/local/sbin/backup-vitrine-softwares
```

```bash
#!/usr/bin/env bash
# Backup diário do banco e dos arquivos enviados do site de vendas (mantém 30 dias).
set -euo pipefail
DEST=/var/backups/vitrine-softwares
STAMP=$(date +%Y%m%d-%H%M)
sudo -u postgres pg_dump --format=custom --no-owner vitrine_softwares > "$DEST/banco-$STAMP.dump"
tar -czf "$DEST/storage-$STAMP.tar.gz" -C /var/www/vitrine-softwares storage
chmod 600 "$DEST"/*-"$STAMP".*
find "$DEST" -maxdepth 1 -type f \( -name 'banco-*.dump' -o -name 'storage-*.tar.gz' \) -mtime +30 -delete
```

Ative e agende para 3h da manhã:

```bash
sudo chmod 700 /usr/local/sbin/backup-vitrine-softwares
sudo /usr/local/sbin/backup-vitrine-softwares && sudo ls -lh /var/backups/vitrine-softwares
echo "0 3 * * * root /usr/local/sbin/backup-vitrine-softwares" | sudo tee /etc/cron.d/backup-vitrine-softwares
```

Recomendações:

- Copie os backups para **fora da VPS** (outro servidor, armazenamento S3/B2, etc.). Backup que só
  existe na própria VPS se perde junto com ela.
- Os backups contêm dados pessoais dos clientes: mantenha-os com acesso restrito e, fora do
  servidor, criptografados.
- Faça um **teste de restauração** periodicamente em um banco separado:

  ```bash
  sudo -u postgres createdb --owner=vitrine_app vitrine_restore_teste
  sudo -u postgres pg_restore --no-owner --role=vitrine_app -d vitrine_restore_teste /var/backups/vitrine-softwares/banco-AAAAMMDD-HHMM.dump
  sudo -u postgres dropdb vitrine_restore_teste
  ```

Se você usa a Central de Implantação, os bancos e arquivos de cada cliente ficam em
`/srv/clientes/<identificador>`; inclua essa pasta e esses bancos na sua política de backup.

---

## 15. Atualizar o site

```bash
sudo /usr/local/sbin/backup-vitrine-softwares
cd /var/www/vitrine-softwares
sudo -u vitrine git pull --ff-only
sudo -u vitrine env HOME=/tmp npm ci --omit=dev --no-audit --no-fund
sudo -u vitrine node backend/src/database/cli/migrate.js
sudo systemctl restart vitrine-softwares
curl -s http://127.0.0.1:3010/saude
```

Se usa a Central de Implantação, atualize também o auxiliar e o agente:

```bash
sudo bash deploy/implantacao/preparar-servidor.sh
```

Não rode o `seed.js` nem o `create-admin.js` em atualizações; eles são só para a primeira
instalação. Se algo der errado após a atualização, volte o código (`sudo -u vitrine git checkout
<commit anterior>`), reinicie o serviço e, se a atualização tiver alterado o banco, restaure o backup
feito no primeiro comando.

---

## 16. Solução de problemas

| Sintoma | Causa provável e solução |
| --- | --- |
| **502 Bad Gateway** | O Node não está rodando ou a porta do Nginx difere do `PORT`. Veja `sudo journalctl -u vitrine-softwares -n 50` e confira `proxy_pass` × `PORT`. |
| Serviço reinicia em loop | Erro de configuração no `.env` (banco, `APP_SECRET` curto em produção). A causa aparece no `journalctl`. |
| `password authentication failed` | Senha do banco errada no `DATABASE_URL`, ou o `pg_hba.conf` não aceita senha em `127.0.0.1`. Confira com `sudo grep -v '^#' /etc/postgresql/*/main/pg_hba.conf`. Se precisar, acrescente **uma linha específica** `host vitrine_softwares vitrine_app 127.0.0.1/32 scram-sha-256` antes das regras genéricas e aplique com `sudo systemctl reload postgresql` (reload não derruba conexões). |
| `conflicting server name` no `nginx -t` | Outro arquivo já usa o mesmo domínio. Descubra qual com `sudo grep -rn "seudominio.com.br" /etc/nginx/` e decida qual site deve atender o domínio. |
| Login no painel volta para a tela de entrada | Site acessado por HTTP ou proxy sem `X-Forwarded-Proto`. Use HTTPS, mantenha `COOKIE_SECURE=true`, `TRUST_PROXY=1` e o cabeçalho no Nginx. |
| Muitas tentativas bloqueadas para todo mundo | `TRUST_PROXY` errado: todos parecem vir do IP do Nginx. Use `TRUST_PROXY=1`. |
| Erro ao enviar imagens | Permissão da pasta `storage/` (`sudo chown -R vitrine:vitrine /var/www/vitrine-softwares/storage`) ou arquivo maior que `client_max_body_size`/`UPLOAD_MAX_MB`. |
| E-mails não chegam | `SMTP_*` incompleto (o sistema registra "envio indisponível"), porta 587 bloqueada pelo provedor da VPS ou falta de SPF/DKIM no domínio remetente. |
| Certbot falha no desafio | DNS ainda não aponta para a VPS ou a porta 80 está bloqueada. Confira o passo 2 e o firewall do provedor. |
| Esqueceu a senha do administrador | `cd /var/www/vitrine-softwares && sudo -u vitrine node backend/src/database/cli/reset-password.js` |

---

## 17. Remover o site sem afetar os outros

Se precisar desfazer a instalação (faça um backup antes):

```bash
sudo systemctl disable --now vitrine-softwares
sudo rm /etc/systemd/system/vitrine-softwares.service && sudo systemctl daemon-reload
sudo rm /etc/nginx/sites-enabled/vitrine-softwares.conf
sudo nginx -t && sudo systemctl reload nginx
```

O banco (`vitrine_softwares`), o usuário do banco, a pasta `/var/www/vitrine-softwares`, o usuário
Linux `vitrine` e o certificado podem ser removidos depois, com calma, quando tiver certeza de que
não serão mais necessários. Nenhum desses itens é compartilhado com os outros sites.
