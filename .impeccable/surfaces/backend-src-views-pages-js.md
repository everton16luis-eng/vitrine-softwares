---
version: 1
slug: "backend-src-views-pages-js"
primary_target: "backend/src/views/pages.js"
related_targets: ["frontend/public/admin/index.html","frontend/public/cliente/index.html"]
---

# Site público, painel e área do cliente — direção "Prancha técnica"

Escopo: site público (modo Persuade), painel `/admin` e área `/cliente` (modo Operate), que compartilham o mesmo mundo visual.
Público: dono ou gestor de PME que encomenda software; equipe interna; cliente contratante.
Ação principal do site: pedir orçamento (formulário real; o hero tem um primeiro passo que funciona sem JavaScript).
Restrições: CSP sem inline; cores e logotipo trocáveis pelo painel; Bootstrap 5 mantido; nenhuma rota ou API alterada.

## Direction contract

THESIS: o site é o jogo de pranchas de um escritório de projeto: cada sistema é uma folha com carimbo que diz a verdade sobre o seu estado. Recusa o padrão da categoria: fundo azul-marinho com brilho, gradiente violeta, cartões arredondados iguais e rótulos em caixa-alta acima dos títulos.

OWN-WORLD: papel de desenho frio (#F3F5F7) com malha milimetrada só nas áreas de desenho; tinta nanquim (#12233D) no texto e nas linhas; vermelhão do lápis de revisão (#C8401E) reservado para a ação principal e para as marcas de revisão; azul heliográfico (#1D5F8A) para links e linhas de cota. Fonte Archivo variável (larguras condensada e normal): títulos condensados como letreiro técnico, corpo na largura normal. Raios de 4 a 6 px, filetes de 1 px e nenhuma sombra decorativa. O carimbo (grade de campos rotulados) é o componente de metadados de todo o sistema.

STORY: o visitante entende em uma tela o que a empresa faz, vê as telas reais dos sistemas com a situação de cada um no carimbo, confia por causa da transparência e começa o pedido de orçamento ali mesmo.

FIRST VIEWPORT: à esquerda, o título em Archivo condensado grande, o subtítulo e o primeiro passo do orçamento ("O que você precisa?", com três escolhas e o botão vermelhão). À direita, a folha de desenho com a tela do sistema em destaque, emoldurada e com carimbo real embaixo (nome, situação, contratação). Uma moldura fina de prancha envolve o hero.

FORM: prancha técnica com carimbo (ABNT), 3º da lista ordenada (1: programa de identidade concretista brasileiro; 2: placa de obra; 3: prancha técnica; 4: ordem de serviço com carimbos; 5: sinalização rodoviária; 6: quadro kanban; 7: calçadão). seed:bc20a57d3ba643df
- Elevação herdada do BBS (descartado): operação completa por teclado e índice de folhas navegável.
- Elevação herdada do osciloscópio (descartado): tudo medido na mesma malha; espaçamentos só da escala do sistema.
- Elevação herdada do orizuru (descartado): a situação comercial é desenhada como sequência discreta de revisões.
- Azulejo: competitivo (identificação com o público), mas mantido como alternativa, não construído.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
