# DESIGN.md — sistema "prancha técnica"

Sistema de design único para o site público, o painel administrativo e a área do cliente.
Contexto de produto em [PRODUCT.md](PRODUCT.md). Relatório da refatoração e capturas em
[docs/ui/RELATORIO.md](docs/ui/RELATORIO.md).

## Tese

A empresa vende sistemas sob medida. O visual é o de uma **prancha de desenho técnico**: papel claro,
tinta nanquim, filetes de 1 px, campos rotulados como o carimbo de uma planta e o vermelhão do lápis de
revisão reservado para a única ação que importa em cada tela. Comunica método e precisão sem recorrer
aos clichês de "empresa de tecnologia" (fundo escuro com brilho, gradiente violeta, cartões iguais).

- **Site público (modo Persuadir):** a prancha aparece inteira — malha, marcas de registro, título
  condensado, o desenho (tela real do projeto) e o carimbo.
- **Painel e área do cliente (modo Operar):** só os detalhes — filetes, chips de situação, carimbo para
  metadados, tinta como ação primária. Sem malha, sem animação de entrada.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `frontend/public/assets/css/brand.css` | Marca: `@font-face`, cores padrão, fonte, tamanho da logo. Único arquivo a editar quando a marca definitiva chegar. |
| `frontend/public/assets/css/system.css` | Tokens derivados e componentes compartilhados (botões, formulários, chips, carimbo, tabelas, modais, abas, toasts, estados). |
| `frontend/public/assets/css/site.css` | Composições do site público (hero, seções, rodapé-carimbo, catálogo, produto, contato, demo). |
| `frontend/public/assets/css/admin.css` | Estrutura do painel e da área do cliente (barra lateral, cabeçalho, indicadores, mídia, implantação). |
| `/theme.css` (`backend/src/views/theme.js`) | Cores escolhidas no painel, com tons de texto recalculados para contraste AA. |

Componentes não usam hex: usam os tokens abaixo.

## Cor

| Token | Padrão | Uso |
| --- | --- | --- |
| `--paper` | `#F3F5F7` | Fundo da página |
| `--sheet` / `--sheet-2` | `#FFFFFF` / `#F8F9FB` | Folhas (superfícies) e áreas recolhidas |
| `--ink` | `#12233D` (`cor_primaria`) | Texto, títulos, filetes fortes, botão primário do painel |
| `--ink-2` / `--ink-3` | mistura com branco | Texto secundário (≥ 7:1) / rótulos e metadados (≥ 4,5:1) |
| `--accent` | `#C8401E` (`cor_destaque`) | **Somente** a ação principal (Pedir orçamento, enviar formulário) e marcas de revisão (item atual da navegação, etapa atual da trilha) |
| `--on-accent` | calculado | Texto sobre o destaque (branco ou tinta, o que tiver mais contraste) |
| `--line` / `--link` | `#1D5F8A` (`cor_secundaria`) | Links, linhas de cota, item ativo da navegação |
| `--rule` / `--rule-strong` | tinta 14% / 30% | Filetes |
| `--tone-*` (+ `-bg`) | neutral, info, progress, success, danger | Situações (chips, alertas, fluxo de implantação); texto ≥ 4,5:1 sobre o próprio fundo |

As três cores do painel aceitam qualquer valor válido: `theme.js` escurece a tinta até contraste ≥ 9:1
sobre o papel e escolhe `--on-accent` / `--accent-text` / `--line-text` para manter AA. Testado em
`tests/unit/theme.test.js` e `tests/integration/09-site-identidade.test.js`.

## Tipo

- **Archivo** variável (peso 100–900, largura 62–125%), hospedada em `assets/fonts/archivo/` (OFL).
- Títulos de destaque condensados: `font-stretch: var(--brand-stretch-display)` (78%; hero 72%), peso ~720.
- Corpo 16 px, entrelinha 1,6; escala `--fs-xs` (.78rem) a `--fs-display` (clamp até 4,75rem).
- Sem caixa-alta em rótulos, sem "eyebrows" acima dos títulos, sem destaque de uma palavra no título.
- Números tabulares em tabelas, indicadores e valores (`.tabular`, `td`, `.kpi-value`).

## Espaço, forma, profundidade

- Espaços múltiplos de 4 px: `--s-1` (4) … `--s-9` (104).
- Raios: `--r-1` 3 px (chips, miniaturas), `--r-2` 6 px (botões, campos, folhas), `--r-3` 10 px (modais, cartão de login).
- Profundidade por filete, não por sombra. Única sombra: toasts e o `--lift` discreto.
- Malha milimetrada (`--grid`) só no hero do site — é a superfície de desenho da tese.

## Componentes

| Componente | Classe | Regra |
| --- | --- | --- |
| Botão de ação principal | `.btn-accent` | Um por tela (cabeçalho do site conta à parte). |
| Botão primário | `.btn-primary` (= `.btn-ink`) | Tinta. É o primário do painel e da área do cliente. |
| Botão secundário | `.btn-outline-ink`, `.btn-outline-*` | Contorno de tinta. |
| Todos os botões | `.btn` | Altura mínima 44 px; `:active` com `scale(.97)`; hover só com `@media (hover:hover)`. |
| Chip de situação | `.chip .chip-{info,progress,success,danger,accent,neutral}` | Gerado por `badge(text, tone)` (JS) e `statusBadge()` (servidor). Marca em losango + texto, nunca só cor. |
| Carimbo | `dl.carimbo` (`.carimbo-wide` para campo largo) | Metadados rotulados: projeto, situação, contratação, investimento; rodapé do site. |
| Folha | `.folha`, `.card` | Fundo branco, filete forte, raio 6 px. |
| Abas | `tabSet()` em `shared/ui.js` | Padrão WAI-ARIA: `tablist`/`tab`/`tabpanel`, setas, Home, End. |
| Tabela larga | `scrollRegion()` ou `.table-responsive[tabindex=0][role=region][aria-label]` | Rolável pelo teclado. |
| Trilha de situação | `ol.status-track` | Etapas reais do projeto, `aria-current="step"`. |
| Etapas numeradas | `ol.steps` | Números só porque o conteúdo é sequência. |
| Estados | `loading()`, `emptyState()`, `errorState()` | Vazio convida à ação; erro diz o que aconteceu e oferece "Tentar novamente". |
| Logo | `.brand-logo-slot` | Espaço reservado (quadro de registro) até haver logotipo nas Configurações. |

## Movimento

- `--ease-out: cubic-bezier(.23,1,.32,1)`; durações 120 / 180 / 320 ms.
- Uma única entrada orquestrada: o hero do site (texto sobe; o desenho é revelado com `clip-path`).
- Resposta a ações: pressão nos botões, sublinhado desenhado na navegação, gaveta do menu do painel,
  toasts com `@starting-style`.
- `prefers-reduced-motion: reduce` desliga entradas e reduz transições a quase zero.

## Responsividade

- Testado em 1440×900 e 390×844 (Playwright), sem rolagem horizontal em nenhuma das 99 telas.
- Calhas do Bootstrap limitadas a 2rem no celular; navegação do cliente rola na horizontal dentro do próprio trilho.
- Barra lateral do painel vira gaveta abaixo de 992 px (fundo escurecido, fecha ao navegar).

## Exceções conhecidas

- **Demonstrações** (`demo.css`) representam o produto do cliente, escuro, com destaque `#38BDF8`.
  Não seguem a prancha de propósito; a borda lateral da linha do tempo e do crédito da matéria é
  conteúdo da demo, não um cartão.
- O detector do Impeccable marca a malha do hero como "decorative grid": aqui ela é a superfície de
  desenho técnico da tese (exceção prevista pela própria regra para "blueprint/measurement").
