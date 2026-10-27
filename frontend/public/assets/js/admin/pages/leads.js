import { get, post, put, download } from '../../shared/api.js';
import { el, icon, badge, datetime, money, dataTable, formModal, confirmDialog, toast, toastError, debounce, withBusy } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';

const TONE = { novo: 'primary', em_atendimento: 'info', aguardando_cliente: 'warning', qualificado: 'success', convertido: 'success', encerrado: 'secondary', spam: 'dark' };
const TIPO = { contato: 'Contato', orcamento: 'Orçamento', apresentacao: 'Apresentação', personalizado: 'Sistema personalizado' };
const INTER = { nota: 'Nota interna', email: 'E-mail', ligacao: 'Ligação', reuniao: 'Reunião', whatsapp: 'WhatsApp', status: 'Status', sistema: 'Sistema', conversao: 'Conversão' };

export async function render(c, ctx, params) {
  const opcoes = await ctx.opcoes();
  if (params[0]) return detail(c, ctx, Number(params[0]), opcoes);
  const st = opcoes.status.lead;
  const state = { busca: '', status: '', inicio: '', fim: '' };
  const qs = (extra = {}) => new URLSearchParams(Object.fromEntries(Object.entries({ ...state, ...extra }).filter(([, v]) => v)));
  const table = dataTable({
    caption: 'Leads',
    columns: [
      { label: 'Nome', render: (r) => el('div', {}, el('strong', {}, r.nome), el('div', { class: 'small text-body-secondary' }, r.email)) },
      { label: 'Empresa', render: (r) => r.empresa || '—' },
      { label: 'Situação', render: (r) => badge(st[r.status], TONE[r.status]) },
      { label: 'Responsável', render: (r) => r.responsavel_nome || '—' },
      { label: 'Mensagens', key: 'total_contatos', class: 'text-end' },
      { label: 'Último contato', render: (r) => datetime(r.ultimo_contato_em || r.criado_em) }
    ],
    load: (page) => get(`/api/admin/leads?${qs({ pagina: page })}`),
    onRowClick: (r) => ctx.navigate(`leads/${r.id}`),
    empty: 'Nenhum contato recebido ainda. Os envios dos formulários do site aparecem aqui.'
  });
  const exportBtn = ctx.can('leads.exportar') ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => download(`/api/admin/leads/exportar.csv?${qs()}`, 'leads.csv'), 'Exportação gerada (registrada na auditoria).') }, icon('download'), ' Exportar CSV') : null;
  const date = (name, label) => el('input', { type: 'date', class: 'form-control', 'aria-label': label, title: label, onchange: (e) => { state[name] = e.target.value; table.refresh(1); } });
  c.append(pageHeader('Contatos e leads', 'Solicitações recebidas pelos formulários do site, agrupadas por interessado.', exportBtn),
    el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'toolbar' },
        el('input', { type: 'search', class: 'form-control', placeholder: 'Nome, e-mail ou empresa', 'aria-label': 'Pesquisar leads', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
        el('select', { class: 'form-select', 'aria-label': 'Situação', onchange: (e) => { state.status = e.target.value; table.refresh(1); } }, el('option', { value: '' }, 'Todas as situações'), entries(st).map(([k, l]) => el('option', { value: k }, l))),
        date('inicio', 'Recebidos a partir de'), date('fim', 'Recebidos até')),
      table.node)));
  table.refresh();
}

async function detail(c, ctx, id, opcoes) {
  const st = opcoes.status.lead;
  const canEdit = ctx.can('leads.editar');
  let lead = await get(`/api/admin/leads/${id}`);
  const box = el('div');
  c.append(el('a', { href: '#/leads', class: 'back-link' }, icon('arrow-left'), ' Contatos e leads'), box);

  function draw() {
    box.textContent = '';
    const actions = [];
    if (canEdit && lead.status !== 'convertido' && !lead.anonimizado_em && ctx.can('clientes.editar')) {
      actions.push(el('button', { class: 'btn btn-success', type: 'button', onclick: async (e) => {
        if (!(await confirmDialog({ title: 'Converter em cliente', message: 'Criar (ou vincular) um cliente com os dados deste lead? Orçamentos do lead serão associados ao cliente.', confirmLabel: 'Converter', danger: false }))) return;
        const r = await withBusy(e.currentTarget, () => post(`/api/admin/leads/${id}/converter`), 'Lead convertido em cliente.');
        if (r) { ctx._opcoes = null; lead = await get(`/api/admin/leads/${id}`); draw(); }
      } }, icon('person-check'), ' Converter em cliente'));
    }
    if (lead.cliente_id && ctx.can('clientes.ver')) actions.push(el('a', { class: 'btn btn-outline-secondary', href: `#/clientes/${lead.cliente_id}` }, icon('person'), ' Ver cliente'));
    if (ctx.can('orcamentos.editar')) actions.push(el('a', { class: 'btn btn-outline-primary', href: `#/orcamentos/novo?lead=${id}` }, icon('file-earmark-plus'), ' Novo orçamento'));
    box.append(pageHeader(lead.nome, `Lead #${lead.id} · recebido em ${datetime(lead.criado_em)} · origem: ${lead.origem}`, ...actions));

    const statusSel = el('select', { class: 'form-select', id: 'lead-status', disabled: !canEdit || lead.status === 'convertido' || null },
      entries(st).filter(([k]) => k !== 'convertido' || lead.status === 'convertido').map(([k, l]) => el('option', { value: k, selected: k === lead.status || null }, l)));
    const respSel = el('select', { class: 'form-select', id: 'lead-resp', disabled: !canEdit || null }, el('option', { value: '' }, 'Sem responsável'),
      (opcoes.equipe || []).map((u) => el('option', { value: u.id, selected: u.id === lead.responsavel_id || null }, u.nome)));
    const saveBtn = el('button', { class: 'btn btn-primary btn-sm mt-3', type: 'button', onclick: async (e) => {
      const body = { responsavel_id: respSel.value ? Number(respSel.value) : null };
      if (lead.status !== 'convertido') body.status = statusSel.value;
      const r = await withBusy(e.currentTarget, () => put(`/api/admin/leads/${id}`, body), 'Atendimento atualizado.');
      if (r) { lead = await get(`/api/admin/leads/${id}`); draw(); }
    } }, 'Salvar');

    const info = el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('h2', { class: 'h6' }, 'Dados do interessado'),
      el('dl', { class: 'dl-compact' },
        el('dt', {}, 'E-mail'), el('dd', {}, el('a', { href: `mailto:${lead.email}` }, lead.email)),
        el('dt', {}, 'Telefone'), el('dd', {}, lead.telefone || '—'),
        el('dt', {}, 'Empresa'), el('dd', {}, lead.empresa || '—')),
      el('div', { class: 'mb-2' }, el('label', { class: 'form-label', for: 'lead-status' }, 'Situação do atendimento'), statusSel),
      el('div', {}, el('label', { class: 'form-label', for: 'lead-resp' }, 'Responsável'), respSel),
      canEdit ? saveBtn : null));

    const quotes = el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Orçamentos'),
      lead.orcamentos.length ? el('ul', { class: 'list-unstyled mb-0' }, lead.orcamentos.map((o) => el('li', { class: 'mb-1' }, el('a', { href: `#/orcamentos/${o.id}` }, `${o.numero} — ${o.titulo}`), ' ', badge(opcoes.status.orcamento[o.status], 'light border'), ` ${money(o.total, o.moeda)}`)))
        : el('p', { class: 'text-body-secondary small mb-0' }, 'Nenhum orçamento.')));

    const msgs = el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, `Mensagens recebidas (${lead.contatos.length})`),
      lead.contatos.map((m) => el('article', { class: 'message' },
        el('header', {}, badge(TIPO[m.tipo], 'light border'), el('strong', {}, m.assunto || m.produto_nome || m.servico_nome || 'Sem assunto'), el('time', {}, datetime(m.criado_em))),
        m.produto_nome ? el('p', { class: 'small mb-1' }, `Produto: ${m.produto_nome}`) : null,
        m.servico_nome ? el('p', { class: 'small mb-1' }, `Serviço: ${m.servico_nome}`) : null,
        el('p', { class: 'message-text' }, m.mensagem),
        Object.keys(m.dados_extras || {}).length ? el('details', {}, el('summary', {}, 'Levantamento de requisitos'),
          el('dl', { class: 'dl-compact' }, Object.entries(m.dados_extras).flatMap(([k, v]) => [el('dt', {}, k.replace(/_/g, ' ')), el('dd', {}, Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v))]))) : null,
        el('p', { class: 'small text-body-secondary mb-0' }, `Consentimento registrado em ${datetime(m.consentimento_em)} · comunicações: ${m.aceita_comunicacoes ? 'aceitas' : 'não aceitas'}`)))));

    const timeline = el('div', { class: 'card' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, el('h2', { class: 'h6 mb-0' }, 'Histórico de interações'),
        canEdit ? el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => formModal({
          title: 'Registrar interação', size: '',
          fields: [{ name: 'tipo', label: 'Tipo', type: 'select', required: true, options: [['nota', 'Nota interna'], ['email', 'E-mail'], ['ligacao', 'Ligação'], ['reuniao', 'Reunião'], ['whatsapp', 'WhatsApp']] },
            { name: 'descricao', label: 'Descrição', type: 'textarea', required: true, rows: 4 }],
          values: { tipo: 'nota' },
          onSubmit: async (v) => { await post(`/api/admin/leads/${id}/interacoes`, v); lead = await get(`/api/admin/leads/${id}`); toast('Interação registrada.'); draw(); }
        }) }, icon('plus-lg'), ' Registrar') : null),
      lead.interacoes.length ? el('ul', { class: 'timeline' }, lead.interacoes.map((i) => el('li', {},
        el('div', { class: 'small text-body-secondary' }, `${datetime(i.criado_em)} · ${INTER[i.tipo] || i.tipo}${i.usuario_nome ? ` · ${i.usuario_nome}` : ''}`), el('div', {}, i.descricao)))) : el('p', { class: 'text-body-secondary small' }, 'Sem interações.')));

    box.append(el('div', { class: 'row g-3' }, el('div', { class: 'col-lg-4' }, info, quotes), el('div', { class: 'col-lg-8' }, msgs, timeline)));
  }
  draw();
}

export { toastError };
