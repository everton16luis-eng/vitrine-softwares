import { el, icon, kpis, table, badge, card, field, flash, mountDemo, tourView, addDays, fmtDateLong, money } from './core.js';

// Dados 100% fictícios: municípios, fontes, autores e notícias são inventados.
// Nenhuma notícia é publicada automaticamente — coleta e IA apenas preparam a fila de revisão.
const MUNICIPIOS = ['Vale Sereno', 'Campo das Araucárias', 'Serra do Pinhal', 'Rio Manso do Norte'];
const CATEGORIAS = ['Cidades', 'Clima', 'Saúde', 'Economia', 'Esportes'];

const state = {
  fontes: [
    { id: 1, nome: 'Defesa Civil Regional (fictícia)', tipo: 'RSS', ativa: true, ultima: addDays(0), itens: 10, erro: null },
    { id: 2, nome: 'Prefeitura de Vale Sereno (fictícia)', tipo: 'RSS', ativa: true, ultima: addDays(0), itens: 6, erro: null },
    { id: 3, nome: 'Câmara de Serra do Pinhal (fictícia)', tipo: 'Página HTML', ativa: true, ultima: addDays(-1), itens: 3, erro: 'Tempo de resposta excedido' },
    { id: 4, nome: 'Associação Comercial (fictícia)', tipo: 'RSS', ativa: false, ultima: null, itens: 0, erro: null }
  ],
  noticias: [
    { id: 1, status: 'publicada', titulo: 'Defesa Civil alerta para chuva intensa nas próximas 48 horas', resumo: 'Previsão indica acumulados elevados em toda a região; moradores de áreas de risco devem acompanhar os avisos.', categoria: 'Clima', municipio: 'Vale Sereno', fonte: 1, autor: 'Equipe de comunicação (fictícia)', data: addDays(0), modelo: 'Urgente', views: 1840 },
    { id: 2, status: 'publicada', titulo: 'Campanha de vacinação é ampliada para novos grupos', resumo: 'Unidades de saúde terão horário estendido durante a semana.', categoria: 'Saúde', municipio: 'Campo das Araucárias', fonte: 2, autor: 'Secretaria de Saúde (fictícia)', data: addDays(-1), modelo: 'Serviço', views: 962 },
    { id: 3, status: 'publicada', titulo: 'Feira regional reúne produtores locais no fim de semana', resumo: 'Evento terá exposição de produtos coloniais e programação cultural.', categoria: 'Economia', municipio: 'Serra do Pinhal', fonte: 4, autor: 'Redação (fictícia)', data: addDays(-1), modelo: 'Clássico', views: 611 },
    { id: 4, status: 'publicada', titulo: 'Obras de pavimentação avançam no bairro central', resumo: 'Prefeitura informa que trecho deve ser liberado ao trânsito ainda este mês.', categoria: 'Cidades', municipio: 'Vale Sereno', fonte: 2, autor: 'Assessoria (fictícia)', data: addDays(-2), modelo: 'Nota', views: 430 },
    { id: 5, status: 'pendente', titulo: 'Nota oficial: alteração no horário de atendimento ao público', resumo: '', categoria: 'Cidades', municipio: 'Rio Manso do Norte', fonte: 2, autor: 'Assessoria (fictícia)', data: addDays(0), modelo: 'Nota', views: 0,
      ia: { titulo: 'Atendimento ao público terá novo horário a partir de segunda-feira', resumo: 'Mudança vale para todos os setores; serviços online seguem disponíveis.', categoria: 'Cidades' } },
    { id: 6, status: 'pendente', titulo: 'BOLETIM 14 - NÍVEL DO RIO EM ELEVAÇÃO', resumo: '', categoria: 'Clima', municipio: 'Rio Manso do Norte', fonte: 1, autor: 'Defesa Civil (fictícia)', data: addDays(0), modelo: 'Urgente', views: 0,
      ia: { titulo: 'Nível do rio sobe e Defesa Civil mantém monitoramento', resumo: 'Boletim indica elevação gradual; não há registro de desalojados até o momento.', categoria: 'Clima' } },
    { id: 7, status: 'em_revisao', titulo: 'Sessão aprova projeto de incentivo ao esporte amador', resumo: 'Proposta segue para sanção e prevê apoio a equipes locais.', categoria: 'Esportes', municipio: 'Serra do Pinhal', fonte: 3, autor: 'Câmara (fictícia)', data: addDays(-1), modelo: 'Clássico', views: 0 },
    { id: 8, status: 'agendada', titulo: 'Programação do festival de inverno é divulgada', resumo: 'Atrações culturais ocupam a praça central durante três fins de semana.', categoria: 'Cidades', municipio: 'Campo das Araucárias', fonte: 2, autor: 'Redação (fictícia)', data: addDays(1), modelo: 'Especial', views: 0 }
  ],
  campanhas: [
    { id: 1, anunciante: 'Loja Exemplo (fictícia)', posicao: 'Topo da home', inicio: addDays(-10), fim: addDays(20), impressoes: 18420, cliques: 312 },
    { id: 2, anunciante: 'Clínica Exemplo (fictícia)', posicao: 'Barra lateral da matéria', inicio: addDays(-4), fim: addDays(26), impressoes: 9210, cliques: 141 },
    { id: 3, anunciante: 'Mercado Exemplo (fictício)', posicao: 'Rodapé', inicio: addDays(-40), fim: addDays(-10), impressoes: 22100, cliques: 205 }
  ],
  social: [
    { id: 1, noticia: 1, formato: 'Feed', status: 'aguardando', horario: '12:00' },
    { id: 2, noticia: 2, formato: 'Stories', status: 'publicado', horario: '09:30' }
  ],
  ia: { usado: 1840, limite: 5000 } // centavos no mês
};
let nextId = 100;
const fonte = (id) => state.fontes.find((f) => f.id === id);
const noticia = (id) => state.noticias.find((n) => n.id === id);
const publicadas = () => state.noticias.filter((n) => n.status === 'publicada').sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
const STATUS = {
  pendente: ['Pendente', 'warn'], em_revisao: ['Em revisão', 'info'], agendada: ['Agendada', 'info'],
  publicada: ['Publicada', 'ok'], rejeitada: ['Rejeitada', 'bad'], retirada: ['Retirada', 'bad']
};
const statusBadge = (s) => badge(...STATUS[s]);
const credito = (n) => `Fonte: ${fonte(n.fonte).nome} | Autor: ${n.autor}`;
/** Redesenha a tela e só então mostra o aviso (senão ele some junto com a tela antiga). */
const avisar = (app, msg, tone = 'ok') => { app.refresh(); flash(document.querySelector('#demo-app .demo-body'), msg, tone); };

function painel(c, app) {
  const fila = state.noticias.filter((n) => ['pendente', 'em_revisao'].includes(n.status)).length;
  c.append(kpis([
    ['Na fila de revisão', fila, fila ? 'warn' : ''],
    ['Publicadas', publicadas().length],
    ['Fontes ativas', state.fontes.filter((f) => f.ativa).length],
    ['Fontes com erro', state.fontes.filter((f) => f.erro).length, state.fontes.some((f) => f.erro) ? 'warn' : '']
  ]));
  c.append(card('Fluxo editorial', el('ol', { class: 'pn-flow' },
    ['Coleta automática de fontes autorizadas', 'Deduplicação e sugestão da IA (opcional)', 'Revisão humana obrigatória', 'Publicação no portal, SEO e redes sociais'].map((t) => el('li', {}, t))),
  el('p', { class: 'demo-muted' }, 'Nenhuma notícia é publicada automaticamente: a coleta e a IA apenas preparam o material para a equipe.')));
  c.append(card('Aguardando revisão', table([
    { label: 'Título original', key: 'titulo' }, { label: 'Fonte', render: (n) => fonte(n.fonte).nome },
    { label: 'Situação', render: (n) => statusBadge(n.status) },
    { label: '', render: () => el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => app.go('revisao') }, 'Revisar') }
  ], state.noticias.filter((n) => ['pendente', 'em_revisao'].includes(n.status)), { empty: 'Fila vazia.' })));
}

function newsCard(n, abrir, big = false) {
  return el('article', { class: `pn-card${big ? ' pn-card-big' : ''}` },
    el('div', { class: `pn-thumb pn-cat-${CATEGORIAS.indexOf(n.categoria)}`, 'aria-hidden': 'true' }, icon({ Clima: 'cloud-rain', Saúde: 'heart-pulse', Economia: 'shop', Esportes: 'trophy' }[n.categoria] || 'buildings')),
    el('div', { class: 'pn-card-body' },
      el('span', { class: 'pn-kicker' }, `${n.categoria} · ${n.municipio}`),
      el(big ? 'h3' : 'h4', {}, el('button', { type: 'button', class: 'pn-link', onclick: () => abrir(n) }, n.titulo)),
      big ? el('p', {}, n.resumo) : null,
      el('small', { class: 'demo-muted' }, fmtDateLong(n.data))));
}

function portal(c) {
  let cat = '';
  let busca = '';
  const area = el('div');
  const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const abrir = (n) => {
    n.views += 1;
    area.textContent = '';
    area.append(el('article', { class: 'pn-materia' },
      el('button', { type: 'button', class: 'btn btn-sm btn-outline-light mb-3', onclick: draw }, icon('arrow-left'), ' Voltar à capa'),
      el('span', { class: 'pn-kicker' }, `${n.categoria} · ${n.municipio} · modelo "${n.modelo}"`),
      el('h3', {}, n.titulo),
      el('p', { class: 'pn-lead' }, n.resumo),
      el('p', { class: 'pn-credit' }, credito(n)),
      el('p', {}, 'Texto da matéria de demonstração. No sistema real, o corpo é escrito ou revisado pela equipe e a página traz link para a publicação original, dados estruturados (NewsArticle) e Open Graph para compartilhamento.'),
      el('aside', { class: 'pn-ad' }, el('span', {}, 'Publicidade'), ' Espaço de anúncio — barra lateral da matéria')));
  };
  function draw() {
    area.textContent = '';
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    const lista = publicadas().filter((n) => (!cat || n.categoria === cat) && termos.every((t) => semAcento(`${n.titulo} ${n.resumo}`).includes(t)));
    if (!lista.length) { area.append(el('p', { class: 'demo-empty' }, 'Nenhuma notícia encontrada.')); return; }
    const [manchete, ...resto] = lista;
    area.append(el('div', { class: 'pn-ad pn-ad-top' }, el('span', {}, 'Publicidade'), ' Topo da home'));
    area.append(el('div', { class: 'pn-grid' }, newsCard(manchete, abrir, true), el('div', { class: 'pn-side' }, resto.map((n) => newsCard(n, abrir)))));
  }
  const nav = el('div', { class: 'pn-cats', role: 'group', 'aria-label': 'Categorias' },
    ['', ...CATEGORIAS].map((k) => el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', 'aria-pressed': String(k === cat), onclick: (e) => {
      cat = k;
      nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      draw();
    } }, k || 'Todas')));
  const search = el('input', { type: 'search', class: 'form-control', placeholder: 'Buscar (ex.: previsao chuva)', 'aria-label': 'Buscar notícias', oninput: (e) => { busca = e.target.value; draw(); } });
  c.append(card('Capa do portal (visão do leitor)', el('p', { class: 'demo-muted' }, 'Busca em português sem acento, filtros por categoria e páginas de matéria com crédito da fonte.'), el('div', { class: 'demo-toolbar' }, search), nav, area));
  draw();
}

function revisao(c, app) {
  const fila = state.noticias.filter((n) => ['pendente', 'em_revisao'].includes(n.status));
  if (!fila.length) { c.append(card('Fila de revisão', el('p', { class: 'demo-empty' }, 'Fila vazia. Use "Coletar agora" em Fontes para trazer novos itens.'))); return; }
  for (const n of fila) {
    const titulo = el('input', { class: 'form-control', maxlength: 140, value: n.titulo });
    const resumo = el('textarea', { class: 'form-control', rows: 2, maxlength: 300 }, n.resumo);
    const cat = el('select', { class: 'form-select' }, CATEGORIAS.map((k) => el('option', { value: k, selected: k === n.categoria }, k)));
    const salvar = (status) => {
      if (titulo.value.trim().length < 10) { flash(c, 'O título editorial precisa de ao menos 10 caracteres.', 'bad'); return; }
      if (status !== 'rejeitada' && !resumo.value.trim()) { flash(c, 'Escreva um resumo antes de aprovar.', 'bad'); return; }
      Object.assign(n, { titulo: titulo.value.trim(), resumo: resumo.value.trim(), categoria: cat.value, status, data: status === 'agendada' ? addDays(1) : addDays(0) });
      avisar(app, { publicada: 'Notícia publicada — já aparece na capa do portal.', agendada: 'Publicação agendada para amanhã.', rejeitada: 'Item rejeitado.' }[status], status === 'rejeitada' ? 'bad' : 'ok');
    };
    c.append(card(null,
      el('div', { class: 'd-flex flex-wrap justify-content-between gap-2 mb-2' }, el('strong', { class: 'text-white' }, `Original: ${n.titulo}`), statusBadge(n.status)),
      el('p', { class: 'demo-muted small' }, `${fonte(n.fonte).nome} · ${n.municipio} · coletado ${fmtDateLong(n.data)}`),
      n.ia ? el('div', { class: 'pn-ia' }, el('strong', {}, icon('stars'), ' Sugestão da IA'), el('p', {}, n.ia.titulo), el('p', { class: 'demo-muted' }, n.ia.resumo),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-light', onclick: () => { titulo.value = n.ia.titulo; resumo.value = n.ia.resumo; cat.value = n.ia.categoria; } }, 'Usar sugestão')) : null,
      el('div', { class: 'demo-inline-form mt-2' }, field('Título editorial', titulo), field('Categoria', cat)),
      el('div', { class: 'mt-2' }, field('Resumo', resumo)),
      el('div', { class: 'd-flex flex-wrap gap-2 mt-3' },
        el('button', { class: 'btn btn-accent btn-sm', type: 'button', onclick: () => salvar('publicada') }, icon('check2'), ' Aprovar e publicar'),
        el('button', { class: 'btn btn-outline-light btn-sm', type: 'button', onclick: () => salvar('agendada') }, icon('clock'), ' Agendar'),
        el('button', { class: 'btn btn-outline-light btn-sm', type: 'button', onclick: () => salvar('rejeitada') }, 'Rejeitar'))));
  }
}

function noticias(c, app) {
  c.append(card('Todas as notícias', table([
    { label: 'Título', key: 'titulo' }, { label: 'Categoria', key: 'categoria' },
    { label: 'Data', render: (n) => fmtDateLong(n.data) }, { label: 'Situação', render: (n) => statusBadge(n.status) },
    { label: 'Acessos', num: true, render: (n) => n.views.toLocaleString('pt-BR') },
    { label: 'Ação', render: (n) => (n.status === 'publicada'
      ? el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { n.status = 'retirada'; app.refresh(); } }, 'Retirar')
      : n.status === 'agendada' ? el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { n.status = 'publicada'; n.data = addDays(0); app.refresh(); } }, 'Publicar agora') : '—') }
  ], [...state.noticias].sort((a, b) => b.id - a.id))));
}

const MODELOS_COLETA = [
  ['Prefeitura divulga calendário de coleta seletiva', 'Cidades'], ['Previsão indica frio intenso no fim de semana', 'Clima'],
  ['Unidade de saúde amplia horário de atendimento', 'Saúde'], ['Torneio municipal abre inscrições', 'Esportes']
];

function fontes(c, app) {
  c.append(card('Fontes cadastradas', el('p', { class: 'demo-muted' }, 'Cada fonte tem política de uso registrada e é testada antes da ativação. A coleta respeita limites e detecta duplicados.'),
    table([
      { label: 'Fonte', key: 'nome' }, { label: 'Tipo', key: 'tipo' },
      { label: 'Situação', render: (f) => (f.erro ? badge(f.erro, 'bad') : f.ativa ? badge('Ativa', 'ok') : badge('Inativa', 'neutral')) },
      { label: 'Última coleta', render: (f) => (f.ultima ? fmtDateLong(f.ultima) : '—') },
      { label: 'Ações', render: (f) => el('div', { class: 'd-flex flex-wrap gap-1' },
        el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { f.erro = null; avisar(app, `Conexão OK: ${f.nome} — itens válidos encontrados.`); } }, 'Testar'),
        el('button', { class: 'btn btn-sm btn-outline-light', type: 'button', onclick: () => { f.ativa = !f.ativa; app.refresh(); } }, f.ativa ? 'Pausar' : 'Ativar'),
        el('button', { class: 'btn btn-sm btn-accent', type: 'button', disabled: !f.ativa, onclick: () => coletar(f, app) }, 'Coletar agora')) }
    ], state.fontes)));
}

function coletar(f, app) {
  const [titulo, categoria] = MODELOS_COLETA[f.itens % MODELOS_COLETA.length];
  const dup = state.noticias.some((n) => n.titulo === titulo);
  f.itens += 1;
  f.ultima = addDays(0);
  if (dup) { avisar(app, `Coleta concluída: 1 item duplicado ignorado (${f.nome}).`); return; }
  state.noticias.push({ id: nextId++, status: 'pendente', titulo, resumo: '', categoria, municipio: MUNICIPIOS[f.itens % MUNICIPIOS.length], fonte: f.id, autor: 'Assessoria (fictícia)', data: addDays(0), modelo: 'Clássico', views: 0,
    ia: { titulo: `${titulo} (título editorial sugerido)`, resumo: 'Resumo sugerido pela IA a partir do conteúdo coletado, para revisão da equipe.', categoria } });
  avisar(app, 'Coleta concluída: 1 novo item enviado à fila de revisão.');
}

function publicidade(c) {
  const ativa = (k) => k.inicio <= addDays(0) && k.fim >= addDays(0);
  const total = state.campanhas.reduce((a, k) => a + k.impressoes, 0);
  c.append(kpis([['Campanhas ativas', state.campanhas.filter(ativa).length], ['Impressões', total.toLocaleString('pt-BR')],
    ['Cliques', state.campanhas.reduce((a, k) => a + k.cliques, 0).toLocaleString('pt-BR')]]));
  c.append(card('Campanhas', table([
    { label: 'Anunciante', key: 'anunciante' }, { label: 'Posição', key: 'posicao' },
    { label: 'Período', render: (k) => `${fmtDateLong(k.inicio)} → ${fmtDateLong(k.fim)}` },
    { label: 'Situação', render: (k) => (ativa(k) ? badge('No ar', 'ok') : badge('Encerrada', 'neutral')) },
    { label: 'CTR', num: true, render: (k) => `${((k.cliques / k.impressoes) * 100).toFixed(2).replace('.', ',')}%` }
  ], state.campanhas)), el('p', { class: 'demo-muted small' }, 'Campanhas expiradas saem do ar automaticamente. Há também preparação para Google AdSense, contratos, pagamentos e relatórios em CSV.'));
}

function redes(c, app) {
  const sel = el('select', { class: 'form-select' }, publicadas().map((n) => el('option', { value: n.id }, n.titulo)));
  const formato = el('select', { class: 'form-select' }, el('option', {}, 'Feed'), el('option', {}, 'Stories'));
  c.append(card('Nova publicação no Instagram', el('form', { class: 'demo-inline-form', onsubmit: (e) => {
    e.preventDefault();
    if (!sel.value) return;
    state.social.push({ id: nextId++, noticia: Number(sel.value), formato: formato.value, status: 'aguardando', horario: '18:00' });
    avisar(app, 'Arte gerada e enviada para aprovação.');
  } }, field('Notícia', sel), field('Formato', formato), el('button', { class: 'btn btn-accent', type: 'submit' }, 'Gerar arte'))));
  c.append(card('Fila de publicação', table([
    { label: 'Arte', render: (p) => el('div', { class: `pn-art pn-cat-${CATEGORIAS.indexOf(noticia(p.noticia).categoria)}` }, noticia(p.noticia).titulo) },
    { label: 'Formato', key: 'formato' }, { label: 'Horário', key: 'horario' },
    { label: 'Situação', render: (p) => (p.status === 'publicado' ? badge('Publicado', 'ok') : badge('Aguardando aprovação', 'warn')) },
    { label: 'Ação', render: (p) => (p.status === 'publicado' ? '—' : el('button', { class: 'btn btn-sm btn-accent', type: 'button', onclick: () => { p.status = 'publicado'; app.refresh(); } }, 'Aprovar')) }
  ], state.social)), el('p', { class: 'demo-muted small' }, 'No sistema real a publicação usa a API oficial do Instagram, com legenda e hashtags sugeridas e aprovação antes de enviar.'));
}

function relatorios(c) {
  const porCat = CATEGORIAS.map((k) => ({ categoria: k, total: publicadas().filter((n) => n.categoria === k).length, views: publicadas().filter((n) => n.categoria === k).reduce((a, n) => a + n.views, 0) }));
  const pct = Math.round((state.ia.usado / state.ia.limite) * 100);
  c.append(card('Publicações por categoria', table([
    { label: 'Categoria', key: 'categoria' }, { label: 'Publicadas', key: 'total', num: true }, { label: 'Acessos', num: true, render: (r) => r.views.toLocaleString('pt-BR') }
  ], porCat)));
  c.append(card('Custo da IA no mês', el('p', {}, `${money(state.ia.usado)} de ${money(state.ia.limite)} `,
    el('span', { class: 'demo-bar' }, el('span', { class: `w-${Math.min(100, Math.round(pct / 10) * 10)}` })), ` ${pct}%`),
  el('p', { class: 'demo-muted small' }, 'Limite mensal configurável; ao atingir o limite, as sugestões param e a revisão continua normalmente.')));
}


// Tour pelas telas reais: capturas do sistema rodando com o conteúdo de demonstração (fictício).
const IMG = (k) => `/assets/images/produtos/portal-de-noticias-${k}.webp`;
const TOUR = [
  { img: IMG('capa'), area: 'Portal do leitor', titulo: 'Capa do portal', ver: 'portal',
    itens: ['Manchete e lista lateral montadas com as matérias publicadas ou escolhidas em "Destaques da home".', 'Menus por município e por categoria, busca e espaços de anúncio no tamanho real.', 'Páginas geradas no servidor: carregam rápido e são boas para SEO.'] },
  { img: IMG('materia'), area: 'Portal do leitor', titulo: 'Página da matéria', ver: 'portal',
    itens: ['Oito modelos de página: clássico, destaque, nota, urgente, serviço, entrevista, fotorreportagem e especial.', 'Crédito da fonte e do autor, com link para a publicação original.', 'Dados estruturados de notícia, Open Graph, sitemap e feed RSS.'] },
  { img: IMG('celular'), area: 'Portal do leitor', titulo: 'No celular', ver: 'portal',
    itens: ['O portal e o painel editorial funcionam no celular: a equipe revisa e publica de onde estiver.', 'Menus compactos de municípios e categorias.'] },
  { img: IMG('municipio'), area: 'Portal do leitor', titulo: 'Notícias por município', ver: 'portal',
    itens: ['Cada município e cada região têm a sua página, com busca dentro da seção.', 'Busca em português sem acento: "previsao" encontra "previsão".'] },
  { img: IMG('painel'), area: 'Painel editorial', titulo: 'Dashboard', ver: 'painel',
    itens: ['Coletadas hoje, aguardando revisão, aprovadas, publicadas, falhas de coleta e situação do worker.', 'Publicações por categoria e por município, com acessos medidos pelo próprio portal.'] },
  { img: IMG('revisao'), area: 'Painel editorial', titulo: 'Fila de revisão', ver: 'revisao',
    itens: ['Tudo o que a coleta traz espera decisão humana: nada é publicado sozinho.', 'Filtros por situação, fonte, município, categoria e situação da IA; possíveis duplicatas aparecem sinalizadas.'] },
  { img: IMG('editor'), area: 'Painel editorial', titulo: 'Editor com sugestão da IA', ver: 'revisao',
    itens: ['Texto original da fonte ao lado, escolha do modelo da página e créditos.', 'A IA (Claude ou Gemini, opcional) sugere título, resumo, categoria e alertas; o editor decide o que aproveitar.', 'Aprovar e publicar, agendar, pedir correção ou rejeitar, com histórico de versões.'] },
  { img: IMG('destaques'), area: 'Painel editorial', titulo: 'Destaques da home', ver: 'noticias',
    itens: ['O editor escolhe a manchete e os itens da lateral ou deixa no automático (mais recentes).', 'Prévia da página inicial antes de salvar.'] },
  { img: IMG('publicidade'), area: 'Comercial', titulo: 'Campanhas publicitárias', ver: 'publicidade',
    itens: ['Anunciantes, campanhas por período e posição, anúncios em imagem ou texto e matéria patrocinada.', 'Impressões e cliques medidos; contratos, pagamentos e mídia kit gerado com os dados do sistema.'] },
  { img: IMG('relatorios'), area: 'Gestão', titulo: 'Relatórios', ver: 'relatorios',
    itens: ['Coletas, duplicados, aprovações e tempo médio entre a coleta e a aprovação.', 'Relatórios comerciais e de custo da IA, com exportação em CSV.'] }
];

export function start(root) {
  const app = mountDemo(root, {
    name: 'Portal Regional de Notícias',
    views: [
      { id: 'tour', label: 'Tour: telas reais', icon: 'images', render: tourView(TOUR) },
      { id: 'painel', label: 'Painel', icon: 'speedometer2', render: (c, a) => painel(c, a) },
      { id: 'portal', label: 'Portal (leitor)', icon: 'newspaper', render: portal },
      { id: 'revisao', label: 'Fila de revisão', icon: 'check2-square', render: revisao },
      { id: 'noticias', label: 'Notícias', icon: 'journal-text', render: noticias },
      { id: 'fontes', label: 'Fontes e coleta', icon: 'rss', render: fontes },
      { id: 'publicidade', label: 'Publicidade', icon: 'megaphone', render: publicidade },
      { id: 'redes', label: 'Redes sociais', icon: 'instagram', render: redes },
      { id: 'relatorios', label: 'Relatórios', icon: 'bar-chart', render: relatorios }
    ]
  });
  return app;
}
