# Refatoração de UI/UX — relatório

Data: 07/11/2026. Escopo: site público, painel administrativo e área do cliente da Vitrine.
Sistema resultante documentado em [DESIGN.md](../../DESIGN.md); contexto de produto em [PRODUCT.md](../../PRODUCT.md).

## 1. Diagnóstico (antes)

- **Site público:** fundo azul-marinho com brilho e gradiente violeta, títulos com "eyebrow" em caixa-alta
  acima de cada seção, cartões idênticos repetidos e Bootstrap quase sem personalização. Visual de modelo
  genérico de "empresa de tecnologia"; nada ligava o visual ao que a empresa vende (sistemas sob medida).
- **Painel e área do cliente:** outra identidade (verde `#2fd8a4`, sobrescrito pelo `/theme.css` com as
  cores do site), fonte Inter declarada mas **nunca carregada**, barra lateral escura com títulos de grupo
  sem contraste.
- **Medição automática** (Playwright + axe, 99 telas em desktop 1440×900 e celular 390×844, linha de base
  em `docs/ui/capturas/antes/relatorio.json`):

| Métrica | Antes | Depois |
| --- | --- | --- |
| Telas com violação séria/crítica de acessibilidade | 49 | **0** |
| Nós com violação (axe) | 183 | **0** |
| `color-contrast` (telas) | 29 | 0 |
| `button-name` (botão da conta sem nome no celular) | 24 | 0 |
| `aria-required-children` + `listitem` (abas de contratos) | 2 + 2 | 0 |
| `scrollable-region-focusable` (relatórios) | 1 | 0 |
| Telas com rolagem horizontal no celular | 8 (até 52 px na demo) | **0** |
| Erros de console (fora o 401 esperado) | 2 | **0** |
| Requisições com falha (fora o 401 esperado) | 0 | 0 |

O `401 GET /api/auth/me` nas telas de entrada do painel e do cliente é **esperado**: é como o SPA descobre
que não há sessão antes de mostrar o login.

## 2. Problemas encontrados

1. Identidade dupla e genérica (site escuro com gradiente × painel verde com fonte inexistente).
2. Contraste insuficiente: títulos da barra lateral, links em `cliente/dados`, `code` dentro de alertas,
   botão de destaque claro na demo.
3. Botão da conta do painel sem nome acessível no celular (o nome ficava escondido).
4. Abas de contratos/conteúdo sem semântica de abas (e as de produto, parciais) e sem teclado.
5. Tabelas largas roláveis inalcançáveis pelo teclado.
6. Rolagem horizontal no celular (calhas `g-5`, menu do cliente, grade de indicadores da demo).
7. Eyebrows, sombra deslocada e destaque espalhado: padrões que o Impeccable classifica como "slop".
8. Cores do painel (Configurações) podiam gerar texto ilegível sobre o destaque.

## 3. Skills usadas

| Skill | Como foi usada |
| --- | --- |
| **Impeccable** | Contexto (`PRODUCT.md`, surface brief em `.impeccable/`), semente de conceito (seed `bc20a57d3ba643df`), craft floor, detector `impeccable detect` no fim. |
| **Frontend Design** | Plano de tokens (cor, tipo, layout, princípios) revisado contra os clichês listados antes de codificar. |
| **Taste Skill** | Regras de cópia (verbo + objeto nos botões, fato concreto no primeiro viewport), uma entrada no hero, micro-interações. Os scripts de "deal" da skill, feitos para páginas estáticas novas, não foram aplicados: o projeto já tem stack e conteúdo próprios. |
| **UI UX Pro Max** | Prioridades de acessibilidade/toque (44 px, contraste, foco), checklist. A recomendação automática (glassmorphism, Poppins/Open Sans, azul+laranja) foi **recusada** por ser genérica; aproveitado "modo claro por padrão". |
| **Web Design Guidelines** | Regras de formulários, foco visível, `aria-*`, `prefers-reduced-motion`, sem rolagem horizontal. |
| **Emil Design Engineering** | Curvas `--ease-out`, durações < 300 ms em UI, `scale(.97)` no `:active`, hover só com `hover:hover`, `@starting-style` nos toasts, `clip-path` na revelação do desenho. |

**Observação:** o Impeccable pede entrevista e página de decisão com o usuário no `init`. Como a instrução
era executar sem perguntar, o `PRODUCT.md` foi **inferido** do código e do conteúdo; os itens marcados
"(inferido)" precisam de confirmação sua.

## 4. Direção visual — "prancha técnica"

Papel claro, tinta nanquim, filetes de 1 px, campos rotulados como o carimbo de uma planta, malha
milimetrada só no hero, o desenho (tela real do projeto em destaque) traçado na entrada, e o vermelhão do
lápis de revisão reservado para a ação principal. Fonte Archivo variável com títulos condensados
(largura 72–78%), como letreiro técnico. Persuadir no site; operar com contenção no painel.

## 5. Design system

Detalhado em [DESIGN.md](../../DESIGN.md). Em resumo:

- `brand.css` (marca) → `system.css` (tokens + componentes compartilhados, novo) → `site.css` / `admin.css` → `/theme.css`.
- Cores do painel continuam configuráveis; `backend/src/views/theme.js` (novo) calcula tinta legível,
  texto sobre o destaque e tons de link com contraste AA para **qualquer** cor válida.
- Seed `database/seeds/05-identidade-prancha.js`: troca só os **padrões antigos** das três cores pelos
  novos; cores já editadas no painel são preservadas. É alteração de dados (não de esquema), documentada aqui.

## 6. Páginas reformuladas

- **Site:** início (hero com primeiro passo funcional do pedido via GET `/contato?tipo=…`, que funciona sem
  JS; serviços em índice; etapas; projetos; sobre em ficha técnica; contato), catálogo e estado vazio,
  produto (trilha de situação, carimbo, benefícios), serviços e serviço, contato/orçamento/sistema sob
  medida/apresentação (navegação segmentada), FAQ, LGPD, privacidade, sobre, redefinir senha, 404, demo.
- **Painel:** login, estrutura (barra lateral clara, cabeçalho, gaveta no celular), painel com
  indicadores e gráficos nas cores do sistema, todas as 23 rotas herdam o sistema (tabelas, formulários,
  chips, modais, abas, toasts, estados).
- **Área do cliente:** login, cabeçalho e menu novos, início com indicadores, pedidos, orçamentos,
  contratos e licenças, downloads, suporte, meus dados; situações agora com tom (sucesso/atenção/perigo).

Rotas, APIs, autenticação, permissões, validações e fluxos **não foram alterados**.

## 7. Componentes

Novos ou refeitos: botões (`btn-accent`, tinta, contornos; 44 px), chips de situação (`badge()` e
`statusBadge()` agora geram `.chip`), carimbo (`dl.carimbo`), trilha de situação, etapas, ficha técnica,
índice de serviços, navegação segmentada, rodapé-carimbo, espaço reservado da logo compartilhado,
`tabSet()` (abas WAI-ARIA) e `scrollRegion()` em `shared/ui.js`, toasts com `@starting-style`, estados de
carregamento/vazio/erro.

## 8. Responsividade

Verificado em 1440×900 e 390×844 em todas as 99 telas: nenhuma rolagem horizontal. Correções: calhas
limitadas no celular, menu do cliente rola dentro do próprio trilho, nome do usuário oculto no cabeçalho
do cliente em telas estreitas, grade de indicadores da demo com `minmax(0,1fr)`, indicadores do cliente em
2 colunas no celular, gaveta do painel abaixo de 992 px.

## 9. Desempenho e acessibilidade

- Uma única fonte variável (woff2, pré-carregada) substitui a Montserrat; nenhuma requisição a terceiros.
- Sem novas bibliotecas no navegador; animações só em `transform`/`opacity`/`clip-path`.
- `prefers-reduced-motion` reduz entradas e transições a ~0.
- Foco visível em tudo, alvos de 44 px, abas com teclado, tabelas roláveis focáveis, nomes acessíveis.
- axe (WCAG 2.0/2.1 A e AA): 0 violações sérias ou críticas nas 99 telas.

## 10. Capturas antes e depois

Pastas `docs/ui/capturas/antes/` e `docs/ui/capturas/depois/`, mesmos nomes de arquivo (99 cada, página
inteira). Os PNGs não são versionados (ficam na máquina onde os testes rodaram); os links abaixo funcionam localmente. Pares mais representativos:

| Tela | Antes | Depois |
| --- | --- | --- |
| Início (desktop) | [antes](capturas/antes/site-inicio-desktop.png) | [depois](capturas/depois/site-inicio-desktop.png) |
| Início (celular) | [antes](capturas/antes/site-inicio-celular.png) | [depois](capturas/depois/site-inicio-celular.png) |
| Projeto | [antes](capturas/antes/site-projeto-desktop.png) | [depois](capturas/depois/site-projeto-desktop.png) |
| Contato | [antes](capturas/antes/site-contato-desktop.png) | [depois](capturas/depois/site-contato-desktop.png) |
| Demo (celular) | [antes](capturas/antes/site-demonstracao-celular.png) | [depois](capturas/depois/site-demonstracao-celular.png) |
| Painel | [antes](capturas/antes/admin-painel-desktop.png) | [depois](capturas/depois/admin-painel-desktop.png) |
| Produtos (painel) | [antes](capturas/antes/admin-produtos-desktop.png) | [depois](capturas/depois/admin-produtos-desktop.png) |
| Menu do painel (celular) | [antes](capturas/antes/admin-menu-aberto-celular.png) | [depois](capturas/depois/admin-menu-aberto-celular.png) |
| Área do cliente (celular) | [antes](capturas/antes/cliente-inicio-celular.png) | [depois](capturas/depois/cliente-inicio-celular.png) |

## 11. Resultado dos testes

| Suíte | Comando | Resultado |
| --- | --- | --- |
| Unitários + integração (API, rotas, autenticação, permissões, formulários, seeds, tema) | `npm test` | **154/154 passaram**, 0 falhas |
| Capturas, axe, console, requisições e rolagem (99 telas) | `npm run test:e2e:preparar` e `npm run test:e2e -- depois` | 0 violações, 0 rolagem, 0 erros (fora o 401 esperado) |
| Interações no navegador | `npm run test:e2e:interacoes` | **10/10 passaram** (primeiro passo do pedido, aba do contato, trilha de situação, menu do site no celular, gaveta do painel, nome do botão da conta, abas WAI-ARIA com teclado, região rolável, chips) |
| Detector do Impeccable | `impeccable detect` | 3 achados "advisory/warning" analisados: malha do hero (justificada pela tese de prancha técnica), bordas laterais dentro da demo (conteúdo do produto demonstrado) e "checkmark" da lista (falso positivo, é um ✓ desenhado com bordas). Contraste no hover do botão primário: falso positivo do detector (não resolve `color-mix`); conferido no navegador: branco sobre tinta clareada. |

Os testes e2e rodam contra o servidor com `NODE_ENV=test` e o banco `_test` (`vitrine-softwares-banco-teste`
no `.claude/launch.json`). Depois de `npm test`, rode `npm run test:e2e:preparar` e reinicie o servidor
(as configurações ficam em cache na memória).

## 12. Problemas corrigidos

Todos os itens da seção 2. Além deles: sombra deslocada no carimbo do hero, eyebrows, célula vazia no
carimbo do hero, `autofocus` no alerta
de sucesso do contato, cores dos gráficos do painel (agora tinta/azul/tons de situação em vez do destaque),
vazamento de mensagens entre telas no próprio script de captura.

## 13. Pendências

1. **Confirmar o `PRODUCT.md`** (itens "(inferido)").
2. **Imagem de compartilhamento e favicon** (`og-default`, `favicon.svg`) ainda na identidade anterior:
   atualizar `scripts/generate-images.js` e rodar `npm run images`. Não feito para não alterar ativos
   gerados sem revisão.
3. **Logo e nome definitivos** continuam como espaço reservado (vêm das Configurações).
4. Gráficos do painel são `canvas` com `aria-label`, sem tabela de dados alternativa.
5. Capturas não cobrem estados com muitos dados reais (pedidos, orçamentos e chamados existentes) nem
   modais abertos; o banco de testes tem só os seeds.
6. Não testado em Safari/Firefox nem em leitor de tela real; só Chromium (Playwright) e axe.
7. Os PNGs das capturas (~50 MB) ficam fora do repositório (`.gitignore`); só os `relatorio.json` são versionados. Para regenerar: `npm run test:e2e -- antes|depois`.
