// Configurações, conteúdo editável, páginas institucionais, perguntas frequentes e modelos de e-mail.
// Nada aqui é sobrescrito em execuções posteriores (ON CONFLICT DO NOTHING): edições feitas no painel são preservadas.
// Valores de contato NÃO são inventados: ficam vazios até o administrador configurar.

export const SETTINGS = {
  nome_comercial: ['Sua empresa de tecnologia', true, 'Nome comercial exibido no site (PROVISÓRIO — substitua pelo nome definitivo).'],
  slogan: ['', true, 'Frase curta exibida junto ao logotipo.'],
  logo_url: [null, true, 'URL do logotipo (vazio = marca padrão).'],
  favicon_url: [null, true, 'URL do favicon.'],
  email_contato: [null, true, 'E-mail público de contato.'],
  telefone: [null, true, 'Telefone público.'],
  whatsapp: [null, true, 'Número do WhatsApp com DDI e DDD, somente dígitos.'],
  whatsapp_mensagem: ['Olá! Vim pelo site e gostaria de mais informações.', true, 'Mensagem inicial do WhatsApp.'],
  endereco: [null, true, 'Endereço comercial (opcional).'],
  razao_social: [null, true, 'Razão social (usada em documentos).'],
  documento_empresa: [null, false, 'CNPJ/CPF do fornecedor (usado em orçamentos).'],
  instagram: [null, true, ''], linkedin: [null, true, ''], github: [null, true, ''], youtube: [null, true, ''],
  cor_primaria: ['#0F172A', true, 'Cor base (fundo escuro).'],
  cor_destaque: ['#0EA5E9', true, 'Cor de destaque (botões e links).'],
  cor_secundaria: ['#8B5CF6', true, 'Cor secundária (gradientes e detalhes).'],
  seo_titulo_padrao: ['Desenvolvimento de software para empresas', true, 'Título padrão das páginas.'],
  seo_descricao_padrao: ['Sistemas sob medida, plataformas web, sistemas de gestão, automações e integrações para empresas e instituições.', true, 'Descrição padrão.'],
  moeda_padrao: ['BRL', true, ''],
  aviso_site: ['Site em fase de implantação: conteúdos e produtos demonstrativos em revisão.', true, 'Aviso exibido no topo do site.'],
  aviso_site_ativo: [true, true, ''],
  notificar_email_novos_contatos: [true, false, 'Enviar e-mail à equipe a cada novo contato (requer SMTP).'],
  email_notificacoes: [null, false, 'E-mail que recebe as notificações internas.'],
  rastrear_visualizacoes: [true, false, 'Contar visualizações de produtos (contagem diária agregada, sem dados pessoais).'],
  condicoes_orcamento_padrao: ['- Forma de pagamento: a combinar.\n- Prazo de execução: a definir conforme escopo aprovado.\n- Valores não incluem custos de infraestrutura de terceiros, salvo indicação.', false, 'Condições inseridas em novos orçamentos.'],
  validade_orcamento_dias: [15, false, 'Validade padrão dos orçamentos (dias).']
};

export const CONTENT = [
  ['home.hero.etiqueta', 'home', 'Etiqueta acima do título', 'texto', 'Desenvolvimento de software para empresas'],
  ['home.hero.titulo', 'home', 'Título principal', 'texto', 'Transformamos ideias em soluções digitais'],
  ['home.hero.subtitulo', 'home', 'Subtítulo', 'texto_longo', 'Desenvolvemos sistemas sob medida, plataformas web, sistemas de gestão, automações e integrações para empresas e instituições que precisam organizar processos e crescer com tecnologia.'],
  ['home.hero.cta_primario', 'home', 'Botão principal (leva ao orçamento)', 'texto', 'Solicitar orçamento'],
  ['home.hero.cta_secundario', 'home', 'Botão secundário (leva aos serviços)', 'texto', 'Conhecer os serviços'],
  ['home.hero.imagem', 'home', 'Imagem do destaque (vazio = painel padrão)', 'imagem', ''],
  ['home.produtos.titulo', 'home', 'Título da seção de produtos', 'texto', 'Projetos e soluções'],
  ['home.produtos.texto', 'home', 'Texto da seção de produtos', 'texto_longo', 'Sistemas desenvolvidos pela equipe. Cada projeto informa sua situação atual; os marcados como demonstrativos usam dados fictícios.'],
  ['home.beneficios.titulo', 'home', 'Título dos benefícios', 'texto', 'O que você ganha com um sistema bem feito'],
  ['home.beneficios.itens', 'home', 'Benefícios (um por linha: Título | Descrição)', 'texto_longo',
    'Informação centralizada | Dados que hoje estão em planilhas, cadernos e mensagens passam a ficar em um só lugar.\nMenos retrabalho | Cadastros, cálculos e conferências repetitivas são automatizados.\nControle de acesso | Cada pessoa vê e altera apenas o que é da sua responsabilidade.\nRelatórios confiáveis | Indicadores calculados a partir dos dados reais da operação.\nAcesso de qualquer lugar | Sistemas web responsivos, utilizáveis no computador e no celular.\nEvolução contínua | O sistema acompanha o crescimento do seu negócio.'],
  ['home.servicos.titulo', 'home', 'Título dos serviços', 'texto', 'Soluções digitais para o seu negócio'],
  ['home.servicos.texto', 'home', 'Texto dos serviços', 'texto_longo', 'Do levantamento de requisitos à implantação, desenvolvemos software alinhado aos processos da sua empresa, com código organizado, documentação e suporte.'],
  ['home.etapas.titulo', 'home', 'Título das etapas', 'texto', 'Como trabalhamos'],
  ['home.etapas.itens', 'home', 'Etapas (uma por linha: Título | Descrição)', 'texto_longo',
    'Entendimento | Conversamos sobre o seu processo, os problemas atuais e os objetivos do projeto.\nPlanejamento e proposta | Escopo, etapas, prazos e investimento descritos em uma proposta formal.\nDesenvolvimento | Construção em entregas parciais, com validação a cada etapa.\nEntrega e implantação | Publicação, migração de dados quando necessária e orientação da equipe.\nEvolução | Acompanhamento do uso, correções e novas funcionalidades conforme o combinado.'],
  ['home.diferenciais.titulo', 'home', 'Título dos compromissos técnicos (seção Sobre)', 'texto', 'Compromissos técnicos'],
  ['home.diferenciais.itens', 'home', 'Diferenciais (um por linha: Título | Descrição)', 'texto_longo',
    'Segurança desde o início | Senhas com hash forte, controle de permissões no servidor e proteção contra ataques comuns.\nBanco de dados relacional | PostgreSQL com integridade referencial e cálculos financeiros precisos.\nPrivacidade (LGPD) | Coleta mínima de dados, finalidade informada e atendimento a titulares.\nCódigo documentado | Estrutura modular, testes automatizados e documentação de instalação.'],
  ['home.sobre.titulo', 'home', 'Título da seção Sobre', 'texto', 'Sobre a empresa'],
  ['home.sobre.texto', 'home', 'Texto da seção Sobre (provisório — substitua pela apresentação real)', 'texto_longo', 'Desenvolvemos software para empresas e instituições que precisam organizar processos, integrar informações e ganhar eficiência. Cada projeto começa pela compreensão da necessidade e segue com transparência sobre escopo, prazos e investimento.'],
  ['home.contato.titulo', 'home', 'Título do contato', 'texto', 'Vamos conversar sobre o seu projeto?'],
  ['home.contato.texto', 'home', 'Texto do contato', 'texto_longo', 'Conte o que você precisa e solicite um orçamento. A primeira conversa é sem compromisso.'],
  ['home.cta.titulo', 'home', 'Título da chamada final', 'texto', 'Precisa de um sistema sob medida?'],
  ['home.cta.texto', 'home', 'Texto da chamada final', 'texto', 'Descreva sua necessidade e receba um orçamento detalhado, sem custo.'],
  ['servicos.titulo', 'servicos', 'Título da página de serviços', 'texto', 'Serviços de desenvolvimento'],
  ['servicos.texto', 'servicos', 'Introdução da página de serviços', 'texto_longo', 'Desenvolvimento de sistemas, integrações, APIs, automação de processos e consultoria — com escopo e orçamento definidos antes do início.']
];

export const PAGES = [
  ['sobre', 'Sobre', 'institucional', false,
    `## Quem somos

Somos uma empresa de desenvolvimento de software para empresas e instituições. **Este texto é provisório:** substitua-o pela apresentação real da empresa no painel administrativo (Conteúdo › Páginas).

## Como trabalhamos

- Levantamento de requisitos antes de qualquer linha de código.
- Entregas em etapas, com validação a cada fase.
- Código organizado, documentado e testado.
- Transparência sobre prazos, custos e situação de cada projeto.

## Compromissos

Os projetos exibidos neste site informam sua situação real. Projetos marcados como demonstrativos utilizam dados fictícios.`],
  ['politica-de-privacidade', 'Política de Privacidade', 'juridica', true,
    `> MODELO — revise com profissional habilitado antes da publicação definitiva.

## 1. Quem é o controlador

[Nome/razão social, CNPJ/CPF e contato do controlador — configure em Configurações e ajuste este texto.]

## 2. Quais dados coletamos

- **Formulários de contato e orçamento:** nome, e-mail, telefone (opcional), empresa (opcional) e a mensagem enviada.
- **Área do cliente:** dados cadastrais necessários à prestação do serviço contratado.
- **Dados técnicos:** um identificador irreversível (hash) do endereço IP, usado somente para prevenção de abusos.

## 3. Finalidades e bases legais

- Responder solicitações e elaborar propostas (procedimentos preliminares a contrato — art. 7º, V, LGPD).
- Executar contratos e emitir documentos (execução de contrato e obrigação legal).
- Enviar novidades apenas a quem consentiu expressamente (consentimento — art. 7º, I).

## 4. Compartilhamento

Não vendemos dados. Podemos utilizar provedores de hospedagem e envio de e-mails, que atuam como operadores.

## 5. Retenção

Os dados são mantidos pelo tempo necessário às finalidades acima e às obrigações legais.

## 6. Direitos do titular

Você pode solicitar confirmação, acesso, correção, anonimização, portabilidade, eliminação e revogação de consentimento pelo formulário de solicitações de titulares.

## 7. Cookies

Utilizamos apenas cookies essenciais. Consulte a Política de Cookies.`],
  ['termos-de-uso', 'Termos de Uso', 'juridica', true,
    `> MODELO — revise com profissional habilitado antes da publicação definitiva.

## 1. Objeto

Estes termos regulam o uso deste site, que apresenta softwares e serviços de desenvolvimento.

## 2. Informações dos produtos

As descrições, telas e situações comerciais dos produtos são informativas. Produtos identificados como demonstrativos ou em desenvolvimento não estão disponíveis para contratação imediata.

## 3. Orçamentos

Solicitações de orçamento não geram obrigação de contratação. Propostas são válidas pelo prazo nelas indicado.

## 4. Área do cliente

O acesso é pessoal e intransferível. O usuário é responsável por manter a confidencialidade da sua senha.

## 5. Propriedade intelectual

Os softwares, marcas e conteúdos deste site são protegidos pela legislação aplicável.

## 6. Contato

Dúvidas sobre estes termos podem ser enviadas pela página de contato.`],
  ['politica-de-cookies', 'Política de Cookies', 'juridica', true,
    `> MODELO — revise com profissional habilitado antes da publicação definitiva.

## Cookies utilizados

Este site utiliza **somente cookies estritamente necessários**:

- **sid / __Host-sid** — mantém a sessão de usuários autenticados no painel e na área do cliente. Expira ao sair ou após o período de inatividade.

## Cookies não utilizados

Não utilizamos cookies de publicidade, de redes sociais ou de análise de comportamento. A contagem de visualizações de produtos é feita de forma agregada, sem cookies e sem identificar visitantes.

## Como gerenciar

Você pode apagar cookies nas configurações do navegador. Sem o cookie de sessão não é possível acessar áreas autenticadas.`]
];

const FAQS = [
  ['Preciso pagar para solicitar um orçamento?', 'Não. A solicitação de orçamento é gratuita e não exige pagamento online. Você recebe uma proposta formal e decide se deseja contratar.'],
  ['Os softwares do portfólio já estão disponíveis?', 'Cada software informa a sua situação comercial: em planejamento, em desenvolvimento, demonstração disponível ou disponível para contratação. Apenas os marcados como "Disponível para contratação" podem ser contratados imediatamente.'],
  ['As demonstrações usam dados reais?', 'Não. As demonstrações utilizam exclusivamente dados fictícios e funcionam no seu navegador, sem salvar informações.'],
  ['É possível adaptar um sistema às necessidades da minha empresa?', 'Sim. Os sistemas podem ser personalizados e também é possível desenvolver uma solução totalmente sob medida a partir de um levantamento de requisitos.'],
  ['Como funciona o suporte após a implantação?', 'As condições de suporte e manutenção são definidas na proposta comercial e no contrato, conforme a necessidade de cada cliente.'],
  ['Como meus dados são tratados?', 'Coletamos apenas o necessário para responder à sua solicitação. Detalhes estão na Política de Privacidade, onde você também pode exercer seus direitos de titular.']
];

const EMAILS = [
  ['confirmacao_contato', 'Confirmação de contato', 'Recebemos sua mensagem — {{empresa_nome}}',
    'Olá, {{nome}}.\n\nRecebemos sua mensagem sobre "{{assunto}}" (protocolo {{protocolo}}). Responderemos pelo e-mail informado.\n\n{{empresa_nome}}', ['nome', 'assunto', 'protocolo', 'empresa_nome']],
  ['confirmacao_orcamento', 'Confirmação de solicitação de orçamento', 'Solicitação de orçamento {{protocolo}} recebida',
    'Olá, {{nome}}.\n\nRecebemos sua solicitação de orçamento ({{produto}}) com o protocolo {{protocolo}}. Vamos analisar e retornar com uma proposta.\n\n{{empresa_nome}}', ['nome', 'produto', 'protocolo', 'empresa_nome']],
  ['admin_novo_contato', 'Aviso interno: novo contato', 'Novo contato: {{nome}}',
    'Novo contato recebido pelo site.\n\nNome: {{nome}}\nE-mail: {{email}}\nAssunto: {{assunto}}\n\n{{mensagem}}\n\nAcesse o painel: {{link_admin}}', ['nome', 'email', 'assunto', 'mensagem', 'link_admin']],
  ['admin_novo_orcamento', 'Aviso interno: nova solicitação de orçamento', 'Nova solicitação de orçamento {{protocolo}}',
    'Nova solicitação de orçamento.\n\nProtocolo: {{protocolo}}\nNome: {{nome}}\nE-mail: {{email}}\nInteresse: {{produto}}\n\n{{mensagem}}\n\nAcesse o painel: {{link_admin}}', ['protocolo', 'nome', 'email', 'produto', 'mensagem', 'link_admin']],
  ['orcamento_enviado', 'Orçamento enviado ao cliente', 'Orçamento {{numero}} — {{titulo}}',
    'Olá, {{nome}}.\n\nSeu orçamento {{numero}} ({{titulo}}) está disponível.\nValor total: {{total}}\nValidade: {{validade}}\n\nSe você possui acesso à área do cliente, pode consultá-lo e respondê-lo em {{link_cliente}}. Caso contrário, responda a este e-mail.\n\n{{empresa_nome}}', ['nome', 'numero', 'titulo', 'total', 'validade', 'link_cliente', 'empresa_nome']],
  ['pedido_status', 'Alteração de status de pedido', 'Pedido {{numero}}: {{status}}',
    'Olá, {{nome}}.\n\nO status do seu pedido {{numero}} foi atualizado para: {{status}}.\n\n{{empresa_nome}}', ['nome', 'numero', 'status', 'empresa_nome']],
  ['pagamento_confirmado', 'Confirmação de pagamento', 'Pagamento confirmado — pedido {{numero}}',
    'Olá, {{nome}}.\n\nConfirmamos o pagamento integral do pedido {{numero}} ({{total}}). Obrigado!\n\n{{empresa_nome}}', ['nome', 'numero', 'total', 'empresa_nome']],
  ['recuperacao_senha', 'Recuperação de senha', 'Redefinição de senha',
    'Olá, {{nome}}.\n\nRecebemos uma solicitação para redefinir sua senha. Use o link abaixo (válido por {{validade}}):\n\n{{link}}\n\nSe você não fez esta solicitação, ignore este e-mail.', ['nome', 'link', 'validade']],
  ['convite_equipe', 'Convite para a equipe', 'Convite de acesso ao painel — {{empresa_nome}}',
    'Olá, {{nome}}.\n\nVocê recebeu acesso ao painel administrativo. Defina sua senha pelo link abaixo (válido por {{validade}}):\n\n{{link}}', ['nome', 'link', 'validade', 'empresa_nome']],
  ['convite_cliente', 'Convite para a área do cliente', 'Seu acesso à área do cliente — {{empresa_nome}}',
    'Olá, {{nome}}.\n\nSeu acesso à área do cliente foi habilitado. Defina sua senha pelo link abaixo (válido por {{validade}}):\n\n{{link}}\n\nNa área do cliente você acompanha pedidos, orçamentos, contratos e licenças.', ['nome', 'link', 'validade', 'empresa_nome']]
];

export async function seed(tx) {
  for (const [chave, [valor, publica, descricao]] of Object.entries(SETTINGS)) {
    await tx.query('INSERT INTO configuracoes (chave, valor, publica, descricao) VALUES ($1,$2,$3,$4) ON CONFLICT (chave) DO NOTHING',
      [chave, JSON.stringify(valor), publica, descricao]);
  }
  for (const [i, [chave, grupo, rotulo, tipo, valor]] of CONTENT.entries()) {
    await tx.query('INSERT INTO conteudos (chave, grupo, rotulo, tipo, valor, ordem) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (chave) DO NOTHING',
      [chave, grupo, rotulo, tipo, valor, i]);
  }
  for (const [slug, titulo, tipo, revisao, conteudo] of PAGES) {
    await tx.query('INSERT INTO paginas (slug, titulo, tipo, revisao_pendente, conteudo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING',
      [slug, titulo, tipo, revisao, conteudo]);
  }
  const { n } = await tx.one('SELECT count(*)::int n FROM faqs');
  if (!n) for (const [i, [pergunta, resposta]] of FAQS.entries()) await tx.query('INSERT INTO faqs (pergunta, resposta, ordem) VALUES ($1,$2,$3)', [pergunta, resposta, i * 10]);
  for (const [chave, nome, assunto, corpo, variaveis] of EMAILS) {
    await tx.query('INSERT INTO modelos_email (chave, nome, assunto, corpo, variaveis) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (chave) DO NOTHING',
      [chave, nome, assunto, corpo, variaveis]);
  }
}
