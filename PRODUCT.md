# Product

<!-- impeccable:product-schema 1 -->

> Registro escrito a partir do pedido do usuário ("refatoração completa com foco em UI/UX") e do código
> do repositório, sem uma rodada de entrevista. Os itens marcados **(inferido)** ainda precisam ser
> confirmados pelo dono do projeto.

## Platform

web

## Users

- **Visitante do site público.** É o dono, gestor ou responsável de TI de uma empresa ou instituição
  brasileira (pequena ou média; igrejas, locadoras de espaços, frotas e redações aparecem nos produtos).
  Normalmente pesquisa no computador do trabalho ou no celular entre outras tarefas **(inferido)**.
  Ele quer:
  - entender se a empresa resolve o seu problema;
  - ver projetos reais;
  - pedir orçamento ou uma demonstração.
- **Equipe interna (painel `/admin`).** Usa o painel todos os dias para:
  - cuidar do catálogo (produtos, serviços, planos, mídia, páginas e parceiros);
  - atender leads, orçamentos, pedidos, contratos e chamados;
  - acompanhar implantações em servidores;
  - tratar solicitações da LGPD;
  - consultar auditoria e relatórios.

  O acesso é separado por perfil e permissão.
- **Cliente (área `/cliente`).** É o contratante que acompanha pedidos, responde orçamentos, consulta
  contratos e licenças, baixa arquivos e abre chamados. Usa a área de vez em quando, a partir de um
  e-mail ou de um aviso.

## Product Purpose

É a vitrine e o balcão comercial de uma empresa que desenvolve software. Ela:
- apresenta os serviços e os sistemas próprios, informando com honestidade a situação de cada um
  (planejamento, desenvolvimento, demonstração ou disponível);
- recebe pedidos de orçamento e de apresentação;
- conduz a venda até o contrato, a licença, a implantação e o suporte.

O sucesso é medido por dois resultados:
- o visitante qualificado envia uma solicitação;
- a equipe consegue levar essa solicitação até a entrega sem sair do sistema.

## Positioning

Transparência sobre o estado real de cada projeto. Cada sistema mostra o seu status comercial, avisa
quando os dados são demonstrativos e tem demonstração interativa no navegador quando ela existe. Além
disso, o mesmo sistema cuida do pós-venda: contratos, licenças, implantação automatizada e LGPD.

## Operating Context

- **Site público.** É renderizado no servidor e funciona sem JavaScript; o JavaScript só melhora os
  formulários. Formulários de contato, orçamento, desenvolvimento personalizado e LGPD têm proteção
  antirrobô e consentimento.
- **Painel e área do cliente.** São SPAs em JavaScript puro com roteamento por hash. Usam Bootstrap 5,
  Bootstrap Icons e Chart.js servidos localmente.
- **CSP restrita:** `script-src 'self'` e `style-src 'self'`. Nenhum estilo ou script inline; ajustes
  dinâmicos de estilo só pelo CSSOM.

## Capabilities and Constraints

- Rotas, APIs, autenticação, permissões, validações e regras de negócio não podem mudar com o redesenho.
- Identidade configurável pelo painel:
  - nome comercial, slogan, logotipo, favicon;
  - três cores (`cor_primaria`, `cor_destaque`, `cor_secundaria`), aplicadas por `/theme.css`;
  - textos da home e aviso do site.

  O visual precisa continuar funcionando com qualquer cor válida escolhida ali.
- A marca é provisória: `brand.css` concentra a identidade e é o único arquivo a trocar quando a marca
  definitiva chegar. Enquanto não houver logotipo, aparece um espaço reservado neutro.
- Fonte Archivo (variável) hospedada no próprio site; nenhuma requisição a terceiros.

## Brand Commitments

- Nada de dados, depoimentos, clientes ou números inventados. Os produtos demonstrativos são sempre
  sinalizados como tais.
- Linguagem em português do Brasil, direta e sem exageros comerciais.
- Somente cookies essenciais.

## Evidence on Hand

- Telas dos produtos: SVG em `frontend/public/assets/images/produtos/`.
- Demonstrações interativas em `assets/js/demos/`.
- Conteúdo editável no banco: textos da home, etapas, compromissos técnicos, FAQ, páginas jurídicas.
- Ausências que não podem ser preenchidas com invenção:
  - não há depoimentos, números de clientes nem fotografias da equipe;
  - parceiros e logomarcas só aparecem quando cadastrados e autorizados.

## Product Principles

1. Dizer a verdade sobre o estado de cada coisa: produto, pedido, implantação, pagamento.
2. Toda tela leva a uma próxima ação clara (pedir orçamento, responder, atender, implantar).
3. Funcionar sem JavaScript no site público e com teclado em todas as áreas.
4. A identidade é trocável: nada do visual pode depender de uma cor ou de um logotipo fixos.

## Accessibility & Inclusion

WCAG 2.1 AA como meta (contraste, foco visível, rótulos, navegação por teclado, `prefers-reduced-motion`).
