# Deploy

## Variáveis de ambiente de produção

| Variável | Exemplo | Observação |
| --- | --- | --- |
| `NODE_ENV` | `production` | Ativa cookies `Secure`, HSTS e validação do `APP_SECRET` |
| `PORT` | `3000` | Porta interna |
| `HOST` | `127.0.0.1` | Interface de rede. Com proxy reverso no mesmo servidor, use `127.0.0.1` para não expor a porta interna. Vazio = todas (necessário em plataformas como Render/Railway) |
| `APP_URL` | `https://www.seudominio.com.br` | Usada em canonical, sitemap, Open Graph e links de e-mail |
| `DATABASE_URL` | `postgres://vitrine:***@host:5432/vitrine` | Usuário dedicado, sem superusuário |
| `DATABASE_SSL` | `true` | Para bancos gerenciados que exigem SSL |
| `APP_SECRET` | 96 caracteres hexadecimais | Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `TRUST_PROXY` | `1` | Número de proxies à frente da aplicação (necessário para IP real e rate limit) |
| `SMTP_*`, `MAIL_FROM` | — | E-mail transacional |
| `UPLOAD_MAX_MB` | `5` | Limite de upload |

## Passo a passo (servidor Linux com Nginx e PM2)

> Tutorial completo para uma VPS que já tem outros sites (usuário, banco, porta e Nginx isolados, HTTPS, backups e atualização): [DEPLOY-VPS.md](DEPLOY-VPS.md).

```bash
git clone <repositorio> /srv/vitrine && cd /srv/vitrine
npm ci --omit=dev
cp .env.example .env   # edite com os valores de produção
npm run db:migrate
npm run db:seed        # apenas na primeira instalação
npm run admin:create   # apenas na primeira instalação
npm install -g pm2
pm2 start backend/src/server.js --name vitrine
pm2 save && pm2 startup
```

Nginx (HTTPS com Let's Encrypt/Certbot):

```nginx
server {
  server_name www.seudominio.com.br;
  client_max_body_size 6m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  listen 443 ssl; # gerenciado pelo certbot
}
```

## Windows Server

Instale Node.js e PostgreSQL, configure o `.env` e registre a aplicação como serviço (por exemplo, com [NSSM](https://nssm.cc/)): executável `node.exe`, argumentos `backend\src\server.js`, diretório inicial a pasta do projeto. Use o IIS com URL Rewrite/ARR como proxy reverso HTTPS.

## Plataformas gerenciadas (Render, Railway, Fly.io, etc.)

- Comando de build: `npm ci --omit=dev`
- Comando de início: `npm run db:migrate && npm start`
- Banco PostgreSQL gerenciado com `DATABASE_SSL=true`
- **Disco persistente** montado em `storage/` (sem ele, uploads somem a cada deploy) — ou implemente um driver de armazenamento externo em `backend/src/services/storage/` (S3, Cloudflare R2, etc.) seguindo a interface `save/read/remove/publicUrl`.
- Execute `npm run admin:create` uma vez pelo console da plataforma.

## Atualizações

1. Faça backup do banco e de `storage/`.
2. `git pull` → `npm ci --omit=dev` → `npm run db:migrate` → reinicie (`pm2 restart vitrine`).
3. Verifique `GET /saude` e os logs.

## Monitoramento

- `GET /saude` para verificação de disponibilidade.
- Logs de erro no stdout (`[erro] ...`), sem dados sensíveis.
- Rotina horária interna remove sessões expiradas e marca orçamentos vencidos como expirados.
