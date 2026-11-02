// Repaginação do site como vitrine de serviços: identidade provisória e textos da página inicial.
// Atualiza SOMENTE valores que ainda são os padrões antigos do seed 02 — qualquer edição feita
// no painel é preservada. Em instalações novas o seed 02 já grava os valores atuais e nada muda aqui.
import { SETTINGS, CONTENT, PAGES } from './02-configuracoes.js';

const OLD_SETTINGS = {
  nome_comercial: 'Sua Marca Software',
  slogan: 'Sistemas sob medida',
  cor_primaria: '#0e1525',
  cor_destaque: '#2fd8a4',
  seo_titulo_padrao: 'Softwares de gestão e desenvolvimento sob medida',
  seo_descricao_padrao: 'Sistemas web para gestão institucional, locações e frotas, além de desenvolvimento de software sob medida, integrações e APIs.'
};

const OLD_CONTENT = {
  'home.hero.etiqueta': 'Softwares de gestão • Desenvolvimento sob medida',
  'home.hero.titulo': 'Sistemas que organizam a operação e liberam tempo para o que importa',
  'home.hero.subtitulo': 'Desenvolvo softwares web para gestão de instituições, locação de espaços e frotas — e crio sistemas sob medida, com integrações e APIs, para processos que planilhas já não comportam.',
  'home.hero.cta_primario': 'Conhecer os softwares',
  'home.hero.cta_secundario': 'Solicitar orçamento',
  'home.produtos.titulo': 'Softwares em destaque',
  'home.produtos.texto': 'Soluções em diferentes estágios — da demonstração à contratação. Cada produto informa sua situação atual.',
  'home.servicos.titulo': 'Desenvolvimento sob medida para o seu processo',
  'home.servicos.texto': 'Do levantamento de requisitos à implantação, com código organizado, documentação e suporte.',
  'home.etapas.titulo': 'Como funciona a contratação',
  'home.etapas.itens': 'Conversa inicial | Entendimento do seu cenário, dos problemas e dos objetivos.\nProposta | Escopo, prazos e investimento descritos em um orçamento formal.\nImplantação | Configuração, migração de dados e ajustes necessários.\nTreinamento | Orientação para a equipe usar o sistema com segurança.\nAcompanhamento | Suporte e evolução conforme o combinado.',
  'home.diferenciais.titulo': 'Diferenciais técnicos',
  'home.contato.texto': 'Envie uma mensagem contando o que você precisa. A primeira conversa é sem compromisso.'
};

const OLD_PAGES = {
  sobre: `## Quem desenvolve os softwares

Este é um espaço para você apresentar a sua trajetória, a forma como trabalha e os valores que orientam os seus projetos. **Edite este texto no painel administrativo** (Conteúdo › Páginas).

## Como trabalho

- Levantamento de requisitos antes de qualquer linha de código.
- Entregas em etapas, com validação a cada fase.
- Código organizado, documentado e testado.
- Transparência sobre prazos, custos e situação de cada produto.

## Compromissos

Os produtos exibidos neste portfólio informam sua situação comercial real. Projetos marcados como demonstrativos utilizam dados fictícios.`
};

export async function seed(tx) {
  for (const [chave, antigo] of Object.entries(OLD_SETTINGS)) {
    await tx.query('UPDATE configuracoes SET valor = $1 WHERE chave = $2 AND valor = $3',
      [JSON.stringify(SETTINGS[chave][0]), chave, JSON.stringify(antigo)]);
  }
  const content = Object.fromEntries(CONTENT.map(([chave, , rotulo, , valor]) => [chave, { rotulo, valor }]));
  for (const [chave, antigo] of Object.entries(OLD_CONTENT)) {
    await tx.query('UPDATE conteudos SET valor = $1, rotulo = $2 WHERE chave = $3 AND valor = $4',
      [content[chave].valor, content[chave].rotulo, chave, antigo]);
  }
  const pages = Object.fromEntries(PAGES.map(([slug, , , , conteudo]) => [slug, conteudo]));
  for (const [slug, antigo] of Object.entries(OLD_PAGES)) {
    await tx.query('UPDATE paginas SET conteudo = $1 WHERE slug = $2 AND conteudo = $3', [pages[slug], slug, antigo]);
  }
}
