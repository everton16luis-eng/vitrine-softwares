// Catálogo demonstrativo. Todos os produtos são marcados como dados_demonstrativos
// e NENHUM preço é inventado. Situações comerciais iniciais conservadoras:
// os três sistemas aparecem como "Em desenvolvimento" (com demonstração visual
// de dados fictícios); o administrador altera conforme a realidade.
// Inserção apenas se o slug ainda não existir — edições do painel são preservadas.

const CATEGORIES = [
  ['Gestão institucional', 'gestao-institucional', 'Organização de membros, voluntários, eventos e atividades.'],
  ['Gestão de locações', 'gestao-de-locacoes', 'Reservas, contratos e controle de espaços e utensílios.'],
  ['Gestão operacional', 'gestao-operacional', 'Controle de ativos, manutenção e custos operacionais.'],
  ['Desenvolvimento sob demanda', 'desenvolvimento-sob-demanda', 'Sistemas criados a partir das necessidades de cada cliente.']
];

const f = (titulo, descricao, icone) => ({ titulo, descricao, icone });

const PRODUCTS = [
  {
    slug: 'churchflow', nome: 'ChurchFlow', categoria: 'gestao-institucional', ordem: 10, destaque: true,
    resumo: 'Plataforma para organizar membros, visitantes, voluntários, eventos, escalas de serviço e relatórios de igrejas e instituições.',
    descricao: 'O **ChurchFlow** (nome provisório) centraliza a organização de uma comunidade: cadastro de membros e visitantes, equipes de voluntários, escalas com confirmação de participação, calendário de eventos e relatórios administrativos.\n\nCada voluntário pode ter uma área individual para consultar e confirmar as próprias escalas, reduzindo trocas de mensagens e esquecimentos.',
    problema: 'Escalas montadas em planilhas e grupos de mensagens, confirmações perdidas, cadastros duplicados e dificuldade para saber quem participa de cada atividade.',
    publico: '- Igrejas e comunidades religiosas\n- Associações e instituições com equipes de voluntários\n- Organizações que realizam eventos recorrentes',
    requisitos: '- Navegador atualizado (Chrome, Edge, Firefox ou Safari)\n- Acesso à internet\n- Hospedagem em servidor Node.js com PostgreSQL (pode ser fornecida na implantação)',
    status: 'em_desenvolvimento', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Membros e visitantes', 'Cadastro com histórico de participação e acompanhamento de visitantes.', 'person-vcard'),
      f('Gestão de voluntários', 'Equipes, funções e disponibilidade de cada voluntário.', 'people'),
      f('Escalas com confirmação', 'Montagem de escalas e confirmação de presença pelo próprio voluntário.', 'calendar-check'),
      f('Calendário de eventos', 'Eventos, cultos e atividades em uma agenda única.', 'calendar3'),
      f('Usuários e permissões', 'Perfis de acesso para líderes, secretaria e administração.', 'shield-lock'),
      f('Relatórios administrativos', 'Participação, frequência e escalas por período.', 'bar-chart'),
      f('Área do voluntário', 'Espaço individual para consultar e confirmar compromissos.', 'person-badge'),
      f('Atividades e equipes', 'Controle de ministérios, equipes e suas atividades.', 'diagram-3')
    ],
    beneficios: [f('Menos mensagens', 'Confirmações centralizadas no sistema.'), f('Escalas equilibradas', 'Visão de quem está sobrecarregado ou disponível.'), f('Histórico organizado', 'Participação registrada ao longo do tempo.'), f('Acesso pelo celular', 'Interface responsiva para voluntários.')],
    faqs: [['Os dados da demonstração são reais?', 'Não. A demonstração usa somente nomes e dados fictícios.'], ['O sistema já está disponível para contratação?', 'O ChurchFlow está em desenvolvimento. Registre seu interesse para ser avisado e participar da definição das funcionalidades.']],
    imagens: [['churchflow-escalas.svg', 'Escalas de serviço com status de confirmação'], ['churchflow-membros.svg', 'Cadastro de membros e visitantes'], ['churchflow-relatorios.svg', 'Relatórios de participação']]
  },
  {
    slug: 'spacecontrol', nome: 'SpaceControl', categoria: 'gestao-de-locacoes', ordem: 20, destaque: true,
    resumo: 'Sistema para controlar reservas de salas e espaços, contratos, checklists de entrega e devolução e o inventário de utensílios.',
    descricao: 'O **SpaceControl** (nome provisório) organiza todo o ciclo de uma locação: agenda de reservas, cadastro de locatários, contratos, checklist de entrega e devolução e inventário dos utensílios disponibilizados.\n\nAvarias registradas na devolução geram cobranças adicionais calculadas automaticamente, com histórico completo de cada locação.',
    problema: 'Conflitos de agenda, contratos sem padronização, utensílios que somem sem registro e cobranças de avarias feitas "de cabeça".',
    publico: '- Salões de festas e espaços para eventos\n- Coworkings e salas comerciais\n- Igrejas, clubes e associações que alugam espaços',
    requisitos: '- Navegador atualizado\n- Acesso à internet\n- Hospedagem Node.js + PostgreSQL',
    status: 'em_desenvolvimento', modelo: 'sob_orcamento', demo: 'interna',
    funcionalidades: [
      f('Cadastro de espaços', 'Capacidade, valores de referência e itens disponíveis em cada espaço.', 'building'),
      f('Agenda de reservas', 'Calendário com bloqueio de conflitos de horário.', 'calendar-week'),
      f('Cadastro de locatários', 'Dados de contato e histórico de locações.', 'person-lines-fill'),
      f('Gestão de contratos', 'Contratos vinculados a cada reserva.', 'file-earmark-text'),
      f('Checklist de entrega e devolução', 'Conferência item a item na entrega e na devolução.', 'list-check'),
      f('Inventário de utensílios', 'Quantidades e estado de conservação dos itens.', 'box-seam'),
      f('Danos e avarias', 'Registro de ocorrências com descrição e valor.', 'exclamation-triangle'),
      f('Cobranças adicionais', 'Cálculo automático de avarias e itens faltantes.', 'calculator'),
      f('Histórico de locações', 'Linha do tempo por espaço e por locatário.', 'clock-history'),
      f('Relatórios financeiros e operacionais', 'Ocupação, receitas e ocorrências por período.', 'graph-up')
    ],
    beneficios: [f('Agenda sem conflitos', 'Reservas sobrepostas são bloqueadas.'), f('Inventário confiável', 'Saiba o que saiu e o que voltou.'), f('Cobranças justas', 'Avarias documentadas e calculadas.'), f('Contratos padronizados', 'Menos retrabalho a cada locação.')],
    faqs: [['O sistema emite nota fiscal?', 'Não nesta versão. Integrações fiscais podem ser avaliadas em projeto personalizado.']],
    imagens: [['spacecontrol-agenda.svg', 'Agenda de reservas dos espaços'], ['spacecontrol-checklist.svg', 'Checklist de devolução com avarias'], ['spacecontrol-inventario.svg', 'Inventário de utensílios']]
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,now(),$11,true,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [catIds[p.categoria], p.nome, p.slug, p.resumo, p.descricao, p.problema, p.publico, p.requisitos, p.modelo, p.status, p.destaque,
        `/assets/images/produtos/${p.slug}-capa.svg`, p.demo, p.demo === 'interna',
        p.demo === 'interna' ? 'Demonstração visual com dados fictícios. Não representa um ambiente de produção.' : null,
        `${p.nome} — ${p.resumo.split(',')[0].slice(0, 50)}`.slice(0, 70), p.resumo.slice(0, 170), p.ordem]);
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
      ['churchflow', 'spacecontrol', 'fleetmanager'], ['Configuração inicial', 'Importação de dados existentes', 'Treinamento da equipe']],
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
