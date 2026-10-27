# Segurança e privacidade

## Medidas implementadas

| Tema | Implementação |
| --- | --- |
| Senhas | Argon2id (m=19 MiB, t=2, p=1). Política: ≥ 10 caracteres, letras e números, sem conter o e-mail. Comparação em tempo constante mesmo para usuários inexistentes |
| Sessões | Token aleatório de 256 bits no cookie; no banco fica apenas o SHA-256. Expiração absoluta (`SESSION_TTL_HOURS`) e por inatividade (`SESSION_IDLE_MINUTES`). Revogação no logout, troca de senha, alteração de permissões e desativação de conta |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção |
| CSRF | Token por sessão exigido no cabeçalho `X-CSRF-Token` em toda requisição autenticada que altera estado + verificação de `Origin`/`Referer` |
| XSS | Templates com escape automático; Markdown renderizado com escape total e somente links http(s)/mailto/tel; painel monta o DOM com `textContent`; CSP sem `unsafe-inline` |
| SQL injection | Somente consultas parametrizadas; nomes de colunas vêm do código, nunca da requisição; termos de busca com curingas escapados |
| Autorização | Verificada no servidor em cada rota (`requirePermission`). Esconder botões é só usabilidade. Permissões de gestão de usuários/configurações/auditoria são exclusivas do perfil Administrador |
| Escalonamento de privilégios | Validação com lista branca de campos (campos extras são descartados); o primeiro administrador é criado apenas por CLI; o último administrador não pode ser desativado |
| Isolamento de clientes | O `cliente_id` vem da sessão; todas as consultas filtram por ele; IDs alheios retornam 404 |
| Enumeração de contas | Mesma mensagem para usuário inexistente, senha errada, conta inativa ou bloqueada; "esqueci a senha" responde igual sempre |
| Força bruta | Rate limit por IP (login 10/15 min, formulários 6/10 min, redefinição 5/30 min, API 300/min) e bloqueio da conta por 15 min após 5 falhas |
| Spam | Honeypot, token de formulário assinado (HMAC) com tempo mínimo de preenchimento e validade de 24 h, rate limit |
| Uploads | Tipo detectado pelos bytes (JPG/PNG/WEBP; PDF/ZIP apenas em documentos privados), extensão coerente, limite de tamanho, SVG proibido, nome aleatório gerado pelo servidor, gravação com flag exclusiva (nunca sobrescreve), proteção contra path traversal, reprocessamento das imagens (remove EXIF e conteúdo embutido), arquivos públicos servidos com `nosniff` e CSP `sandbox`, documentos privados só por rota autenticada |
| Cabeçalhos | Helmet: CSP estrita, HSTS (produção), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`, sem `X-Powered-By` |
| Erros | Tratamento centralizado; mensagens genéricas para erros internos; detalhes só no log do servidor, sem corpo de requisição |
| Logs e auditoria | Auditoria omite automaticamente campos como senha, token, hash e documento |
| Segredos | Somente em variáveis de ambiente; nada sensível em `configuracoes` nem no JavaScript do navegador; `.env` fora do Git |
| CORS | Não habilitado (mesma origem) |
| Pagamentos | Nenhuma confirmação sem webhook com assinatura válida; eventos idempotentes |

## LGPD

**Coleta mínima e finalidade:** os formulários pedem apenas nome, e-mail e mensagem como obrigatórios; telefone e empresa são opcionais. Cada formulário informa a finalidade do uso dos dados.

**Consentimentos:** a ciência da Política de Privacidade é obrigatória para enviar; o aceite de comunicações de marketing é opcional e **nunca vem pré-marcado**. Ambos ficam registrados com data.

**Cookies:** apenas o cookie de sessão (essencial). Não há analytics, pixels ou publicidade, por isso não há banner de consentimento — apenas um aviso informativo. Se incluir ferramentas de análise no futuro, implemente consentimento prévio e granular.

**IP:** não é armazenado em formulários públicos; guarda-se apenas um hash com segredo para antiabuso.

**Direitos dos titulares:** formulário público em `/privacidade/solicitacao`, painel **Privacidade (LGPD)** para acompanhamento, exportação dos dados do titular (JSON) e anonimização irreversível do cliente, seus leads e mensagens, preservando registros comerciais sem identificação pessoal.

**Controle de acesso:** dados de clientes e leads só para perfis com permissão; exportações são auditadas.

> Este sistema oferece instrumentos para apoiar a adequação à LGPD, mas **não garante conformidade legal por si só**. Os textos jurídicos fornecidos são modelos e devem ser revisados por profissional habilitado, assim como os prazos de retenção e as bases legais aplicáveis ao seu caso.

## Checklist antes de ir para produção

- [ ] `NODE_ENV=production`, `APP_URL` com `https://`, `APP_SECRET` aleatório (≥ 48 bytes)
- [ ] HTTPS no proxy e `TRUST_PROXY` correto
- [ ] Usuário do banco exclusivo da aplicação, sem superusuário
- [ ] SMTP com SPF/DKIM/DMARC
- [ ] Backups automáticos testados
- [ ] Textos jurídicos revisados; aviso "em revisão" desativado
- [ ] Dados de contato reais em Configurações; aviso de implantação desativado
- [ ] Produtos com status comercial verdadeiro
- [ ] Dependências atualizadas (`npm audit`)
