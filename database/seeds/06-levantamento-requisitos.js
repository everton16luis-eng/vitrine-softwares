// Roteiro inicial do Levantamento de Requisitos: 8 etapas, categorias da consolidação e perguntas.
// Aplicado só na primeira instalação (banco de perguntas vazio). Depois disso tudo é administrado
// pelo painel (Levantamento de Requisitos › Gerenciar perguntas) e este seed não reverte as edições.

/** Categorias: agrupam as respostas na consolidação do relatório. "contexto" alimenta a identificação do projeto. */
export const CATEGORIAS = [
  ['contexto', 'Contexto da ideia', 'Origem e explicação da ideia, usadas na identificação do projeto.'],
  ['problemas', 'Principais problemas identificados', 'Dores, erros e dificuldades da forma atual de trabalhar.'],
  ['necessidades', 'Necessidades do cliente', 'O que a solução precisa permitir no dia a dia.'],
  ['objetivos', 'Objetivos esperados', 'Resultados que o cliente espera alcançar.'],
  ['indispensaveis', 'Funcionalidades indispensáveis', 'O que precisa existir desde a primeira versão.'],
  ['desejaveis', 'Funcionalidades desejáveis', 'O que agrega valor, mas pode ficar para uma etapa seguinte.'],
  ['regras', 'Regras de negócio identificadas', 'Condições, limites, aprovações e exceções do processo.'],
  ['usuarios', 'Perfis de usuários', 'Quem usa a solução, com quais acessos e de onde.'],
  ['integracoes', 'Integrações mencionadas', 'Outros sistemas, serviços e referências citados.'],
  ['riscos', 'Restrições e riscos identificados', 'Prazos, orçamento, receios e o que não pode acontecer.'],
  ['duvidas', 'Dúvidas a esclarecer', 'Pontos em aberto e próximos passos da descoberta.']
];

const T = 'texto_longo';
const C = 'texto_curto';
const SN = 'sim_nao';
const U = 'selecao_unica';
const M = 'selecao_multipla';

// [enunciado, tipo, categoria, { obrigatoria, opcoes, orientacao }]
export const ETAPAS = [
  {
    titulo: 'Entendendo a ideia',
    descricao: 'Deixe o cliente contar a ideia com as próprias palavras, sem interromper com soluções.',
    perguntas: [
      ['Me conte um pouco sobre a sua ideia. O que você gostaria de criar?', T, 'contexto', { obrigatoria: true, orientacao: 'Pergunta de abertura. Anote as palavras que o cliente usa: elas costumam virar o vocabulário do sistema.' }],
      ['Como surgiu essa ideia?', T, 'contexto'],
      ['Se tivesse que explicar sua ideia para alguém que nunca ouviu falar dela, como explicaria?', T, 'contexto'],
      ['O que você imagina que esse sistema ou aplicativo seria capaz de fazer?', T, 'necessidades'],
      ['Você conhece algum sistema, aplicativo ou site parecido?', T, 'integracoes', { orientacao: 'Peça nomes e, se possível, o endereço. Referências ajudam a alinhar expectativas.' }],
      ['O que você gosta nesse exemplo e o que faria diferente?', T, 'desejaveis'],
      ['Você já imaginou como seria utilizar essa solução no dia a dia?', T, 'necessidades'],
      ['Existe alguma coisa que considera indispensável nessa ideia?', T, 'indispensaveis']
    ]
  },
  {
    titulo: 'Identificando o problema',
    descricao: 'Descubra a dor real por trás da ideia. Problemas relevantes podem ser aprofundados com os 5 porquês.',
    perguntas: [
      ['Qual problema você gostaria de resolver?', T, 'problemas', { obrigatoria: true, orientacao: 'Se o problema parecer sintoma de outra coisa, registre-o na Investigação de Problemas (5 porquês).' }],
      ['Como esse problema é resolvido atualmente?', T, 'problemas'],
      ['Como você faz isso hoje: papel, planilha, WhatsApp, outro sistema ou manualmente?', M, 'problemas', { opcoes: ['Papel', 'Planilha', 'WhatsApp', 'Outro sistema', 'Manualmente', 'Outra forma'] }],
      ['O que mais incomoda na maneira como as coisas funcionam atualmente?', T, 'problemas'],
      ['Quanto tempo acredita que perde realizando essas atividades?', C, 'problemas', { orientacao: 'Uma estimativa basta (ex.: 2 horas por dia). Ajuda a medir o retorno do projeto.' }],
      ['Quais erros ou dificuldades acontecem com frequência?', T, 'problemas'],
      ['O que acontece quando esse problema não é resolvido?', T, 'riscos'],
      ['Quem mais é prejudicado por essa situação?', T, 'problemas'],
      ['Já tentou alguma solução? Por que não funcionou?', T, 'problemas'],
      ['Se esse problema fosse resolvido amanhã, o que melhoraria?', T, 'objetivos']
    ]
  },
  {
    titulo: 'Conhecendo os processos',
    descricao: 'Percorra com o cliente o passo a passo de uma atividade real, do início ao fim.',
    perguntas: [
      ['Vamos imaginar que você comece a utilizar esse sistema amanhã. Qual seria a primeira coisa que faria?', T, 'necessidades'],
      ['Depois dessa primeira ação, o que deveria acontecer?', T, 'necessidades'],
      ['Quem seria responsável por realizar essa atividade?', T, 'usuarios'],
      ['Quais informações precisam ser registradas?', T, 'necessidades', { orientacao: 'Liste os campos citados. Pergunte quais são obrigatórios.' }],
      ['Essas informações precisam ser consultadas posteriormente?', SN, 'necessidades'],
      ['Alguém precisa aprovar ou autorizar alguma atividade?', SN, 'regras'],
      ['Existem etapas que precisam acontecer obrigatoriamente antes de outras?', T, 'regras'],
      ['Existem situações em que o processo pode ser diferente?', T, 'regras'],
      ['O que acontece quando alguma informação é preenchida incorretamente?', T, 'regras'],
      ['Como você saberia que uma atividade foi concluída corretamente?', T, 'regras']
    ]
  },
  {
    titulo: 'Identificando os usuários',
    descricao: 'Mapeie quem usa a solução, o que cada perfil pode fazer e de onde acessa.',
    perguntas: [
      ['Quem utilizará o sistema?', T, 'usuarios', { obrigatoria: true }],
      ['Somente você utilizará ou outras pessoas também terão acesso?', U, 'usuarios', { opcoes: ['Somente eu', 'Outras pessoas também'] }],
      ['Seus funcionários precisarão acessar o sistema?', SN, 'usuarios'],
      ['Seus clientes também precisarão utilizar alguma parte dele?', SN, 'usuarios'],
      ['Todas as pessoas poderão fazer as mesmas coisas?', SN, 'usuarios'],
      ['Existem informações que algumas pessoas não podem visualizar?', T, 'regras'],
      ['Alguém precisa administrar os acessos?', SN, 'usuarios'],
      ['Você gostaria de acompanhar as atividades realizadas por cada usuário?', SN, 'desejaveis'],
      ['As pessoas utilizarão o sistema pelo computador, celular ou ambos?', U, 'usuarios', { opcoes: ['Computador', 'Celular', 'Ambos'] }],
      ['Algum usuário precisa acessar o sistema fora da empresa?', SN, 'usuarios']
    ]
  },
  {
    titulo: 'Imaginando a solução',
    descricao: 'Explore o formato da solução sem decidir tecnologia: canais, automações, relatórios e integrações.',
    perguntas: [
      ['Você imagina um sistema acessado pelo navegador, um aplicativo de celular ou ambos?', U, 'necessidades', { opcoes: ['Navegador (sistema web)', 'Aplicativo de celular', 'Ambos', 'Ainda não sei'] }],
      ['O sistema será utilizado somente dentro da empresa ou também externamente?', U, 'necessidades', { opcoes: ['Somente dentro da empresa', 'Também externamente'] }],
      ['Você gostaria que o sistema enviasse notificações?', SN, 'desejaveis', { orientacao: 'Se sim, pergunte por qual canal: e-mail, WhatsApp, SMS ou no próprio sistema.' }],
      ['Existem atividades que gostaria que fossem realizadas automaticamente?', T, 'desejaveis'],
      ['Você precisa gerar relatórios?', SN, 'necessidades'],
      ['Quais informações gostaria de acompanhar em um painel inicial?', T, 'necessidades'],
      ['Você precisa armazenar documentos, fotos ou arquivos?', SN, 'necessidades'],
      ['O sistema precisaria conversar com outros sistemas ou serviços?', T, 'integracoes', { orientacao: 'Ex.: sistema de gestão, emissor de nota fiscal, meios de pagamento, planilhas, WhatsApp.' }],
      ['Você gostaria de acompanhar informações em tempo real?', SN, 'desejaveis'],
      ['Precisa funcionar quando não houver conexão com a internet?', SN, 'riscos']
    ]
  },
  {
    titulo: 'Regras e exceções',
    descricao: 'Levante as regras que o sistema precisa garantir e o que acontece fora do caminho normal.',
    perguntas: [
      ['Existem regras que precisam ser seguidas obrigatoriamente?', T, 'regras'],
      ['Existem limites de valores, quantidades, horários ou prazos?', T, 'regras'],
      ['Quem pode autorizar determinadas operações?', T, 'regras'],
      ['Existem situações em que uma operação precisa ser cancelada?', T, 'regras'],
      ['Quando uma informação é registrada, ela poderá ser alterada posteriormente?', SN, 'regras'],
      ['Você precisa saber quem realizou cada alteração?', SN, 'regras'],
      ['Existem atividades que precisam de justificativa?', T, 'regras'],
      ['O sistema precisa manter um histórico das operações?', SN, 'regras'],
      ['Existem situações excepcionais que precisam de tratamento especial?', T, 'regras'],
      ['O que o sistema nunca deve permitir que um usuário faça?', T, 'riscos']
    ]
  },
  {
    titulo: 'Expectativas e prioridades',
    descricao: 'Separe o essencial do desejável e registre prazo, orçamento e visão de futuro.',
    perguntas: [
      ['Qual seria o resultado ideal depois que o sistema estivesse funcionando?', T, 'objetivos'],
      ['O que faria você considerar esse projeto um sucesso?', T, 'objetivos'],
      ['Quais funcionalidades seriam indispensáveis desde o primeiro dia?', T, 'indispensaveis', { obrigatoria: true }],
      ['O que seria interessante ter, mas poderia ficar para uma segunda etapa?', T, 'desejaveis'],
      ['Existe alguma funcionalidade que considera um diferencial?', T, 'desejaveis'],
      ['Você tem alguma data ou prazo em mente?', 'data', 'riscos', { orientacao: 'Registre a data e, no complemento, o motivo do prazo (evento, sazonalidade, contrato).' }],
      ['Existe um orçamento previsto para o desenvolvimento?', C, 'riscos'],
      ['Você pretende utilizar essa solução somente internamente ou comercializá-la para outras pessoas?', U, 'objetivos', { opcoes: ['Somente internamente', 'Comercializar para outras pessoas', 'Ambos', 'Ainda não sei'] }],
      ['Quantas pessoas imagina utilizando a solução inicialmente?', 'numero', 'usuarios'],
      ['Como imagina que essa solução poderá evoluir nos próximos anos?', T, 'objetivos']
    ]
  },
  {
    titulo: 'Finalização da descoberta',
    descricao: 'Feche a conversa garantindo que nada importante ficou de fora e combine os próximos passos.',
    perguntas: [
      ['Existe alguma coisa importante que não perguntamos?', 'observacoes', 'duvidas'],
      ['Existe alguma situação que tem receio de que o sistema não consiga resolver?', T, 'riscos'],
      ['Existe alguma funcionalidade que viu em outro sistema e gostaria de ter?', T, 'desejaveis'],
      ['O que definitivamente não gostaria que existisse nessa solução?', T, 'riscos'],
      ['Se pudesse escolher apenas três coisas que o sistema precisa resolver, quais seriam?', T, 'indispensaveis'],
      ['Existe alguma pessoa da sua equipe que também deveria participar de uma próxima conversa?', C, 'duvidas'],
      ['Você possui documentos, planilhas ou exemplos que possam ajudar a entender melhor os processos?', SN, 'duvidas', { orientacao: 'Se sim, combine como serão enviados e registre no complemento.' }]
    ]
  }
];

export async function seed(tx) {
  const { n } = await tx.one('SELECT count(*)::int AS n FROM lr_etapas');
  if (n > 0) return; // já instalado: o roteiro pertence ao administrador

  const cat = new Map();
  for (const [i, [chave, titulo, descricao]] of CATEGORIAS.entries()) {
    const r = await tx.one(`INSERT INTO lr_categorias (chave, titulo, descricao, ordem, padrao) VALUES ($1,$2,$3,$4,true)
      ON CONFLICT (chave) DO UPDATE SET chave = EXCLUDED.chave RETURNING id`, [chave, titulo, descricao, (i + 1) * 10]);
    cat.set(chave, r.id);
  }
  for (const [i, etapa] of ETAPAS.entries()) {
    const { id } = await tx.one('INSERT INTO lr_etapas (titulo, descricao, ordem, padrao) VALUES ($1,$2,$3,true) RETURNING id', [etapa.titulo, etapa.descricao, (i + 1) * 10]);
    for (const [j, [enunciado, tipo, categoria, extra = {}]] of etapa.perguntas.entries()) {
      await tx.query(`INSERT INTO lr_perguntas (etapa_id, categoria_id, enunciado, orientacao, tipo, obrigatoria, ordem, personalizada, opcoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
      [id, cat.get(categoria) ?? null, enunciado, extra.orientacao || null, tipo, Boolean(extra.obrigatoria), (j + 1) * 10, JSON.stringify(extra.opcoes || [])]);
    }
  }
}
