import { html } from '../utils/html.js';
import { formatMoney } from '../utils/money.js';
import { renderMarkdown } from '../utils/markdown.js';
import { raw } from '../utils/html.js';

const fmtDate = (d) => (d ? (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : new Date(d).toLocaleDateString('pt-BR')) : '—');
const missing = (label) => html`<span class="missing">[${label} não configurado]</span>`;

/**
 * Documento de orçamento para impressão/PDF (Ctrl+P). Usa apenas dados reais
 * cadastrados: campos de fornecedor não configurados aparecem sinalizados.
 */
export function renderQuoteDocument(q, s) {
  const cliente = {
    nome: q.cliente_nome || q.lead_nome, empresa: q.cliente_empresa || q.lead_empresa,
    email: q.cliente_email || q.lead_email, telefone: q.cliente_telefone || q.lead_telefone, documento: q.cliente_documento
  };
  return `<!doctype html>${html`<html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Orçamento ${q.numero}</title>
    <link rel="stylesheet" href="/assets/css/print.css">
  </head><body>
    <div class="toolbar no-print"><button type="button" data-print>Imprimir / salvar em PDF</button></div>
    <article class="doc">
      <header class="doc-header">
        <div>
          <h1>${s.razao_social || s.nome_comercial || missing('Nome do fornecedor')}</h1>
          <p>${s.documento_empresa ? `CNPJ/CPF: ${s.documento_empresa}` : missing('Documento do fornecedor')}</p>
          <p>${s.endereco || ''}</p>
          <p>${[s.email_contato, s.telefone].filter(Boolean).join(' · ')}</p>
        </div>
        <div class="doc-id"><strong>ORÇAMENTO</strong><span>${q.numero}</span><span>Emissão: ${fmtDate(q.enviado_em || q.criado_em)}</span><span>Validade: ${fmtDate(q.validade)}</span></div>
      </header>
      <section class="doc-block"><h2>Cliente</h2>
        <p><strong>${cliente.nome || '—'}</strong>${cliente.empresa ? ` — ${cliente.empresa}` : ''}</p>
        <p>${[cliente.email, cliente.telefone].filter(Boolean).join(' · ')}</p>
        ${cliente.documento ? html`<p>Documento: ${cliente.documento}</p>` : ''}
      </section>
      <section class="doc-block"><h2>${q.titulo}</h2>
        ${q.informacoes_adicionais ? html`<div class="prose">${raw(renderMarkdown(q.informacoes_adicionais))}</div>` : ''}
        <table><thead><tr><th>Descrição</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Desconto</th><th class="n">Total</th></tr></thead>
          <tbody>${q.itens.length ? q.itens.map((i) => html`<tr><td>${i.descricao}</td><td class="n">${i.quantidade}</td><td class="n">${formatMoney(i.preco_unitario, q.moeda)}</td>
            <td class="n">${Number(i.desconto) ? formatMoney(i.desconto, q.moeda) : '—'}</td><td class="n">${formatMoney(i.total, q.moeda)}</td></tr>`)
            : html`<tr><td colspan="5">Nenhum item cadastrado.</td></tr>`}</tbody>
          <tfoot>
            <tr><td colspan="4" class="n">Subtotal</td><td class="n">${formatMoney(q.subtotal, q.moeda)}</td></tr>
            ${Number(q.desconto) ? html`<tr><td colspan="4" class="n">Desconto</td><td class="n">- ${formatMoney(q.desconto, q.moeda)}</td></tr>` : ''}
            <tr class="total"><td colspan="4" class="n">Total</td><td class="n">${formatMoney(q.total, q.moeda)}</td></tr>
          </tfoot></table>
      </section>
      ${q.condicoes_comerciais ? html`<section class="doc-block"><h2>Condições comerciais</h2><div class="prose">${raw(renderMarkdown(q.condicoes_comerciais))}</div></section>` : ''}
      <footer class="doc-footer">Este orçamento é válido até ${fmtDate(q.validade)}. Valores sujeitos às condições acima. Documento sem valor fiscal.</footer>
    </article>
    <script src="/assets/js/print.js"></script>
  </body></html>`}`;
}
