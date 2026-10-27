import { html, raw, jsonForScript, safeUrl } from '../utils/html.js';
import { env } from '../config/env.js';

const NAV = [
  { href: '/', label: 'Início' },
  { href: '/softwares', label: 'Softwares' },
  { href: '/servicos', label: 'Serviços' },
  { href: '/sobre', label: 'Sobre' },
  { href: '/perguntas-frequentes', label: 'Dúvidas' },
  { href: '/contato', label: 'Contato' }
];

export const absoluteUrl = (path = '/') => (/^https?:\/\//.test(path) ? path : `${env.appUrl}${path.startsWith('/') ? path : `/${path}`}`);

export function whatsappLink(s, text) {
  if (!s.whatsapp) return null;
  const msg = text || s.whatsapp_mensagem || '';
  return `https://wa.me/${s.whatsapp}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
}

function brand(s) {
  return html`<a class="brand" href="/" aria-label="${s.nome_comercial} — página inicial">
    ${s.logo_url
      ? html`<img src="${safeUrl(s.logo_url)}" alt="" height="34" class="brand-logo">`
      : html`<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="32" height="32"><rect x="1" y="1" width="30" height="30" rx="9" class="bm-bg"/><path d="M9 21.5 14.5 10h3L23 21.5h-3.2l-1.1-2.5h-5.4l-1.1 2.5Zm5.3-5h3.4L16 12.6Z" class="bm-fg"/></svg></span>`}
    <span class="brand-text">${s.nome_comercial}${s.slogan ? html`<small>${s.slogan}</small>` : ''}</span>
  </a>`;
}

function header(s, current) {
  return html`<header class="site-header" data-header>
    <nav class="navbar navbar-expand-lg" aria-label="Navegação principal">
      <div class="container">
        ${brand(s)}
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#nav-principal" aria-controls="nav-principal" aria-expanded="false" aria-label="Abrir menu">
          <i class="bi bi-list" aria-hidden="true"></i>
        </button>
        <div class="collapse navbar-collapse" id="nav-principal">
          <ul class="navbar-nav ms-auto align-items-lg-center">
            ${NAV.map((n) => {
              const active = n.href === '/' ? current === '/' : current.startsWith(n.href);
              return html`<li class="nav-item"><a class="nav-link${active ? ' active' : ''}" href="${n.href}"${active ? raw(' aria-current="page"') : ''}>${n.label}</a></li>`;
            })}
            <li class="nav-item ms-lg-3 mt-2 mt-lg-0"><a class="btn btn-accent btn-sm px-3" href="/orcamento">Solicitar orçamento</a></li>
          </ul>
        </div>
      </div>
    </nav>
  </header>`;
}

function footer(s, pages = []) {
  const socials = [['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['youtube', 'YouTube']].filter(([k]) => s[k]);
  const wa = whatsappLink(s);
  const legal = pages.filter((p) => p.tipo === 'juridica');
  return html`<footer class="site-footer">
    <div class="container">
      <div class="row g-4">
        <div class="col-lg-4">
          ${brand(s)}
          <p class="footer-text mt-3">${s.seo_descricao_padrao || ''}</p>
          ${socials.length ? html`<ul class="social list-unstyled d-flex gap-2 mt-3">${socials.map(([k, label]) => html`
            <li><a href="${safeUrl(s[k])}" target="_blank" rel="noopener noreferrer" aria-label="${label}"><i class="bi bi-${k}" aria-hidden="true"></i></a></li>`)}</ul>` : ''}
        </div>
        <div class="col-6 col-lg-2">
          <h2 class="footer-title">Navegação</h2>
          <ul class="list-unstyled footer-links">${NAV.map((n) => html`<li><a href="${n.href}">${n.label}</a></li>`)}</ul>
        </div>
        <div class="col-6 col-lg-3">
          <h2 class="footer-title">Políticas</h2>
          <ul class="list-unstyled footer-links">
            ${legal.map((p) => html`<li><a href="/${p.slug}">${p.titulo}</a></li>`)}
            <li><a href="/privacidade/solicitacao">Solicitações de titulares (LGPD)</a></li>
            <li><a href="/cliente">Área do cliente</a></li>
          </ul>
        </div>
        <div class="col-lg-3">
          <h2 class="footer-title">Contato</h2>
          <ul class="list-unstyled footer-links">
            ${s.email_contato ? html`<li><i class="bi bi-envelope me-2" aria-hidden="true"></i><a href="mailto:${s.email_contato}">${s.email_contato}</a></li>` : ''}
            ${s.telefone ? html`<li><i class="bi bi-telephone me-2" aria-hidden="true"></i><a href="tel:${s.telefone.replace(/[^\d+]/g, '')}">${s.telefone}</a></li>` : ''}
            ${wa ? html`<li><i class="bi bi-whatsapp me-2" aria-hidden="true"></i><a href="${wa}" target="_blank" rel="noopener noreferrer">WhatsApp</a></li>` : ''}
            ${s.endereco ? html`<li><i class="bi bi-geo-alt me-2" aria-hidden="true"></i>${s.endereco}</li>` : ''}
            ${!s.email_contato && !s.telefone && !wa ? html`<li class="text-warning-emphasis small">Canais de contato ainda não configurados.</li>` : ''}
            <li><a href="/contato" class="btn btn-outline-light btn-sm mt-2">Enviar mensagem</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${new Date().getFullYear()} ${s.razao_social || s.nome_comercial}${s.documento_empresa ? ` — ${s.documento_empresa}` : ''}</span>
        <span>Este site utiliza apenas cookies essenciais.</span>
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
  return `<!doctype html>${html`<html lang="pt-BR">
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
  <meta name="theme-color" content="${s.cor_primaria || '#0e1525'}">
  <link rel="icon" href="${safeUrl(s.favicon_url || '/assets/icons/favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">
  <link rel="stylesheet" href="/vendor/bootstrap-icons/font/bootstrap-icons.min.css">
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="stylesheet" href="/theme.css">
  ${jsonLd ? html`<script type="application/ld+json">${jsonForScript(jsonLd)}</script>` : ''}
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  ${s.aviso_site_ativo && s.aviso_site ? html`<div class="site-notice" role="status">${s.aviso_site}</div>` : ''}
  ${header(s, path)}
  <main id="conteudo" tabindex="-1">${body}</main>
  ${footer(s, pages)}
  <div class="cookie-notice" data-cookie-notice hidden role="region" aria-label="Aviso de cookies">
    <p>Usamos somente cookies essenciais para o funcionamento do site (por exemplo, manter sua sessão). Não usamos cookies de publicidade ou rastreamento. <a href="/politica-de-cookies">Saiba mais</a>.</p>
    <button type="button" class="btn btn-sm btn-accent" data-cookie-ok>Entendi</button>
  </div>
  <div class="toast-region" aria-live="polite" aria-atomic="true" data-toasts></div>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
  <script type="module" src="/assets/js/site/main.js"></script>
  ${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
</body>
</html>`}`;
}
