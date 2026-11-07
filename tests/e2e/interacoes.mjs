// Verificações de interação no navegador (Playwright) para os componentes da refatoração visual.
// Uso: node tests/e2e/interacoes.mjs [baseUrl=http://localhost:3001]
// Pré-requisitos: banco de testes preparado (npm run test:e2e:preparar) e servidor com NODE_ENV=test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3001';
const PASSWORD = 'Senha-de-Teste-2026'; // senha dos usuários de teste (tests/integration/helpers.js)
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FALHOU', `${name}: ${e.message.split('\n')[0]}`]); }
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- site público
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/`);
  await check('início: primeiro passo do pedido leva ao formulário com o tipo escolhido (sem JS também, é GET)', async () => {
    await page.check('input[name=tipo][value=apresentacao]');
    await Promise.all([page.waitForURL(/\/contato\?tipo=apresentacao/), page.click('.hero-start button[type=submit]')]);
    assert.equal(await page.locator('.segmented [aria-current="page"]').innerText(), 'Apresentação');
  });
  await check('contato: o tipo "personalizado" marca a aba certa', async () => {
    await page.goto(`${BASE}/contato?tipo=personalizado`);
    assert.equal(await page.locator('.segmented [aria-current="page"]').innerText(), 'Sistema sob medida');
  });
  await check('produto: trilha de situação expõe a etapa atual', async () => {
    const r = await page.request.get(`${BASE}/api/publico/produtos`);
    const body = await r.json();
    const list = Array.isArray(body) ? body : body.items || body.produtos || [];
    await page.goto(`${BASE}/softwares/${list[0].slug}`);
    assert.equal(await page.locator('.status-track [aria-current="step"]').count(), 1);
  });
}

// ---------------------------------------------------------------- celular: menu do site e gaveta do painel
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await check('celular: botão do menu abre a navegação do site', async () => {
    await page.click('.navbar-toggler');
    await page.locator('#nav-principal.show').waitFor({ timeout: 3000 });
    assert.equal(await page.getAttribute('.navbar-toggler', 'aria-expanded'), 'true');
  });
  await page.goto(`${BASE}/admin`);
  await page.fill('input[type=email]', 'e2e-admin@exemplo.test');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.locator('.admin-header').waitFor();
  await check('celular: gaveta do painel abre, fica visível e fecha ao navegar', async () => {
    await page.click('button[aria-controls="admin-sidebar"]');
    await page.locator('#admin-sidebar').waitFor({ state: 'visible' });
    await page.click('#admin-sidebar a[data-route="produtos"]');
    await page.waitForFunction(() => !document.body.classList.contains('sidebar-open'));
  });
  await check('celular: botão da conta tem nome acessível', async () => {
    const label = await page.getAttribute('.btn-user', 'aria-label');
    assert.match(label || '', /^Conta de /);
  });
  await ctx.close();
}

// ---------------------------------------------------------------- painel: abas e tabelas
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/admin`);
  await page.fill('input[type=email]', 'e2e-admin@exemplo.test');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.locator('.admin-header').waitFor();
  await page.goto(`${BASE}/admin#/contratos`);
  await page.locator('[role=tab]').first().waitFor();
  await check('abas (contratos): estrutura WAI-ARIA com uma aba selecionada e painel rotulado', async () => {
    assert.equal(await page.locator('[role=tablist] > li[role=presentation] > [role=tab]').count(), 2);
    assert.equal(await page.locator('[role=tab][aria-selected=true]').count(), 1);
    const panel = page.locator('[role=tabpanel]');
    const labelledby = await panel.getAttribute('aria-labelledby');
    assert.equal(await page.locator(`#${labelledby}`).innerText(), 'Contratos');
  });
  await check('abas (contratos): seta para a direita e Home trocam a aba e o foco', async () => {
    await page.locator('[role=tab][aria-selected=true]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), 'Licenças');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Licenças');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), 'Contratos');
    assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1);
  });
  await check('tabelas largas: região rolável alcançável pelo teclado e rotulada', async () => {
    await page.goto(`${BASE}/admin#/produtos`);
    const region = page.locator('.table-responsive').first();
    await region.waitFor();
    assert.equal(await region.getAttribute('tabindex'), '0');
    assert.equal(await region.getAttribute('role'), 'region');
    assert.ok(await region.getAttribute('aria-label'));
  });
  await check('chips de situação usam o componente do sistema', async () => {
    assert.ok(await page.locator('.data-table .chip').count() > 0);
  });
}

await browser.close();
for (const [s, n] of results) console.log(`${s === 'ok' ? '✔' : '✖'} ${n}`);
const failed = results.filter(([s]) => s !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
process.exit(failed ? 1 : 0);
