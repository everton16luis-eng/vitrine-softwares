// Relatório de descoberta e levantamento de requisitos — modelo visual próprio, no sistema
// "prancha técnica" (DESIGN.md): papel, tinta, filetes, carimbo e o vermelhão como marca de revisão.
//
// O mesmo HTML serve para:
//   - pré-visualização no painel (mode 'preview'): CSS e tema por arquivo, por causa da CSP;
//   - PDF (mode 'pdf'): tudo embutido (CSS, fonte, tema, logo) e regras @page com cabeçalho,
//     rodapé institucional e numeração "Página X de Y".
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { html, raw, escapeHtml } from '../../utils/html.js';
import { themeCss } from '../../views/theme.js';
import { PUBLIC_DIR } from '../../services/storage/local.js';
import { formatAnswer, isAnswered } from './answers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '../../../../frontend/public');
const CSS_FILE = path.join(FRONTEND, 'assets/css/relatorio-requisitos.css');
const FONT_FILE = path.join(FRONTEND, 'assets/fonts/archivo/archivo-latin-standard-normal.woff2');

export const LEGAL_NOTE = 'Este documento representa o levantamento inicial de informações e necessidades do cliente. Seu conteúdo servirá como base para a análise, especificação e validação dos requisitos do projeto. Não constitui, isoladamente, uma especificação técnica definitiva nem representa aprovação de escopo ou orçamento.';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function longDate(value) {
  if (!value) return '—';
  const s = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const [y, m, d] = s.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

// ------------------------------------------------------------------ texto rico seguro
const URL_RE = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;

/** Escapa, transforma URLs/e-mails em links e preserva parágrafos e quebras de linha. */
export function richText(text) {
  const s = String(text ?? '').trim();
  if (!s) return raw('');
  const linkify = (chunk) => {
    let out = '';
    let last = 0;
    for (const m of chunk.matchAll(URL_RE)) {
      let token = m[0];
      const trail = /[.,;:!?)\]]+$/.exec(token)?.[0] || '';
      if (trail) token = token.slice(0, -trail.length);
      out += escapeHtml(chunk.slice(last, m.index));
      const href = token.includes('@') && !/^https?:/i.test(token) ? `mailto:${token}` : /^www\./i.test(token) ? `https://${token}` : token;
      out += `<a href="${escapeHtml(href)}">${escapeHtml(token)}</a>`;
      last = m.index + token.length;
    }
    return out + escapeHtml(chunk.slice(last));
  };
  const ITEM = /^\s*([-*•]|\d+[.)])\s+/;
  const paragraphs = s.split(/\n{2,}/).map((p) => {
    // Linhas consecutivas de lista ("- item", "1. item") viram <ul>; as demais, parágrafo.
    const out = [];
    let text = [];
    let items = [];
    const flushText = () => { if (text.length) out.push(`<p>${text.map(linkify).join('<br>')}</p>`); text = []; };
    const flushItems = () => { if (items.length) out.push(`<ul>${items.map((l) => `<li>${linkify(l.replace(ITEM, ''))}</li>`).join('')}</ul>`); items = []; };
    for (const line of p.split('\n')) {
      if (ITEM.test(line)) { flushText(); items.push(line); } else { flushItems(); text.push(line); }
    }
    flushText();
    flushItems();
    return out.join('');
  });
  return raw(paragraphs.join(''));
}

const excerpt = (s, n = 320) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t;
};

// ------------------------------------------------------------------ modelo do relatório
/** Prepara números, referências cruzadas e totais. Também calcula a impressão digital do conteúdo. */
export function buildReportModel(s, settings, { emitidoEm = new Date() } = {}) {
  const etapas = s.etapas.map((e) => ({
    ...e,
    numero: e.ordem,
    perguntas: e.perguntas.map((q) => ({ ...q, ref: `${e.ordem}.${q.ordem}`, texto: formatAnswer(q, q.resposta), respondida: isAnswered(q.resposta), pulada: Boolean(q.resposta?.pulada) }))
  }));
  const all = etapas.flatMap((e) => e.perguntas);
  const cons = s.versao.consolidacao || {};
  const categorias = (s.categorias || []).filter((c) => c.chave !== 'contexto').map((c) => ({
    ...c,
    sintese: cons[c.chave] || '',
    relacionadas: all.filter((q) => q.categoria_chave === c.chave && q.respondida)
  }));
  const contexto = all.filter((q) => q.categoria_chave === 'contexto' && q.respondida);
  const pendentes = all.filter((q) => !q.respondida);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    id: s.id, versao: s.versao.numero, status: s.versao.status, cliente: [s.cliente_nome, s.cliente_empresa, s.cliente_email, s.cliente_telefone],
    projeto: [s.projeto_nome, s.projeto_descricao], cabecalho: [s.data_reuniao, s.responsavel_nome, s.observacoes_iniciais],
    respostas: all.map((q) => [q.id, q.resposta?.valor ?? null, q.pulada]), notas: etapas.map((e) => e.nota), investigacoes: s.investigacoes.map((i) => [i.problema, i.niveis, i.causa, i.observacoes]),
    consolidacao: cons, finais: s.versao.observacoes_finais
  })).digest('hex');
  return {
    s, settings, etapas, categorias, contexto, pendentes, fingerprint,
    totais: { perguntas: all.length, respondidas: all.filter((q) => q.respondida).length, puladas: all.filter((q) => q.pulada).length, investigacoes: s.investigacoes.length },
    empresa: settings.nome_comercial || settings.razao_social || 'Empresa',
    emitidoEm,
    rascunho: s.versao.status !== 'concluida'
  };
}

// ------------------------------------------------------------------ partes do documento
function logoBlock(m, logoSrc, cls) {
  return logoSrc
    ? html`<img class="${cls}-logo" src="${logoSrc}" alt="${m.empresa}">`
    : html`<span class="${cls}-mark" aria-hidden="true"></span>`;
}

function cover(m, logoSrc) {
  const { s } = m;
  return html`<section class="capa" aria-label="Capa">
    <div class="capa-quadro">
      <span class="registro r-tl"></span><span class="registro r-tr"></span><span class="registro r-bl"></span><span class="registro r-br"></span>
      <header class="capa-topo">
        ${logoBlock(m, logoSrc, 'capa')}
        <span class="capa-empresa">${m.empresa}</span>
      </header>
      <div class="capa-titulo">
        <span class="capa-revisao" aria-hidden="true"></span>
        <h1>Relatório de descoberta e levantamento de requisitos</h1>
        <p class="capa-projeto">${s.projeto_nome}</p>
        <p class="capa-cliente">${s.cliente_empresa ? `${s.cliente_nome} · ${s.cliente_empresa}` : s.cliente_nome}</p>
      </div>
      <dl class="carimbo capa-carimbo">
        <div class="span-2"><dt>Cliente</dt><dd>${s.cliente_nome}${s.cliente_empresa ? html`<span class="sub">${s.cliente_empresa}</span>` : ''}</dd></div>
        <div class="span-2"><dt>Projeto</dt><dd>${s.projeto_nome}</dd></div>
        <div><dt>Data da entrevista</dt><dd>${longDate(s.data_reuniao)}</dd></div>
        <div><dt>Responsável pelo levantamento</dt><dd>${s.responsavel_nome}</dd></div>
        <div><dt>Documento</dt><dd>${s.codigo} · versão ${s.versao.numero}</dd></div>
        <div><dt>Situação</dt><dd>${m.rascunho ? html`<span class="selo selo-rascunho">Rascunho — versão em trabalho</span>` : html`<span class="selo">Versão concluída</span>`}</dd></div>
      </dl>
    </div>
  </section>`;
}

function sectionTitle(n, title, lead) {
  return html`<header class="secao-titulo"><span class="secao-num">${String(n).padStart(2, '0')}</span><div><h2>${title}</h2>${lead ? html`<p>${lead}</p>` : ''}</div></header>`;
}

function identification(m) {
  const { s, totais } = m;
  const cons = s.versao.consolidacao || {};
  const tel = s.cliente_telefone ? `tel:${s.cliente_telefone.replace(/[^\d+]/g, '')}` : null;
  const contextoTexto = cons.contexto
    ? richText(cons.contexto)
    : m.contexto.length
      ? html`${m.contexto.map((q) => html`<div class="citacao"><p class="citacao-ref">${q.ref} · ${q.enunciado}</p>${richText(q.texto)}</div>`)}`
      : html`<p class="vazio">Contexto não registrado.</p>`;
  const objetivos = m.categorias.find((c) => c.chave === 'objetivos');
  const objetivoTexto = cons.objetivo
    ? richText(cons.objetivo)
    : objetivos?.relacionadas.length
      ? html`<ul class="lista-refs">${objetivos.relacionadas.slice(0, 4).map((q) => html`<li><span class="ref">${q.ref}</span><span>${excerpt(q.texto, 420)}</span></li>`)}</ul>`
      : html`<p class="vazio">Objetivo inicial não registrado.</p>`;
  const pct = totais.perguntas ? Math.round((totais.respondidas / totais.perguntas) * 100) : 0;
  return html`<section class="secao secao-quebra" id="identificacao">
    ${sectionTitle(1, 'Identificação do projeto', 'Quem é o cliente, de onde vem a ideia e o que se espera dela.')}
    <dl class="carimbo">
      <div class="span-2"><dt>Cliente</dt><dd>${s.cliente_nome}</dd></div>
      <div class="span-2"><dt>Empresa</dt><dd>${s.cliente_empresa || '—'}</dd></div>
      <div class="span-2"><dt>E-mail</dt><dd>${s.cliente_email ? html`<a href="mailto:${s.cliente_email}">${s.cliente_email}</a>` : '—'}</dd></div>
      <div class="span-2"><dt>Telefone</dt><dd>${tel ? html`<a href="${tel}">${s.cliente_telefone}</a>` : '—'}</dd></div>
      <div class="span-4"><dt>Projeto ou ideia</dt><dd>${s.projeto_nome}${s.projeto_descricao ? html`<span class="sub">${excerpt(s.projeto_descricao, 400)}</span>` : ''}</dd></div>
      <div class="span-2"><dt>Data da entrevista</dt><dd>${longDate(s.data_reuniao)}</dd></div>
      <div class="span-2"><dt>Responsável pelo levantamento</dt><dd>${s.responsavel_nome}</dd></div>
    </dl>

    <div class="indicadores">
      <div><strong>${totais.perguntas}</strong><span>perguntas no roteiro</span></div>
      <div><strong>${totais.respondidas}</strong><span>respondidas (${pct}%)</span></div>
      <div><strong>${totais.perguntas - totais.respondidas}</strong><span>sem resposta</span></div>
      <div><strong>${totais.investigacoes}</strong><span>investigação${totais.investigacoes === 1 ? '' : 'ões'} de problemas</span></div>
    </div>

    <div class="manter"><h3>Resumo executivo</h3>
    <div class="texto destaque">${cons.resumo_executivo ? richText(cons.resumo_executivo) : html`<p class="vazio">O resumo executivo ainda não foi redigido pelo responsável.</p>`}</div></div>

    <div class="manter"><h3>Panorama da entrevista</h3>
    <table class="tabela">
      <thead><tr><th>Etapa</th><th class="n">Perguntas</th><th class="n">Respondidas</th><th class="n">Sem resposta</th><th>Observações</th></tr></thead>
      <tbody>${m.etapas.map((e) => {
        const r = e.perguntas.filter((q) => q.respondida).length;
        return html`<tr><td><span class="ref">${e.numero}</span> ${e.titulo}</td><td class="n">${e.perguntas.length}</td><td class="n">${r}</td><td class="n">${e.perguntas.length - r || '—'}</td><td>${e.nota ? 'Registradas' : '—'}</td></tr>`;
      })}</tbody>
    </table></div>

    <div class="manter"><h3>Contextualização da ideia</h3><div class="texto">${contextoTexto}</div></div>
    <div class="manter"><h3>Objetivo inicial</h3><div class="texto">${objetivoTexto}</div></div>
    ${s.observacoes_iniciais ? html`<div class="manter"><h3>Observações iniciais</h3><div class="texto">${richText(s.observacoes_iniciais)}</div></div>` : ''}
  </section>`;
}

function answerBlock(q) {
  const long = (q.texto || '').length > 900;
  const status = q.respondida ? '' : q.pulada ? 'Pulada durante a entrevista' : 'Sem resposta registrada';
  return html`<article class="qa${long ? ' qa-longa' : ''}">
    <header class="qa-pergunta"><span class="ref">${q.ref}</span><h4>${q.enunciado}${q.obrigatoria ? html`<span class="obrig" title="Obrigatória"> *</span>` : ''}</h4></header>
    ${q.respondida
      ? html`<div class="qa-resposta tipo-${q.tipo}">${q.tipo === 'texto_longo' || q.tipo === 'observacoes' || q.tipo === 'texto_curto'
        ? richText(q.texto)
        : answerStructured(q)}</div>`
      : html`<div class="qa-resposta qa-vazia"><span class="selo selo-vazio">${status}</span></div>`}
  </article>`;
}

function answerStructured(q) {
  const { valor, detalhe } = q.resposta.valor;
  let main = '';
  if (valor !== null && valor !== undefined) {
    if (q.tipo === 'selecao_multipla') main = html`<ul class="escolhas">${q.opcoes.map((o) => html`<li class="${valor.includes(o) ? 'on' : 'off'}">${o}</li>`)}</ul>`;
    else if (q.tipo === 'selecao_unica') main = html`<ul class="escolhas">${q.opcoes.map((o) => html`<li class="${o === valor ? 'on' : 'off'}">${o}</li>`)}</ul>`;
    else if (q.tipo === 'sim_nao') main = html`<p class="valor">${valor === 'sim' ? 'Sim' : 'Não'}</p>`;
    else main = html`<p class="valor">${formatAnswer({ tipo: q.tipo }, { valor: { valor, detalhe: null } })}</p>`;
  }
  return html`${main}${detalhe ? html`<div class="complemento">${richText(detalhe)}</div>` : ''}`;
}

function discovery(m) {
  return html`<section class="secao" id="descoberta">
    ${sectionTitle(2, 'Descoberta', 'Perguntas do roteiro aplicado nesta entrevista e as respostas registradas, etapa por etapa.')}
    ${m.etapas.map((e) => html`<section class="etapa">
      <div class="manter">
        <header class="etapa-titulo"><span class="etapa-num">Etapa ${e.numero}</span><h3>${e.titulo}</h3></header>
        ${e.descricao ? html`<p class="etapa-desc">${e.descricao}</p>` : ''}
        ${e.perguntas[0] ? answerBlock(e.perguntas[0]) : ''}
      </div>
      ${e.perguntas.slice(1).map(answerBlock)}
      ${e.nota ? html`<aside class="nota"><p class="nota-titulo">Observações do entrevistador</p>${richText(e.nota)}</aside>` : ''}
    </section>`)}
  </section>`;
}

function investigations(m) {
  const list = m.s.investigacoes;
  return html`<section class="secao" id="investigacao">
    ${sectionTitle(3, 'Investigação de problemas — 5 porquês', 'Problemas aprofundados durante a entrevista, da manifestação até a causa provável.')}
    ${list.length ? list.map((inv, i) => html`<article class="porques">
      <div class="manter">
        <p class="porques-rotulo">Problema ${i + 1}</p>
        <div class="porques-problema">${richText(inv.problema)}</div>
      </div>
      <ol class="porques-cadeia">${(inv.niveis || []).map((n, j) => html`<li><span class="porques-n">${j + 1}</span><div><p class="porques-p">${n.pergunta}</p>${n.resposta ? richText(n.resposta) : html`<p class="vazio">Sem resposta.</p>`}</div></li>`)}</ol>
      <div class="porques-causa"><p class="porques-rotulo">Causa identificada</p>${inv.causa ? richText(inv.causa) : html`<p class="vazio">Causa ainda não identificada.</p>`}</div>
      ${inv.observacoes ? html`<div class="porques-obs"><p class="porques-rotulo">Observações do entrevistador</p>${richText(inv.observacoes)}</div>` : ''}
    </article>`) : html`<p class="vazio">Nenhuma investigação de problemas foi registrada nesta entrevista.</p>`}
  </section>`;
}

function consolidation(m) {
  return html`<section class="secao" id="consolidacao">
    ${sectionTitle(4, 'Consolidação', 'Síntese do entrevistador e respostas relacionadas, organizadas por tema.')}
    ${m.categorias.map((c) => html`<section class="tema">
      <div class="manter">
        <h3>${c.titulo}</h3>
        ${c.sintese ? html`<div class="texto">${richText(c.sintese)}</div>` : ''}
        ${!c.sintese && !c.relacionadas.length && c.chave !== 'duvidas' ? html`<p class="vazio">Nada registrado sobre este tema.</p>` : ''}
      </div>
      ${c.relacionadas.length && c.sintese ? html`<p class="refs-inline">Base nas respostas ${c.relacionadas.map((q) => q.ref).join(', ')} da seção 2.</p>` : ''}
      ${c.relacionadas.length && !c.sintese ? html`<ul class="lista-refs">${c.relacionadas.map((q) => html`<li><span class="ref">${q.ref}</span><span><span class="lista-q">${q.enunciado}</span> ${excerpt(q.texto, 220)}</span></li>`)}</ul>` : ''}
      ${c.chave === 'duvidas' && m.pendentes.length ? html`<div class="pendencias"><p class="porques-rotulo">Perguntas do roteiro sem resposta (${m.pendentes.length})</p>
        <ul class="lista-refs">${m.pendentes.map((q) => html`<li><span class="ref">${q.ref}</span><span>${q.enunciado}${q.pulada ? ' (pulada)' : ''}</span></li>`)}</ul></div>` : ''}
    </section>`)}
  </section>`;
}

function closing(m) {
  const { s, settings } = m;
  const site = env.appUrl && !/localhost|127\.0\.0\.1/.test(env.appUrl) ? env.appUrl : null;
  return html`<section class="secao" id="encerramento">
    ${sectionTitle(5, 'Encerramento')}
    <h3>Observações finais</h3>
    <div class="texto">${s.versao.observacoes_finais ? richText(s.versao.observacoes_finais) : html`<p class="vazio">Sem observações finais.</p>`}</div>
    <div class="fecho">
    <aside class="nota-legal"><p class="nota-titulo">Natureza deste documento</p><p>${LEGAL_NOTE}</p></aside>
    <dl class="carimbo carimbo-final">
      <div class="span-2"><dt>Empresa desenvolvedora</dt><dd>${settings.razao_social || m.empresa}${settings.razao_social && settings.nome_comercial && settings.razao_social !== settings.nome_comercial ? html`<span class="sub">${settings.nome_comercial}</span>` : ''}${settings.documento_empresa ? html`<span class="sub">CNPJ/CPF ${settings.documento_empresa}</span>` : ''}</dd></div>
      <div class="span-2"><dt>Contato</dt><dd>${[
        settings.email_contato ? html`<a href="mailto:${settings.email_contato}">${settings.email_contato}</a>` : null,
        settings.telefone ? html`<a href="tel:${settings.telefone.replace(/[^\d+]/g, '')}">${settings.telefone}</a>` : null,
        site ? html`<a href="${site}">${site.replace(/^https?:\/\//, '')}</a>` : null
      ].filter(Boolean).map((x, i) => html`${i ? html`<br>` : ''}${x}`)}${!settings.email_contato && !settings.telefone && !site ? '—' : ''}</dd></div>
      <div><dt>Data de emissão</dt><dd>${longDate(m.emitidoEm)}</dd></div>
      <div><dt>Documento</dt><dd>${s.codigo}</dd></div>
      <div><dt>Versão do levantamento</dt><dd>${s.versao.numero} · ${m.rascunho ? 'em trabalho (rascunho)' : `concluída em ${longDate(s.versao.concluida_em)}`}</dd></div>
      <div><dt>Impressão digital do conteúdo</dt><dd class="mono">${m.fingerprint.slice(0, 16)}</dd></div>
    </dl>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ montagem
const cssString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

/** Regras @page com textos do documento (só no PDF, onde o CSS vai embutido). */
function pageRules(m) {
  const left = `${m.empresa} · Relatório de descoberta`;
  const right = `${m.s.codigo} · versão ${m.s.versao.numero}${m.rascunho ? ' · rascunho' : ''}`;
  const foot = `${m.s.cliente_nome} — ${m.s.projeto_nome}`;
  return `@page { @top-left { content: ${cssString(left)}; } @top-right { content: ${cssString(right)}; } @bottom-left { content: ${cssString(foot.length > 90 ? `${foot.slice(0, 88)}…` : foot)}; } }`;
}

let cssCache;
let fontCache;
async function inlineAssets() {
  if (!cssCache || !env.isProduction) cssCache = await readFile(CSS_FILE, 'utf8');
  if (!fontCache) fontCache = (await readFile(FONT_FILE)).toString('base64');
  return cssCache.replace(/url\((["']?)\/assets\/fonts\/archivo\/archivo-latin-standard-normal\.woff2\1\)/g, `url(data:font/woff2;base64,${fontCache})`);
}

/** Logo em data URI para o PDF (sem rede no navegador). Aceita arquivos do próprio site ou URL https. */
export async function logoDataUri(logoUrl) {
  if (!logoUrl) return null;
  const mimeOf = (name) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' }[String(name).split('?')[0].split('.').pop().toLowerCase()]);
  try {
    if (logoUrl.startsWith('/')) {
      const rel = decodeURIComponent(logoUrl.split('?')[0]);
      const base = rel.startsWith('/uploads/') ? PUBLIC_DIR : FRONTEND;
      const file = path.resolve(base, `.${rel.startsWith('/uploads/') ? rel.slice('/uploads'.length) : rel}`);
      if (!file.startsWith(base + path.sep)) return null;
      const mime = mimeOf(file);
      if (!mime) return null;
      const buf = await readFile(file);
      return buf.length <= 2 * 1024 * 1024 ? `data:${mime};base64,${buf.toString('base64')}` : null;
    }
    if (/^https:\/\//i.test(logoUrl)) {
      const res = await fetch(logoUrl, { signal: AbortSignal.timeout(5000), redirect: 'follow' });
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(mime)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= 2 * 1024 * 1024 ? `data:${mime};base64,${buf.toString('base64')}` : null;
    }
  } catch { /* sem logo: usa a marca de registro */ }
  return null;
}

/**
 * @param {object} model  resultado de buildReportModel
 * @param {object} opts   { mode: 'preview'|'pdf', logoSrc, toolbar }
 */
export async function renderReport(model, { mode = 'preview', logoSrc = null, toolbar = null } = {}) {
  const { s } = model;
  const title = `Levantamento de requisitos — ${s.cliente_nome} — ${s.projeto_nome}`;
  const head = mode === 'pdf'
    ? html`<style>${raw(await inlineAssets())}</style><style>${raw(themeCss(model.settings))}${raw(pageRules(model))}</style>`
    : html`<link rel="stylesheet" href="/assets/css/relatorio-requisitos.css"><link rel="stylesheet" href="/theme.css">`;
  const body = html`${cover(model, logoSrc)}${identification(model)}${discovery(model)}${investigations(model)}${consolidation(model)}${closing(model)}`;
  return `<!doctype html>${html`<html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${title}</title>
    <meta name="author" content="${model.empresa}">
    <meta name="description" content="Relatório de descoberta e levantamento de requisitos ${s.codigo}, versão ${s.versao.numero}.">
    ${head}
  </head><body class="relatorio ${mode === 'pdf' ? 'modo-pdf' : 'modo-previa'}">
    ${toolbar ? raw(toolbar) : ''}
    <main class="doc">${body}</main>
  </body></html>`}`;
}
