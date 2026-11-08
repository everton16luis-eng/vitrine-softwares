# Instalar a Central de Backup no VPS da vitrine

Roteiro único para o cenário decidido em [06-riscos-e-decisoes.md](06-riscos-e-decisoes.md) (D2: mesmo VPS
do site; D3: disco da própria central como primeiro destino). Junta os passos das fases 1, 3 e do painel
web. Todos os comandos são no servidor, como `root`, salvo indicação.

> **Risco R14 (alto):** com a central e o único destino no mesmo VPS, a perda desse VPS leva a central
> **e** os backups. Use esta instalação para começar e validar, mas adicione uma cópia externa (S3:
> Backblaze B2, Cloudflare R2 etc.) antes de depender dela.

O que fica onde:

| Item | Local |
| --- | --- |
| Código da central | `/opt/central-backup` (dono `root`, só leitura para o serviço) |
| Configuração | `/opt/central-backup/.env` (0600, dono `central`) |
| KEK, CA, chaves | `/opt/central-backup/.data` (0700, dono `central`) |
| Repositórios restic | `/srv/central-backup/repos` (0700, dono `central`) |
| Serviços | `central-backup@panel` (127.0.0.1:4300), `central-backup@gateway` (8443), `central-backup@worker`, `central-rest-server` (127.0.0.1:8000) |

Nada disso altera o site, o Nginx nem o banco da vitrine.

## 0. Diagnóstico

```bash
node -v; restic version; rest-server --version; psql --version; nginx -v
df -h / /srv; free -h; ufw status
ss -ltnp | grep -E ':(4300|8443|8000)\b' || echo "portas livres"
```

Requisitos: Node **≥ 22.18**, restic **≥ 0.17**, rest-server, cliente do PostgreSQL, portas livres.

## 1. Node.js ≥ 22.18

A vitrine exige Node ≥ 20.11, então funciona no 22. Se o `node -v` for menor que 22.18, atualize pelo
NodeSource (o mesmo Node é usado pelo site, por isso o backup e o restart do site no fim):

```bash
sudo /usr/local/sbin/backup-vitrine-softwares
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh && less /tmp/nodesource.sh
sudo bash /tmp/nodesource.sh && sudo apt-get install -y nodejs
node -v
sudo systemctl restart vitrine-softwares && curl -s http://127.0.0.1:3010/saude
```

## 2. restic e rest-server (binários oficiais, conferidos)

```bash
cd /tmp
curl -LO https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2
curl -LO https://github.com/restic/restic/releases/download/v0.19.1/SHA256SUMS
grep restic_0.19.1_linux_amd64.bz2 SHA256SUMS | sha256sum -c -
bunzip2 -f restic_0.19.1_linux_amd64.bz2
sudo install -m 0755 restic_0.19.1_linux_amd64 /usr/local/bin/restic

curl -LO https://github.com/restic/rest-server/releases/download/v0.14.0/rest-server_0.14.0_linux_amd64.tar.gz
curl -Lo rs-SHA256SUMS https://github.com/restic/rest-server/releases/download/v0.14.0/SHA256SUMS
grep rest-server_0.14.0_linux_amd64.tar.gz rs-SHA256SUMS | sha256sum -c -
tar xzf rest-server_0.14.0_linux_amd64.tar.gz
sudo install -m 0755 rest-server_0.14.0_linux_amd64/rest-server /usr/local/bin/rest-server

sudo apt-get install -y postgresql-client
restic version && rest-server --version
```

Cada `sha256sum -c` precisa responder `OK`; se não responder, pare.

## 3. Usuário e código

```bash
id central >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/central-backup --create-home --shell /usr/sbin/nologin central
cd /var/www/vitrine-softwares && sudo -u vitrine git pull --ff-only
sudo install -d -m 0755 /opt/central-backup
sudo rsync -a --delete --exclude node_modules --exclude .data --exclude .env --exclude .tools \
  /var/www/vitrine-softwares/central-backup/ /opt/central-backup/
cd /opt/central-backup
sudo env HOME=/tmp npm ci --no-audit --no-fund
sudo env HOME=/tmp npm run web:build
sudo chown -R root:root /opt/central-backup
sudo install -d -o central -g central -m 0700 /opt/central-backup/.data
```

## 4. Banco de dados

O usuário `central` do PostgreSQL é dono do schema; `--createrole` é necessário porque a central cria o
papel `central_app` (sem login, sujeito a RLS). Guarde a senha escolhida para o próximo passo.

```bash
sudo -u postgres createuser --createrole -P central
sudo -u postgres createdb -O central central_backup
```

## 5. Configuração (`.env`)

```bash
cd /opt/central-backup
sudo cp .env.example .env && sudo chown central:central .env && sudo chmod 600 .env
sudo nano .env
```

Ajuste:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | `postgres://central:SENHA_DO_PASSO_4@127.0.0.1:5432/central_backup` |
| `GATEWAY_HOSTNAMES` | `agentes.SEUDOMINIO,IP_PUBLICO,localhost` — **o domínio primeiro**; `localhost` permite o agente deste VPS |
| `GATEWAY_PUBLIC_URL` | `https://agentes.SEUDOMINIO:8443` |

Se a porta 8443 já estiver em uso (o diagnóstico mostra quem escuta nela), **não mexa no outro
serviço**: escolha uma porta livre (ex.: `GATEWAY_PORT=9443`) e use a mesma porta em
`GATEWAY_PUBLIC_URL`, no `enroll` do passo 9 e na regra de firewall do passo 10.

Os nomes vão no certificado do gateway, que só é reemitido se o **primeiro** nome mudar: defina todos
agora. Apague a linha `DATABASE_URL_TEST` (testes não rodam em produção).

## 6. Inicializar (KEK, migrations, CA) e criar o administrador

```bash
cd /opt/central-backup
sudo -u central node apps/api/src/cli/init-ca.ts
sudo -u central node apps/api/src/cli/create-admin.ts --email voce@seudominio --name "Seu Nome"
```

A senha é pedida sem eco (mínimo 12 caracteres); o 2FA é cadastrado no primeiro login.

**Copie a KEK para fora do servidor agora** (no seu computador, não no servidor). Sem ela os segredos
da central não podem ser lidos. Guarde num cofre de senhas ou mídia offline, nunca no repositório:

```bash
scp root@IP_DO_SERVIDOR:/opt/central-backup/.data/kek ./kek-central-backup
```

## 7. Repositórios e serviços

```bash
sudo install -d -o central -g central -m 0700 /srv/central-backup /srv/central-backup/repos
sudo -u central touch /srv/central-backup/repos/.htpasswd
cd /opt/central-backup
sudo cp deploy/systemd/central-rest-server.service deploy/systemd/central-backup@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now central-rest-server central-backup@panel central-backup@gateway central-backup@worker
systemctl --no-pager status central-rest-server central-backup@panel central-backup@gateway central-backup@worker | grep -E '●|Active'
curl -s -o /dev/null -w 'painel %{http_code}\n' http://127.0.0.1:4300/
curl -s -o /dev/null -w 'rest-server %{http_code} (esperado 401)\n' http://127.0.0.1:8000/
```

Logs: `journalctl -u central-backup@panel -n 50` (troque por `gateway`, `worker`, `central-rest-server`).

## 8. Acessar o painel

Enquanto não houver DNS/HTTPS, por túnel SSH **a partir do seu computador**:

```bash
ssh -N -L 4300:127.0.0.1:4300 root@IP_DO_SERVIDOR
```

Abra `http://localhost:4300`, entre e cadastre o 2FA. Com o DNS propagado, publique em HTTPS com
`deploy/nginx/central-painel.conf.example` (arquivo novo em `sites-available`, `nginx -t` antes do reload,
certificado com `certbot --nginx -d backup.SEUDOMINIO`). De preferência restrinja por IP.

## 9. Primeiro cliente: o próprio VPS

1. No painel: cadastre o **cliente** (sua empresa) e o **destino** "Disco da central", tipo
   `local_rest`, `agent_url` = `http://127.0.0.1:8000`, `data_dir` = `/srv/central-backup/repos`,
   imutável. Use "Testar" (deve responder OK).
2. Cadastre o **servidor** e gere o código de instalação do agente.
3. Instale o agente neste mesmo VPS:

   ```bash
   cd /opt/central-backup && sudo ./apps/agent/install/install.sh
   ```

4. Registre com o comando mostrado no painel, **trocando o endereço** por `https://localhost:8443`
   (o agente está na mesma máquina):

   ```bash
   sudo central-agent enroll --url https://localhost:8443 --ca-sha256 ... --code ...
   sudo systemctl enable --now central-agent
   journalctl -u central-agent -n 30
   ```

5. Crie as políticas: arquivos de `/var/www/vitrine-softwares/storage` e banco `vitrine_softwares`
   (PostgreSQL). Rode um backup manual e depois um **teste de restauração** pelo painel.

O painel mostrará o aviso "cópia no mesmo servidor" para esse servidor até existir um destino externo.

## 10. Agentes de outros servidores (depois)

Libere a porta do gateway só para os IPs dos servidores dos clientes:

```bash
sudo ufw allow from IP_DO_CLIENTE to any port 8443 proto tcp
```

O rest-server precisa de HTTPS para agentes remotos (proxy TLS numa porta dedicada, ver
[fase-3.md](fase-3.md)).

## 11. Atualizar a central

```bash
cd /var/www/vitrine-softwares && sudo -u vitrine git pull --ff-only
sudo rsync -a --delete --exclude node_modules --exclude .data --exclude .env --exclude .tools \
  /var/www/vitrine-softwares/central-backup/ /opt/central-backup/
cd /opt/central-backup && sudo env HOME=/tmp npm ci --no-audit --no-fund && sudo env HOME=/tmp npm run web:build
sudo chown -R root:root /opt/central-backup && sudo chown -R central:central /opt/central-backup/.data /opt/central-backup/.env
sudo -u central node apps/api/src/cli/init-ca.ts   # aplica migrations novas; não recria chaves existentes
sudo systemctl restart central-backup@panel central-backup@gateway central-backup@worker
```
