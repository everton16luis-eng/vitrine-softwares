# Central de Implantação — guia de uso

A Central de Implantação instala, configura, testa e entrega cada sistema contratado em um
**ambiente isolado por cliente**, a partir do painel administrativo (menu **Implantação**).
A arquitetura e as decisões de segurança estão em [IMPLANTACOES-PROPOSTA.md](IMPLANTACOES-PROPOSTA.md).

## Como funciona, em uma frase

O painel **nunca executa comandos**: ele grava tarefas numa fila no PostgreSQL. Um processo separado
(o **agente**, `npm run agente`) consome a fila e executa apenas operações de uma lista fechada. As
operações que exigem root passam por um único **auxiliar** (`deploy/implantacao/helper.mjs`), liberado
por uma única regra de sudoers e que valida todos os parâmetros.

```
Painel ──tarefa──▶ PostgreSQL (fila) ◀── Agente (usuário "implantador") ──sudo──▶ Auxiliar root (lista fechada)
```

## 1. Preparar o servidor (uma vez)

Requisitos: Ubuntu/Debian, Node.js 20+ instalado no sistema (não via nvm), `git`, `nginx`, `certbot`,
PostgreSQL local (`postgresql` e `postgresql-client`) e o timer de renovação do certbot ativo.

```bash
sudo bash deploy/implantacao/preparar-servidor.sh
```

O script cria o usuário `implantador`, os diretórios `/srv/clientes` e `/var/www/vitrine-acme`, instala o
auxiliar em `/usr/local/lib/vitrine-implantacao`, a regra `/etc/sudoers.d/vitrine-implantacao` (validada
com `visudo`) e o serviço `vitrine-implantacao-agente`. Ele **não** instala pacotes nem altera Nginx,
PostgreSQL, firewall ou serviços existentes — apenas avisa o que falta. Pode ser executado de novo, e
deve ser executado sempre que o código do painel for atualizado.

No `.env` do site, configure:

| Variável | Para quê |
| --- | --- |
| `IMPLANTACAO_IPS` | IP(s) públicos do servidor (conferência do DNS dos clientes) |
| `IMPLANTACAO_EMAIL_SSL` | e-mail dos certificados Let's Encrypt |
| `IMPLANTACAO_CHAVE` | chave das credenciais cifradas (recomendado; sem ela, deriva de `APP_SECRET`) |
| `IMPLANTACAO_EXECUTOR` | `linux` em produção; `simulado` para ensaiar sem tocar no servidor |

> Guarde uma cópia segura de `IMPLANTACAO_CHAVE`. Trocá-la torna ilegíveis as credenciais já salvas.

Comandos úteis:

```bash
systemctl status vitrine-implantacao-agente
```

```bash
journalctl -u vitrine-implantacao-agente -f
```

## 2. Cadastrar a receita do software

**Implantação › Receitas por software › Nova receita.** Cada software tem sua receita — a central não
presume que todos usam a mesma tecnologia ou processo. Hoje a tecnologia suportada é Node.js; outras
podem ser acrescentadas na política (`backend/src/modules/deployments/policy.js`).

| Seção | O que informar |
| --- | --- |
| Identificação | software, repositório Git **HTTPS** (sem usuário/token na URL), branch/tag/commit, versão, Node mínimo, se usa banco |
| Comandos | instalação, build, migrations, seed, personalização e inicialização. Permitidos: `npm ci`, `npm install`, `npm run <script> [-- args]`, `node <arquivo.js do projeto>`. Sem shell, `&&`, `;`, redirecionamentos, `npx`, `node -e` etc. |
| Informações do cliente | uma por linha: `chave \| rótulo \| tipo \| responsável \| obrigatorio \| padrão` |
| Variáveis (.env) | uma por linha: `NOME=origem` ou `NOME=origem:valor` (veja abaixo) |
| Servidor | diretórios persistentes entre versões (ex.: `storage/uploads`), upload máximo, tempo limite, WebSocket, verificações HTTP (`/saude 200`) |

Origens das variáveis: `fixo:<valor>` (não sigiloso), `gerado` (segredo aleatório criado uma vez),
`banco` (URL do banco exclusivo), `dominio` (`https://…`), `host`, `porta`, `cliente:<chave>` e
`segredo:<chave de campo sigiloso>`. Senhas nunca são digitadas na receita.

Repositório privado: use o botão de chave na lista para salvar um token **somente leitura** (ex.:
token fine‑grained do GitHub com "Contents: read"). Ele fica cifrado e nunca é exibido nem registrado.

## 3. Fluxo de uma implantação

**Implantação › Implantações › Nova implantação**: escolha cliente, software/receita, domínio (pode
ficar para depois) e responsável. O sistema gera o identificador e reserva os recursos exclusivos:

| Recurso | Exemplo (`acme-churchflow`) |
| --- | --- |
| Diretório | `/srv/clientes/acme-churchflow/{releases,current,shared,logs,backups}` |
| Usuário Linux | `app-acme-churchflow` (sem login) |
| Banco e papel | `cli_acme_churchflow` (sem superusuário) |
| Porta interna | 4100–4999, única por implantação |
| Serviço | `vitrine-app-acme-churchflow` (systemd, com isolamento) |
| Site Nginx | `vitrine-acme-churchflow.conf` |

As sete etapas aparecem na linha do tempo da implantação:

1. **Contratação** — registrada na criação.
2. **Informações do cliente** — botão **Atualizar** preenche os campos da receita. Credenciais
   (tipo "segredo") exigem a permissão *Gerenciar credenciais*, são cifradas e aparecem só como
   "Definido". Enquanto faltar algo obrigatório, a instalação não pode começar.
3. **Preparação da infraestrutura** — requisitos, usuário e diretórios.
4. **Instalação** — código, banco, `.env` (permissão 600), dependências, build, ativação da versão,
   backup + migrations, seed, serviço, Nginx, DNS, SSL e HTTPS.
5. **Personalização** — aplica os dados do cliente e reinicia a aplicação.
6. **Testes e validação** — aplicação, serviço, banco, migrations, DNS, SSL, renovação, HTTPS e as
   verificações da receita.
7. **Entrega** — liberada só quando tudo passou.

Botões: **Iniciar instalação**, **Continuar** (retoma do ponto em que parou), **Reexecutar** em cada
passo, **Executar testes**, **Ver logs** (ao vivo), **Atualizar** informações do cliente e **Finalizar
entrega**. A página pode ser fechada: o agente continua e a tela se atualiza ao voltar.

### Domínio e DNS

Se o domínio ainda não aponta para o servidor, a instalação para em *Verificar o apontamento do
domínio* com o status **Aguardando cliente** e mostra as instruções (registro A/AAAA com os IPs de
`IMPLANTACAO_IPS`) para enviar ao cliente — copie pelo botão. O agente recheca o DNS a cada 5 minutos e
retoma sozinho quando estiver correto; também é possível clicar em **Verificar DNS**.
O menu **Domínios e SSL** mostra todos os domínios, a validade dos certificados e a renovação.

Trocar o domínio depois do Nginx configurado refaz Nginx, DNS, SSL e HTTPS da implantação.

### Falhas, reexecução e retomada

- Cada passo é idempotente. Em caso de erro, o passo e a etapa ficam como **Falhou** com a mensagem;
  corrija a causa e use **Reexecutar** no passo ou **Continuar**.
- Reexecutar *criar banco*, *migrations* ou *seed* exige administrador; um backup do banco
  (`pg_dump`, em `backups/`) é feito antes de toda execução de migrations.
- Se o agente cair no meio de uma tarefa, ela volta para a fila após 2 minutos sem sinal e continua
  do último passo concluído (até 3 tentativas).
- Só existe uma tarefa ativa por implantação; não é possível disparar duas instalações iguais.

### Entrega

**Finalizar entrega** pede as instruções de acesso e gera o **resumo de entrega** (imprimível):
software, versão, endereço, data, recursos, orientações da receita e resultado das verificações. O
resumo **não pode conter senhas** — o sistema recusa textos com credenciais da instalação ou com
"senha: …". Oriente o cliente a definir a própria senha pelo sistema.

## 4. Permissões

| Permissão | Permite |
| --- | --- |
| `implantacoes.ver` | ver implantações, logs, domínios e receitas |
| `implantacoes.editar` | criar implantações, informar dados do cliente, cancelar |
| `implantacoes.executar` | iniciar/continuar/reexecutar, testar e entregar |
| `implantacoes.receitas` | criar e alterar receitas e tokens de repositório |
| `implantacoes.segredos` | definir credenciais sigilosas do cliente |

O perfil administrador recebe todas. Atribua as demais em **Usuários e perfis**.

## 5. Segurança — o que a central garante

- Lista fechada de operações; nenhum campo do painel vira comando de shell. Comandos da receita são
  validados (lista de executáveis, opções e caracteres) no painel, no agente **e** no auxiliar root.
- Cada instalação roda com usuário Linux próprio, banco e papel próprios, porta própria, serviço
  systemd com `NoNewPrivileges`, `ProtectSystem` e escrita limitada ao próprio diretório.
- O auxiliar nunca toca em recursos que não derivem do identificador da instalação: não altera sites
  Nginx, serviços, portas ou bancos de outros projetos. Antes de gravar o Nginx ele confere se outro
  site já atende o domínio, roda `nginx -t` e desfaz a alteração se a validação falhar.
- Operações dentro dos diretórios da aplicação são feitas como o usuário da aplicação, para que links
  simbólicos não possam ser usados para escalar privilégio.
- Senhas, tokens e chaves ficam cifrados (AES‑256‑GCM) e são mascarados nos logs; nunca aparecem em
  respostas da API, na auditoria nem no resumo de entrega. Parâmetros sigilosos vão ao auxiliar pela
  entrada padrão, nunca na linha de comando.
- Cancelar uma implantação **não remove** nada do servidor nem interrompe aplicações; a remoção, se
  necessária, é manual e deve ser feita após backup.

## 6. Ensaiar sem servidor (modo simulado)

Em desenvolvimento o executor padrão é `simulado`: o fluxo inteiro é percorrido, com a mesma
validação, sem alterar nada. Útil para testar receitas novas.

```bash
npm run agente
```

Para simular uma falha em uma operação: `IMPLANTACAO_SIMULAR_FALHA=runAppCommand npm run agente`.

## 7. Limites atuais

- Tecnologia suportada: Node.js (+ PostgreSQL opcional). Outras exigem acrescentar a política de
  comandos correspondente.
- Um servidor por instalação do painel (o agente roda no mesmo servidor das aplicações).
- Remoção de instalações e reversão para versão anterior são manuais (as três últimas versões ficam
  em `releases/`).
