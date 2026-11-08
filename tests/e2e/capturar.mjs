// Percorre TODAS as telas (site público, painel e área do cliente) num Chromium real, em desktop e celular.
// Para cada tela: captura de página inteira, erros de console, requisições com falha e violações de
// acessibilidade (axe-core, impacto sério ou crítico). Gera relatorio.json na pasta de saída.
//
// Uso: node tests/e2e/capturar.mjs <rotulo> [baseUrl]
//   rotulo  -> pasta em docs/ui/capturas/<rotulo> (ex.: antes, depois)
//   baseUrl -> padrão http://localhost:3001 (servidor com NODE_ENV=test e banco *_test)
// Antes: node tests/e2e/prepare-db.js
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const label = process.argv[2] || 'atual';
const BASE = process.argv[3] || 'http://localhost:3001';
const OUT = path.resolve('docs/ui/capturas', label);
const PASSWORD = 'Senha-de-Teste-2026'; // senha dos usuários de teste (tests/integration/helpers.js)
const ADMIN = 'e2e-admin@exemplo.test';
const CLIENTE = 'e2e-cliente@exemplo.test';
const ONLY = process.env.SO ? new RegExp(process.env.SO) : null;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  celular: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
};

const ADMIN_ROUTES = ['', 'produtos', 'categorias', 'servicos', 'planos', 'leads', 'clientes', 'orcamentos', 'pedidos', 'contratos', 'suporte',
  'levantamentos', 'levantamentos/perguntas', 'implantacoes', 'receitas', 'dominios', 'conteudo', 'parceiros', 'midia', 'relatorios', 'lgpd', 'auditoria', 'usuarios', 'configuracoes', 'perfil'];
const CLIENT_ROUTES = ['', 'pedidos', 'orcamentos', 'contratos', 'arquivos', 'suporte', 'dados'];

mkdirSync(OUT, { recursive: true });
const report = { base: BASE, label, geradoEm: new Date().toISOString(), telas: [] };

async function publicPaths() {
  const r = await fetch(`${BASE}/api/publico/produtos`).then((x) => x.json());
  const prods = r.items || [];
  const html = await fetch(`${BASE}/servicos`).then((x) => x.text());
  const svc = [...html.matchAll(/href="\/servicos\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  const demo = prods.find((p) => p.demo_tipo === 'interna' && p.demo_disponivel);
  const custom = prods.find((p) => p.modelo_contratacao === 'personalizado');
  const normal = prods.find((p) => p.modelo_contratacao !== 'personalizado') || prods[0];
  return [
    ['inicio', '/'], ['projetos', '/softwares'], ['projetos-filtro-vazio', '/softwares?busca=zzzz-nada'],
    normal && ['projeto', `/softwares/${normal.slug}`], custom && ['projeto-personalizado', `/softwares/${custom.slug}`],
    demo && ['demonstracao', `/softwares/${demo.slug}/demonstracao`],
    ['servicos', '/servicos'], svc[0] && ['servico', `/servicos/${svc[0]}`],
    ['contato', '/contato'], ['orcamento', '/orcamento'], ['personalizado', '/contato?tipo=personalizado'],
    ['faq', '/perguntas-frequentes'], ['lgpd', '/privacidade/solicitacao'], ['privacidade', '/politica-de-privacidade'],
    ['sobre', '/sobre'], ['redefinir-senha', '/redefinir-senha'], ['erro-404', '/pagina-que-nao-existe']
  ].filter(Boolean);
}

function watch(page) {
  const problems = { console: [], requisicoes: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.console.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.requisicoes.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.requisicoes.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return problems;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.state-loading, .boot'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
}

async function shoot(page, problems, area, name, vp) {
  if (ONLY && !ONLY.test(`${area}/${name}`)) { problems.console.length = 0; problems.requisicoes.length = 0; return; }
  await settle(page);
  const file = `${area}-${name}-${vp}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  let a11y = [];
  try {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    a11y = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => ({ id: v.id, impacto: v.impact, nos: v.nodes.length, exemplo: v.nodes[0]?.target?.join(' ') }));
  } catch (e) { a11y = [{ id: 'axe-falhou', impacto: 'n/a', nos: 0, exemplo: e.message }]; }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.telas.push({ area, tela: name, viewport: vp, arquivo: file, url: page.url(), console: [...problems.console], requisicoes: [...problems.requisicoes], acessibilidade: a11y, rolagemHorizontalPx: overflow });
  problems.console.length = 0; problems.requisicoes.length = 0;
  process.stdout.write(`${area}/${name} [${vp}] ${a11y.length ? `a11y:${a11y.map((x) => x.id).join(',')}` : 'ok'}${overflow > 0 ? ` overflow:${overflow}` : ''}\n`);
}

async function login(page, url, email, area) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.click('button[type=submit]')]);
  await settle(page);
  if (await page.locator('input[type=password]').count()) throw new Error(`Login falhou em ${area}`);
}

const browser = await chromium.launch();
const paths = await publicPaths();
for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, isMobile: opts.isMobile, hasTouch: opts.hasTouch, deviceScaleFactor: opts.deviceScaleFactor || 1, locale: 'pt-BR' });
  await ctx.addInitScript(() => { try { localStorage.setItem('aviso-cookies', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const problems = watch(page);

  for (const [name, p] of paths) {
    await page.goto(`${BASE}${p}`);
    if (name === 'erro-404') {
      // O 404 é o próprio objeto do teste: descarta a resposta e a mensagem que o navegador registra por ela.
      await page.waitForLoadState('load');
      problems.requisicoes = problems.requisicoes.filter((x) => !x.startsWith('404 GET'));
      problems.console = problems.console.filter((x) => !x.includes('status of 404'));
    }
    await shoot(page, problems, 'site', name, vp);
  }

  // Painel administrativo
  await page.goto(`${BASE}/admin`);
  await shoot(page, problems, 'admin', 'login', vp);
  await login(page, '/admin', ADMIN, 'admin');
  for (const r of ADMIN_ROUTES) {
    await page.goto(`${BASE}/admin#/${r}`);
    await shoot(page, problems, 'admin', r || 'painel', vp);
  }
  if (vp === 'celular') {
    await page.goto(`${BASE}/admin#/`);
    await settle(page);
    const toggle = page.locator('[aria-controls="admin-sidebar"]');
    if (await toggle.count()) { await toggle.first().click(); await page.waitForTimeout(400); await shoot(page, problems, 'admin', 'menu-aberto', vp); }
  }
  await ctx.clearCookies();

  // Área do cliente
  await page.goto(`${BASE}/cliente`);
  await shoot(page, problems, 'cliente', 'login', vp);
  await login(page, '/cliente', CLIENTE, 'cliente');
  for (const r of CLIENT_ROUTES) {
    await page.goto(`${BASE}/cliente#/${r}`);
    await shoot(page, problems, 'cliente', r || 'inicio', vp);
  }
  await ctx.close();
}
await browser.close();

writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(report, null, 2));
const withIssues = report.telas.filter((t) => t.console.length || t.requisicoes.length || t.acessibilidade.length || t.rolagemHorizontalPx > 0);
console.log(`\n${report.telas.length} capturas em ${OUT}. Com algum problema: ${withIssues.length}.`);
