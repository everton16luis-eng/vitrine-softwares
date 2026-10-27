import { html, raw, safeUrl } from '../utils/html.js';
import { formatMoney } from '../utils/money.js';
import { STATUS_COMERCIAL, MODELOS_CONTRATACAO, CONTRATAVEL } from '../modules/products/products.constants.js';

const STATUS_TONE = {
  em_planejamento: 'neutral', em_desenvolvimento: 'info', demonstracao_disponivel: 'accent',
  disponivel: 'success', em_manutencao: 'warning', arquivado: 'neutral'
};

export const statusBadge = (status) => html`<span class="status-badge tone-${STATUS_TONE[status] || 'neutral'}">${STATUS_COMERCIAL[status] || status}</span>`;

/** Linhas "Título | Descrição" (conteúdo editável) -> [{ titulo, descricao }]. */
export function parseLines(text = '') {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [titulo, ...rest] = l.split('|');
    return { titulo: titulo.trim(), descricao: rest.join('|').trim() };
  });
}

export function priceLabel(p) {
  if (p.preco === null || p.preco === undefined) return p.modelo_contratacao === 'personalizado' ? 'Sob medida' : 'Sob consulta';
  return `${p.preco_descricao ? `${p.preco_descricao} ` : ''}${formatMoney(p.preco, p.moeda)}`;
}

export function productCard(p, { headingLevel = 3 } = {}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const canHire = CONTRATAVEL.has(p.status_comercial);
  const demo = p.demo_disponivel && p.demo_tipo !== 'nenhuma';
  return html`<article class="product-card">
    <a class="product-card-media" href="/softwares/${p.slug}" tabindex="-1" aria-hidden="true">
      <img src="${safeUrl(p.capa_url)}" alt="" loading="lazy" decoding="async" width="640" height="400">
    </a>
    <div class="product-card-body">
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <span class="eyebrow">${p.categoria_nome}</span>
        ${statusBadge(p.status_comercial)}
      </div>
      ${raw(`<${H} class="product-card-title">`)}<a href="/softwares/${p.slug}">${p.nome}</a>${raw(`</${H}>`)}
      <p class="product-card-text">${p.resumo}</p>
      ${p.destaques?.length ? html`<ul class="check-list small">${p.destaques.map((d) => html`<li>${d}</li>`)}</ul>` : ''}
      <dl class="product-meta">
        <div><dt>Contratação</dt><dd>${MODELOS_CONTRATACAO[p.modelo_contratacao]}</dd></div>
        <div><dt>Investimento</dt><dd>${priceLabel(p)}</dd></div>
      </dl>
      ${p.dados_demonstrativos ? html`<p class="demo-flag"><i class="bi bi-info-circle" aria-hidden="true"></i> Projeto demonstrativo do portfólio</p>` : ''}
      <div class="product-card-actions">
        <a class="btn btn-primary-ink btn-sm" href="/softwares/${p.slug}">Conhecer</a>
        <a class="btn btn-outline-ink btn-sm" href="/orcamento?produto=${p.slug}">${canHire ? 'Contratar' : 'Solicitar orçamento'}</a>
        ${demo ? html`<a class="btn btn-link btn-sm" href="${p.demo_tipo === 'interna' ? `/softwares/${p.slug}/demonstracao` : safeUrl(p.demo_url)}"${p.demo_tipo === 'externa' ? raw(' target="_blank" rel="noopener noreferrer"') : ''}>Ver demonstração</a>` : ''}
      </div>
    </div>
  </article>`;
}

export function pager(result, basePath, params = {}) {
  if (result.pages <= 1) return '';
  const link = (page) => {
    const q = new URLSearchParams(Object.entries({ ...params, pagina: page }).filter(([, v]) => v !== '' && v !== undefined && v !== null && !(v === 1 && false)));
    if (page === 1) q.delete('pagina');
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ''}`;
  };
  const pages = [];
  for (let i = 1; i <= result.pages; i++) {
    if (i === 1 || i === result.pages || Math.abs(i - result.page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return html`<nav aria-label="Paginação" class="mt-4"><ul class="pagination justify-content-center">
    <li class="page-item${result.page === 1 ? ' disabled' : ''}"><a class="page-link" href="${link(Math.max(1, result.page - 1))}" aria-label="Página anterior">‹</a></li>
    ${pages.map((p) => (p === '…'
      ? html`<li class="page-item disabled"><span class="page-link">…</span></li>`
      : html`<li class="page-item${p === result.page ? ' active' : ''}"><a class="page-link" href="${link(p)}"${p === result.page ? raw(' aria-current="page"') : ''}>${p}</a></li>`))}
    <li class="page-item${result.page === result.pages ? ' disabled' : ''}"><a class="page-link" href="${link(Math.min(result.pages, result.page + 1))}" aria-label="Próxima página">›</a></li>
  </ul></nav>`;
}

export function breadcrumbs(items) {
  return html`<nav aria-label="Trilha de navegação" class="crumbs"><ol class="breadcrumb">
    ${items.map((it, i) => (i === items.length - 1
      ? html`<li class="breadcrumb-item active" aria-current="page">${it.label}</li>`
      : html`<li class="breadcrumb-item"><a href="${it.href}">${it.label}</a></li>`))}
  </ol></nav>`;
}

function field({ name, label, type = 'text', required = false, value = '', error, autocomplete, max, min, help, placeholder }) {
  const id = `f-${name.replace(/[^\w]/g, '-')}`;
  return html`<div class="mb-3">
    <label class="form-label" for="${id}">${label}${required ? html` <span class="req" aria-hidden="true">*</span>` : html` <span class="opt">(opcional)</span>`}</label>
    ${type === 'textarea'
      ? html`<textarea class="form-control${error ? ' is-invalid' : ''}" id="${id}" name="${name}" rows="5"${required ? raw(' required') : ''}${max ? raw(` maxlength="${max}"`) : ''}${min ? raw(` minlength="${min}"`) : ''} aria-describedby="${id}-err${help ? ` ${id}-help` : ''}">${value}</textarea>`
      : html`<input class="form-control${error ? ' is-invalid' : ''}" id="${id}" name="${name}" type="${type}" value="${value}"${required ? raw(' required') : ''}${max ? raw(` maxlength="${max}"`) : ''}${min ? raw(` minlength="${min}"`) : ''}${autocomplete ? raw(` autocomplete="${autocomplete}"`) : ''}${placeholder ? html` placeholder="${placeholder}"` : ''} aria-describedby="${id}-err${help ? ` ${id}-help` : ''}">`}
    ${help ? html`<div class="form-text" id="${id}-help">${help}</div>` : ''}
    <div class="invalid-feedback" id="${id}-err" data-error-for="${name}">${error || ''}</div>
  </div>`;
}

function select({ name, label, options, value = '', error }) {
  const id = `f-${name.replace(/[^\w]/g, '-')}`;
  return html`<div class="mb-3">
    <label class="form-label" for="${id}">${label} <span class="opt">(opcional)</span></label>
    <select class="form-select${error ? ' is-invalid' : ''}" id="${id}" name="${name}" aria-describedby="${id}-err">
      <option value="">Selecione…</option>
      ${options.map(([v, l]) => html`<option value="${v}"${String(v) === String(value) ? raw(' selected') : ''}>${l}</option>`)}
    </select>
    <div class="invalid-feedback" id="${id}-err" data-error-for="${name}">${error || ''}</div>
  </div>`;
}

const PURPOSE = {
  contato: 'Usamos estes dados somente para responder à sua mensagem.',
  orcamento: 'Usamos estes dados para elaborar e enviar o orçamento solicitado e para contato sobre ele.',
  apresentacao: 'Usamos estes dados para agendar e realizar a apresentação solicitada.',
  personalizado: 'Usamos estes dados para analisar a sua necessidade e elaborar uma proposta.'
};

/**
 * Formulário de contato/orçamento. Funciona sem JavaScript (POST tradicional)
 * e é aprimorado por /assets/js/site/forms.js (envio via fetch, validação acessível).
 */
export function contactForm({ tipo = 'contato', token, produto = null, servico = null, produtos = [], servicos = [], values = {}, errors = {}, compact = false, submitLabel, idPrefix = '' }) {
  const val = (k) => values[k] ?? '';
  const err = (k) => errors[k];
  const general = errors._geral;
  return html`<form class="contact-form needs-validation" method="post" action="/contato" novalidate data-ajax-form="/api/publico/contato">
    <input type="hidden" name="tipo" value="${tipo}">
    <input type="hidden" name="form_token" value="${token}">
    ${produto ? html`<input type="hidden" name="produto" value="${produto.slug}">` : ''}
    ${servico ? html`<input type="hidden" name="servico" value="${servico.slug}">` : ''}
    <div class="hp-field" aria-hidden="true"><label>Não preencha este campo<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="alert alert-danger${general ? '' : ' d-none'}" role="alert" data-form-error>${general || ''}</div>
    <div class="row">
      <div class="col-md-6">${field({ name: 'nome', label: 'Nome', required: true, value: val('nome'), error: err('nome'), autocomplete: 'name', max: 160, min: 2 })}</div>
      <div class="col-md-6">${field({ name: 'email', label: 'E-mail', type: 'email', required: true, value: val('email'), error: err('email'), autocomplete: 'email', max: 254 })}</div>
      <div class="col-md-6">${field({ name: 'telefone', label: 'Telefone ou WhatsApp', type: 'tel', value: val('telefone'), error: err('telefone'), autocomplete: 'tel', max: 30, placeholder: '(00) 00000-0000' })}</div>
      <div class="col-md-6">${field({ name: 'empresa', label: 'Empresa', value: val('empresa'), error: err('empresa'), autocomplete: 'organization', max: 160 })}</div>
      ${!produto && !compact && (produtos.length || servicos.length) ? html`<div class="col-md-6">${select({ name: 'produto', label: 'Produto de interesse', options: produtos.map((p) => [p.slug, p.nome]), value: val('produto'), error: err('produto') })}</div>
        <div class="col-md-6">${select({ name: 'servico', label: 'Serviço de interesse', options: servicos.map((s) => [s.slug, s.nome]), value: val('servico'), error: err('servico') })}</div>` : ''}
      ${!compact ? html`<div class="col-12">${field({ name: 'assunto', label: 'Assunto', value: val('assunto'), error: err('assunto'), max: 200 })}</div>` : ''}
      ${tipo === 'personalizado' ? requirementsFields(values.requisitos || {}, errors) : ''}
      <div class="col-12">${field({ name: 'mensagem', label: tipo === 'personalizado' ? 'Descreva o sistema que você precisa' : 'Mensagem', type: 'textarea', required: true, value: val('mensagem'), error: err('mensagem'), min: 10, max: 5000 })}</div>
    </div>
    <p class="form-purpose"><i class="bi bi-shield-lock" aria-hidden="true"></i> ${PURPOSE[tipo]} Não compartilhamos seus dados com terceiros para fins comerciais.</p>
    <div class="form-check mb-2">
      <input class="form-check-input${err('consentimento') ? ' is-invalid' : ''}" type="checkbox" id="${idPrefix}consentimento" name="consentimento" value="true" required aria-describedby="${idPrefix}consentimento-err">
      <label class="form-check-label" for="${idPrefix}consentimento">Li a <a href="/politica-de-privacidade" target="_blank">Política de Privacidade</a> e estou ciente do uso dos meus dados para esta finalidade. <span class="req" aria-hidden="true">*</span></label>
      <div class="invalid-feedback" id="${idPrefix}consentimento-err" data-error-for="consentimento">${err('consentimento') || ''}</div>
    </div>
    <div class="form-check mb-3">
      <input class="form-check-input" type="checkbox" id="${idPrefix}aceita_comunicacoes" name="aceita_comunicacoes" value="true">
      <label class="form-check-label" for="${idPrefix}aceita_comunicacoes">Aceito receber comunicações sobre novidades e lançamentos (opcional).</label>
    </div>
    <button class="btn btn-accent btn-lg" type="submit" data-submit>
      <span class="spinner-border spinner-border-sm me-2 d-none" aria-hidden="true" data-spinner></span>${submitLabel || 'Enviar'}
    </button>
    <div class="form-success d-none" role="status" tabindex="-1" data-form-success></div>
  </form>`;
}

function requirementsFields(r, errors) {
  const opts = {
    usuarios: [['ate_10', 'Até 10'], ['11_50', '11 a 50'], ['51_200', '51 a 200'], ['acima_200', 'Mais de 200'], ['nao_sei', 'Ainda não sei']],
    prazo: [['urgente', 'Urgente'], ['1_3_meses', '1 a 3 meses'], ['3_6_meses', '3 a 6 meses'], ['acima_6_meses', 'Mais de 6 meses'], ['flexivel', 'Flexível']],
    faixa: [['ate_10k', 'Até R$ 10 mil'], ['10k_30k', 'R$ 10 mil a R$ 30 mil'], ['30k_80k', 'R$ 30 mil a R$ 80 mil'], ['acima_80k', 'Acima de R$ 80 mil'], ['a_definir', 'A definir']]
  };
  const plats = Array.isArray(r.plataformas) ? r.plataformas : [];
  return html`<fieldset class="col-12 requirements">
    <legend>Levantamento inicial de requisitos</legend>
    <div class="row">
      <div class="col-md-6">${field({ name: 'requisitos[segmento]', label: 'Segmento da empresa', value: r.segmento || '', max: 120 })}</div>
      <div class="col-md-6">${select({ name: 'requisitos[usuarios_estimados]', label: 'Usuários estimados', options: opts.usuarios, value: r.usuarios_estimados })}</div>
      <div class="col-12">${field({ name: 'requisitos[objetivo]', label: 'Principal objetivo do sistema', type: 'textarea', value: r.objetivo || '', max: 2000 })}</div>
      <div class="col-12 mb-3"><span class="form-label d-block">Plataformas <span class="opt">(opcional)</span></span>
        ${[['web', 'Web'], ['mobile', 'Aplicativo móvel'], ['desktop', 'Desktop'], ['api', 'API / integrações']].map(([v, l]) => html`
          <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="requisitos[plataformas][]" id="plat-${v}" value="${v}"${plats.includes(v) ? raw(' checked') : ''}><label class="form-check-label" for="plat-${v}">${l}</label></div>`)}
      </div>
      <div class="col-12">${field({ name: 'requisitos[integracoes]', label: 'Integrações necessárias', value: r.integracoes || '', max: 1000, help: 'Ex.: ERP, gateway de pagamento, planilhas, APIs públicas.' })}</div>
      <div class="col-md-6">${select({ name: 'requisitos[prazo]', label: 'Prazo desejado', options: opts.prazo, value: r.prazo })}</div>
      <div class="col-md-6">${select({ name: 'requisitos[faixa_investimento]', label: 'Faixa de investimento', options: opts.faixa, value: r.faixa_investimento })}</div>
      <div class="col-12"><div class="form-check mb-3"><input class="form-check-input" type="checkbox" name="requisitos[possui_sistema_atual]" id="possui-sistema" value="true"${r.possui_sistema_atual ? raw(' checked') : ''}><label class="form-check-label" for="possui-sistema">Já utilizamos um sistema que precisa ser substituído ou integrado</label></div></div>
      ${errors.requisitos ? html`<div class="col-12 text-danger small">${errors.requisitos}</div>` : ''}
    </div>
  </fieldset>`;
}

export const sectionHeading = ({ eyebrow, title, text, id, center = false }) => html`<header class="section-heading${center ? ' text-center mx-auto' : ''}">
  ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
  <h2${id ? html` id="${id}"` : ''}>${title}</h2>
  ${text ? html`<p class="lead-muted">${text}</p>` : ''}
</header>`;

export const faqList = (faqs, idPrefix = 'faq') => html`<div class="accordion faq" id="${idPrefix}">
  ${faqs.map((f, i) => html`<div class="accordion-item">
    <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${idPrefix}-${i}" aria-expanded="false" aria-controls="${idPrefix}-${i}">${f.pergunta}</button></h3>
    <div id="${idPrefix}-${i}" class="accordion-collapse collapse" data-bs-parent="#${idPrefix}"><div class="accordion-body">${f.resposta}</div></div>
  </div>`)}
</div>`;
