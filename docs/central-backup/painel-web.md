# Painel web (frontend)

Código em [`central-backup/apps/web`](../../central-backup/apps/web). Usa React 19, Vite 6, Tailwind 4,
componentes no estilo shadcn/ui, recharts e lucide.

## 1. Como funciona

| Ponto | Como foi feito |
| --- | --- |
| Mesma origem | O processo do painel (`npm run start:panel`, porta 4300) serve a API (`/api/v1`) e o build do front (`apps/web/dist`). O cookie de sessão é `SameSite=Strict` e o token CSRF vai no cabeçalho `x-csrf-token`, então não há CORS nem segundo domínio. |
| Formulários | Gerados do **OpenAPI da própria API** (`/api/v1/openapi.json`): campos, limites, enums e obrigatórios são os que o servidor valida. Erros de validação voltam no campo certo. Campos `*_id`/`*_ids` viram seletores com os registros reais. |
| `config` por tipo | Destinos (local/S3) e canais (e-mail/webhook/WhatsApp) têm `config`/`secret` validados depois pelo servidor. Os schemas desses campos são **exportados do código da API** (`npm run web:gen` → `src/lib/schemas.gen.ts`). |
| Permissões | `npm run web:gen` também gera `src/lib/perms.gen.ts` (rota → permissão) a partir das rotas da API. Um botão só aparece se o perfil do usuário pode executar aquela rota. Nenhum botão leva a algo que a API recusaria por perfil. A API continua checando tudo. |
| Edição | Envia só os campos alterados. |
| Ações destrutivas | Arquivar, revogar agente, aprovar restauração de produção e redefinir 2FA pedem que o nome do objeto seja digitado. A aprovação de produção também é conferida no servidor. |
| Segredos | Senhas de banco, credenciais S3 e segredos de canais são só de escrita. A tela mostra "definida/não definida", nunca o valor. O material das chaves (KEK) não passa pela API: a rotação e o kit de recuperação são feitos no CLI do servidor. |
| CSP | `default-src 'self'`, `script-src 'self'` (sem script inline), `connect-src 'self'`, `frame-ancestors 'none'`. Só `style-src` aceita `'unsafe-inline'`, porque os gráficos usam atributos `style`. |
| Tema | Claro/escuro, seguindo o sistema ou a escolha do usuário (guardada no navegador). |

## 2. Telas

| Menu | O que dá para fazer |
| --- | --- |
| Login | Entrar; ativar 2FA obrigatório (QR, chave manual, códigos de recuperação) ou verificar com código/recuperação |
| Visão geral | Contagem por saúde, alertas ativos, servidores com CPU/memória/disco, jobs com falha e problemas |
| Alertas | Filtrar, reconhecer com observação, ver as notificações enviadas por canal |
| Execuções | Execuções de backup com atualização automática; detalhe com resumo, tarefa e log |
| Restaurações | Lista e detalhe com log e resultado. Aprovar (outra pessoa, digitando o nome do servidor), rejeitar, cancelar |
| Clientes | Criar, editar, arquivar; servidores do cliente |
| Servidores | Criar, editar, arquivar. Código de instalação do agente (com o comando pronto) e envio de operação do catálogo. Abas: métricas (6 h a 90 dias), inventário, bancos (descobrir), aplicações, jobs, tarefas |
| Agentes | Lista (com revogados), detalhe com certificados, revogação e tarefas |
| Bancos | Criar, editar, arquivar, definir/trocar senha, testar conexão |
| Aplicações | Criar, editar, arquivar (diretórios, configurações, domínios, bancos, RPO/RTO) |
| Armazenamento | Destinos local (rest-server) e S3: criar, editar, testar, credencial, arquivar; repositórios com tamanho e verificação |
| Políticas | Agenda, retenção, verificação, limite de upload e testes periódicos de restauração |
| Jobs | Criar (arquivos ou banco), editar, executar agora, arquivar; execuções e snapshots do job |
| Snapshots | Navegar nos arquivos, verificar, retenção legal, pedir restauração (modos conforme o tipo; produção só para quem tem permissão) |
| pgBackRest | Stanzas com agenda full/diff, executar full/diff/incr/info, backups no repositório e execuções |
| Planos de DR | Gerar, regenerar, ver pendências, passos, RPO/RTO e o que reproduzir. Baixar o playbook Ansible, gerar o cloud-init e registrar exercícios |
| Regras de alerta | Criar, editar, arquivar, criar as recomendadas |
| Canais | E-mail, webhook (URL e chave cifradas) e WhatsApp: criar, editar, testar, arquivar |
| Relatórios | Relatório de backups por período e cliente, na tela e em CSV |
| Tarefas | Tarefas dos agentes, detalhe com parâmetros, resultado e log; cancelar pendentes |
| Usuários | Criar, editar perfis, clientes e situação, redefinir 2FA; perfis e permissões |
| Auditoria | Lista com busca e verificação da cadeia de hashes |
| Sistema | Backup da central (estado, histórico, executar agora) e uso das KEKs |
| Minha conta | Trocar senha, ver e encerrar sessões |

## 3. Instalação e desenvolvimento

No servidor, depois do `npm ci`:

```bash
npm run web:build
```

O build vai para `apps/web/dist`, que o painel serve sozinho. Outro diretório pode ser indicado em
`WEB_DIST`. Para publicar com HTTPS use o exemplo `deploy/nginx/central-painel.conf.example`, que não
altera os outros sites do Nginx.

Desenvolvimento com recarga automática (a API precisa estar rodando na 4300):

```bash
npm run web:dev
```

Sempre que rotas ou permissões da API mudarem, rode `npm run web:gen`. O `web:build` já faz isso.

## 4. Testes

- **Automático** (`tests/unit/web.test.ts`): serve o build e o CSP; rotas da SPA caem no
  `index.html`; arquivo inexistente dá 404; `/api` não é engolido; tentativas de sair do diretório
  (`..`, `%2e%2e`, `..%2f`, URL malformada) não vazam arquivos; sem build, só a API responde.
- **No navegador** (painel local, banco de desenvolvimento, rest-server real):
  - login e ativação do 2FA, códigos de recuperação e sessão mantida ao recarregar;
  - cliente, servidor e código de instalação;
  - destino local, que falha com o rest-server desligado e passa com ele ligado;
  - política com retenção aninhada e job de arquivos;
  - 10 regras recomendadas e canal webhook com teste que falha honestamente;
  - plano de DR com as pendências reais, download do playbook e verificação da auditoria;
  - todas as telas de lista carregando sem erro de JavaScript nem bloqueio de CSP.
- **Validações que chegaram ao campo certo**:
  - CNPJ inválido;
  - destino local sem "imutável";
  - job com destino não testado;
  - execução sem agente ativo;
  - troca de endereço de destino em uso.
- **Problemas encontrados e corrigidos**:
  - a edição mandava campos não alterados, e a API recusava a edição do destino;
  - estados apareciam sem acento;
  - o primeiro login (ativação do 2FA) não registrava o último acesso.

## 5. O que não foi verificado aqui

| Item | Situação |
| --- | --- |
| Telas que dependem de agente conectado | Métricas, inventário, tarefas, execuções, snapshots, navegação em arquivos e restauração. As telas estão prontas e a API delas é coberta pelos testes de integração, mas no navegador ficaram vazias porque não havia agente registrado. **Testar no Ubuntu** com um agente real. |
| Layout no celular | Responsivo (menu lateral vira gaveta abaixo de 1024 px), mas a conferência visual foi feita só na largura de desktop. |
| Navegadores | Testado no Chromium do app. Firefox/Safari não conferidos. |
| Tamanho do bundle | 870 KB (253 KB gzip), num arquivo só; dá para dividir por rota depois. |
