// Catálogo inicial. Os produtos ilustrativos são marcados como dados_demonstrativos; o Portal Regional
// de Notícias, o Gerenciamento de Igrejas, o Sistema de Locação de Salas, o Livro-Caixa Pessoal e a
// Gestão de Barbearias são sistemas reais, com capturas das telas em funcionamento (demonstrativo: false).
// NENHUM preço é inventado. Situações comerciais iniciais conservadoras:
// os sistemas aparecem como "Em desenvolvimento" ou "Demonstração disponível" (com demonstração visual
// de dados fictícios); o administrador altera conforme a realidade.
// Inserção apenas se o slug ainda não existir — edições do painel são preservadas.

const CATEGORIES = [
  ['Gestão institucional', 'gestao-institucional', 'Organização de membros, voluntários, eventos e atividades.'],
  ['Gestão de locações', 'gestao-de-locacoes', 'Reservas, contratos e controle de espaços e utensílios.'],
  ['Gestão operacional', 'gestao-operacional', 'Controle de ativos, manutenção e custos operacionais.'],
  ['Comunicação e mídia', 'comunicacao-e-midia', 'Portais de conteúdo, fluxos editoriais e publicidade.'],
  ['Gestão financeira', 'gestao-financeira', 'Controle de caixa, entradas, saídas e relatórios financeiros.'],
  ['Gestão de serviços', 'gestao-de-servicos', 'Agenda, atendimento, caixa e comissões para negócios de serviços.'],
  ['Desenvolvimento sob demanda', 'desenvolvimento-sob-demanda', 'Sistemas criados a partir das necessidades de cada cliente.']
];

const f = (titulo, descricao, icone) => ({ titulo, descricao, icone });

export const PRODUCTS = [
  {
    slug: 'portal-de-noticias', nome: 'Portal Regional de Notícias', categoria: 'comunicacao-e-midia', ordem: 5, destaque: true, demonstrativo: false, capa: 'portal-de-noticias-capa.webp',
    resumo: 'Portal de notícias regional com redação integrada: coleta automática de fontes autorizadas, sugestões da IA, revisão humana obrigatória, publicidade, Instagram e Facebook.',
    descricao: 'O **Portal Regional de Notícias** reúne em um só sistema o site que o leitor vê e o painel da redação. Comunicados de prefeituras, câmaras, Defesa Civil e entidades chegam por coleta automática (RSS e páginas autorizadas), os repetidos são identificados e a IA, se estiver ligada, sugere título, resumo, categoria e alertas.\n\n**Nenhuma notícia vai ao ar sozinha:** cada item espera na fila de revisão até a equipe aprovar, agendar, pedir correção ou rejeitar. O portal publicado tem páginas por município e categoria, oito modelos de matéria, busca sem acento, crédito da fonte e do autor, SEO técnico, gestão de anúncios com mídia kit e publicação no Instagram e no Facebook.\n\nAs telas desta página são capturas do sistema em funcionamento, com conteúdo de demonstração fictício.',
    problema: 'Redações pequenas gastam horas copiando comunicados de órgãos públicos e entidades, sem controle de duplicados, sem padrão editorial e sem um jeito organizado de vender e medir anúncios.',
    publico: '- Portais e jornais regionais\n- Assessorias de comunicação\n- Veículos que reúnem informações de prefeituras, câmaras e entidades de uma região',
    requisitos: '- Navegador atualizado (computador ou celular)\n- Servidor Node.js 20+ e PostgreSQL 14+ com HTTPS (pode ser fornecido na implantação)\n- Opcional: chave de IA (Claude ou Gemini), SMTP, conta profissional do Instagram e página do Facebook',
    status: 'demonstracao_disponivel', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Coleta automatizada', 'Fontes RSS e páginas autorizadas, com política de uso registrada, teste de conexão, agendamento e histórico de coletas.', 'rss'),
      f('Duplicados e mesmo fato', 'Itens repetidos são descartados e notícias parecidas aparecem lado a lado para o editor agrupar.', 'files'),
      f('Sugestões da IA', 'Título, resumo, categoria e alertas sugeridos por Claude ou Gemini, com limite mensal de custo. Opcional.', 'stars'),
      f('Revisão humana obrigatória', 'Fila de revisão com aprovação, agendamento, pedido de correção, rejeição e histórico de versões.', 'check2-square'),
      f('Oito modelos de matéria', 'Clássico, destaque, nota, urgente, serviço, entrevista, fotorreportagem e especial.', 'layout-text-window'),
      f('Municípios e categorias', 'Páginas por município, região e categoria, com destaques da home escolhidos pelo editor.', 'geo-alt'),
      f('Busca e SEO técnico', 'Busca em português sem acento, sitemap, feed RSS, Open Graph e dados estruturados de notícia.', 'search'),
      f('Crédito de fonte e autor', 'Atribuição clara e link para a publicação original em cada matéria.', 'person-check'),
      f('Publicidade e mídia kit', 'Anunciantes, campanhas, posições, métricas, contratos, pagamentos e mídia kit gerado com os dados do portal.', 'megaphone'),
      f('Instagram e Facebook', 'Artes de Feed e Stories geradas a partir da notícia, com legenda e aprovação antes de publicar.', 'instagram'),
      f('Central via WhatsApp', 'Mensagens de grupos escolhidos viram rascunhos para revisão, agrupados por fato. Opcional.', 'whatsapp'),
      f('Painel completo', 'Usuários, grupos de permissão, auditoria, relatórios, backups e saúde do sistema.', 'shield-lock')
    ],
    beneficios: [f('Menos trabalho manual', 'Os comunicados chegam prontos para revisão.'), f('Controle editorial', 'Nada é publicado sem aprovação de uma pessoa.'), f('Receita com anúncios', 'Campanhas medidas e mídia kit com números reais.'), f('Mais alcance', 'SEO, Instagram e Facebook integrados.')],
    faqs: [
      ['A IA publica notícias sozinha?', 'Não. A IA só sugere título, resumo, categoria e alertas; toda publicação depende de aprovação humana. O sistema funciona normalmente sem IA.'],
      ['As telas são do sistema real?', 'Sim. As imagens são capturas do sistema em funcionamento, preenchido com conteúdo de demonstração fictício. A demonstração interativa simula os fluxos principais no seu navegador.'],
      ['Posso usar o nome e as cores do meu veículo?', 'Sim. Nome, logotipo, cores, municípios, regiões e categorias são configurados no painel.'],
      ['Quais fontes podem ser coletadas?', 'Somente fontes cuja política de uso permite a reprodução ou o resumo com crédito. Cada fonte é testada e tem a política registrada antes de ser ativada.']
    ],
    imagens: [
      ['portal-de-noticias-capa.webp', 'Capa do portal: manchete, destaques e espaço de anúncio'],
      ['portal-de-noticias-materia.webp', 'Página da matéria com crédito da fonte'],
      ['portal-de-noticias-celular.webp', 'No celular: capa, matéria e fila de revisão'],
      ['portal-de-noticias-municipio.webp', 'Notícias por município'],
      ['portal-de-noticias-painel.webp', 'Dashboard do painel editorial'],
      ['portal-de-noticias-revisao.webp', 'Fila de revisão: nada é publicado sem aprovação'],
      ['portal-de-noticias-editor.webp', 'Editor com modelos de página e sugestão da IA'],
      ['portal-de-noticias-destaques.webp', 'Escolha dos destaques da página inicial'],
      ['portal-de-noticias-publicidade.webp', 'Campanhas publicitárias com métricas'],
      ['portal-de-noticias-relatorios.webp', 'Relatórios editoriais e comerciais']
    ]
  },
  {
    slug: 'churchflow', nome: 'Gerenciamento de Igrejas', categoria: 'gestao-institucional', ordem: 10, destaque: true, demonstrativo: false, capa: 'gerenciamento-de-igrejas-capa.webp',
    resumo: 'Sistema de gestão de igrejas: cadastro único de pessoas, voluntários e escalas com confirmação pelo celular, eventos, ministério infantil com etiquetas e QR code, avisos e relatórios.',
    descricao: 'O **Gerenciamento de Igrejas** organiza a rotina da secretaria, dos líderes e dos voluntários em um só sistema: cadastro único de visitantes e membros, voluntários com funções e disponibilidade, escalas com confirmação, eventos e relatórios.\n\nCada voluntário tem a sua **Minha área**, aberta pelo celular, para confirmar ou recusar escalas, **passar a vaga** para outro voluntário e informar ausências — com avisos no celular e lembrete na véspera. No ministério infantil, a recepção das crianças registra quem deixou, imprime **duas etiquetas** e confere a saída lendo o **QR code** pela câmera.\n\nAs telas desta página são capturas do sistema em funcionamento, com dados fictícios (igreja, pessoas e logo genéricos).',
    problema: 'Escalas montadas em planilhas e grupos de mensagens, confirmações perdidas, cadastros duplicados, crianças entregues sem conferência e dificuldade para saber quem participa de cada atividade.',
    publico: '- Igrejas e comunidades religiosas\n- Associações e instituições com equipes de voluntários\n- Organizações com ministério infantil ou eventos recorrentes',
    requisitos: '- Navegador atualizado no computador ou no celular (Chrome, Edge, Firefox ou Safari)\n- Servidor Node.js com PostgreSQL e HTTPS (pode ser fornecido na implantação)\n- Opcional: impressora de etiquetas para a recepção das crianças',
    status: 'demonstracao_disponivel', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Cadastro único de pessoas', 'Visitantes e membros na mesma base, com classificação, apto ao voluntariado e acesso ao sistema.', 'person-vcard'),
      f('Voluntários e funções', 'Funções, vagas por escala, disponibilidade por dia e ficha completa com histórico e ausências.', 'people'),
      f('Escalas com confirmação', 'Calendário de escalas, confirmações pendentes, substituição e verificação de ausências ao escalar.', 'calendar-check'),
      f('Minha área do voluntário', 'Confirmar, recusar, passar a vaga, informar ausências e trocar a senha pelo celular.', 'person-badge'),
      f('Eventos', 'Próximos eventos com as funções necessárias; o evento realizado vira histórico.', 'calendar3'),
      f('Crianças e responsáveis', 'Ficha com responsáveis, autorizações e quem pode buscar; turmas por faixa etária.', 'balloon'),
      f('Turmas com etiqueta e QR code', 'Entrada com quem deixou, duas etiquetas, saída lendo o QR pela câmera e encerramento automático.', 'qr-code'),
      f('Lista de presença', 'Entrada e saída nas turmas, por data.', 'clipboard-check'),
      f('Avisos no celular', 'Central de avisos e notificações no celular sem aplicativo, com lembrete na véspera.', 'bell'),
      f('Relatórios', '8 tipos e o relatório por evento, com pré-visualização e exportação em PDF, Excel e CSV.', 'bar-chart'),
      f('Usuários e permissões', 'Perfis por área (administração, secretaria, financeiro, voluntário) com proteção contra escalada de privilégio.', 'shield-lock'),
      f('Configurações e backup', 'Dados da igreja, preferências e backup do banco manual e automático.', 'hdd-stack')
    ],
    beneficios: [f('Menos mensagens', 'Confirmações e trocas de escala centralizadas no sistema.'), f('Escalas equilibradas', 'Visão de quem está disponível, sobrecarregado ou ausente.'), f('Crianças seguras', 'Entrega conferida pela etiqueta e pelo QR code.'), f('Acesso pelo celular', 'Voluntários usam pelo navegador, sem instalar aplicativo.')],
    faqs: [
      ['As telas são do sistema real?', 'Sim. As imagens são capturas do sistema em funcionamento, com dados fictícios: igreja, pessoas e logo genéricos. A demonstração interativa simula os fluxos principais no seu navegador.'],
      ['Precisa instalar aplicativo?', 'Não. O sistema funciona no navegador do computador e do celular; o voluntário pode adicioná-lo à tela inicial e receber avisos.'],
      ['Posso usar o nome e o logo da minha igreja?', 'Sim. Nome, logo e dados da igreja são configurados na implantação e nas Configurações.'],
      ['Os dados da igreja ficam protegidos?', 'Cada perfil acessa só as áreas permitidas, as senhas exigem regras fortes e o backup do banco pode ser automático.']
    ],
    imagens: [
      ['gerenciamento-de-igrejas-capa.webp', 'Dashboard: visitantes, membros, voluntários e escalas da semana'],
      ['gerenciamento-de-igrejas-escalas.webp', 'Calendário de escalas com confirmações e pendências'],
      ['gerenciamento-de-igrejas-celular.webp', 'No celular: Minha área, escalas e dashboard'],
      ['gerenciamento-de-igrejas-minha-area.webp', 'Minha área do voluntário'],
      ['gerenciamento-de-igrejas-participantes.webp', 'Cadastro único de participantes'],
      ['gerenciamento-de-igrejas-voluntarios.webp', 'Voluntários com funções e disponibilidade'],
      ['gerenciamento-de-igrejas-criancas.webp', 'Crianças, responsáveis e turmas'],
      ['gerenciamento-de-igrejas-turmas.webp', 'Turmas: recepção das crianças no culto'],
      ['gerenciamento-de-igrejas-eventos.webp', 'Cadastro de eventos com as funções necessárias'],
      ['gerenciamento-de-igrejas-funcoes.webp', 'Funções e vagas por escala'],
      ['gerenciamento-de-igrejas-relatorios.webp', 'Relatórios com exportação em PDF, Excel e CSV']
    ]
  },
  {
    slug: 'spacecontrol', nome: 'Sistema de Locação de Salas', categoria: 'gestao-de-locacoes', ordem: 20, destaque: true, demonstrativo: false, capa: 'locacao-de-salas-capa.webp',
    resumo: 'Sistema para locação de salas e espaços: agenda sem conflitos, contratos em PDF, entrega e vistoria dos utensílios, danos e cobranças adicionais, financeiro completo e relatórios.',
    descricao: 'O **Sistema de Locação de Salas** acompanha cada locação do primeiro contato à quitação: reserva na agenda, contrato em PDF com assinatura registrada, entrega do espaço e dos utensílios com checklist, devolução com vistoria final, danos e cobranças adicionais e o financeiro da locação.\n\nCada etapa tem as suas regras: o calendário recusa horários sobrepostos (contando o intervalo de limpeza), o contrato assinado só muda por **aditivo**, a avaria registrada na vistoria vira um **registro em avaliação** — nunca uma cobrança automática — e só uma locação **quitada** pode ser concluída. Tudo fica na auditoria.\n\nO financeiro cobre contas a receber (sinal, saldo, caução, cobranças adicionais), contas a pagar, caixa e contas bancárias, com recibos internos em PDF. São 18 relatórios com exportação em CSV e PDF.\n\nAs telas desta página são capturas do sistema em funcionamento, com dados fictícios.',
    problema: 'Conflitos de agenda, contratos sem padronização, utensílios que somem sem registro, avarias cobradas "de cabeça" e o financeiro de cada locação espalhado em cadernos e planilhas.',
    publico: '- Salões de festas e espaços para eventos\n- Coworkings, auditórios e salas comerciais\n- Clubes, associações e sedes que alugam espaços',
    requisitos: '- Navegador atualizado no computador, tablet ou celular\n- Servidor Node.js com PostgreSQL e HTTPS (pode ser fornecido na implantação)\n- Uso interno: só funcionários acessam, com perfis e permissões',
    status: 'demonstracao_disponivel', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Salas e regras de cobrança', 'Capacidade, recursos, cor na agenda, cobrança por hora ou por período, hora adicional e intervalo entre locações.', 'building'),
      f('Calendário de reservas', 'Mês, semana, dia ou lista; pré-reservas com validade e bloqueio de horários sobrepostos.', 'calendar-week'),
      f('Locações com etapas', 'Do rascunho à conclusão, com as pendências de cada passo e situação financeira separada da operacional.', 'diagram-3'),
      f('Contratos em PDF', 'Modelo editável, versões, assinatura presencial ou eletrônica registrada e aditivos depois de assinado.', 'file-earmark-text'),
      f('Entrega e vistoria inicial', 'Checklist dos utensílios entregues, com patrimônio, estado e termo de responsabilidade.', 'list-check'),
      f('Devolução e vistoria final', 'Devolvidos, avariados e faltantes por item, com fotos e classificação da avaria.', 'clipboard-check'),
      f('Danos e cobranças adicionais', 'Avaria vira registro em avaliação; a cobrança só nasce com valor aprovado por alguém autorizado.', 'exclamation-triangle'),
      f('Inventário de utensílios e bens', 'Disponível, em uso, em manutenção e baixado, com histórico de movimentações.', 'box-seam'),
      f('Contas a receber', 'Sinal, saldo, caução e cobranças; recebimentos com recibo, créditos de cliente e compensação da caução.', 'cash-coin'),
      f('Contas a pagar e caixa', 'Despesas por categoria, caixas e contas bancárias, abertura, fechamento e conciliação.', 'wallet2'),
      f('Painel e relatórios', 'Painel do dia e financeiro; 18 relatórios com exportação em CSV e PDF.', 'graph-up'),
      f('Usuários, permissões e auditoria', 'Perfis com permissões por ação, registro de todas as alterações e backups.', 'shield-lock')
    ],
    beneficios: [f('Agenda sem conflitos', 'Horários sobrepostos são recusados, já contando a limpeza.'), f('Utensílios sob controle', 'Saiba o que saiu, o que voltou e o que está em manutenção.'), f('Cobranças justas', 'Avarias documentadas e aprovadas antes de cobrar.'), f('Financeiro por locação', 'Cada locação mostra o que foi pago e o que falta.')],
    faqs: [
      ['O sistema emite nota fiscal?', 'Tem a estrutura fiscal pronta, mas a emissão real depende do contador e da contratação de um provedor de notas. Até lá, o sistema emite recibos internos em PDF, com o aviso de que não são documento fiscal.'],
      ['Os clientes acessam o sistema?', 'Não. É um sistema interno: só os funcionários entram, cada um com o seu perfil e as suas permissões.'],
      ['Funciona no celular?', 'Sim. As telas se adaptam ao celular; a vistoria pode ser feita no próprio espaço.'],
      ['Os dados da demonstração são reais?', 'Não. As capturas e a simulação usam salas, clientes e valores fictícios.']
    ],
    imagens: [['locacao-de-salas-capa.webp', 'Painel: reservas de hoje, contratos, entregas e vistorias pendentes'], ['locacao-de-salas-calendario.webp', 'Calendário de reservas por sala'], ['locacao-de-salas-locacoes.webp', 'Lista de locações com situação operacional e financeira'],
      ['locacao-de-salas-locacao.webp', 'Ficha da locação com as etapas'], ['locacao-de-salas-contrato.webp', 'Contrato emitido aguardando assinatura'],
      ['locacao-de-salas-entrega.webp', 'Entrega e vistoria inicial concluídas'], ['locacao-de-salas-vistoria.webp', 'Devolução e vistoria final dos utensílios'],
      ['locacao-de-salas-inventario.webp', 'Inventário de utensílios e bens'], ['locacao-de-salas-receber.webp', 'Contas a receber com parcelas e caução'],
      ['locacao-de-salas-financeiro.webp', 'Painel financeiro do período'], ['locacao-de-salas-salas.webp', 'Cadastro de salas e regras de cobrança'],
      ['locacao-de-salas-celular.webp', 'Painel, locação e vistoria no celular']]
  },
  {
    slug: 'livro-caixa', nome: 'Livro-Caixa Pessoal', categoria: 'gestao-financeira', ordem: 25, destaque: true, demonstrativo: false, capa: 'livro-caixa-capa.webp',
    resumo: 'Livro-caixa digital para controlar entradas e saídas do dia a dia: saldo do dia ou acumulado, categorias, formas de pagamento e relatórios. Funciona 100% offline, sem servidor.',
    descricao: 'O **Livro-Caixa Pessoal** registra cada entrada e saída em segundos e mostra o livro-caixa com **Data, Descrição, Entrada, Saída e Saldo**, como no caderno, mas sem conta errada: os valores são guardados em centavos e editar um lançamento antigo recalcula todos os saldos seguintes.\n\nVocê escolhe como ver o saldo: **diário**, em que cada dia abre em R$ 0,00 e fecha com o resultado do dia (ideal para acompanhar o movimento de uma loja), ou **acumulado**, o livro-caixa tradicional a partir do saldo inicial. Quem fecha o caixa depois da meia-noite define a **virada do dia** (até 06:00).\n\nFunciona **direto no navegador, sem internet, sem servidor e sem login**. Os dados ficam em um arquivo SQLite no seu computador, que você exporta como backup e abre de novo no próximo uso; o arquivo importado é validado antes de substituir o atual.\n\nAs telas desta página são capturas do sistema em funcionamento, com lançamentos fictícios.',
    problema: 'Controle de caixa em caderno ou planilha: contas erradas, saldo que não fecha, lançamentos sem categoria e nenhuma visão de para onde o dinheiro está indo.',
    publico: '- Quem quer organizar as finanças pessoais ou da família\n- Autônomos, feirantes e pequenos comércios que fecham o caixa todo dia\n- Quem prefere manter os dados no próprio computador, sem nuvem',
    requisitos: '- Navegador atualizado (Chrome, Edge ou Firefox)\n- Não precisa de internet, servidor nem instalação: basta abrir o arquivo index.html\n- Recomendado: guardar cópias do arquivo exportado em pen drive ou nuvem pessoal',
    status: 'demonstracao_disponivel', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Lançamentos rápidos', 'Entrada ou saída, valor, descrição com sugestões, categoria e forma de pagamento; a data já vem preenchida.', 'plus-circle'),
      f('Livro-caixa com saldo', 'Data, descrição, entrada, saída e saldo, com saldo anterior, totais e saldo final do período.', 'journal-text'),
      f('Saldo diário ou acumulado', 'Cada dia começando em R$ 0,00 ou o livro-caixa tradicional, sem alterar nenhum lançamento.', 'arrow-repeat'),
      f('Virada do dia', 'Para quem fecha depois da meia-noite: lançamentos até as 06:00 contam no dia anterior.', 'moon'),
      f('Formas de pagamento', 'Dinheiro, Pix, débito, crédito ou outro, com totais do dia e do mês por forma.', 'credit-card'),
      f('Categorias', 'Categorias de receitas e despesas prontas, editáveis, com desativação e exclusão só sem uso.', 'tags'),
      f('Dashboard', 'Saldo do dia, entradas e saídas do dia e do mês, fechamento dos últimos dias e últimas movimentações.', 'speedometer2'),
      f('Relatórios', 'Diário, mensal e por período, com resumo por categoria e por forma de pagamento; CSV e impressão A4.', 'file-earmark-bar-graph'),
      f('Filtros e busca', 'Movimentações por período, tipo, categoria, forma de pagamento e texto.', 'funnel'),
      f('Arquivo SQLite próprio', 'Exportação, importação com validação completa e cópia de segurança da sessão no navegador.', 'database')
    ],
    beneficios: [f('Saldo sempre certo', 'Valores em centavos e saldos recalculados a cada alteração.'), f('Sem servidor para manter', 'Roda no navegador, sem internet.'), f('Seus dados com você', 'Um arquivo no seu computador, que abre em qualquer ferramenta SQLite.'), f('Fechamento do dia', 'Veja quanto entrou e saiu em cada dia.')],
    faqs: [
      ['Precisa de internet?', 'Não. O sistema abre direto do computador (arquivo index.html) e funciona totalmente offline.'],
      ['Onde ficam os dados?', 'Em um arquivo .sqlite que você exporta e guarda onde quiser. O navegador mantém uma cópia da sessão só como rede de segurança: o arquivo exportado é a fonte oficial.'],
      ['Serve para uma loja?', 'Sim. O modo de saldo diário mostra o movimento de cada dia, com totais por forma de pagamento. Para vários usuários ao mesmo tempo, avalie um projeto personalizado.'],
      ['Os dados da demonstração são reais?', 'Não. As capturas e a simulação usam lançamentos fictícios.']
    ],
    imagens: [['livro-caixa-capa.webp', 'Dashboard: saldo do dia, entradas e saídas e fechamento dos últimos dias'], ['livro-caixa-livro-diario.webp', 'Livro-caixa no modo diário, com abertura e fechamento de cada dia'],
      ['livro-caixa-livro-acumulado.webp', 'Livro-caixa tradicional, com saldo acumulado'], ['livro-caixa-movimentacoes.webp', 'Novo lançamento e lista de movimentações com filtros'],
      ['livro-caixa-dashboard-acumulado.webp', 'Dashboard com totais por forma de pagamento'], ['livro-caixa-relatorios.webp', 'Relatório mensal com resumo dia a dia'],
      ['livro-caixa-categorias.webp', 'Categorias de entrada e de saída'], ['livro-caixa-backup.webp', 'Banco de dados e backup: exportar, importar e modo do saldo'],
      ['livro-caixa-inicio.webp', 'Tela inicial: abrir o arquivo ou criar um livro-caixa'], ['livro-caixa-celular.webp', 'Dashboard, novo lançamento e relatório no celular']]
  },
  {
    slug: 'gestao-de-barbearias', nome: 'Gestão de Barbearias', categoria: 'gestao-de-servicos', ordem: 27, destaque: true, demonstrativo: false, capa: 'barbearia-capa.webp',
    resumo: 'Sistema completo para barbearias: agenda por profissional, agendamento online, app do barbeiro, caixa, comissões, financeiro, estoque e site próprio com cinco modelos.',
    descricao: 'A **Gestão de Barbearias** reúne em um só sistema tudo o que acontece na barbearia, do horário marcado ao dinheiro no caixa.\n\nO **dono** acompanha a agenda de cada profissional, o caixa com conferência no fechamento, as comissões, o financeiro (contas a pagar e a receber, fluxo de caixa e resultado), o estoque de produtos e doze relatórios. Cada barbearia tem os próprios usuários e permissões: proprietário, gerente, recepção e barbeiros.\n\nO **cliente agenda pela internet**, sem criar conta: escolhe o serviço, o profissional ou o primeiro disponível, a data e um horário livre. O sistema nunca marca dois clientes no mesmo horário e respeita a jornada, o almoço e as folgas de cada profissional.\n\nO **barbeiro usa o app no celular**: vê a agenda do dia, inicia e finaliza o atendimento, registra observações, pede folga e acompanha as próprias comissões e recebimentos.\n\nQuem contrata ainda ganha um **site próprio**, com cinco modelos (Black Label, Urban Culture, Heritage, Modern Minimal e Signature), editor com prévia em computador, tablet e celular, versões para restaurar e domínio próprio. Serviços, preços e equipe vêm direto do cadastro.\n\nAs telas desta página são capturas do sistema em funcionamento, com dados fictícios.',
    problema: 'Agenda em caderno ou no WhatsApp, horários marcados em dobro, comissão calculada à mão no fim do mês, caixa que não fecha e nenhuma presença na internet para o cliente agendar sozinho.',
    publico: '- Barbearias com um ou vários profissionais\n- Donos que querem controlar agenda, caixa e comissões em um só lugar\n- Barbeiros que atendem pela agenda no celular\n- Salões e estúdios com atendimento por hora marcada',
    requisitos: '- Navegador atualizado no computador, tablet ou celular\n- O app do barbeiro funciona no navegador do celular e pode ser instalado na tela inicial\n- Para o site com domínio próprio: um domínio registrado em nome da barbearia\n- Lembretes por WhatsApp exigem um número dedicado',
    status: 'demonstracao_disponivel', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Agenda por profissional', 'Dia, semana e mês, com bloqueios, encaixes e situação de cada atendimento; o banco recusa horário duplo.', 'calendar-week'),
      f('Agendamento online', 'Página pública para o cliente escolher serviço, profissional, data e horário livre, sem criar conta.', 'calendar-plus'),
      f('App do barbeiro', 'Agenda do dia, início e fim do atendimento, observações, folgas, comissões e recebimentos no celular.', 'phone'),
      f('Caixa', 'Abertura, recebimento com pagamento dividido, desconto, sangria, suprimento, estorno e fechamento com conferência.', 'cash-stack'),
      f('Comissões', 'Regras por serviço e profissional, percentual ou valor fixo, bônus, ajustes, adiantamentos e pagamento.', 'percent'),
      f('Financeiro', 'Contas a pagar e a receber, parcelas, fornecedores, fluxo de caixa, resultado e previsão de 30 dias.', 'graph-up-arrow'),
      f('Estoque', 'Produtos com custo, preço, mínimo e fornecedor; venda com baixa automática e histórico imutável.', 'box-seam'),
      f('Site com cinco modelos', 'Editor com prévia, seções, cores, imagens, SEO, versões, subdomínio e domínio próprio.', 'globe'),
      f('Lembretes por WhatsApp', 'Confirmação e lembrete do horário para o cliente que autorizar, com fila e histórico de envios.', 'whatsapp'),
      f('Relatórios e auditoria', 'Doze relatórios do dono e cinco do barbeiro, com CSV e PDF; ações sensíveis ficam registradas.', 'file-earmark-bar-graph')
    ],
    beneficios: [f('Sem horário em dobro', 'A disponibilidade é calculada no servidor, a partir da jornada de cada profissional.'), f('Comissão sem planilha', 'Gerada ao finalizar o atendimento, com a regra congelada.'), f('Cliente agenda sozinho', 'Link próprio e site da barbearia, 24 horas por dia.'), f('Dados isolados', 'Cada barbearia só enxerga os próprios dados, garantido pelo banco.')],
    faqs: [
      ['O cliente precisa baixar aplicativo ou criar conta?', 'Não. Ele agenda pelo navegador, informando nome e celular, e recebe um link para consultar ou cancelar o horário.'],
      ['Cada barbeiro vê a agenda dos outros?', 'Não. No app, o barbeiro vê só a própria agenda, as próprias comissões e os próprios recebimentos. O dono e a gerência veem tudo, conforme as permissões.'],
      ['Posso trocar o modelo do site depois?', 'Sim. Você vê a demonstração de cada modelo com os dados da sua barbearia, aplica e publica quando quiser; textos e imagens são mantidos e versões anteriores podem ser restauradas.'],
      ['Os dados da demonstração são reais?', 'Não. As capturas e a simulação usam uma barbearia, clientes e valores fictícios.']
    ],
    imagens: [['barbearia-capa.webp', 'Agenda do dia com uma coluna por profissional'], ['barbearia-painel.webp', 'Visão geral: faturamento, comissões, agenda e ocupação'],
      ['barbearia-agendamento.webp', 'Agendamento online: serviço, profissional, data e horário livre'], ['barbearia-agendamento-celular.webp', 'Agendamento online no celular, do serviço à confirmação'],
      ['barbearia-app-barbeiro.webp', 'App do barbeiro: agenda, atendimento e comissões'], ['barbearia-caixa.webp', 'Caixa com abertura, movimentações e fechamentos anteriores'],
      ['barbearia-comissoes.webp', 'Comissões por profissional no período'], ['barbearia-financeiro.webp', 'Financeiro: resultado, dinheiro no período e vencimentos'],
      ['barbearia-estoque.webp', 'Estoque de produtos com custo, venda e mínimo'], ['barbearia-meu-site.webp', 'Editor do site com prévia do rascunho'],
      ['barbearia-site-black-label.webp', 'Site no modelo Black Label'], ['barbearia-site-urban-culture.webp', 'Site no modelo Urban Culture'],
      ['barbearia-site-heritage.webp', 'Site no modelo Heritage'], ['barbearia-site-modern-minimal.webp', 'Site no modelo Modern Minimal'],
      ['barbearia-site-signature.webp', 'Site no modelo Signature'], ['barbearia-sites-celular.webp', 'Modelos Urban Culture, Heritage e Signature no celular']]
  },
  {
    slug: 'fleetmanager', nome: 'FleetManager', categoria: 'gestao-operacional', ordem: 30, destaque: true,
    resumo: 'Gestão de frota de veículos e máquinas: quilometragem, horímetro, manutenções, abastecimentos, documentos e custos operacionais.',
    descricao: 'O **FleetManager** (nome provisório) reúne as informações da frota em um painel: cadastro de veículos e máquinas, leituras de quilometragem e horímetro, histórico de manutenções com alertas de revisão, pneus e componentes, abastecimentos e vencimento de documentos.\n\nOs custos operacionais são consolidados por veículo, permitindo comparar consumo e despesas.',
    problema: 'Revisões esquecidas, documentos vencidos, abastecimentos sem controle e custos de manutenção espalhados em notas e planilhas.',
    publico: '- Empresas com frota própria\n- Prefeituras e órgãos com veículos e máquinas\n- Transportadoras e prestadores de serviço',
    requisitos: '- Navegador atualizado\n- Acesso à internet\n- Hospedagem Node.js + PostgreSQL',
    status: 'em_desenvolvimento', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Veículos e máquinas', 'Cadastro completo com dados técnicos.', 'truck'),
      f('Quilometragem e horímetro', 'Leituras periódicas com histórico.', 'speedometer'),
      f('Histórico de manutenções', 'Preventivas e corretivas por equipamento.', 'tools'),
      f('Alertas de revisão', 'Avisos por quilometragem, horas ou data.', 'bell'),
      f('Pneus e componentes', 'Controle de vida útil e substituições.', 'gear-wide-connected'),
      f('Abastecimentos', 'Litros, valores e consumo médio.', 'fuel-pump'),
      f('Documentos e vencimentos', 'Licenciamento, seguro e outros documentos.', 'file-earmark-check'),
      f('Custos operacionais', 'Despesas consolidadas por veículo e período.', 'cash-stack'),
      f('Relatórios por veículo', 'Indicadores individuais de uso e custo.', 'clipboard-data'),
      f('Painel de indicadores', 'Visão geral da frota em tempo real.', 'speedometer2')
    ],
    beneficios: [f('Manutenção em dia', 'Alertas antes do vencimento.'), f('Custos visíveis', 'Despesas por veículo e por km.'), f('Documentação regular', 'Vencimentos sob controle.'), f('Decisões com dados', 'Compare consumo e disponibilidade.')],
    faqs: [['O sistema rastreia veículos por GPS?', 'Não. O FleetManager não realiza rastreamento nem monitoramento invasivo; as leituras são registradas pelos usuários ou por integrações contratadas.']],
    imagens: [['fleetmanager-painel.svg', 'Painel de indicadores da frota'], ['fleetmanager-manutencao.svg', 'Alertas de manutenção'], ['fleetmanager-abastecimento.svg', 'Registro de abastecimentos']]
  },
  {
    slug: 'sistemas-personalizados', nome: 'Sistemas Personalizados', categoria: 'desenvolvimento-sob-demanda', ordem: 40, destaque: false,
    resumo: 'Desenvolvimento de sistemas sob medida, a partir de um levantamento de requisitos das necessidades da sua empresa.',
    descricao: 'Quando nenhum produto pronto atende ao seu processo, desenvolvemos um sistema sob medida: levantamento de requisitos, protótipo, desenvolvimento em etapas, implantação e suporte.\n\nPreencha o levantamento inicial abaixo. Com essas informações, retornamos com perguntas complementares e uma proposta com escopo, prazo e investimento.',
    problema: 'Processos específicos que não cabem em sistemas genéricos, controles em planilhas que cresceram demais e integrações manuais entre ferramentas.',
    publico: '- Empresas com processos próprios\n- Equipes que dependem de planilhas complexas\n- Negócios que precisam integrar sistemas existentes',
    requisitos: 'Definidos em conjunto, conforme o escopo do projeto.',
    status: 'disponivel', modelo: 'personalizado', demo: 'nenhuma',
    funcionalidades: [
      f('Levantamento de requisitos', 'Entendimento detalhado do processo antes do desenvolvimento.', 'clipboard-check'),
      f('Aplicações web responsivas', 'Uso no computador, tablet e celular.', 'phone'),
      f('Integrações e APIs', 'Comunicação com sistemas e serviços existentes.', 'plug'),
      f('Controle de acesso', 'Perfis e permissões conforme a sua estrutura.', 'shield-check'),
      f('Relatórios', 'Indicadores definidos com você.', 'bar-chart-line'),
      f('Documentação e testes', 'Código organizado e documentado.', 'journal-code')
    ],
    beneficios: [],
    faqs: [['Quanto custa um sistema personalizado?', 'O valor depende do escopo. Após o levantamento inicial, enviamos uma proposta detalhada, sem custo.'], ['Quem é dono do código?', 'As condições de propriedade e licenciamento são definidas na proposta e no contrato.']],
    imagens: []
  }
];

const SERVICES = [
  ['desenvolvimento-de-sistemas-personalizados', 'Desenvolvimento de sistemas personalizados', 'code-square', 'Sistemas criados a partir do seu processo, com escopo e etapas bem definidos.', ['Escopo definido antes do início', 'Entregas em etapas', 'Documentação técnica']],
  ['sistemas-de-gestao-empresarial', 'Sistemas de gestão empresarial', 'briefcase', 'Cadastros, operações, financeiro e relatórios integrados em uma única aplicação.', ['Informações centralizadas', 'Controle de acesso por perfil', 'Relatórios gerenciais']],
  ['aplicacoes-web', 'Aplicações web', 'window', 'Aplicações acessadas pelo navegador, responsivas e seguras.', ['Funciona em qualquer dispositivo', 'Sem instalação nas máquinas', 'Atualizações centralizadas']],
  ['sistemas-administrativos', 'Sistemas administrativos', 'kanban', 'Painéis administrativos para controlar cadastros, fluxos e aprovações.', ['Fluxos de aprovação', 'Histórico de alterações', 'Exportação de dados']],
  ['automacao-de-processos', 'Automação de processos', 'robot', 'Automação de tarefas repetitivas, cálculos e rotinas de conferência.', ['Menos retrabalho', 'Redução de erros manuais', 'Rotinas agendadas']],
  ['integracoes-entre-sistemas', 'Integrações entre sistemas', 'plug', 'Comunicação entre sistemas, planilhas e serviços externos.', ['Dados sincronizados', 'Fim da digitação dupla', 'Registros de integração']],
  ['desenvolvimento-de-apis', 'Desenvolvimento de APIs', 'braces', 'APIs documentadas para disponibilizar dados e serviços com segurança.', ['Autenticação e autorização', 'Documentação de rotas', 'Testes automatizados']],
  ['manutencao-e-evolucao', 'Manutenção e evolução de aplicações', 'wrench-adjustable', 'Correções, melhorias e novas funcionalidades em sistemas existentes.', ['Diagnóstico técnico', 'Correções priorizadas', 'Evolução planejada']],
  ['consultoria-e-implantacao', 'Consultoria e implantação', 'people', 'Apoio na escolha, implantação e adoção de sistemas pela equipe.', ['Mapeamento de processos', 'Treinamento da equipe', 'Acompanhamento pós-implantação']]
];

export async function seed(tx) {
  const catIds = {};
  for (const [i, [nome, slug, descricao]] of CATEGORIES.entries()) {
    await tx.query('INSERT INTO categorias (nome, slug, descricao, ordem) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [nome, slug, descricao, (i + 1) * 10]);
    catIds[slug] = (await tx.one('SELECT id FROM categorias WHERE slug = $1', [slug])).id;
  }

  for (const p of PRODUCTS) {
    const created = await tx.one(
      `INSERT INTO produtos (categoria_id, nome, slug, resumo, descricao, problema_resolvido, publico_alvo, requisitos_tecnicos, modelo_contratacao,
                             status_comercial, publicado, publicado_em, destaque, dados_demonstrativos, imagem_url, demo_tipo, demo_disponivel, demo_aviso,
                             seo_title, seo_description, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,now(),$11,$19,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [catIds[p.categoria], p.nome, p.slug, p.resumo, p.descricao, p.problema, p.publico, p.requisitos, p.modelo, p.status, p.destaque,
        `/assets/images/produtos/${p.capa || `${p.slug}-capa.svg`}`, p.demo, p.demo === 'interna',
        p.demo === 'interna' ? 'Demonstração visual com dados fictícios. Não representa um ambiente de produção.' : null,
        `${p.nome} — ${p.resumo.split(',')[0].slice(0, 50)}`.slice(0, 70), p.resumo.slice(0, 170), p.ordem, p.demonstrativo !== false]);
    if (!created) continue;
    for (const [i, it] of p.funcionalidades.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, icone, ordem) VALUES ($1,'funcionalidade',$2,$3,$4,$5)", [created.id, it.titulo, it.descricao, it.icone, i]);
    }
    for (const [i, it] of p.beneficios.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, ordem) VALUES ($1,'beneficio',$2,$3,$4)", [created.id, it.titulo, it.descricao, i]);
    }
    for (const [i, [pergunta, resposta]] of p.faqs.entries()) {
      await tx.query('INSERT INTO produto_faqs (produto_id, pergunta, resposta, ordem) VALUES ($1,$2,$3,$4)', [created.id, pergunta, resposta, i]);
    }
    for (const [i, [file, legenda]] of p.imagens.entries()) {
      await tx.query('INSERT INTO produto_imagens (produto_id, url_estatica, legenda, ordem) VALUES ($1,$2,$3,$4)', [created.id, `/assets/images/produtos/${file}`, legenda, i]);
    }
  }

  // Planos sem preço inventado: apenas modalidades "sob orçamento" e "personalizado".
  const plans = [
    ['Implantação sob orçamento', 'Licenciamento, implantação e treinamento com valores definidos conforme o porte e as necessidades da instituição.', 'sob_orcamento',
      ['portal-de-noticias', 'churchflow', 'spacecontrol', 'livro-caixa', 'gestao-de-barbearias', 'fleetmanager'], ['Configuração inicial', 'Importação de dados existentes', 'Treinamento da equipe']],
    ['Projeto personalizado', 'Desenvolvimento sob medida, com escopo, prazos e investimento definidos em proposta.', 'personalizado',
      ['sistemas-personalizados'], ['Levantamento de requisitos', 'Desenvolvimento em etapas', 'Implantação e suporte conforme contrato']]
  ];
  for (const [i, [nome, descricao, tipo, slugs, feats]] of plans.entries()) {
    if (await tx.one('SELECT id FROM planos WHERE nome = $1', [nome])) continue;
    const pl = await tx.one("INSERT INTO planos (nome, descricao, tipo_cobranca, periodicidade, ordem) VALUES ($1,$2,$3,'nao_aplicavel',$4) RETURNING id", [nome, descricao, tipo, i * 10]);
    for (const [j, d] of feats.entries()) await tx.query('INSERT INTO plano_funcionalidades (plano_id, descricao, ordem) VALUES ($1,$2,$3)', [pl.id, d, j]);
    await tx.query('INSERT INTO planos_produtos (plano_id, produto_id) SELECT $1, id FROM produtos WHERE slug = ANY($2) ON CONFLICT DO NOTHING', [pl.id, slugs]);
  }

  for (const [i, [slug, nome, icone, resumo, beneficios]] of SERVICES.entries()) {
    await tx.query(
      `INSERT INTO servicos (slug, nome, icone, resumo, descricao, beneficios, status, ordem) VALUES ($1,$2,$3,$4,$5,$6,'publicado',$7) ON CONFLICT (slug) DO NOTHING`,
      [slug, nome, icone, resumo, `${resumo}\n\nCada projeto começa com uma conversa para entender o contexto, seguida de proposta com escopo, prazos e investimento. Edite este texto no painel administrativo.`, beneficios, (i + 1) * 10]);
  }
}
