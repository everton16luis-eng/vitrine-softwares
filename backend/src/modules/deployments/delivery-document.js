// Resumo de entrega para impressão/PDF. Usa apenas o resumo gravado na entrega —
// que, por construção, não contém senhas nem credenciais.
import { html } from '../../utils/html.js';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

export function renderDeliveryDocument(d, s) {
  const r = d.resumo_entrega;
  return `<!doctype html>${html`<html lang="pt-BR"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Resumo de entrega ${d.codigo}</title>
    <link rel="stylesheet" href="/assets/css/print.css">
  </head><body>
    <div class="toolbar no-print"><button type="button" data-print>Imprimir / salvar em PDF</button></div>
    <article class="doc">
      <header class="doc-header">
        <div>
          <h1>${s.nome_comercial || 'Resumo de entrega'}</h1>
          <p>Resumo de entrega do sistema</p>
        </div>
        <div class="doc-id"><strong>ENTREGA</strong><span>${d.codigo}</span><span>${fmt(r.entregue_em)}</span></div>
      </header>

      <section class="doc-block">
        <h2>Sistema</h2>
        <table><tbody>
          <tr><th>Cliente</th><td>${d.cliente_empresa || d.cliente_nome}</td></tr>
          <tr><th>Software</th><td>${r.software}</td></tr>
          <tr><th>Versão</th><td>${r.versao || '—'}</td></tr>
          <tr><th>Endereço de acesso</th><td>${r.endereco || '—'}</td></tr>
          <tr><th>Instalado em</th><td>${fmt(r.instalado_em)}</td></tr>
          <tr><th>Situação</th><td>${r.situacao}</td></tr>
        </tbody></table>
      </section>

      ${r.recursos?.length ? html`<section class="doc-block"><h2>Recursos disponibilizados</h2><ul>${r.recursos.map((x) => html`<li>${x}</li>`)}</ul></section>` : ''}

      <section class="doc-block">
        <h2>Acesso inicial</h2>
        <p class="pre-line">${r.instrucoes_acesso}</p>
        <p class="doc-note">Por segurança, este documento não contém senhas. Cada usuário define a própria senha no primeiro acesso.</p>
      </section>

      ${r.orientacoes ? html`<section class="doc-block"><h2>Orientações de uso</h2><p class="pre-line">${r.orientacoes}</p></section>` : ''}

      ${r.verificacoes?.length ? html`<section class="doc-block"><h2>Verificações realizadas na entrega</h2><ul>${r.verificacoes.map((x) => html`<li>${x.ok ? '✔' : '✖'} ${x.descricao}</li>`)}</ul></section>` : ''}

      ${r.observacoes ? html`<section class="doc-block"><h2>Observações</h2><p class="pre-line">${r.observacoes}</p></section>` : ''}

      <footer class="doc-footer"><p>Infraestrutura, atualizações técnicas e manutenção do servidor são de responsabilidade de ${s.nome_comercial || 'fornecedor'}.</p></footer>
    </article>
    <script src="/assets/js/print.js"></script>
  </body></html>`}`;
}
