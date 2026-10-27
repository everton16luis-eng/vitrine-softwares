# Rotas da aplicação

Convenções:

- Respostas JSON. Erros no formato `{ "erro": "mensagem", "codigo": "CODIGO", "campos": { "campo": "mensagem" } }`.
- Códigos HTTP: `400` requisição inválida, `401` não autenticado, `403` sem permissão / CSRF / origem, `404` não encontrado (também usado quando o registro pertence a outro cliente), `409` conflito de regra de negócio, `413` muito grande, `422` validação, `429` limite de requisições, `503` integração não configurada.
- Requisições autenticadas que alteram estado (`POST`, `PUT`, `DELETE`) exigem o cabeçalho `X-CSRF-Token` com o valor devolvido no login ou em `GET /api/auth/me`.
- Listagens paginadas aceitam `pagina` e `limite` (máx. 100) e devolvem `{ items, total, page, limit, pages }`.
- Valores monetários trafegam como string decimal (`"1500.00"`); a entrada aceita `"1.500,00"` ou `"1500.00"`.

## Páginas públicas (HTML renderizado no servidor)

| Rota | Descrição |
| --- | --- |
| `GET /` | Página inicial |
| `GET /softwares` | Catálogo (`busca`, `categoria`, `modelo`, `disponibilidade`, `pagina`) |
| `GET /softwares/:slug` | Página do produto (registra visualização agregada) |
| `GET /softwares/:slug/demonstracao` | Demonstração interativa com dados fictícios |
| `GET /servicos`, `GET /servicos/:slug` | Serviços |
| `GET /contato`, `GET /orcamento` | Formulários (`?tipo=personalizado`, `?produto=slug`) |
| `POST /contato` | Envio sem JavaScript (form-urlencoded) |
| `GET /perguntas-frequentes` | FAQ |
| `GET /privacidade/solicitacao`, `POST /privacidade/solicitacao` | Solicitação de titular (LGPD) |
| `GET /redefinir-senha?token=` | Definição/redefinição de senha |
| `GET /:slug` | Páginas institucionais (sobre, políticas, termos) |
| `GET /sitemap.xml`, `GET /robots.txt`, `GET /theme.css` | SEO e tema configurável |
| `GET /admin/*`, `GET /cliente/*` | Aplicações do painel e da área do cliente |
| `GET /saude` | Verificação de saúde |

## API pública — `/api/publico`

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/form-token` | Token anti-spam para formulários |
| GET | `/produtos` | Catálogo público em JSON (mesmos filtros da página) |
| POST | `/contato` | Contato/orçamento/apresentação/personalizado. Campos: `tipo`, `nome`, `email`, `telefone?`, `empresa?`, `produto?` (slug), `servico?` (slug), `assunto?`, `mensagem`, `consentimento` (obrigatório `true`), `aceita_comunicacoes?`, `requisitos?` (objeto, tipo personalizado), `form_token`, `website` (honeypot, deve ficar vazio) |
| POST | `/lgpd` | Solicitação de titular: `nome`, `email`, `tipo`, `descricao?`, `form_token` |

Limite: 6 envios a cada 10 minutos por IP.

## Autenticação — `/api/auth`

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/login` | `{ email, senha, area: "admin" \| "cliente" }` → cookie de sessão + `{ usuario, csrf }`. 10 tentativas/15 min por IP; bloqueio da conta por 15 min após 5 falhas |
| POST | `/logout` | Revoga a sessão |
| GET | `/me` | Usuário atual, perfis, permissões e `csrf` |
| POST | `/esqueci-senha` | `{ email }` — resposta idêntica exista ou não a conta |
| POST | `/redefinir-senha` | `{ token, senha }` — token de uso único; encerra todas as sessões |
| POST | `/alterar-senha` | `{ senha_atual, nova_senha }` — encerra as demais sessões |

## API administrativa — `/api/admin` (equipe autenticada)

Cada rota verifica a permissão indicada no servidor. O perfil Administrador possui todas.

| Recurso | Rotas | Permissão |
| --- | --- | --- |
| Painel | `GET /dashboard` | `dashboard.ver` |
| Notificações | `GET /notificacoes`, `POST /notificacoes/lidas` | autenticado |
| Opções de formulários | `GET /opcoes` | conforme permissões |
| Produtos | `GET /produtos`, `GET /produtos/opcoes`, `GET /produtos/:id` | `produtos.ver` |
| | `POST /produtos`, `PUT /produtos/:id`, `DELETE /produtos/:id`, `PUT /produtos/ordem`, `PUT /produtos/:id/planos` | `produtos.editar` |
| | `POST /produtos/:id/{publicar,despublicar,arquivar,restaurar}` | `produtos.publicar` |
| | `POST/PUT/DELETE /produtos/:id/{funcionalidades,imagens,faqs}[/:itemId]` | `produtos.editar` |
| Categorias | CRUD `/categorias`, `PUT /categorias/ordem` | `categorias.ver` / `categorias.editar` |
| Serviços | CRUD `/servicos`, `PUT /servicos/ordem` | `servicos.ver` / `servicos.editar` |
| Planos | CRUD `/planos` (exclusão vira desativação se houver histórico) | `planos.ver` / `planos.editar` |
| Mídia | `GET /midia`, `GET /midia/:id` | `midia.ver` |
| | `POST /midia` (multipart `arquivo`), `PUT /midia/:id`, `PUT /midia/:id/arquivo`, `DELETE /midia/:id` | `midia.editar` |
| Conteúdo | `GET/PUT /conteudos`, CRUD `/paginas`, CRUD `/faqs` | `conteudo.ver` / `conteudo.editar` |
| Leads | `GET /leads`, `GET /leads/:id` | `leads.ver` |
| | `PUT /leads/:id`, `POST /leads/:id/interacoes` | `leads.editar` |
| | `POST /leads/:id/converter` | `clientes.editar` |
| | `GET /leads/exportar.csv` (auditado) | `leads.exportar` |
| Clientes | `GET /clientes`, `GET /clientes/:id` | `clientes.ver` |
| | `POST /clientes`, `PUT /clientes/:id`, `POST/DELETE /clientes/:id/acesso`, `POST/DELETE /clientes/:id/arquivos[/:id]` | `clientes.editar` |
| | `GET /clientes/exportar.csv` | `clientes.exportar` |
| | `GET /clientes/:id/dados-titular` | `lgpd.ver` |
| | `POST /clientes/:id/anonimizar` | `lgpd.editar` |
| | `GET /arquivos-privados/:id` | `clientes.ver` ou `contratos.ver` |
| Orçamentos | `GET /orcamentos`, `GET /orcamentos/:id`, `GET /orcamentos/:id/documento` (HTML para impressão) | `orcamentos.ver` |
| | `POST /orcamentos`, `PUT /orcamentos/:id`, `POST /orcamentos/:id/status` | `orcamentos.editar` |
| | `POST /orcamentos/:id/gerar-pedido` | `pedidos.editar` |
| Pedidos | `GET /pedidos`, `GET /pedidos/:id` | `pedidos.ver` |
| | `POST /pedidos`, `PUT /pedidos/:id`, `POST /pedidos/:id/status` (descontos exigem `pedidos.autorizar_desconto`) | `pedidos.editar` |
| Pagamentos | `POST /pedidos/:id/pagamentos` | `pagamentos.registrar` (confirmar exige `pagamentos.confirmar`) |
| | `POST /pagamentos/:id/{confirmar,cancelar,estornar}` | `pagamentos.confirmar` / `pedidos.editar` |
| Contratos | `GET/POST/PUT /contratos`, `POST /contratos/:id/arquivo` | `contratos.ver` / `contratos.editar` |
| Licenças | `GET/POST/PUT /licencas` | `contratos.ver` / `contratos.editar` |
| Suporte | `GET /chamados`, `PUT /chamados/:id` | `suporte.ver` / `suporte.editar` |
| LGPD | `GET /lgpd`, `PUT /lgpd/:id` | `lgpd.ver` / `lgpd.editar` |
| Relatórios | `GET /relatorios`, `GET /relatorios/:tipo`, `GET /relatorios/:tipo.csv` (`inicio`, `fim`) | `relatorios.ver` |
| Auditoria | `GET /auditoria` | `auditoria.ver` (somente administrador) |
| Usuários | `GET /usuarios`, `GET /perfis` | `usuarios.ver` |
| | `POST /usuarios`, `PUT /usuarios/:id`, `POST /usuarios/:id/redefinir-acesso`, `PUT /perfis/:id/permissoes` | `usuarios.editar` |
| Configurações | `GET /configuracoes`, `GET /modelos-email` | `configuracoes.ver` |
| | `PUT /configuracoes`, `PUT /modelos-email/:chave` | `configuracoes.editar` |

Tipos de relatório: `produtos`, `leads`, `orcamentos`, `pedidos`, `vendas`, `clientes`, `mais_consultados`, `atividades`.

### Transições de estado

**Orçamento:** `novo → em_analise | em_elaboracao | cancelado`; `em_analise → em_elaboracao | cancelado`; `em_elaboracao → enviado | cancelado`; `enviado → aguardando_resposta | aceito | recusado | expirado | cancelado`; `aguardando_resposta → aceito | recusado | expirado | cancelado`; `expirado → em_elaboracao | cancelado`. Valores e condições só podem mudar até o envio. Orçamentos enviados vencidos expiram automaticamente.

**Pedido:** `rascunho → aguardando_pagamento | cancelado`; `aguardando_pagamento → em_andamento | cancelado`; `em_andamento → concluido | cancelado`. Itens só mudam no rascunho; concluir exige pagamento integral; cancelar exige estorno prévio dos pagamentos confirmados.

**Situação de pagamento** (derivada): `pendente` sem confirmados; `parcial` com confirmados abaixo do total; `pago` com confirmados ≥ total; `estornado` quando só há estornos.

## Área do cliente — `/api/cliente` (cliente autenticado)

O cliente é identificado pela sessão; IDs de outros clientes retornam `404`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET/PUT | `/perfil` | Dados cadastrais (somente nome, telefone e empresa são editáveis) |
| GET | `/resumo` | Indicadores do cliente |
| GET | `/pedidos`, `/pedidos/:id` | Pedidos (exceto rascunhos) |
| GET | `/orcamentos`, `/orcamentos/:id`, `/orcamentos/:id/documento` | Orçamentos enviados (sem observações internas) |
| POST | `/orcamentos/:id/resposta` | `{ resposta: "aceitar" \| "recusar", motivo? }` |
| GET | `/contratos`, `/contratos/:id/arquivo` | Contratos (exceto rascunhos) e documento assinado |
| GET | `/licencas` | Licenças |
| GET | `/arquivos`, `/arquivos/:id/download` | Downloads autorizados |
| GET/POST | `/chamados` | Suporte |
| GET | `/produtos-licenciados` | Produtos para abertura de chamado |

## Webhooks de pagamento

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/pagamentos/webhook/stripe` | Assinatura `Stripe-Signature` verificada |
| POST | `/api/pagamentos/webhook/mercadopago` | Assinatura `x-signature` verificada |

Sem credenciais configuradas, respondem `503`. Ver [PAGAMENTOS.md](PAGAMENTOS.md).
