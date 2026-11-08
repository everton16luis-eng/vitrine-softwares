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
  cor_primaria: ['#12233D', true, 'Cor da tinta: textos, títulos e linhas (use um tom escuro).'],
  cor_destaque: ['#C8401E', true, 'Cor de destaque: ação principal e marcas de revisão.'],
  cor_secundaria: ['#1D5F8A', true, 'Cor secundária: links e linhas de cota.'],
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
  ['home.clientes.titulo', 'home', 'Título da seção de clientes e parceiros', 'texto', 'Empresas que confiam em nossas soluções'],
  ['home.clientes.texto', 'home', 'Texto da seção de clientes e parceiros (opcional)', 'texto_longo', ''],
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

Esta política explica quais dados pessoais tratamos neste site, para quê, por quanto tempo e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD).

## 1. Quem é o controlador

[Razão social], inscrita no CNPJ sob o nº [CNPJ], com endereço em [endereço], é a controladora dos dados tratados neste site.

**Encarregado (canal de privacidade):** [nome ou "Canal de Privacidade"], pelo e-mail [e-mail de privacidade] ou pelo [formulário de solicitações](/privacidade/solicitacao).

## 2. Quais dados tratamos

**Quando você envia um formulário** (contato, orçamento, pedido de apresentação ou desenvolvimento sob medida):

- nome, e-mail e a mensagem (obrigatórios);
- telefone e empresa (opcionais);
- as respostas do levantamento de requisitos, quando você pede um sistema sob medida;
- a data em que você declarou ciência desta política e, se marcou, a autorização para receber comunicações;
- um código irreversível (hash) derivado do seu endereço IP, usado só contra spam e abuso. O IP em si não é guardado.

**Quando você é cliente:**

- dados cadastrais: nome, e-mail, telefone, empresa e, somente quando necessário para contrato ou documento fiscal, CPF ou CNPJ;
- orçamentos, pedidos, pagamentos (valor, forma e situação; não guardamos número de cartão), contratos, licenças, arquivos compartilhados e chamados de suporte;
- dados de acesso à área do cliente: e-mail, senha (guardada apenas em forma irreversível), data do último acesso e, em cada sessão, endereço IP e navegador utilizado.

**Quando você só navega:** não coletamos dados pessoais. A contagem de visualizações dos softwares é agregada por dia, sem cookies e sem identificar visitantes. Detalhes na [Política de Cookies](/politica-de-cookies).

Não pedimos dados sensíveis (saúde, religião, biometria etc.). Não inclua esse tipo de informação nas mensagens.

## 3. Para que usamos e com qual base legal

- **Responder seu contato e preparar propostas:** procedimentos preliminares a um contrato, a seu pedido (art. 7º, V).
- **Prestar os serviços contratados**, manter a área do cliente, emitir documentos e prestar suporte: execução de contrato (art. 7º, V).
- **Cumprir obrigações legais e fiscais** e guardar registros de acesso exigidos pelo Marco Civil da Internet: obrigação legal (art. 7º, II).
- **Proteger o site e as contas** (bloqueio de tentativas de invasão, prevenção de spam, registro de auditoria): legítimo interesse (art. 7º, IX), limitado ao necessário.
- **Enviar novidades e materiais:** somente com seu consentimento (art. 7º, I), que nunca vem pré-marcado e pode ser revogado a qualquer momento.
- **Exercer direitos em processos:** exercício regular de direitos (art. 7º, VI).

Não tomamos decisões automatizadas sobre você e não usamos seus dados para publicidade de terceiros.

## 4. Com quem compartilhamos

Não vendemos nem alugamos dados pessoais. Eles só são acessados por:

- **nossa equipe**, conforme o perfil de acesso de cada pessoa, com registro em auditoria;
- **fornecedores que atuam como operadores**, apenas no necessário para o serviço: hospedagem do site e das cópias de segurança, envio de e-mails e, se você optar por pagar por eles, processadores de pagamento (como Mercado Pago ou Stripe);
- **autoridades públicas**, quando houver obrigação legal ou ordem judicial.

Alguns desses fornecedores podem manter servidores fora do Brasil. Nesse caso, a transferência segue as hipóteses do art. 33 da LGPD, como cláusulas contratuais e garantias adequadas de proteção.

## 5. Sistemas que hospedamos para clientes

Quando desenvolvemos, implantamos ou hospedamos um sistema para uma empresa cliente, os dados das pessoas que usam esse sistema pertencem ao cliente, que é o controlador. Nesse caso atuamos como operadores, seguindo as instruções e o contrato firmado com o cliente. Dúvidas sobre esses dados devem ser dirigidas primeiro à empresa responsável pelo sistema.

## 6. Por quanto tempo guardamos

- **Contatos que não resultaram em contratação:** até [24 meses] após a última interação, depois anonimizados ou excluídos.
- **Dados de clientes e documentos comerciais e fiscais:** durante o contrato e pelos prazos legais depois dele (em regra, 5 anos para obrigações fiscais e de consumo).
- **Registros de acesso** (IP, data e hora): no mínimo 6 meses, como exige o art. 15 do Marco Civil da Internet.
- **Sessões encerradas ou expiradas:** apagadas automaticamente 7 dias depois.
- **Autorização para comunicações:** até você revogar.
- **Cópias de segurança:** cifradas e substituídas em ciclo; cada cópia é descartada em até [6 meses].

Terminado o prazo, os dados são excluídos ou anonimizados de forma irreversível.

## 7. Como protegemos

Conexão sempre cifrada (HTTPS), senhas guardadas com algoritmo próprio para senhas (Argon2id), sessões que expiram por inatividade, bloqueio após tentativas de login malsucedidas, permissões por perfil, registro de auditoria das ações da equipe, arquivos privados acessíveis apenas a quem tem permissão e cópias de segurança cifradas. Nenhum sistema é totalmente imune a incidentes; se ocorrer um incidente que possa causar risco ou dano relevante, comunicaremos você e a Autoridade Nacional de Proteção de Dados (ANPD), conforme o art. 48.

## 8. Seus direitos

Você pode, a qualquer momento e sem custo:

- confirmar se tratamos seus dados e acessá-los;
- corrigir dados incompletos, inexatos ou desatualizados;
- pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;
- pedir a portabilidade dos seus dados;
- saber com quem compartilhamos seus dados;
- revogar o consentimento para comunicações e ser informado das consequências;
- opor-se a um tratamento baseado em legítimo interesse.

Faça seu pedido pelo [formulário de solicitações](/privacidade/solicitacao). Para proteger você, podemos pedir confirmação de identidade antes de atender. Respondemos em até 15 dias. Alguns dados podem ser mantidos mesmo após um pedido de exclusão, quando a lei exigir (por exemplo, documentos fiscais). Se não ficar satisfeito com a resposta, você pode reclamar à ANPD (gov.br/anpd).

## 9. Crianças e adolescentes

Este site é voltado a empresas e profissionais. Não coletamos intencionalmente dados de menores de 18 anos.

## 10. Alterações

Podemos atualizar esta política para refletir mudanças no site ou na lei. A versão em vigor é sempre a publicada nesta página, com a data abaixo. Mudanças relevantes serão destacadas no site e, para clientes, avisadas por e-mail.

Última atualização: [data].`],
  ['termos-de-uso', 'Termos de Uso', 'juridica', true,
    `> MODELO — revise com profissional habilitado antes da publicação definitiva.

Estes termos regulam o uso deste site, oferecido por [Razão social], CNPJ [CNPJ] ("nós"). Ao usar o site você concorda com eles. Se não concordar, não utilize o site.

## 1. O que é este site

Este site apresenta os softwares e os serviços de desenvolvimento que oferecemos, permite pedir orçamentos e apresentações e dá aos clientes acesso a uma área restrita para acompanhar pedidos, orçamentos, contratos, licenças e suporte.

## 2. Informações sobre softwares e serviços

- Cada software informa sua situação real: em planejamento, em desenvolvimento, demonstração disponível ou disponível para contratação. Somente os marcados como "Disponível para contratação" podem ser contratados de imediato.
- Descrições, telas, funcionalidades e preços exibidos são informativos e podem mudar. O que vale para uma contratação é o que constar na proposta aceita e no contrato.
- Fazemos o possível para manter as informações corretas e atualizadas, mas podem ocorrer erros de digitação ou desatualização. Se encontrar algo assim, avise pela [página de contato](/contato).

## 3. Demonstrações

As demonstrações usam exclusivamente dados fictícios, funcionam no seu navegador e não salvam informações. Não digite dados reais nelas. Uma demonstração mostra o funcionamento geral do software e pode ser diferente da versão entregue a cada cliente.

## 4. Orçamentos e contratação

- Pedir um orçamento é gratuito e não obriga você nem nós a contratar.
- Cada proposta informa escopo, valores, prazos e validade. A contratação só acontece com o aceite da proposta e, quando houver, a assinatura do contrato.
- Em caso de diferença entre estes termos e a proposta ou o contrato, valem a proposta e o contrato.
- Pagamentos seguem as condições da proposta. Quando feitos por processador de pagamento, também se aplicam os termos desse processador.

## 5. Área do cliente

- O acesso é criado por nós, por convite enviado ao e-mail do cliente. É pessoal e intransferível.
- Você é responsável por guardar sua senha em sigilo e pelas ações feitas com seu acesso. Se suspeitar de uso indevido, troque a senha e nos avise imediatamente.
- Podemos suspender um acesso em caso de uso indevido, risco à segurança ou fim do contrato, avisando o cliente sempre que possível.

## 6. Uso permitido

Ao usar o site, você se compromete a não:

- tentar acessar áreas, contas ou dados sem autorização, nem contornar medidas de segurança;
- enviar spam, conteúdo ilícito, ofensivo ou que viole direitos de terceiros pelos formulários;
- sobrecarregar o site, usar robôs para coletar conteúdo em massa ou enviar programas maliciosos;
- usar o site para fins ilegais ou passar-se por outra pessoa.

Encontrou uma falha de segurança? Comunique-nos pela [página de contato](/contato) em vez de explorá-la.

## 7. Propriedade intelectual

Os softwares, textos, telas, marcas, logotipos e demais conteúdos deste site pertencem a nós ou a seus respectivos titulares e são protegidos por lei (incluindo a Lei de Software, nº 9.609/1998, e a Lei de Direitos Autorais, nº 9.610/1998). Você pode consultá-los para conhecer nossos serviços, mas não pode copiá-los, modificá-los, distribuí-los ou usá-los comercialmente sem autorização por escrito. Marcas de clientes e parceiros só são exibidas com autorização deles. Os direitos sobre softwares contratados seguem o que for definido no contrato.

## 8. Links e serviços de terceiros

O site pode ter links ou conteúdo de terceiros, como WhatsApp, vídeos do YouTube ou do Vimeo e processadores de pagamento. Esses serviços têm termos e políticas próprios, e não respondemos pelo conteúdo ou funcionamento deles.

## 9. Disponibilidade e responsabilidade

- Trabalhamos para manter o site no ar e seguro, mas ele pode ficar indisponível por manutenção, falhas técnicas ou motivos fora do nosso controle.
- Não respondemos por danos causados por uso indevido do site, por falhas de equipamentos, conexões ou serviços de terceiros, nem por decisões tomadas apenas com base nas informações gerais do site.
- Nada nestes termos afasta direitos garantidos pelo Código de Defesa do Consumidor, quando ele for aplicável.
- Níveis de serviço, suporte e garantias de softwares contratados são definidos na proposta e no contrato.

## 10. Privacidade

O tratamento dos seus dados pessoais está descrito na [Política de Privacidade](/politica-de-privacidade) e na [Política de Cookies](/politica-de-cookies), que fazem parte destes termos.

## 11. Alterações

Podemos atualizar estes termos a qualquer momento. A versão em vigor é sempre a publicada nesta página, com a data abaixo. Mudanças relevantes serão destacadas no site e, para clientes, avisadas por e-mail.

## 12. Lei e foro

Estes termos seguem as leis brasileiras. Fica eleito o foro da comarca de [cidade/UF] para resolver qualquer questão, ressalvado o direito do consumidor de propor ação no foro do seu domicílio.

## 13. Contato

Dúvidas sobre estes termos podem ser enviadas pela [página de contato](/contato).

Última atualização: [data].`],
  ['politica-de-cookies', 'Política de Cookies', 'juridica', true,
    `> MODELO — revise com profissional habilitado antes da publicação definitiva.

## 1. O que são cookies

Cookies são pequenos arquivos que um site grava no seu navegador para lembrar informações entre uma página e outra. Tecnologias parecidas, como o armazenamento local do navegador (*localStorage*), funcionam da mesma forma e também são tratadas nesta política.

## 2. Resumo

- Usamos **apenas um cookie**, estritamente necessário, e somente para quem entra no painel administrativo ou na área do cliente.
- Quem apenas navega pelo site, consulta softwares ou envia um formulário **não recebe nenhum cookie** nosso.
- **Não usamos** cookies de publicidade, de redes sociais, de análise de comportamento nem de rastreamento entre sites.
- Por isso o site não pede consentimento para cookies: os estritamente necessários dispensam essa autorização, e não há outros.

## 3. Cookie utilizado

**sid** (em produção, **__Host-sid**)

- **Finalidade:** manter você conectado depois de entrar no painel administrativo ou na área do cliente. Sem ele, cada página pediria login novamente.
- **Quando é gravado:** somente após um login bem-sucedido.
- **Conteúdo:** um código aleatório que identifica a sessão. Não contém seu nome, e-mail, senha ou outro dado pessoal; o servidor guarda apenas uma versão irreversível (hash) desse código.
- **Duração:** é apagado ao sair (botão Sair). Por padrão, a sessão também termina após 2 horas sem uso ou 12 horas depois do login, o que ocorrer primeiro.
- **Proteções:** inacessível a scripts da página (*HttpOnly*), enviado somente por conexão segura (*Secure*), restrito a este domínio (*__Host-*) e não enviado em requisições iniciadas por outros sites (*SameSite=Lax*).
- **Origem:** próprio (primeira parte). Não é compartilhado com terceiros.
- **Base legal:** necessário para prestar o serviço solicitado por você (acesso à área restrita) e para a segurança da conta.

## 4. Armazenamento local

**aviso-cookies** (*localStorage*)

- **Finalidade:** lembrar que você já fechou o aviso de cookies, para que ele não apareça em todas as páginas.
- **Conteúdo:** apenas o valor "1". Fica somente no seu navegador e nunca é enviado ao servidor.
- **Duração:** até você limpar os dados do site no navegador.

## 5. Conteúdo de terceiros

Algumas páginas de software podem exibir um vídeo demonstrativo incorporado:

- **YouTube:** usamos o modo de privacidade aprimorada (youtube-nocookie.com), que não grava cookies antes de você dar play no vídeo.
- **Vimeo:** o player é carregado com a opção "não rastrear" (*dnt*), que desativa os cookies de rastreamento do Vimeo.

Ao reproduzir um vídeo, o serviço de vídeo pode gravar seus próprios dados de reprodução, conforme a política de privacidade dele. Links externos, como o botão do WhatsApp, levam a sites com políticas próprias, que não controlamos.

## 6. Estatísticas sem cookies

A contagem de visualizações dos softwares é feita no servidor, agregada por dia, sem cookies e sem identificar quem visitou. O administrador pode desligar essa contagem em Configurações.

## 7. Como controlar

Você pode ver, bloquear ou apagar cookies e o armazenamento local nas configurações do seu navegador, inclusive só para este site. Bloquear o cookie de sessão não afeta a navegação pública, mas impede o acesso ao painel e à área do cliente.

## 8. Alterações e contato

Se passarmos a usar qualquer cookie que não seja estritamente necessário, esta política será atualizada **antes** do uso e o site passará a pedir seu consentimento. Dúvidas podem ser enviadas pela [página de contato](/contato). Para exercer seus direitos de titular, use o [formulário de solicitações](/privacidade/solicitacao). Consulte também a [Política de Privacidade](/politica-de-privacidade).`]
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
