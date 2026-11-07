import { html, raw, jsonForScript, safeUrl } from '../utils/html.js';
import { env } from '../config/env.js';

const NAV = [
  { href: '/', label: 'Início' },
  { href: '/servicos', label: 'Serviços' },
  { href: '/#como-trabalhamos', label: 'Como trabalhamos' },
  { href: '/softwares', label: 'Projetos' },
  { href: '/sobre', label: 'Sobre' },
  { href: '/contato', label: 'Contato' }
];

export const absoluteUrl = (path = '/') => (/^https?:\/\//.test(path) ? path : `${env.appUrl}${path.startsWith('/') ? path : `/${path}`}`);

export function whatsappLink(s, text) {
  if (!s.whatsapp) return null;
  const msg = text || s.whatsapp_mensagem || '';
  return `https://wa.me/${s.whatsapp}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
}

/**
 * Marca: logotipo configurado no painel (Configurações › URL do logotipo) ou, enquanto não houver,
 * um espaço reservado neutro. O nome vem de "nome comercial" — nada de marca fixa no código.
 */
function brand(s) {
  return html`<a class="brand" href="/" aria-label="${s.nome_comercial} — página inicial">
    ${s.logo_url
      ? html`<img src="${safeUrl(s.logo_url)}" alt="" height="36" class="brand-logo">`
      : html`<span class="brand-logo-slot" aria-hidden="true" title="Espaço reservado para a logo"></span>`}
    <span class="brand-text">${s.nome_comercial}${s.slogan ? html`<small>${s.slogan}</small>` : ''}</span>
  </a>`;
}

function header(s, current) {
  return html`<header class="site-header" data-header>
    <nav class="navbar navbar-expand-lg" aria-label="Navegação principal">
      <div class="container">
        ${brand(s)}
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav-principal" aria-controls="nav-principal" aria-expanded="false" aria-label="Abrir menu">
          <span class="toggler-bars" aria-hidden="true"></span>
        </button>
        <div class="collapse navbar-collapse" id="nav-principal">
          <ul class="navbar-nav ms-auto">
            ${NAV.map((n) => {
              const active = n.href === '/' ? current === '/' : !n.href.includes('#') && current.startsWith(n.href);
              return html`<li class="nav-item"><a class="nav-link${active ? ' active' : ''}" href="${n.href}"${active ? raw(' aria-current="page"') : ''}>${n.label}</a></li>`;
            })}
          </ul>
          <a class="btn btn-accent btn-nav" href="/orcamento">Pedir orçamento</a>
        </div>
      </div>
    </nav>
  </header>`;
}

/** Rodapé em forma de carimbo: os dados da empresa como os campos de uma prancha. */
function footer(s, pages = []) {
  const socials = [['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['youtube', 'YouTube']].filter(([k]) => s[k]);
  const wa = whatsappLink(s);
  const legal = pages.filter((p) => p.tipo === 'juridica');
  return html`<footer class="site-footer">
    <div class="container">
      <div class="footer-sheet">
        <div class="footer-lead">
          ${brand(s)}
          ${s.seo_descricao_padrao ? html`<p class="footer-text">${s.seo_descricao_padrao}</p>` : ''}
          <a class="btn btn-accent" href="/orcamento">Pedir orçamento</a>
        </div>
        <div class="footer-cell">
          <h2 class="footer-title">Navegação</h2>
          <ul class="list-unstyled footer-links">
            ${NAV.map((n) => html`<li><a href="${n.href}">${n.label}</a></li>`)}
            <li><a href="/perguntas-frequentes">Perguntas frequentes</a></li>
          </ul>
        </div>
        <div class="footer-cell">
          <h2 class="footer-title">Políticas e acesso</h2>
          <ul class="list-unstyled footer-links">
            ${legal.map((p) => html`<li><a href="/${p.slug}">${p.titulo}</a></li>`)}
            <li><a href="/privacidade/solicitacao">Solicitações de titulares (LGPD)</a></li>
            <li><a href="/cliente">Área do cliente</a></li>
          </ul>
        </div>
        <div class="footer-cell">
          <h2 class="footer-title">Contato</h2>
          <ul class="list-unstyled footer-links">
            ${s.email_contato ? html`<li><a href="mailto:${s.email_contato}"><i class="bi bi-envelope" aria-hidden="true"></i>${s.email_contato}</a></li>` : ''}
            ${s.telefone ? html`<li><a href="tel:${s.telefone.replace(/[^\d+]/g, '')}"><i class="bi bi-telephone" aria-hidden="true"></i>${s.telefone}</a></li>` : ''}
            ${wa ? html`<li><a href="${wa}" target="_blank" rel="noopener noreferrer"><i class="bi bi-whatsapp" aria-hidden="true"></i>WhatsApp</a></li>` : ''}
            ${s.endereco ? html`<li class="footer-address"><i class="bi bi-geo-alt" aria-hidden="true"></i>${s.endereco}</li>` : ''}
            <li><a href="/contato"><i class="bi bi-chat-left-text" aria-hidden="true"></i>Formulário de contato</a></li>
          </ul>
          ${socials.length ? html`<ul class="social list-unstyled">${socials.map(([k, label]) => html`
            <li><a href="${safeUrl(s[k])}" target="_blank" rel="noopener noreferrer" aria-label="${label}"><i class="bi bi-${k}" aria-hidden="true"></i></a></li>`)}</ul>` : ''}
        </div>
        <dl class="footer-stamp">
          <div><dt>Empresa</dt><dd>${s.razao_social || s.nome_comercial}</dd></div>
          ${s.documento_empresa ? html`<div><dt>Documento</dt><dd>${s.documento_empresa}</dd></div>` : ''}
          <div><dt>Cookies</dt><dd>Somente essenciais</dd></div>
          <div><dt>Ano</dt><dd>${new Date().getFullYear()}</dd></div>
        </dl>
      </div>
    </div>
  </footer>`;
}

/**
 * @param {object} o
 * @param {object} o.settings configurações públicas
 * @param {string} o.title
 * @param {string} [o.description]
 * @param {string} o.path caminho canônico
 * @param {*} o.body
 */
export function layout({ settings: s, title, description, path = '/', body, jsonLd, ogImage, noindex = false, pages = [], bodyClass = '', scripts = [] }) {
  const fullTitle = title ? `${title} | ${s.nome_comercial}` : s.seo_titulo_padrao || s.nome_comercial;
  const desc = description || s.seo_descricao_padrao || '';
  const canonical = absoluteUrl(path);
  const image = absoluteUrl(ogImage || '/assets/images/og-default.png');
  return `<!doctype html>${html`<html lang="pt-BR" data-bs-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${canonical}">
  ${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
  <meta property="og:type" content="website">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:site_name" content="${s.nome_comercial}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${image}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#F3F5F7">
  <link rel="icon" href="${safeUrl(s.favicon_url || '/assets/icons/favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">
  <link rel="stylesheet" href="/vendor/bootstrap-icons/font/bootstrap-icons.min.css">
  <link rel="preload" href="/assets/fonts/archivo/archivo-latin-standard-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/brand.css">
  <link rel="stylesheet" href="/assets/css/system.css">
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="stylesheet" href="/theme.css">
  ${jsonLd ? html`<script type="application/ld+json">${jsonForScript(jsonLd)}</script>` : ''}
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  ${s.aviso_site_ativo && s.aviso_site ? html`<div class="site-notice" role="note"><div class="container"><span class="chip chip-accent">Aviso</span><span>${s.aviso_site}</span></div></div>` : ''}
  ${header(s, path)}
  <main id="conteudo" tabindex="-1">${body}</main>
  ${footer(s, pages)}
  <div class="cookie-notice" data-cookie-notice hidden role="region" aria-label="Aviso de cookies">
    <p>Usamos somente cookies essenciais para o funcionamento do site (por exemplo, manter sua sessão). Não usamos cookies de publicidade ou rastreamento. <a href="/politica-de-cookies">Saiba mais</a>.</p>
    <button type="button" class="btn btn-sm btn-primary" data-cookie-ok>Entendi</button>
  </div>
  <div class="toast-region" aria-live="polite" aria-atomic="true" data-toasts></div>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
  <script type="module" src="/assets/js/site/main.js"></script>
  ${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
</body>
</html>`}`;
}
