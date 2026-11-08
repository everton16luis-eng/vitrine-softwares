// Conversão HTML → PDF com o Chrome/Chromium instalado no servidor (via playwright-core, que não
// baixa navegador). O documento é montado pelo próprio sistema com tudo embutido (CSS, fonte e
// logo em data URI); o navegador roda sem JavaScript e sem acesso à rede.
//
// Caminho do navegador: PDF_CHROME_PATH no .env ou detecção automática dos locais comuns.
// Um PDF por vez (fila), com tempo limite, para não sobrecarregar o servidor.
import { existsSync } from 'node:fs';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const CANDIDATES = [
  '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

let detected;
export function findBrowser() {
  if (detected !== undefined) return detected;
  if (env.pdf.chromePath) detected = existsSync(env.pdf.chromePath) ? env.pdf.chromePath : null;
  else detected = CANDIDATES.find((p) => existsSync(p)) || null;
  return detected;
}

let playwright;
async function loadPlaywright() {
  if (playwright !== undefined) return playwright;
  try { playwright = await import('playwright-core'); } catch { playwright = null; }
  return playwright;
}

export async function pdfStatus() {
  const pw = await loadPlaywright();
  const browser = findBrowser();
  return { disponivel: Boolean(pw && browser), navegador: browser ? browser.split(/[\\/]/).pop() : null, biblioteca: Boolean(pw) };
}

let queue = Promise.resolve();

/**
 * Gera o PDF. `footer`: rodapé de reserva (texto) para navegadores sem suporte a margens de
 * página do CSS (Chrome < 131); nos atuais a numeração vem do próprio documento (@page).
 * Devolve { buffer, paginas, navegador }.
 */
export function htmlToPdf(html, { timeoutMs = env.pdf.timeoutMs, footer = null } = {}) {
  const job = queue.then(() => render(html, { timeoutMs, footer }));
  queue = job.catch(() => {});
  return job;
}

async function render(html, { timeoutMs, footer }) {
  const pw = await loadPlaywright();
  const executablePath = findBrowser();
  if (!pw || !executablePath) {
    throw new AppError('Geração de PDF indisponível: instale o Google Chrome/Chromium no servidor ou defina PDF_CHROME_PATH no .env.', { status: 503, code: 'PDF_INDISPONIVEL' });
  }
  let browser;
  const timer = setTimeout(() => browser?.close().catch(() => {}), timeoutMs);
  try {
    browser = await pw.chromium.launch({
      executablePath,
      headless: true,
      timeout: timeoutMs,
      args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--font-render-hinting=none']
    });
    const major = Number(String(browser.version()).split('.')[0]) || 0;
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true, locale: 'pt-BR' });
    await context.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const legacy = major && major < 131 && footer;
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: Boolean(legacy),
      headerTemplate: '<span></span>',
      footerTemplate: legacy ? `<div style="width:100%;font:8px Arial,sans-serif;color:#555;padding:0 18mm;display:flex;justify-content:space-between"><span>${escapeTpl(footer)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>` : '<span></span>',
      tagged: true,
      outline: true
    });
    return { buffer, paginas: countPages(buffer), navegador: browser.version() };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`Não foi possível gerar o PDF: ${String(err.message || err).split('\n')[0]}`, { status: 500, code: 'PDF_FALHOU' });
  } finally {
    clearTimeout(timer);
    await browser?.close().catch(() => {});
  }
}

const escapeTpl = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Conta as páginas a partir da árvore de páginas do PDF (/Type /Pages … /Count n). */
export function countPages(buffer) {
  const s = buffer.toString('latin1');
  let max = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)) max = Math.max(max, Number(m[1] || m[2]));
  if (max) return max;
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length || null;
}
