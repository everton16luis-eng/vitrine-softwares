// Renderizador Markdown mínimo e seguro: todo o texto é escapado antes da
// formatação; nenhuma tag HTML digitada pelo editor é preservada.
// Suporta: #..#### títulos, parágrafos, listas (- * 1.), **negrito**, *itálico*,
// `código`, [links](https://...), > citações e linhas horizontais (---).
import { escapeHtml } from './html.js';

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
    // href já está escapado; aceitar apenas esquemas seguros
    const ok = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href);
    if (!ok) return label;
    const external = /^https?:\/\//i.test(href);
    return `<a href="${href}"${external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${label}</a>`;
  });
  return s;
}

export function renderMarkdown(source = '') {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { type: 'ul'|'ol', items: [] }
  let quote = [];

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; }
  };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { flushAll(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.+)$/))) {
      flushAll();
      const level = Math.min(m[1].length + 1, 5); // # vira h2 (h1 é o título da página)
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushAll(); out.push('<hr>');
    } else if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
      flushPara(); flushQuote();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.+)$/))) {
      flushPara(); flushQuote();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); flushList(); quote.push(m[1]);
    } else {
      flushList(); flushQuote(); para.push(line.trim());
    }
  }
  flushAll();
  return out.join('\n');
}

/** Texto puro a partir de Markdown (para meta descriptions). */
export function markdownToText(source = '', max = 160) {
  const text = String(source).replace(/[#>*`_[\]()-]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
