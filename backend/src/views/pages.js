import { html, raw, safeUrl } from '../utils/html.js';
import { renderMarkdown } from '../utils/markdown.js';
import { formatMoney } from '../utils/money.js';
import { STATUS_COMERCIAL, MODELOS_CONTRATACAO, CONTRATAVEL } from '../modules/products/products.constants.js';
import { productCard, pager, breadcrumbs, contactForm, sectionHeading, faqList, parseLines, statusBadge, statusTrack, priceLabel } from './components.js';
import { whatsappLink, absoluteUrl } from './layout.js';

const icon = (name) => html`<i class="bi bi-${name}" aria-hidden="true"></i>`;

// ------------------------------------------------------------------ início
/** Acima deste número de marcas a seção vira um carrossel contínuo. */
export const PARTNERS_CAROUSEL_MIN = 11;

const partnerTile = (p, hidden = false) => {
  const logos = html`<img class="partner-logo partner-logo-mono" src="${safeUrl(p.mono_url)}" alt="${hidden ? '' : p.nome}" width="480" height="240" loading="lazy" decoding="async">
      <img class="partner-logo partner-logo-cor" src="${safeUrl(p.cor_url)}" alt="" width="480" height="240" loading="lazy" decoding="async">`;
  const href = p.site_url ? safeUrl(p.site_url) : '';
  return html`<li class="partner-tile partner-plate-${p.fundo_colorida}"${hidden ? raw(' aria-hidden="true"') : ''}>${href
    ? html`<a class="partner-inner" href="${href}" target="_blank" rel="noopener noreferrer nofollow"${hidden ? raw(' tabindex="-1"') : ''}${hidden ? '' : html` title="${p.nome}"`}>${logos}</a>`
    : html`<span class="partner-inner"${hidden ? '' : html` title="${p.nome}"`}>${logos}</span>`}</li>`;
};

/** Seção "Empresas que confiam em nossas soluções" (oculta quando não há marcas autorizadas). */
function partnersSection(c, partners) {
  if (!partners?.length) return '';
  const carousel = partners.length >= PARTNERS_CAROUSEL_MIN;
  return html`<section class="section partners-section" id="clientes" aria-labelledby="clientes-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Clientes e parceiros', title: c['home.clientes.titulo'] || 'Empresas que confiam em nossas soluções', text: c['home.clientes.texto'], id: 'clientes-title', center: true })}
    </div>
    ${carousel
      ? html`<div class="partners-marquee" data-partners-marquee data-count="${partners.length}">
          <ul class="partners-track" role="list">${partners.map((p) => partnerTile(p))}${partners.map((p) => partnerTile(p, true))}</ul>
        </div>`
      : html`<div class="container"><ul class="partners-grid partners-count-${Math.min(partners.length, 6)}" role="list">${partners.map((p) => partnerTile(p))}</ul></div>`}
  </section>`;
}

/**
 * Folha de desenho do destaque: a tela real do projeto em destaque (ou a imagem configurada em
 * home.hero.imagem), emoldurada, com o carimbo de dados verdadeiros embaixo.
 */
function heroDrawing(s, c, p) {
  const img = c['home.hero.imagem'];
  if (!img && !p) return '';
  return html`<figure class="hero-drawing" data-enter>
    <div class="drawing-frame">
      ${img
        ? html`<img src="${safeUrl(img)}" alt="${c['home.hero.imagem.alt'] || ''}" width="960" height="600" fetchpriority="high">`
        : html`<a href="/softwares/${p.slug}" tabindex="-1" aria-hidden="true"><img src="${safeUrl(p.capa_url)}" alt="" width="960" height="600" fetchpriority="high"></a>`}
    </div>
    <dl class="carimbo hero-stamp">
      ${p && !img ? html`
        <div class="carimbo-wide"><dt>Projeto em destaque</dt><dd><a href="/softwares/${p.slug}">${p.nome}</a></dd></div>
        <div><dt>Situação</dt><dd>${statusBadge(p.status_comercial)}</dd></div>
        <div><dt>Contratação</dt><dd>${MODELOS_CONTRATACAO[p.modelo_contratacao]}</dd></div>
        ${p.dados_demonstrativos ? html`<div class="carimbo-wide"><dt>Dados</dt><dd>Telas com dados fictícios, para demonstração</dd></div>` : ''}`
      : html`
        <div class="carimbo-wide"><dt>Empresa</dt><dd>${s.nome_comercial}</dd></div>
        ${c['home.hero.etiqueta'] ? html`<div class="carimbo-wide"><dt>Especialidade</dt><dd>${c['home.hero.etiqueta']}</dd></div>` : ''}`}
    </dl>
  </figure>`;
}

/** Primeiro passo do pedido: escolhe o tipo e continua no formulário completo. Funciona sem JavaScript (GET). */
function heroStart(c) {
  const opts = [
    ['personalizado', 'Um sistema sob medida', 'Descrever o processo que precisa virar sistema'],
    ['orcamento', 'Um dos sistemas prontos', 'Orçamento de um projeto do portfólio'],
    ['apresentacao', 'Uma apresentação', 'Conversa para ver um sistema funcionando']
  ];
  return html`<form class="hero-start" method="get" action="/contato" data-enter>
    <fieldset>
      <legend>O que você precisa?</legend>
      <div class="choice-row">
        ${opts.map(([v, l, d], i) => html`<label class="choice">
          <input type="radio" name="tipo" value="${v}"${i === 0 ? raw(' checked') : ''}>
          <span class="choice-label">${l}</span>
          <span class="choice-hint">${d}</span>
        </label>`)}
      </div>
    </fieldset>
    <div class="hero-actions">
      <button class="btn btn-accent btn-lg" type="submit">${c['home.hero.cta_primario'] || 'Continuar o pedido'}</button>
      <a class="btn btn-link" href="#servicos">${c['home.hero.cta_secundario'] || 'Conhecer os serviços'}</a>
    </div>
  </form>`;
}

export function homePage({ s, c, featured, services, partners = [], token }) {
  const etapas = parseLines(c['home.etapas.itens']);
  const compromissos = parseLines(c['home.diferenciais.itens']);
  const wa = whatsappLink(s);
  const drawing = heroDrawing(s, c, featured[0]);
  return html`
  <section class="hero" aria-labelledby="hero-title">
    <div class="container">
      <div class="hero-sheet${drawing ? '' : ' is-single'}">
        <div class="hero-copy">
          <h1 id="hero-title" class="hero-title" data-enter>${c['home.hero.titulo'] || 'Transformamos ideias em soluções digitais'}</h1>
          ${c['home.hero.subtitulo'] ? html`<p class="hero-lead" data-enter>${c['home.hero.subtitulo']}</p>` : ''}
          ${heroStart(c)}
          ${wa ? html`<p class="hero-alt"><a href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} Prefere conversar pelo WhatsApp?</a></p>` : ''}
        </div>
        ${drawing}
      </div>
    </div>
  </section>

  ${partnersSection(c, partners)}

  <section class="section" id="servicos" aria-labelledby="servicos-title">
    <div class="container">
      <div class="split">
        <div class="split-aside">
          ${sectionHeading({ title: c['home.servicos.titulo'] || 'Soluções digitais para o seu negócio', text: c['home.servicos.texto'], id: 'servicos-title' })}
          ${services.length ? html`<a class="btn btn-outline-ink" href="/servicos">Ver todos os serviços</a>` : ''}
        </div>
        ${services.length
          ? html`<ul class="index-list" role="list">${services.slice(0, 6).map((sv) => html`<li><a class="index-row" href="/servicos/${sv.slug}">
              <span class="index-icon">${icon(sv.icone || 'gear')}</span>
              <span class="index-text"><strong>${sv.nome}</strong><span>${sv.resumo}</span></span>
              <span class="index-go" aria-hidden="true">${icon('arrow-up-right')}</span>
            </a></li>`)}</ul>`
          : html`<div class="empty-inline">${icon('tools')}<p>Os serviços aparecem aqui assim que forem publicados no painel. Enquanto isso, <a href="/contato">fale com a gente</a>.</p></div>`}
      </div>
    </div>
  </section>

  ${etapas.length ? html`<section class="section section-ruled" id="como-trabalhamos" aria-labelledby="etapas-title">
    <div class="container">
      ${sectionHeading({ title: c['home.etapas.titulo'] || 'Como trabalhamos', id: 'etapas-title' })}
      <ol class="steps">${etapas.map((e, i) => html`<li><span class="step-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><h3>${e.titulo}</h3><p>${e.descricao}</p></li>`)}</ol>
    </div>
  </section>` : ''}

  <section class="section" id="projetos" aria-labelledby="projetos-title">
    <div class="container">
      <div class="section-head-row">
        ${sectionHeading({ title: c['home.produtos.titulo'] || 'Projetos e soluções', text: c['home.produtos.texto'], id: 'projetos-title' })}
        ${featured.length ? html`<a class="btn btn-outline-ink" href="/softwares">Ver todos os projetos</a>` : ''}
      </div>
      ${featured.length
        ? html`<div class="card-grid">${featured.map((p) => productCard(p))}</div>`
        : html`<div class="empty-inline">${icon('folder2-open')}<p>Os projetos aparecem aqui assim que forem publicados no painel.</p></div>`}
    </div>
  </section>

  <section class="section section-sheet" id="sobre" aria-labelledby="sobre-title">
    <div class="container">
      <div class="split">
        <div class="split-aside">
          ${sectionHeading({ title: c['home.sobre.titulo'] || 'Sobre a empresa', id: 'sobre-title' })}
          ${c['home.sobre.texto'] ? html`<p class="lead-muted">${c['home.sobre.texto']}</p>` : ''}
          <a class="btn btn-outline-ink" href="/sobre">Conheça a empresa</a>
        </div>
        ${compromissos.length ? html`<div>
          <h3 class="subheading">${c['home.diferenciais.titulo'] || 'Compromissos técnicos'}</h3>
          <dl class="spec-sheet">${compromissos.map((d) => html`<div><dt>${d.titulo}</dt><dd>${d.descricao}</dd></div>`)}</dl>
        </div>` : ''}
      </div>
    </div>
  </section>

  <section class="section" id="contato" aria-labelledby="contato-title">
    <div class="container">
      <div class="split">
        <div class="split-aside">
          ${sectionHeading({ title: c['home.contato.titulo'] || 'Vamos conversar sobre o seu projeto?', text: c['home.contato.texto'], id: 'contato-title' })}
          <ul class="list-unstyled contact-points">
            ${s.email_contato ? html`<li>${icon('envelope')} <a href="mailto:${s.email_contato}">${s.email_contato}</a></li>` : ''}
            ${s.telefone ? html`<li>${icon('telephone')} <a href="tel:${s.telefone.replace(/[^\d+]/g, '')}">${s.telefone}</a></li>` : ''}
            ${wa ? html`<li>${icon('whatsapp')} <a href="${wa}" target="_blank" rel="noopener noreferrer">Conversar pelo WhatsApp</a></li>` : ''}
            <li>${icon('file-earmark-text')} <a href="/orcamento">Formulário completo de orçamento</a></li>
          </ul>
        </div>
        <div class="form-card">${contactForm({ tipo: 'orcamento', token, compact: true, submitLabel: 'Pedir orçamento', idPrefix: 'home-' })}</div>
      </div>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ catálogo
export function catalogPage({ result, categories }) {
  const f = result.filtros;
  const params = { busca: f.busca, categoria: f.categoria, modelo: f.modelo, disponibilidade: f.disponibilidade };
  const statusOptions = Object.entries(STATUS_COMERCIAL).filter(([k]) => k !== 'arquivado');
  const anyFilter = Object.values(params).some(Boolean);
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: 'Projetos' }])}
      <h1>Projetos e soluções</h1>
      <p class="lead-muted">Sistemas desenvolvidos pela equipe. Cada projeto mostra a sua situação atual; os demonstrativos usam dados fictícios.</p>
    </div></section>
    <section class="section pt-4"><div class="container">
      <form class="filters" method="get" action="/softwares" role="search" aria-label="Filtrar softwares">
        <div class="row g-2 align-items-end">
          <div class="col-lg-4"><label class="form-label" for="busca">Pesquisar</label>
            <input class="form-control" type="search" id="busca" name="busca" value="${f.busca}" placeholder="Nome, descrição ou funcionalidade" maxlength="100"></div>
          <div class="col-sm-4 col-lg-2"><label class="form-label" for="categoria">Categoria</label>
            <select class="form-select" id="categoria" name="categoria"><option value="">Todas</option>${categories.map((c) => html`<option value="${c.slug}"${c.slug === f.categoria ? raw(' selected') : ''}>${c.nome}</option>`)}</select></div>
          <div class="col-sm-4 col-lg-2"><label class="form-label" for="modelo">Contratação</label>
            <select class="form-select" id="modelo" name="modelo"><option value="">Todas</option>${Object.entries(MODELOS_CONTRATACAO).map(([k, l]) => html`<option value="${k}"${k === f.modelo ? raw(' selected') : ''}>${l}</option>`)}</select></div>
          <div class="col-sm-4 col-lg-2"><label class="form-label" for="disponibilidade">Disponibilidade</label>
            <select class="form-select" id="disponibilidade" name="disponibilidade"><option value="">Todas</option>${statusOptions.map(([k, l]) => html`<option value="${k}"${k === f.disponibilidade ? raw(' selected') : ''}>${l}</option>`)}</select></div>
          <div class="col-lg-2 d-flex gap-2"><button class="btn btn-primary flex-fill" type="submit">${icon('funnel')} Filtrar</button>
            ${anyFilter ? html`<a class="btn btn-outline-ink" href="/softwares" aria-label="Limpar filtros">${icon('x-lg')}</a>` : ''}</div>
        </div>
      </form>
      <p class="result-count" role="status">${result.total} ${result.total === 1 ? 'projeto encontrado' : 'projetos encontrados'}</p>
      ${result.items.length
        ? html`<div class="card-grid">${result.items.map((p) => productCard(p, { headingLevel: 2 }))}</div>`
        : html`<div class="empty-state">${icon('search')}<h2>Nenhum projeto encontrado</h2><p>Tente outros termos ou limpe os filtros. Se o que você precisa não está aqui, ele pode ser desenvolvido sob medida.</p>
            <a class="btn btn-accent" href="/contato?tipo=personalizado">Descrever um sistema sob medida</a></div>`}
      ${pager(result, '/softwares', params)}
    </div></section>`;
}

// ------------------------------------------------------------------ produto
function videoEmbed(url) {
  if (!url) return '';
  let src = null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([\w-]{6,20})/);
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (yt) src = `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  if (vm) src = `https://player.vimeo.com/video/${vm[1]}?dnt=1`;
  if (!src) return '';
  return html`<div class="ratio ratio-16x9 video-frame"><iframe src="${src}" title="Vídeo demonstrativo" loading="lazy" allow="fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

export function productPage({ p, s, token }) {
  const canHire = CONTRATAVEL.has(p.status_comercial);
  const isCustom = p.modelo_contratacao === 'personalizado';
  const demoHref = p.demo_tipo === 'interna' ? `/softwares/${p.slug}/demonstracao` : p.demo_tipo === 'externa' ? safeUrl(p.demo_url) : null;
  const wa = whatsappLink(s, `Olá! Tenho interesse no ${p.nome}.`);
  const notReady = ['em_planejamento', 'em_desenvolvimento'].includes(p.status_comercial);
  return html`<section class="page-hero product-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { href: '/softwares', label: 'Projetos' }, { label: p.nome }])}
      <div class="row g-5 align-items-center">
        <div class="col-lg-6">
          <h1>${p.nome}</h1>
          <p class="lead">${p.resumo}</p>
          ${statusTrack(p.status_comercial)}
          ${notReady ? html`<div class="notice notice-info" role="note">${icon('cone-striped')}<span>Este software está <strong>${STATUS_COMERCIAL[p.status_comercial].toLowerCase()}</strong> e ainda não está disponível para contratação. Você pode registrar interesse ou pedir uma conversa.</span></div>` : ''}
          ${p.dados_demonstrativos ? html`<div class="notice notice-muted" role="note">${icon('info-circle')}<span>Projeto demonstrativo do portfólio: as telas e os dados exibidos são fictícios. Nome, escopo e condições comerciais podem mudar.</span></div>` : ''}
          <div class="d-flex flex-wrap gap-2 mt-4">
            <a class="btn btn-accent btn-lg" href="#solicitar">${canHire ? 'Contratar' : isCustom ? 'Descrever minha necessidade' : 'Pedir orçamento'}</a>
            ${demoHref && p.demo_disponivel ? html`<a class="btn btn-outline-ink btn-lg" href="${demoHref}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>${icon('play-circle')} Ver demonstração</a>` : ''}
            ${!isCustom ? html`<a class="btn btn-link btn-lg" href="#apresentacao">Pedir apresentação</a>` : ''}
            ${wa ? html`<a class="btn btn-link btn-lg" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} WhatsApp</a>` : ''}
          </div>
        </div>
        <div class="col-lg-6"><figure class="product-cover">
          <div class="drawing-frame"><img src="${safeUrl(p.capa_url)}" alt="${p.imagem_alt || `Tela ilustrativa do ${p.nome}`}" width="960" height="600" fetchpriority="high"></div>
          <dl class="carimbo">
            <div><dt>Categoria</dt><dd><a href="/softwares?categoria=${p.categoria_slug}">${p.categoria_nome}</a></dd></div>
            <div><dt>Situação</dt><dd>${statusBadge(p.status_comercial)}</dd></div>
            <div><dt>Contratação</dt><dd>${MODELOS_CONTRATACAO[p.modelo_contratacao]}</dd></div>
            <div><dt>Investimento</dt><dd>${priceLabel(p)}</dd></div>
          </dl>
        </figure></div>
      </div>
    </div></section>

    <nav class="product-subnav" aria-label="Seções do produto"><div class="container"><ul>
      ${p.descricao || p.problema_resolvido ? html`<li><a href="#visao-geral">Visão geral</a></li>` : ''}
      ${p.funcionalidades.length ? html`<li><a href="#funcionalidades">Funcionalidades</a></li>` : ''}
      ${p.imagens.length ? html`<li><a href="#galeria">Telas</a></li>` : ''}
      <li><a href="#contratacao">Contratação</a></li>
      ${p.faqs.length ? html`<li><a href="#perguntas">Dúvidas</a></li>` : ''}
      <li><a href="#solicitar">${isCustom ? 'Levantamento' : 'Orçamento'}</a></li>
    </ul></div></nav>

    ${p.descricao || p.problema_resolvido || p.publico_alvo ? html`<section class="section" id="visao-geral" aria-labelledby="vg-title"><div class="container">
      <div class="row g-5">
        <div class="col-lg-7"><h2 id="vg-title">Visão geral</h2><div class="prose">${raw(renderMarkdown(p.descricao || ''))}</div></div>
        <div class="col-lg-5">
          ${p.problema_resolvido ? html`<div class="info-card"><h3>${icon('bullseye')} Problema que resolve</h3><div class="prose">${raw(renderMarkdown(p.problema_resolvido))}</div></div>` : ''}
          ${p.publico_alvo ? html`<div class="info-card mt-3"><h3>${icon('people')} Para quem é indicado</h3><div class="prose">${raw(renderMarkdown(p.publico_alvo))}</div></div>` : ''}
        </div>
      </div></div></section>` : ''}

    ${p.funcionalidades.length ? html`<section class="section section-alt" id="funcionalidades" aria-labelledby="func-title"><div class="container">
      ${sectionHeading({ eyebrow: 'Recursos', title: 'Principais funcionalidades', id: 'func-title' })}
      <div class="row g-3">${p.funcionalidades.map((f) => html`<div class="col-md-6 col-lg-4"><div class="feature compact">
        <span class="feature-icon">${icon(f.icone || 'check2-circle')}</span><h3>${f.titulo}</h3>${f.descricao ? html`<p>${f.descricao}</p>` : ''}</div></div>`)}</div>
    </div></section>` : ''}

    ${p.imagens.length || p.video_url ? html`<section class="section" id="galeria" aria-labelledby="gal-title"><div class="container">
      ${sectionHeading({ eyebrow: 'Interface', title: 'Galeria de telas', text: p.dados_demonstrativos ? 'Telas ilustrativas com dados fictícios.' : '', id: 'gal-title' })}
      ${videoEmbed(p.video_url)}
      <div class="gallery" data-gallery>${p.imagens.map((img, i) => html`<figure class="gallery-item">
        <button type="button" class="gallery-thumb" data-gallery-open="${i}" aria-label="Ampliar: ${img.legenda || img.texto_alternativo || `tela ${i + 1}`}">
          <img src="${safeUrl(img.url)}" alt="${img.texto_alternativo || img.legenda || `Tela ${i + 1} do ${p.nome}`}" loading="lazy" decoding="async" width="${img.largura || 960}" height="${img.altura || 600}">
        </button>${img.legenda ? html`<figcaption>${img.legenda}</figcaption>` : ''}</figure>`)}</div>
    </div></section>` : ''}

    ${p.beneficios.length ? html`<section class="section section-sheet" aria-labelledby="ben-title"><div class="container">
      ${sectionHeading({ eyebrow: 'Resultados esperados', title: 'Recursos e benefícios', id: 'ben-title' })}
      <dl class="spec-sheet spec-sheet-wide">${p.beneficios.map((b) => html`<div><dt>${b.titulo}</dt><dd>${b.descricao || ''}</dd></div>`)}</dl>
    </div></section>` : ''}

    <section class="section" id="contratacao" aria-labelledby="ct-title"><div class="container">
      ${sectionHeading({ eyebrow: 'Comercial', title: 'Modalidades de contratação', id: 'ct-title' })}
      <div class="row g-4">
        <div class="col-lg-4"><div class="info-card h-100">
          <dl class="spec-list">
            <div><dt>Modelo</dt><dd>${MODELOS_CONTRATACAO[p.modelo_contratacao]}</dd></div>
            <div><dt>Investimento</dt><dd>${priceLabel(p)}</dd></div>
            <div><dt>Situação</dt><dd>${STATUS_COMERCIAL[p.status_comercial]}</dd></div>
          </dl>
          ${p.requisitos_tecnicos ? html`<h3 class="h6 mt-4">${icon('cpu')} Requisitos técnicos</h3><div class="prose small">${raw(renderMarkdown(p.requisitos_tecnicos))}</div>` : ''}
          ${p.documentacao_url || p.manual_url ? html`<div class="d-flex flex-column gap-2 mt-3">
            ${p.documentacao_url ? html`<a href="${safeUrl(p.documentacao_url)}" target="_blank" rel="noopener noreferrer">${icon('journal-code')} Documentação</a>` : ''}
            ${p.manual_url ? html`<a href="${safeUrl(p.manual_url)}" target="_blank" rel="noopener noreferrer">${icon('book')} Manual de utilização</a>` : ''}</div>` : ''}
        </div></div>
        <div class="col-lg-8">
          ${p.planos.length ? html`<div class="row g-3">${p.planos.map((pl) => html`<div class="col-md-6"><article class="plan-card">
            <h3>${pl.nome}</h3>
            <p class="plan-price">${pl.preco !== null ? html`${formatMoney(pl.preco, pl.moeda)}<small>${{ mensal: '/mês', anual: '/ano' }[pl.periodicidade] || ''}</small>` : 'Sob orçamento'}</p>
            ${pl.descricao ? html`<p class="small text-body-secondary">${pl.descricao}</p>` : ''}
            ${pl.funcionalidades.length ? html`<ul class="check-list">${pl.funcionalidades.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
            ${pl.limites ? html`<p class="small"><strong>Limites:</strong> ${pl.limites}</p>` : ''}
            <a class="btn btn-outline-ink btn-sm" href="#solicitar" data-select-plan="${pl.nome}">${canHire ? 'Contratar este plano' : 'Pedir orçamento deste plano'}</a>
          </article></div>`)}</div>`
          : html`<div class="empty-inline">${icon('chat-square-text')}<p>Os planos e valores deste software são definidos conforme o escopo de cada cliente. Solicite um orçamento sem compromisso.</p></div>`}
        </div>
      </div>
    </div></section>

    ${p.demo_tipo !== 'nenhuma' ? html`<section class="section section-alt" aria-labelledby="demo-title"><div class="container">
      <div class="demo-callout">
        <div><h2 id="demo-title">Demonstração</h2>
          ${p.demo_disponivel ? html`<p>${p.demo_tipo === 'interna' ? 'Explore uma demonstração interativa com dados fictícios, executada no seu navegador.' : 'Acesse o ambiente de demonstração online.'}</p>` : html`<p>A demonstração está temporariamente indisponível.</p>`}
          ${p.demo_aviso ? html`<p class="small mb-0">${icon('exclamation-circle')} ${p.demo_aviso}</p>` : ''}</div>
        ${p.demo_disponivel && demoHref ? html`<a class="btn btn-accent btn-lg" href="${demoHref}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>Abrir demonstração</a>` : ''}
      </div></div></section>` : ''}

    ${p.faqs.length ? html`<section class="section" id="perguntas" aria-labelledby="pq-title"><div class="container narrow">
      ${sectionHeading({ title: `Perguntas sobre o ${p.nome}`, id: 'pq-title', center: true })}
      ${faqList(p.faqs, 'faq-produto')}
    </div></section>` : ''}

    <section class="section section-alt" id="solicitar" aria-labelledby="sol-title"><div class="container">
      <div class="row g-5">
        <div class="col-lg-${isCustom ? '12' : '7'}"><div class="form-card">
          <h2 id="sol-title">${isCustom ? 'Levantamento inicial de requisitos' : canHire ? `Contratar ${p.nome}` : `Pedir orçamento do ${p.nome}`}</h2>
          <p class="text-body-secondary">${isCustom ? 'Conte o que você precisa. Analisamos e retornamos com perguntas e uma proposta.' : 'Não é necessário pagamento para solicitar orçamento. Retornamos com a proposta pelo e-mail informado.'}</p>
          ${contactForm({ tipo: isCustom ? 'personalizado' : 'orcamento', token, produto: p, submitLabel: isCustom ? 'Enviar levantamento' : 'Pedir orçamento', idPrefix: 'orc-' })}
        </div></div>
        ${!isCustom ? html`<div class="col-lg-5" id="apresentacao"><div class="form-card">
          <h2 class="h4">Pedir apresentação</h2>
          <p class="text-body-secondary small">Agende uma conversa para ver o sistema e tirar dúvidas.</p>
          ${contactForm({ tipo: 'apresentacao', token, produto: p, compact: true, submitLabel: 'Pedir apresentação', idPrefix: 'apr-' })}
        </div></div>` : ''}
      </div>
    </div></section>`;
}

/** Dados estruturados honestos: sem avaliações, sem ofertas fictícias. Preço apenas quando configurado e disponível. */
export function productJsonLd(p, s) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: p.nome,
    description: p.seo_description || p.resumo,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: absoluteUrl(`/softwares/${p.slug}`),
    image: absoluteUrl(p.capa_url),
    publisher: { '@type': 'Organization', name: s.nome_comercial }
  };
  if (p.preco !== null && p.status_comercial === 'disponivel') {
    data.offers = { '@type': 'Offer', price: p.preco, priceCurrency: p.moeda, availability: 'https://schema.org/InStock' };
  }
  return data;
}

// ------------------------------------------------------------------ demonstração interna
export function demoPage({ p }) {
  return html`<section class="demo-shell">
    <div class="demo-banner" role="note">${icon('exclamation-triangle')} <strong>Ambiente de demonstração.</strong> Todos os dados são fictícios e as alterações ficam apenas no seu navegador até recarregar a página. Nenhuma informação é enviada ou salva.</div>
    <div class="container-fluid px-0">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 px-3 py-2 demo-topbar">
        <a href="/softwares/${p.slug}" class="link-light text-decoration-none">${icon('arrow-left')} Voltar para ${p.nome}</a>
        <a href="/softwares/${p.slug}#solicitar" class="btn btn-accent btn-sm">Pedir orçamento</a>
      </div>
      <div id="demo-app" class="demo-app" data-demo="${p.slug}" aria-live="polite"><p class="p-4">Carregando demonstração…</p></div>
      <noscript><p class="p-4">A demonstração interativa requer JavaScript habilitado.</p></noscript>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ serviços
export function servicesPage({ services, c, token }) {
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: 'Serviços' }])}
      <h1>${c['servicos.titulo'] || 'Serviços de desenvolvimento'}</h1>
      <p class="lead-muted">${c['servicos.texto'] || ''}</p>
    </div></section>
    <section class="section pt-4"><div class="container">
      ${services.length ? html`<div class="card-grid">${services.map((sv) => html`<article class="service-card">
        <span class="service-icon">${icon(sv.icone || 'gear')}</span>
        <h2><a href="/servicos/${sv.slug}">${sv.nome}</a></h2>
        <p>${sv.resumo}</p>
        ${sv.beneficios.length ? html`<ul class="check-list small">${sv.beneficios.slice(0, 3).map((b) => html`<li>${b}</li>`)}</ul>` : ''}
        ${sv.preco !== null ? html`<p class="small fw-semibold">${sv.preco_descricao || ''} ${formatMoney(sv.preco)}</p>` : ''}
        <a class="btn btn-outline-ink btn-sm mt-auto" href="/servicos/${sv.slug}">Ver o serviço</a>
      </article>`)}</div>` : html`<div class="empty-state">${icon('tools')}<h2>Nenhum serviço publicado</h2><p>Em breve publicaremos nossos serviços. Enquanto isso, fale com a gente.</p><a class="btn btn-accent" href="/contato">Entrar em contato</a></div>`}
    </div></section>
    <section class="section section-alt"><div class="container narrow"><div class="form-card">
      <h2>Fale sobre o seu projeto</h2>
      ${contactForm({ tipo: 'orcamento', token, servicos: services, submitLabel: 'Pedir orçamento', idPrefix: 'srv-' })}
    </div></div></section>`;
}

export function servicePage({ sv, token }) {
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { href: '/servicos', label: 'Serviços' }, { label: sv.nome }])}
      <h1>${sv.nome}</h1><p class="lead-muted">${sv.resumo}</p>
    </div></section>
    <section class="section pt-4"><div class="container"><div class="row g-5">
      <div class="col-lg-7">
        <div class="prose">${raw(renderMarkdown(sv.descricao || ''))}</div>
        ${sv.beneficios.length ? html`<h2 class="h4 mt-4">Benefícios</h2><ul class="check-list">${sv.beneficios.map((b) => html`<li>${b}</li>`)}</ul>` : ''}
        ${sv.preco !== null ? html`<p class="mt-3"><strong>Investimento:</strong> ${sv.preco_descricao || ''} ${formatMoney(sv.preco)}</p>` : html`<p class="mt-3 text-body-secondary">Valor definido conforme o escopo.</p>`}
      </div>
      <div class="col-lg-5"><div class="form-card">
        <h2 class="h4">Pedir orçamento</h2>
        ${contactForm({ tipo: 'orcamento', token, compact: true, servico: sv, submitLabel: 'Pedir orçamento', idPrefix: 'sv-' })}
      </div></div>
    </div></div></section>`;
}

// ------------------------------------------------------------------ contato
export function contactPage({ s, token, tipo, produtos, servicos, values = {}, errors = {}, success = null, produtoSel = null }) {
  const wa = whatsappLink(s);
  const titles = { contato: 'Fale conosco', orcamento: 'Pedir orçamento', apresentacao: 'Pedir apresentação', personalizado: 'Sistema sob medida' };
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: titles[tipo] }])}
      <h1>${titles[tipo]}</h1>
      <p class="lead-muted">${{ orcamento: 'Conte o que você precisa. O pedido de orçamento é gratuito e não exige pagamento.', personalizado: 'Descreva o processo que precisa virar sistema. Com isso preparamos as perguntas e a proposta.', apresentacao: 'Diga qual sistema quer ver e os melhores horários. A resposta chega pelo e-mail informado.' }[tipo] || 'A resposta chega pelo e-mail informado.'}</p>
    </div></section>
    <section class="section pt-4"><div class="container"><div class="row g-5">
      <div class="col-lg-8"><div class="form-card">
        ${success ? html`<div class="alert alert-success" role="status" tabindex="-1">${icon('check-circle')} ${success}</div><a class="btn btn-outline-ink" href="/">Voltar ao início</a>`
          : html`<nav class="segmented" aria-label="Tipo de solicitação">
              ${[['contato', '/contato', 'Mensagem'], ['orcamento', '/orcamento', 'Orçamento'], ['personalizado', '/contato?tipo=personalizado', 'Sistema sob medida'], ['apresentacao', '/contato?tipo=apresentacao', 'Apresentação']].map(([t, href, label]) => html`<a href="${href}"${tipo === t ? raw(' aria-current="page"') : ''}>${label}</a>`)}
            </nav>
            ${contactForm({ tipo, token, produtos, servicos, values: { ...values, produto: values.produto || produtoSel || '' }, errors, submitLabel: { orcamento: 'Pedir orçamento', personalizado: 'Enviar levantamento', apresentacao: 'Pedir apresentação' }[tipo] || 'Enviar mensagem', idPrefix: 'ct-' })}`}
      </div></div>
      <aside class="col-lg-4" aria-label="Outros canais">
        <div class="info-card">
          <h2 class="h5">Outros canais</h2>
          <ul class="list-unstyled contact-points">
            ${s.email_contato ? html`<li>${icon('envelope')} <a href="mailto:${s.email_contato}">${s.email_contato}</a></li>` : ''}
            ${s.telefone ? html`<li>${icon('telephone')} <a href="tel:${s.telefone.replace(/[^\d+]/g, '')}">${s.telefone}</a></li>` : ''}
            ${wa ? html`<li>${icon('whatsapp')} <a href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>` : ''}
            ${s.linkedin ? html`<li>${icon('linkedin')} <a href="${safeUrl(s.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></li>` : ''}
            ${s.instagram ? html`<li>${icon('instagram')} <a href="${safeUrl(s.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : ''}
            ${!s.email_contato && !s.telefone && !wa ? html`<li class="small text-body-secondary">Os canais diretos ainda não foram configurados. Use o formulário.</li>` : ''}
          </ul>
        </div>
      </aside>
    </div></div></section>`;
}

// ------------------------------------------------------------------ institucionais
export function contentPage({ page }) {
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: page.titulo }])}
      <h1>${page.titulo}</h1>
      ${page.tipo === 'juridica' ? html`<p class="small text-body-secondary">Última atualização: ${new Date(page.atualizado_em).toLocaleDateString('pt-BR')}</p>` : ''}
    </div></section>
    <section class="section pt-4"><div class="container narrow">
      ${page.revisao_pendente ? html`<div class="notice notice-warning" role="note">${icon('exclamation-triangle')} <strong>Documento em revisão.</strong> Este texto é um modelo e deve ser revisado por profissional habilitado antes da publicação definitiva.</div>` : ''}
      <article class="prose">${raw(renderMarkdown(page.conteudo))}</article>
      ${page.slug === 'politica-de-privacidade' ? html`<div class="info-card mt-4"><h2 class="h5">Exercer seus direitos</h2><p>Você pode solicitar acesso, correção, anonimização, portabilidade ou exclusão dos seus dados.</p><a class="btn btn-outline-ink btn-sm" href="/privacidade/solicitacao">Fazer uma solicitação</a></div>` : ''}
    </div></section>`;
}

export function faqPage({ faqs }) {
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: 'Perguntas frequentes' }])}
      <h1>Perguntas frequentes</h1>
    </div></section>
    <section class="section pt-4"><div class="container narrow">
      ${faqs.length ? faqList(faqs, 'faq-geral') : html`<div class="empty-state">${icon('question-circle')}<h2>Nenhuma pergunta cadastrada</h2><p>Envie sua dúvida pelo formulário de contato.</p></div>`}
      <div class="faq-more"><p>Não encontrou a sua resposta?</p><a class="btn btn-accent" href="/contato">Enviar uma pergunta</a></div>
    </div></section>`;
}

export function dataRequestPage({ token, success, errors = {}, values = {} }) {
  const tipos = [['acesso', 'Confirmação e acesso aos dados'], ['correcao', 'Correção de dados'], ['anonimizacao', 'Anonimização ou bloqueio'], ['exclusao', 'Eliminação de dados'],
    ['portabilidade', 'Portabilidade'], ['revogacao', 'Revogação de consentimento'], ['informacao', 'Informações sobre compartilhamento']];
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { href: '/politica-de-privacidade', label: 'Privacidade' }, { label: 'Solicitação de titular' }])}
      <h1>Solicitação de titular de dados</h1>
      <p class="lead-muted">Exerça os direitos previstos na Lei Geral de Proteção de Dados (Lei nº 13.709/2018).</p>
    </div></section>
    <section class="section pt-4"><div class="container narrow"><div class="form-card">
      ${success ? html`<div class="alert alert-success" role="status">${success}</div>` : html`<form method="post" action="/privacidade/solicitacao" novalidate data-ajax-form="/api/publico/lgpd" class="needs-validation">
        <input type="hidden" name="form_token" value="${token}">
        <div class="hp-field" aria-hidden="true"><label>Não preencha<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="alert alert-danger${errors._geral ? '' : ' d-none'}" role="alert" data-form-error>${errors._geral || ''}</div>
        <div class="mb-3"><label class="form-label" for="lg-nome">Nome completo <span class="req" aria-hidden="true">*</span></label>
          <input class="form-control${errors.nome ? ' is-invalid' : ''}" id="lg-nome" name="nome" required maxlength="160" value="${values.nome || ''}" autocomplete="name"><div class="invalid-feedback" data-error-for="nome">${errors.nome || ''}</div></div>
        <div class="mb-3"><label class="form-label" for="lg-email">E-mail usado no cadastro <span class="req" aria-hidden="true">*</span></label>
          <input class="form-control${errors.email ? ' is-invalid' : ''}" id="lg-email" name="email" type="email" required maxlength="254" value="${values.email || ''}" autocomplete="email"><div class="invalid-feedback" data-error-for="email">${errors.email || ''}</div></div>
        <div class="mb-3"><label class="form-label" for="lg-tipo">Tipo de solicitação <span class="req" aria-hidden="true">*</span></label>
          <select class="form-select${errors.tipo ? ' is-invalid' : ''}" id="lg-tipo" name="tipo" required><option value="">Selecione…</option>${tipos.map(([v, l]) => html`<option value="${v}"${values.tipo === v ? raw(' selected') : ''}>${l}</option>`)}</select><div class="invalid-feedback" data-error-for="tipo">${errors.tipo || ''}</div></div>
        <div class="mb-3"><label class="form-label" for="lg-desc">Detalhes <span class="opt">(opcional)</span></label>
          <textarea class="form-control" id="lg-desc" name="descricao" rows="4" maxlength="3000">${values.descricao || ''}</textarea></div>
        <p class="form-purpose">${icon('shield-lock')} Usaremos estes dados exclusivamente para atender à sua solicitação. Poderemos pedir confirmação de identidade.</p>
        <button class="btn btn-accent" type="submit" data-submit><span class="spinner-border spinner-border-sm me-2 d-none" aria-hidden="true" data-spinner></span>Enviar solicitação</button>
        <div class="form-success d-none" role="status" tabindex="-1" data-form-success></div>
      </form>`}
    </div></div></section>`;
}

export function resetPasswordPage({ invite }) {
  return html`<section class="section"><div class="container narrow-sm"><div class="form-card">
    <h1 class="h3">${invite ? 'Defina sua senha de acesso' : 'Redefinir senha'}</h1>
    <p class="text-body-secondary">A senha deve ter ao menos 10 caracteres, com letras e números.</p>
    <form data-reset-form novalidate>
      <div class="alert alert-danger d-none" role="alert" data-form-error></div>
      <div class="mb-3"><label class="form-label" for="nova-senha">Nova senha</label>
        <input class="form-control" type="password" id="nova-senha" name="senha" required minlength="10" maxlength="128" autocomplete="new-password"><div class="invalid-feedback" data-error-for="senha"></div></div>
      <div class="mb-3"><label class="form-label" for="conf-senha">Confirme a nova senha</label>
        <input class="form-control" type="password" id="conf-senha" name="confirmacao" required minlength="10" maxlength="128" autocomplete="new-password"><div class="invalid-feedback" data-error-for="confirmacao"></div></div>
      <button class="btn btn-accent" type="submit" data-submit><span class="spinner-border spinner-border-sm me-2 d-none" aria-hidden="true" data-spinner></span>Salvar senha</button>
      <div class="alert alert-success d-none mt-3" role="status" data-form-success></div>
    </form>
  </div></div></section>`;
}
