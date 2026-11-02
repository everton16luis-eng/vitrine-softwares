// Site público renderizado no servidor (SEO) + API pública de formulários.
import { Router } from 'express';
import { layout, absoluteUrl } from '../views/layout.js';
import * as pages from '../views/pages.js';
import { getPublicSettings, getSettings } from '../modules/settings/settings.service.js';
import { getContentMap, getPublishedPage, listPublicFaqs, listPublishedPages } from '../modules/content/content.service.js';
import * as products from '../modules/products/products.service.js';
import { listActiveCategories } from '../modules/categories/categories.service.js';
import { listPublishedServices, getPublishedService } from '../modules/services/services.service.js';
import { submitContact, submitDataSubjectRequest } from '../modules/leads/contact.service.js';
import { issueFormToken } from '../modules/leads/form-token.js';
import { formLimiter } from '../middlewares/security.js';
import { AppError } from '../utils/errors.js';
import { clientIp } from '../utils/common.js';
import { markdownToText } from '../utils/markdown.js';
import { escapeHtml } from '../utils/html.js';
import { handleWebhook } from '../modules/payments/gateways.js';

export const publicRouter = Router();
export const publicApi = Router();

async function render(req, res, { title, description, body, jsonLd, ogImage, noindex, status = 200, scripts }) {
  const [settings, pagesList] = await Promise.all([getPublicSettings(), listPublishedPages()]);
  res.status(status).type('html').send(layout({ settings, title, description, path: req.path, body: typeof body === 'function' ? body(settings) : body, jsonLd, ogImage, noindex, pages: pagesList, scripts }));
}

/** Converte erros de validação em { campo: mensagem } para reexibir o formulário. */
function formErrors(err) {
  if (err instanceof AppError) return { ...(err.details || {}), _geral: err.message };
  throw err;
}

// ------------------------------------------------------------- páginas
publicRouter.get('/', async (req, res) => {
  const [c, featured, services] = await Promise.all([getContentMap(), products.listFeatured(3), listPublishedServices()]);
  const settings = await getPublicSettings();
  await render(req, res, {
    title: null,
    body: pages.homePage({ s: settings, c, featured, services, token: issueFormToken() }),
    jsonLd: { '@context': 'https://schema.org', '@type': 'Organization', name: settings.nome_comercial, url: absoluteUrl('/'),
      ...(settings.email_contato ? { email: settings.email_contato } : {}),
      sameAs: ['instagram', 'linkedin', 'github', 'youtube'].map((k) => settings[k]).filter(Boolean) }
  });
});

publicRouter.get('/softwares', async (req, res) => {
  const [result, categories] = await Promise.all([products.listPublic(req.query), listActiveCategories()]);
  const filtered = Object.values(result.filtros).some(Boolean) || result.page > 1;
  await render(req, res, {
    title: 'Projetos e soluções',
    description: 'Conheça os sistemas desenvolvidos, com funcionalidades, situação atual e demonstrações.',
    body: pages.catalogPage({ result, categories }),
    noindex: filtered && result.total === 0
  });
});

publicRouter.get('/softwares/:slug', async (req, res) => {
  const p = await products.getPublicBySlug(req.params.slug);
  const settings = await getSettings();
  if (settings.rastrear_visualizacoes !== false) products.recordView(p.id, req.get('user-agent') || '').catch(() => {});
  await render(req, res, {
    title: p.seo_title || p.nome,
    description: p.seo_description || p.resumo,
    ogImage: p.capa_url,
    body: (s) => pages.productPage({ p, s, token: issueFormToken() }),
    jsonLd: pages.productJsonLd(p, await getPublicSettings()),
    scripts: ['/assets/js/site/gallery.js']
  });
});

publicRouter.get('/softwares/:slug/demonstracao', async (req, res) => {
  const p = await products.getPublicBySlug(req.params.slug);
  if (p.demo_tipo !== 'interna' || !p.demo_disponivel) throw new AppError('Demonstração indisponível para este software.', { status: 404, code: 'NAO_ENCONTRADO' });
  await render(req, res, { title: `Demonstração — ${p.nome}`, description: `Ambiente de demonstração do ${p.nome} com dados fictícios.`, body: pages.demoPage({ p }), noindex: true, scripts: ['/assets/js/demos/app.js'] });
});

publicRouter.get('/servicos', async (req, res) => {
  const [services, c] = await Promise.all([listPublishedServices(), getContentMap()]);
  await render(req, res, { title: 'Serviços', description: c['servicos.texto'] || 'Desenvolvimento de sistemas, integrações, APIs, automação e consultoria.', body: pages.servicesPage({ services, c, token: issueFormToken() }) });
});

publicRouter.get('/servicos/:slug', async (req, res) => {
  const sv = await getPublishedService(req.params.slug);
  await render(req, res, { title: sv.seo_title || sv.nome, description: sv.seo_description || sv.resumo, body: pages.servicePage({ sv, token: issueFormToken() }) });
});

async function contactOptions() {
  const [catalog, servicos] = await Promise.all([products.listPublic({ limite: 30 }), listPublishedServices()]);
  return { produtos: catalog.items, servicos };
}

function contactTipo(req, fallback) {
  const t = req.query.tipo || req.body?.tipo;
  return ['contato', 'orcamento', 'apresentacao', 'personalizado'].includes(t) ? t : fallback;
}

publicRouter.get(['/contato', '/orcamento'], async (req, res) => {
  const tipo = contactTipo(req, req.path === '/orcamento' ? 'orcamento' : 'contato');
  const settings = await getPublicSettings();
  const opts = await contactOptions();
  await render(req, res, {
    title: tipo === 'orcamento' ? 'Solicitar orçamento' : 'Contato',
    description: 'Fale conosco e solicite um orçamento para o desenvolvimento do seu sistema.',
    body: pages.contactPage({ s: settings, token: issueFormToken(), tipo, ...opts, produtoSel: typeof req.query.produto === 'string' ? req.query.produto : null })
  });
});

// Envio tradicional (sem JavaScript): processa e reexibe a página com o resultado.
publicRouter.post('/contato', formLimiter, async (req, res) => {
  const tipo = contactTipo(req, 'contato');
  const settings = await getPublicSettings();
  let success = null;
  let errors = {};
  try {
    success = (await submitContact(req.body, { ip: clientIp(req) })).mensagem;
  } catch (err) {
    errors = formErrors(err);
  }
  const opts = await contactOptions();
  await render(req, res, {
    title: 'Contato', status: success ? 200 : 422, noindex: true,
    body: pages.contactPage({ s: settings, token: issueFormToken(), tipo, ...opts, values: success ? {} : req.body, errors, success })
  });
});

publicRouter.get('/perguntas-frequentes', async (req, res) => {
  const faqs = await listPublicFaqs();
  await render(req, res, {
    title: 'Perguntas frequentes', description: 'Respostas para as dúvidas mais comuns sobre os softwares e serviços.',
    body: pages.faqPage({ faqs }),
    jsonLd: faqs.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.pergunta, acceptedAnswer: { '@type': 'Answer', text: f.resposta } })) } : null
  });
});

publicRouter.get('/privacidade/solicitacao', async (req, res) => {
  await render(req, res, { title: 'Solicitação de titular de dados', body: pages.dataRequestPage({ token: issueFormToken() }) });
});
publicRouter.post('/privacidade/solicitacao', formLimiter, async (req, res) => {
  let success = null;
  let errors = {};
  try { success = (await submitDataSubjectRequest(req.body)).mensagem; } catch (err) { errors = formErrors(err); }
  await render(req, res, { title: 'Solicitação de titular de dados', status: success ? 200 : 422, noindex: true, body: pages.dataRequestPage({ token: issueFormToken(), success, errors, values: req.body }) });
});

publicRouter.get('/redefinir-senha', async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer'); // o token está na URL
  await render(req, res, { title: req.query.convite ? 'Definir senha' : 'Redefinir senha', noindex: true, body: pages.resetPasswordPage({ invite: Boolean(req.query.convite) }), scripts: ['/assets/js/site/reset-password.js'] });
});

// ------------------------------------------------------------- SEO
publicRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /cliente\nDisallow: /api/\nDisallow: /redefinir-senha\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`);
});

publicRouter.get('/sitemap.xml', async (req, res) => {
  const [prods, services, pagesList] = await Promise.all([products.listPublicSlugs(), listPublishedServices(), listPublishedPages()]);
  const urls = [
    { loc: '/', priority: '1.0' }, { loc: '/softwares', priority: '0.9' }, { loc: '/servicos', priority: '0.8' },
    { loc: '/contato', priority: '0.6' }, { loc: '/orcamento', priority: '0.7' }, { loc: '/perguntas-frequentes', priority: '0.5' },
    ...prods.map((p) => ({ loc: `/softwares/${p.slug}`, lastmod: p.atualizado_em, priority: '0.8' })),
    ...services.map((sv) => ({ loc: `/servicos/${sv.slug}`, lastmod: sv.atualizado_em, priority: '0.6' })),
    ...pagesList.map((p) => ({ loc: `/${p.slug}`, lastmod: p.atualizado_em, priority: '0.3' }))
  ];
  const body = urls.map((u) => `  <url><loc>${escapeHtml(absoluteUrl(u.loc))}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n');
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

/**
 * Folha de estilo com as cores configuradas no painel (sem estilos inline, compatível com a CSP).
 * Sobrescreve os padrões de /assets/css/brand.css; --ink e --accent atendem o painel e a área do cliente.
 */
publicRouter.get('/theme.css', async (req, res) => {
  const s = await getPublicSettings();
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  const navy = hex(s.cor_primaria, '#0F172A');
  const blue = hex(s.cor_destaque, '#0EA5E9');
  const purple = hex(s.cor_secundaria, '#8B5CF6');
  res.type('text/css').set('Cache-Control', 'public, max-age=300')
    .send(`:root{--brand-navy:${navy};--brand-blue:${blue};--brand-purple:${purple};--ink:${navy};--accent:${blue};}\n`);
});

// ------------------------------------------------------------- páginas institucionais por slug (deve ficar por último)
publicRouter.get('/:slug', async (req, res, next) => {
  if (!/^[a-z0-9-]{2,120}$/.test(req.params.slug)) return next();
  let page;
  try { page = await getPublishedPage(req.params.slug); } catch { return next(); }
  return render(req, res, { title: page.seo_title || page.titulo, description: page.seo_description || markdownToText(page.conteudo), body: pages.contentPage({ page }) });
});

// ------------------------------------------------------------- API pública
publicApi.get('/form-token', (req, res) => res.set('Cache-Control', 'no-store').json({ token: issueFormToken() }));
publicApi.get('/produtos', async (req, res) => res.json(await products.listPublic(req.query)));
publicApi.post('/contato', formLimiter, async (req, res) => res.status(201).json(await submitContact(req.body, { ip: clientIp(req) })));
publicApi.post('/lgpd', formLimiter, async (req, res) => res.status(201).json(await submitDataSubjectRequest(req.body)));

export const webhookRouter = Router();
webhookRouter.post('/:provedor', async (req, res) => res.json(await handleWebhook(req.params.provedor, req)));
