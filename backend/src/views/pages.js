import { html, raw, safeUrl } from '../utils/html.js';
import { renderMarkdown } from '../utils/markdown.js';
import { formatMoney } from '../utils/money.js';
import { STATUS_COMERCIAL, MODELOS_CONTRATACAO, CONTRATAVEL } from '../modules/products/products.constants.js';
import { productCard, pager, breadcrumbs, contactForm, sectionHeading, faqList, parseLines, statusBadge, priceLabel } from './components.js';
import { whatsappLink, absoluteUrl } from './layout.js';

const icon = (name) => html`<i class="bi bi-${name}" aria-hidden="true"></i>`;

// ------------------------------------------------------------------ início
export function homePage({ s, c, featured, categories, services, faqs, demos, token }) {
  const beneficios = parseLines(c['home.beneficios.itens']);
  const etapas = parseLines(c['home.etapas.itens']);
  const diferenciais = parseLines(c['home.diferenciais.itens']);
  const wa = whatsappLink(s);
  const icons = ['speedometer2', 'shield-check', 'diagram-3', 'graph-up-arrow', 'phone', 'people'];
  return html`
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-grid" aria-hidden="true"></div>
    <div class="container position-relative">
      <div class="row align-items-center g-5">
        <div class="col-lg-6">
          ${c['home.hero.etiqueta'] ? html`<p class="hero-tag"><span class="dot" aria-hidden="true"></span>${c['home.hero.etiqueta']}</p>` : ''}
          <h1 id="hero-title" class="hero-title">${c['home.hero.titulo']}</h1>
          <p class="hero-lead">${c['home.hero.subtitulo']}</p>
          <div class="d-flex flex-wrap gap-3 mt-4">
            <a class="btn btn-accent btn-lg" href="/softwares">${c['home.hero.cta_primario'] || 'Conhecer os softwares'}</a>
            <a class="btn btn-outline-light btn-lg" href="/orcamento">${c['home.hero.cta_secundario'] || 'Solicitar orçamento'}</a>
            ${wa ? html`<a class="btn btn-link link-light btn-lg" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} Falar pelo WhatsApp</a>` : ''}
          </div>
        </div>
        <div class="col-lg-6">
          <figure class="hero-visual">
            <img src="${safeUrl(c['home.hero.imagem'] || '/assets/images/hero-dashboard.svg')}" alt="${c['home.hero.imagem.alt'] || 'Ilustração de um painel de gestão com gráficos e indicadores'}" width="720" height="520" fetchpriority="high">
          </figure>
        </div>
      </div>
    </div>
  </section>

  ${featured.length ? html`<section class="section" aria-labelledby="destaques-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Portfólio', title: c['home.produtos.titulo'] || 'Softwares em destaque', text: c['home.produtos.texto'], id: 'destaques-title' })}
      <div class="row g-4">${featured.map((p) => html`<div class="col-md-6 col-lg-4">${productCard(p)}</div>`)}</div>
      <div class="text-center mt-4"><a class="btn btn-outline-ink" href="/softwares">Ver todos os softwares ${icon('arrow-right')}</a></div>
    </div>
  </section>` : ''}

  ${categories.length ? html`<section class="section section-alt" aria-labelledby="categorias-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Soluções', title: 'Categorias de soluções', id: 'categorias-title' })}
      <div class="row g-3">${categories.map((cat, i) => html`<div class="col-sm-6 col-lg-3">
        <a class="category-tile" href="/softwares?categoria=${cat.slug}">
          <span class="category-icon">${icon(['building', 'calendar2-week', 'truck', 'code-square', 'grid'][i % 5])}</span>
          <strong>${cat.nome}</strong>
          <span>${cat.descricao || ''}</span>
          <small>${cat.total} ${cat.total === 1 ? 'software' : 'softwares'}</small>
        </a></div>`)}</div>
    </div>
  </section>` : ''}

  ${demos.length ? html`<section class="section section-ink" aria-labelledby="demos-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Demonstrações', title: 'Veja os sistemas em funcionamento', text: 'Ambientes de demonstração com dados fictícios para você explorar as telas e os fluxos antes de conversar com a gente.', id: 'demos-title' })}
      <div class="row g-4">${demos.map((p) => html`<div class="col-md-4"><a class="demo-tile" href="${p.demo_tipo === 'interna' ? `/softwares/${p.slug}/demonstracao` : safeUrl(p.demo_url)}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>
        <img src="${safeUrl(p.capa_url)}" alt="" loading="lazy" width="640" height="400">
        <span class="demo-tile-body"><strong>${p.nome}</strong><span>Abrir demonstração ${icon('box-arrow-up-right')}</span></span>
      </a></div>`)}</div>
    </div>
  </section>` : ''}

  ${beneficios.length ? html`<section class="section" aria-labelledby="beneficios-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Por que usar', title: c['home.beneficios.titulo'] || 'Benefícios', id: 'beneficios-title' })}
      <div class="row g-4">${beneficios.map((b, i) => html`<div class="col-md-6 col-lg-4"><div class="feature">
        <span class="feature-icon">${icon(icons[i % icons.length])}</span><h3>${b.titulo}</h3><p>${b.descricao}</p></div></div>`)}</div>
    </div>
  </section>` : ''}

  ${services.length ? html`<section class="section section-alt" aria-labelledby="servicos-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Desenvolvimento sob medida', title: c['home.servicos.titulo'] || 'Serviços de desenvolvimento', text: c['home.servicos.texto'], id: 'servicos-title' })}
      <div class="row g-3">${services.slice(0, 6).map((sv) => html`<div class="col-md-6 col-lg-4"><a class="service-tile" href="/servicos/${sv.slug}">
        <span class="service-icon">${icon(sv.icone || 'gear')}</span><span><strong>${sv.nome}</strong><span>${sv.resumo}</span></span></a></div>`)}</div>
      <div class="text-center mt-4"><a class="btn btn-outline-ink" href="/servicos">Todos os serviços</a> <a class="btn btn-accent ms-2" href="/softwares/sistemas-personalizados">Solicitar desenvolvimento personalizado</a></div>
    </div>
  </section>` : ''}

  ${etapas.length ? html`<section class="section" aria-labelledby="etapas-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Como funciona', title: c['home.etapas.titulo'] || 'Etapas de contratação e implantação', id: 'etapas-title' })}
      <ol class="steps">${etapas.map((e, i) => html`<li><span class="step-n">${String(i + 1).padStart(2, '0')}</span><h3>${e.titulo}</h3><p>${e.descricao}</p></li>`)}</ol>
    </div>
  </section>` : ''}

  ${diferenciais.length ? html`<section class="section section-ink" aria-labelledby="dif-title">
    <div class="container">
      ${sectionHeading({ eyebrow: 'Diferenciais técnicos', title: c['home.diferenciais.titulo'] || 'Tecnologia com responsabilidade', id: 'dif-title' })}
      <div class="row g-4">${diferenciais.map((d) => html`<div class="col-md-6 col-lg-3"><div class="tech-point"><h3>${d.titulo}</h3><p>${d.descricao}</p></div></div>`)}</div>
    </div>
  </section>` : ''}

  ${faqs.length ? html`<section class="section" aria-labelledby="faq-title">
    <div class="container narrow">
      ${sectionHeading({ eyebrow: 'Dúvidas', title: 'Perguntas frequentes', id: 'faq-title', center: true })}
      ${faqList(faqs.slice(0, 6), 'faq-home')}
      <p class="text-center mt-3"><a href="/perguntas-frequentes">Ver todas as perguntas</a></p>
    </div>
  </section>` : ''}

  <section class="section section-alt" aria-labelledby="contato-title">
    <div class="container">
      <div class="row g-5 align-items-start">
        <div class="col-lg-5">
          ${sectionHeading({ eyebrow: 'Contato', title: c['home.contato.titulo'] || 'Vamos conversar sobre o seu projeto?', text: c['home.contato.texto'], id: 'contato-title' })}
          <ul class="list-unstyled contact-points">
            ${s.email_contato ? html`<li>${icon('envelope')} <a href="mailto:${s.email_contato}">${s.email_contato}</a></li>` : ''}
            ${wa ? html`<li>${icon('whatsapp')} <a href="${wa}" target="_blank" rel="noopener noreferrer">Conversar pelo WhatsApp</a></li>` : ''}
          </ul>
        </div>
        <div class="col-lg-7"><div class="form-card">${contactForm({ tipo: 'contato', token, compact: true, submitLabel: 'Enviar mensagem', idPrefix: 'home-' })}</div></div>
      </div>
    </div>
  </section>

  <section class="cta-band" aria-labelledby="cta-title">
    <div class="container d-lg-flex align-items-center justify-content-between gap-4">
      <div><h2 id="cta-title">${c['home.cta.titulo'] || 'Precisa de um sistema sob medida?'}</h2><p>${c['home.cta.texto'] || ''}</p></div>
      <a class="btn btn-ink btn-lg" href="/orcamento">Solicitar orçamento</a>
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
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: 'Softwares' }])}
      <h1>Portfólio de softwares</h1>
      <p class="lead-muted">Sistemas para gestão e operação. Cada página informa a situação comercial atual do produto.</p>
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
          <div class="col-lg-2 d-flex gap-2"><button class="btn btn-primary-ink flex-fill" type="submit">${icon('funnel')} Filtrar</button>
            ${anyFilter ? html`<a class="btn btn-outline-ink" href="/softwares" aria-label="Limpar filtros">${icon('x-lg')}</a>` : ''}</div>
        </div>
      </form>
      <p class="result-count" role="status">${result.total} ${result.total === 1 ? 'software encontrado' : 'softwares encontrados'}</p>
      ${result.items.length
        ? html`<div class="row g-4">${result.items.map((p) => html`<div class="col-md-6 col-lg-4">${productCard(p, { headingLevel: 2 })}</div>`)}</div>`
        : html`<div class="empty-state">${icon('search')}<h2>Nenhum software encontrado</h2><p>Tente outros termos ou remova os filtros. Se não encontrou o que precisa, podemos desenvolver uma solução sob medida.</p>
            <a class="btn btn-accent" href="/softwares/sistemas-personalizados">Solicitar desenvolvimento personalizado</a></div>`}
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
      ${breadcrumbs([{ href: '/', label: 'Início' }, { href: '/softwares', label: 'Softwares' }, { label: p.nome }])}
      <div class="row g-5 align-items-center">
        <div class="col-lg-6">
          <div class="d-flex flex-wrap gap-2 mb-3"><a class="eyebrow" href="/softwares?categoria=${p.categoria_slug}">${p.categoria_nome}</a> ${statusBadge(p.status_comercial)}</div>
          <h1>${p.nome}</h1>
          <p class="lead">${p.resumo}</p>
          ${notReady ? html`<div class="notice notice-info" role="note">${icon('cone-striped')} Este software está <strong>${STATUS_COMERCIAL[p.status_comercial].toLowerCase()}</strong> e ainda não está disponível para contratação. Você pode registrar interesse ou solicitar uma conversa.</div>` : ''}
          ${p.dados_demonstrativos ? html`<div class="notice notice-muted" role="note">${icon('info-circle')} Projeto demonstrativo do portfólio: as telas e dados exibidos são fictícios. Nome, escopo e condições comerciais podem mudar.</div>` : ''}
          <div class="d-flex flex-wrap gap-2 mt-4">
            <a class="btn btn-accent btn-lg" href="#solicitar">${canHire ? 'Contratar' : isCustom ? 'Descrever minha necessidade' : 'Solicitar orçamento'}</a>
            ${demoHref && p.demo_disponivel ? html`<a class="btn btn-outline-ink btn-lg" href="${demoHref}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>${icon('play-circle')} Ver demonstração</a>` : ''}
            ${!isCustom ? html`<a class="btn btn-link btn-lg" href="#apresentacao">Solicitar apresentação</a>` : ''}
            ${wa ? html`<a class="btn btn-link btn-lg" href="${wa}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')} WhatsApp</a>` : ''}
          </div>
        </div>
        <div class="col-lg-6"><figure class="product-cover"><img src="${safeUrl(p.capa_url)}" alt="${p.imagem_alt || `Tela ilustrativa do ${p.nome}`}" width="960" height="600" fetchpriority="high"></figure></div>
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

    ${p.beneficios.length ? html`<section class="section section-ink" aria-labelledby="ben-title"><div class="container">
      ${sectionHeading({ eyebrow: 'Resultados esperados', title: 'Recursos e benefícios', id: 'ben-title' })}
      <div class="row g-4">${p.beneficios.map((b) => html`<div class="col-md-6 col-lg-3"><div class="tech-point"><h3>${b.titulo}</h3>${b.descricao ? html`<p>${b.descricao}</p>` : ''}</div></div>`)}</div>
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
            <a class="btn btn-outline-ink btn-sm" href="#solicitar" data-select-plan="${pl.nome}">${canHire ? 'Contratar este plano' : 'Solicitar orçamento'}</a>
          </article></div>`)}</div>`
          : html`<div class="empty-inline">${icon('chat-square-text')}<p>Os planos e valores deste software são definidos conforme o escopo de cada cliente. Solicite um orçamento sem compromisso.</p></div>`}
        </div>
      </div>
    </div></section>

    ${p.demo_tipo !== 'nenhuma' ? html`<section class="section section-alt" aria-labelledby="demo-title"><div class="container">
      <div class="demo-callout">
        <div><h2 id="demo-title">Demonstração</h2>
          ${p.demo_disponivel ? html`<p>${p.demo_tipo === 'interna' ? 'Explore uma demonstração interativa com dados fictícios, executada no seu navegador.' : 'Acesse o ambiente de demonstração online.'}</p>` : html`<p>A demonstração está temporariamente indisponível.</p>`}
          ${p.demo_aviso ? html`<p class="small">${icon('exclamation-circle')} ${p.demo_aviso}</p>` : ''}</div>
        ${p.demo_disponivel && demoHref ? html`<a class="btn btn-accent btn-lg" href="${demoHref}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>Abrir demonstração</a>` : ''}
      </div></div></section>` : ''}

    ${p.faqs.length ? html`<section class="section" id="perguntas" aria-labelledby="pq-title"><div class="container narrow">
      ${sectionHeading({ title: `Perguntas sobre o ${p.nome}`, id: 'pq-title', center: true })}
      ${faqList(p.faqs, 'faq-produto')}
    </div></section>` : ''}

    <section class="section section-alt" id="solicitar" aria-labelledby="sol-title"><div class="container">
      <div class="row g-5">
        <div class="col-lg-${isCustom ? '12' : '7'}"><div class="form-card">
          <h2 id="sol-title">${isCustom ? 'Levantamento inicial de requisitos' : canHire ? `Contratar ${p.nome}` : `Solicitar orçamento do ${p.nome}`}</h2>
          <p class="text-body-secondary">${isCustom ? 'Conte o que você precisa. Analisamos e retornamos com perguntas e uma proposta.' : 'Não é necessário pagamento para solicitar orçamento. Retornamos com a proposta pelo e-mail informado.'}</p>
          ${contactForm({ tipo: isCustom ? 'personalizado' : 'orcamento', token, produto: p, submitLabel: isCustom ? 'Enviar levantamento' : 'Solicitar orçamento', idPrefix: 'orc-' })}
        </div></div>
        ${!isCustom ? html`<div class="col-lg-5" id="apresentacao"><div class="form-card">
          <h2 class="h4">Solicitar apresentação</h2>
          <p class="text-body-secondary small">Agende uma conversa para ver o sistema e tirar dúvidas.</p>
          ${contactForm({ tipo: 'apresentacao', token, produto: p, compact: true, submitLabel: 'Solicitar apresentação', idPrefix: 'apr-' })}
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
        <a href="/softwares/${p.slug}#solicitar" class="btn btn-accent btn-sm">Solicitar orçamento</a>
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
      ${services.length ? html`<div class="row g-4">${services.map((sv) => html`<div class="col-md-6 col-lg-4"><article class="service-card">
        <span class="service-icon">${icon(sv.icone || 'gear')}</span>
        <h2><a href="/servicos/${sv.slug}">${sv.nome}</a></h2>
        <p>${sv.resumo}</p>
        ${sv.beneficios.length ? html`<ul class="check-list small">${sv.beneficios.slice(0, 3).map((b) => html`<li>${b}</li>`)}</ul>` : ''}
        ${sv.preco !== null ? html`<p class="small fw-semibold">${sv.preco_descricao || ''} ${formatMoney(sv.preco)}</p>` : ''}
        <a class="btn btn-outline-ink btn-sm mt-auto" href="/servicos/${sv.slug}">Saiba mais</a>
      </article></div>`)}</div>` : html`<div class="empty-state">${icon('tools')}<h2>Nenhum serviço publicado</h2><p>Em breve publicaremos nossos serviços. Enquanto isso, fale com a gente.</p><a class="btn btn-accent" href="/contato">Entrar em contato</a></div>`}
    </div></section>
    <section class="section section-alt"><div class="container narrow"><div class="form-card">
      <h2>Fale sobre o seu projeto</h2>
      ${contactForm({ tipo: 'orcamento', token, servicos: services, submitLabel: 'Solicitar orçamento', idPrefix: 'srv-' })}
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
        <h2 class="h4">Solicitar orçamento</h2>
        ${contactForm({ tipo: 'orcamento', token, compact: true, servico: sv, submitLabel: 'Solicitar orçamento', idPrefix: 'sv-' })}
      </div></div>
    </div></div></section>`;
}

// ------------------------------------------------------------------ contato
export function contactPage({ s, token, tipo, produtos, servicos, values = {}, errors = {}, success = null, produtoSel = null }) {
  const wa = whatsappLink(s);
  const titles = { contato: 'Fale conosco', orcamento: 'Solicitar orçamento', apresentacao: 'Solicitar apresentação', personalizado: 'Desenvolvimento personalizado' };
  return html`<section class="page-hero"><div class="container">
      ${breadcrumbs([{ href: '/', label: 'Início' }, { label: titles[tipo] }])}
      <h1>${titles[tipo]}</h1>
      <p class="lead-muted">${tipo === 'orcamento' ? 'Conte o que você precisa. A solicitação de orçamento é gratuita e não exige pagamento.' : 'Responderemos pelo e-mail informado.'}</p>
    </div></section>
    <section class="section pt-4"><div class="container"><div class="row g-5">
      <div class="col-lg-8"><div class="form-card">
        ${success ? html`<div class="alert alert-success" role="status" tabindex="-1" autofocus>${icon('check-circle')} ${success}</div><a class="btn btn-outline-ink" href="/softwares">Voltar ao portfólio</a>`
          : html`<div class="btn-group mb-4 flex-wrap" role="group" aria-label="Tipo de solicitação">
              <a class="btn btn-sm ${tipo === 'contato' ? 'btn-primary-ink' : 'btn-outline-ink'}" href="/contato">Mensagem</a>
              <a class="btn btn-sm ${tipo === 'orcamento' ? 'btn-primary-ink' : 'btn-outline-ink'}" href="/orcamento">Orçamento</a>
              <a class="btn btn-sm ${tipo === 'personalizado' ? 'btn-primary-ink' : 'btn-outline-ink'}" href="/contato?tipo=personalizado">Sistema personalizado</a>
            </div>
            ${contactForm({ tipo, token, produtos, servicos, values: { ...values, produto: values.produto || produtoSel || '' }, errors, submitLabel: tipo === 'orcamento' ? 'Solicitar orçamento' : 'Enviar', idPrefix: 'ct-' })}`}
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
      <div class="text-center mt-4"><p>Não encontrou sua resposta?</p><a class="btn btn-accent" href="/contato">Enviar pergunta</a></div>
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
