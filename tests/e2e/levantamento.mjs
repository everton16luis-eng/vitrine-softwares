// Percorre o módulo Levantamento de Requisitos num Chromium real, como um usuário da equipe:
// cria o levantamento, responde pela entrevista (autosave), pula pergunta, registra observações,
// 5 porquês, consolidação, conclui, gera PDF, reabre (versão 2), compara versões, duplica e
// edita o banco de perguntas. Captura cada tela em desktop (1440) e celular (390) com axe-core
// e checagem de rolagem horizontal. Saída: docs/ui/capturas/levantamento/.
//
// Uso: node tests/e2e/prepare-db.js && (servidor NODE_ENV=test na porta 3001) && node tests/e2e/levantamento.mjs
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3001';
const OUT = path.resolve('docs/ui/capturas/levantamento');
const PASSWORD = 'Senha-de-Teste-2026';
const ADMIN = 'e2e-admin@exemplo.test';
mkdirSync(OUT, { recursive: true });
const report = { base: BASE, geradoEm: new Date().toISOString(), telas: [], verificacoes: [] };
const check = (ok, what) => { report.verificacoes.push({ ok: Boolean(ok), what }); console.log(`${ok ? '✔' : '✘'} ${what}`); if (!ok) process.exitCode = 1; };

async function launch() {
  try { return await chromium.launch(); } catch { return chromium.launch({ channel: 'chrome' }); }
}

function watch(page) {
  const p = { console: [], requisicoes: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => p.console.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) p.requisicoes.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return p;
}
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.state-loading, .boot'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
}
async function shoot(page, problems, name, vp) {
  await settle(page);
  const file = `${name}-${vp}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  let a11y = [];
  try {
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    a11y = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => ({ id: v.id, impacto: v.impact, nos: v.nodes.length, exemplo: v.nodes[0]?.target?.join(' ') }));
  } catch (e) { a11y = [{ id: 'axe-falhou', exemplo: e.message }]; }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.telas.push({ tela: name, viewport: vp, arquivo: file, url: page.url(), console: [...problems.console], requisicoes: [...problems.requisicoes], acessibilidade: a11y, rolagemHorizontalPx: overflow });
  console.log(`  ${name} [${vp}] ${a11y.length ? `a11y:${a11y.map((x) => `${x.id}(${x.exemplo})`).join(',')}` : 'a11y ok'}${overflow > 0 ? ` overflow:${overflow}` : ''}${problems.console.length ? ` console:${problems.console.join(' | ')}` : ''}${problems.requisicoes.length ? ` http:${problems.requisicoes.join(' | ')}` : ''}`);
  problems.console.length = 0; problems.requisicoes.length = 0;
}
async function login(page) {
  await page.goto(`${BASE}/admin`);
  await settle(page);
  await page.fill('input[type=email]', ADMIN);
  await page.fill('input[type=password]', PASSWORD);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.click('button[type=submit]')]);
  await settle(page);
}
const waitSaved = (page) => page.locator('.lr-save.is-ok').waitFor({ timeout: 10000 });
const modal = (page) => page.locator('.modal.show');
const submitModal = async (page, label) => { await modal(page).getByRole('button', { name: label }).click(); try { await modal(page).waitFor({ state: 'detached', timeout: 15000 }); } catch (e) { console.log('MODAL:', await modal(page).innerText().catch(() => '?')); throw e; } await settle(page); };

/** Responde a pergunta de forma genérica, conforme o controle que ela tem. */
async function answer(q, text) {
  if (await q.locator('textarea.lr-autogrow, input.form-control[type=text]').count()) {
    await q.locator('textarea.lr-autogrow, input.form-control[type=text]').first().fill(text);
  } else if (await q.locator('.btn-option').count()) {
    await q.locator('.btn-option').first().click();
  } else if (await q.locator('input[type=date]').count()) {
    await q.locator('input[type=date]').fill('2027-03-15');
  }
}

const browser = await launch();
// ------------------------------------------------------------------ fluxo completo no desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const problems = watch(page);
  const vp = 'desktop';
  await login(page);

  await page.goto(`${BASE}/admin#/levantamentos`);
  await shoot(page, problems, '01-lista-vazia', vp);
  check(await page.locator('.admin-sidebar a[data-route="levantamentos"]').count(), 'Menu lateral mostra "Levantamento de Requisitos"');

  // Novo levantamento com cliente e projeto novos
  await page.getByRole('button', { name: 'Novo levantamento' }).click();
  await modal(page).waitFor();
  await shoot(page, problems, '02-novo-levantamento', vp);
  await modal(page).locator('[name=cli_nome]').fill('Joana Prado');
  await modal(page).locator('[name=cli_empresa]').fill('Padaria Prado');
  await modal(page).locator('[name=cli_email]').fill('joana@padariaprado.com.br');
  await modal(page).locator('[name=prj_nome]').fill('Gestão de encomendas');
  await modal(page).locator('[name=observacoes_iniciais]').fill('Reunião presencial na loja.');
  await submitModal(page, 'Criar e abrir a entrevista');
  check(/#\/levantamentos\/\d+/.test(page.url()), 'Criar levantamento abre a entrevista');
  const surveyUrl = page.url().split('?')[0];
  const surveyId = surveyUrl.match(/levantamentos\/(\d+)/)[1];

  // Etapa 1: responder a obrigatória e mais uma; autosave
  const qs = page.locator('.lr-stage .lr-q');
  await qs.nth(0).locator('textarea').fill('Hoje os pedidos chegam pelo WhatsApp e são anotados num caderno. Queremos um sistema para organizar encomendas.');
  await waitSaved(page);
  check(/Salvo às/.test(await page.locator('.lr-save').innerText()), 'Autosave mostra "Salvo às…"');
  await qs.nth(1).locator('textarea').fill('Depois de duas encomendas de casamento esquecidas.');
  await qs.nth(2).locator('.lr-skip').click();
  check(await qs.nth(2).locator('.chip', { hasText: 'Pulada' }).count(), 'Pular pergunta marca como pulada');
  await page.locator('.lr-note textarea').fill('Cliente muito objetiva; trouxe exemplos de pedidos.');
  await page.waitForTimeout(1500);
  await waitSaved(page);
  await shoot(page, problems, '03-entrevista-etapa1', vp);

  // Avançar para a etapa 2 (botão "Avançar") e responder escolha múltipla
  await page.locator('.lr-stage-nav .btn-primary').click();
  await settle(page);
  check((await page.locator('.lr-stage h2').innerText()).length > 0 && await page.locator('.lr-stage-btn.is-current .lr-stage-n').innerText() === '2', 'Avançar leva à etapa 2');
  await qs.nth(0).locator('textarea').fill('Pedidos esquecidos e divergência de valores.');
  const multi = page.locator('.lr-stage .lr-q').filter({ has: page.locator('input[type=checkbox].btn-check') }).first();
  await multi.locator('.btn-option').nth(1).click();
  await multi.locator('.btn-option').nth(2).click();
  await waitSaved(page);
  await shoot(page, problems, '04-entrevista-etapa2', vp);

  // Responder as obrigatórias restantes (etapas 4 e 7)
  for (const n of [4, 7]) {
    await page.locator('.lr-stage-btn').nth(n - 1).click();
    await settle(page);
    const req = page.locator('.lr-stage .lr-q').filter({ has: page.locator('.lr-req') });
    for (let i = 0; i < await req.count(); i++) await answer(req.nth(i), 'A proprietária, a gerente e dois atendentes.');
  }
  await page.waitForTimeout(1200);
  await waitSaved(page);

  // Retomar: recarregar a página volta para a última etapa e mantém respostas
  await page.goto(`${surveyUrl}?aba=entrevista`);
  await page.reload();
  await settle(page);
  check(await page.locator('.lr-stage-btn.is-current .lr-stage-n').innerText() === '7', 'Retomar abre na última etapa trabalhada');
  await page.locator('.lr-stage-btn').first().click();
  check((await page.locator('.lr-stage .lr-q').first().locator('textarea').inputValue()).startsWith('Hoje os pedidos'), 'Resposta salva continua lá após recarregar');

  // 5 porquês
  await page.getByRole('tab', { name: '5 porquês' }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Nova investigação' }).click();
  await modal(page).waitFor();
  await modal(page).locator('[name=problema]').fill('Encomendas são entregues com atraso ou esquecidas.');
  await modal(page).locator('[name=r0]').fill('Porque a produção só descobre o pedido no dia.');
  await modal(page).locator('[name=r1]').fill('Porque o pedido fica no caderno do balcão.');
  await modal(page).locator('[name=r2]').fill('Porque não existe um registro comum de pedidos.');
  await modal(page).locator('[name=causa]').fill('Ausência de registro único de encomendas.');
  await submitModal(page, 'Salvar');
  check(await page.locator('.lr-why-chain li').count() === 3, '5 porquês grava 3 níveis');
  await shoot(page, problems, '05-cinco-porques', vp);

  // Revisão e consolidação
  await page.getByRole('tab', { name: 'Revisão e conclusão' }).click();
  await settle(page);
  await page.locator('#cons-resumo_executivo').fill('A Padaria Prado quer centralizar encomendas e produção num sistema simples.');
  await page.locator('#cons-problemas').fill('Pedidos dispersos entre WhatsApp e caderno.');
  await page.waitForTimeout(1600);
  await waitSaved(page);
  await shoot(page, problems, '06-revisao', vp);

  // Pré-visualização (HTML do relatório)
  const prev = await page.request.get(`${BASE}/api/admin/requisitos/levantamentos/${surveyId}/previa`);
  check(prev.ok() && (await prev.text()).includes('Padaria Prado'), 'Pré-visualização do relatório responde com o conteúdo');
  const pp = await ctx.newPage();
  await pp.goto(`${BASE}/api/admin/requisitos/levantamentos/${surveyId}/previa`);
  await pp.waitForLoadState('networkidle');
  await pp.screenshot({ path: path.join(OUT, '07-previa-desktop.png'), fullPage: false });
  await pp.close();

  // Concluir
  await page.getByRole('button', { name: 'Concluir levantamento' }).click();
  await modal(page).waitFor();
  await submitModal(page, 'Concluir');
  check(await page.locator('.alert-success', { hasText: 'concluída em' }).waitFor({ timeout: 10000 }).then(() => true, () => false), 'Conclusão trava a versão 1');
  await shoot(page, problems, '08-concluido', vp);

  // Gerar PDF
  await page.getByRole('tab', { name: 'Relatórios PDF' }).click();
  await settle(page);
  const popup = ctx.waitForEvent('page', { timeout: 60000 }).catch(() => null);
  await page.getByRole('button', { name: /Gerar PDF da versão 1/ }).click();
  const pdfPage = await popup;
  await pdfPage?.close();
  await page.locator('.lr-file').first().waitFor({ timeout: 60000 });
  check(/levantamento-requisitos-joana-prado-gestao-de-encomendas\.pdf/.test(await page.locator('.lr-file').first().innerText()), 'PDF gerado com o nome padronizado');
  await shoot(page, problems, '09-relatorios', vp);

  // Questionário em Word para o cliente
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('.lr-docx').getByRole('button', { name: 'Em branco' }).click();
  const file = await dl;
  check(file.suggestedFilename() === 'questionario-joana-prado-gestao-de-encomendas.docx', 'Baixa o questionário em Word com nome padronizado');

  // Reabrir → versão 2
  await page.getByRole('tab', { name: 'Revisão e conclusão' }).click();
  await settle(page);
  await page.getByRole('button', { name: 'Reabrir para edição' }).click();
  await modal(page).waitFor();
  await modal(page).locator('[name=motivo]').fill('Cliente enviou novas informações sobre as entregas.');
  await submitModal(page, 'Criar versão 2');
  check(await page.locator('.lr-eyebrow', { hasText: /versão 2/i }).first().waitFor({ timeout: 10000 }).then(() => true, () => false), 'Reabrir cria a versão 2');
  await page.locator('.lr-stage .lr-q').nth(1).locator('textarea').fill('Depois de duas encomendas de casamento esquecidas em outubro.');
  await waitSaved(page);
  await page.getByRole('tab', { name: 'Versões e histórico' }).click();
  await settle(page);
  check(await page.locator('table').first().locator('tbody tr').count() === 2, 'Versões lista v1 (concluída) e v2');
  await shoot(page, problems, '10-versoes-historico', vp);

  // Consultar a versão 1 (somente leitura)
  await page.goto(`${surveyUrl}?versao=1&aba=entrevista`);
  await settle(page);
  check(await page.locator('.lr-stage textarea[disabled]').count() > 0 && /consultando a versão 1/.test(await page.locator('.alert-info').innerText()), 'Versão 1 abre somente leitura');
  check(!(await page.locator('.lr-stage .lr-q').nth(1).locator('textarea').inputValue()).includes('outubro'), 'Versão 1 preserva a resposta anterior');

  // Comparar v1 x v2
  await page.goto(`${BASE}/admin#/levantamentos/comparar?a=${surveyId}:1&b=${surveyId}:2`);
  await settle(page);
  check(await page.locator('.lr-cmp-diff').count() >= 1, 'Comparação mostra a diferença entre versões');
  await shoot(page, problems, '11-comparar', vp);

  // Duplicar a partir da lista
  await page.goto(`${BASE}/admin#/levantamentos`);
  await settle(page);
  await page.locator('.lr-row-actions button[title="Duplicar"]').first().click();
  await modal(page).waitFor();
  await submitModal(page, 'Duplicar');
  check(/#\/levantamentos\/\d+/.test(page.url()) && !page.url().includes(`/levantamentos/${surveyId}`), 'Duplicar cria outro levantamento');
  check(await page.locator('.lr-q.is-answered').count() === 0, 'Duplicado não copia respostas');
  await page.goto(`${BASE}/admin#/levantamentos`);
  await shoot(page, problems, '12-lista', vp);

  // Banco de perguntas: nova pergunta de seleção única
  await page.goto(`${BASE}/admin#/levantamentos/perguntas`);
  await settle(page);
  await shoot(page, problems, '13-banco-perguntas', vp);
  await page.getByRole('button', { name: 'Nova pergunta' }).click();
  await modal(page).waitFor();
  await modal(page).locator('[name=enunciado]').fill('Qual é o horário de pico de pedidos?');
  await modal(page).locator('[name=tipo]').selectOption('selecao_unica');
  await modal(page).locator('[name=opcoes]').fill('Manhã\nTarde\nNoite');
  await shoot(page, problems, '14-nova-pergunta', vp);
  await submitModal(page, 'Salvar');
  check(await page.getByText('Qual é o horário de pico de pedidos?').count(), 'Nova pergunta aparece no banco');
  await page.getByRole('tab', { name: 'Categorias' }).click();
  await shoot(page, problems, '15-categorias', vp);

  // Cliente e projeto
  await page.goto(`${BASE}/admin#/levantamentos?aba=clientes`);
  await shoot(page, problems, '16-clientes', vp);
  await page.locator('.data-table a').first().click();
  await shoot(page, problems, '17-cliente', vp);
  await page.locator('a[href^="#/levantamentos/projeto/"]').first().click();
  await shoot(page, problems, '18-projeto', vp);
  await ctx.close();
  report.surveyId = surveyId;
}

// ------------------------------------------------------------------ celular (390 px)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const problems = watch(page);
  const vp = 'celular';
  await login(page);
  const id = report.surveyId;
  const shots = [
    ['01-lista', 'levantamentos'], ['03-entrevista', `levantamentos/${id}?aba=entrevista`], ['05-cinco-porques', `levantamentos/${id}?aba=porques`],
    ['06-revisao', `levantamentos/${id}?aba=revisao`], ['09-relatorios', `levantamentos/${id}?aba=relatorios`], ['10-versoes-historico', `levantamentos/${id}?aba=versoes`],
    ['11-comparar', `levantamentos/comparar?a=${id}:1&b=${id}:2`], ['13-banco-perguntas', 'levantamentos/perguntas'], ['16-clientes', 'levantamentos?aba=clientes'],
    ['17-cliente', 'levantamentos/cliente/1'], ['18-projeto', 'levantamentos/projeto/1']
  ];
  for (const [name, route] of shots) {
    await page.goto(`${BASE}/admin#/${route}`);
    await shoot(page, problems, name, vp);
  }
  await page.goto(`${BASE}/admin#/levantamentos`);
  await settle(page);
  await page.getByRole('button', { name: 'Novo levantamento' }).click();
  await modal(page).waitFor();
  await shoot(page, problems, '02-novo-levantamento', vp);
  await ctx.close();
}
await browser.close();
writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(report, null, 2));
const bad = report.telas.filter((t) => t.acessibilidade.length || t.rolagemHorizontalPx > 0 || t.console.length || t.requisicoes.length);
console.log(`\n${report.telas.length} capturas, ${bad.length} com apontamentos; ${report.verificacoes.filter((v) => !v.ok).length} verificação(ões) falhando.`);
