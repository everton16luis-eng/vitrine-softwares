import { get, post, put } from '../../shared/api.js';
import { el, icon, badge, date, datetime, money, dataTable, buildForm, formModal, confirmDialog, toast, toastError, debounce } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';
import { itemsEditor } from '../items-editor.js';

export const QUOTE_TONE = { novo: 'primary', em_analise: 'info', em_elaboracao: 'info', enviado: 'warning', aguardando_resposta: 'warning', aceito: 'success', recusado: 'danger', expirado: 'secondary', cancelado: 'dark' };

export async function render(c, ctx, params) {
  const opcoes = await ctx.opcoes();
  if (params[0]) return editor(c, ctx, params[0], opcoes);
  const st = opcoes.status.orcamento;
  const state = { busca: '', status: '', pendentes: '' };
  const table = dataTable({
    caption: 'Orçamentos',
    columns: [
      { label: 'Número', key: 'numero' }, { label: 'Título', key: 'titulo' },
      { label: 'Interessado', render: (r) => el('div', {}, r.interessado_nome || '—', el('div', { class: 'small text-body-secondary' }, r.interessado_email || '')) },
      { label: 'Situação', render: (r) => badge(st[r.status], QUOTE_TONE[r.status]) },
      { label: 'Total', class: 'text-end', render: (r) => money(r.total, r.moeda) },
      { label: 'Validade', render: (r) => date(r.validade) }, { label: 'Criado', render: (r) => date(r.criado_em) }
    ],
    load: (page) => get(`/api/admin/orcamentos?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    onRowClick: (r) => ctx.navigate(`orcamentos/${r.id}`),
    empty: 'Nenhum orçamento. Solicitações do site criam orçamentos automaticamente.'
  });
  c.append(pageHeader('Orçamentos', 'Solicitações recebidas e propostas elaboradas pela equipe.',
    ctx.can('orcamentos.editar') ? el('a', { class: 'btn btn-primary', href: '#/orcamentos/novo' }, icon('plus-lg'), ' Novo orçamento') : null),
  el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('div', { class: 'toolbar' },
      el('input', { type: 'search', class: 'form-control', placeholder: 'Número, título ou interessado', 'aria-label': 'Pesquisar orçamentos', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
      el('select', { class: 'form-select', 'aria-label': 'Situação', onchange: (e) => { state.status = e.target.value; table.refresh(1); } }, el('option', { value: '' }, 'Todas as situações'), entries(st).map(([k, l]) => el('option', { value: k }, l))),
      el('div', { class: 'form-check form-switch ms-2' }, el('input', { class: 'form-check-input', type: 'checkbox', id: 'only-pend', onchange: (e) => { state.pendentes = e.target.checked ? 'true' : ''; table.refresh(1); } }), el('label', { class: 'form-check-label', for: 'only-pend' }, 'Somente pendentes'))),
    table.node)));
  table.refresh();
}

async function editor(c, ctx, idParam, opcoes) {
  const isNew = idParam === 'novo';
  const st = opcoes.status.orcamento;
  const canEdit = ctx.can('orcamentos.editar');
  let q = isNew
    ? { status: 'novo', editavel: true, itens: [], desconto: '0', moeda: 'BRL', cliente_id: Number(ctx.query.get('cliente')) || null, lead_id: Number(ctx.query.get('lead')) || null }
    : await get(`/api/admin/orcamentos/${Number(idParam)}`);
  const box = el('div');
  c.append(el('a', { href: '#/orcamentos', class: 'back-link' }, icon('arrow-left'), ' Orçamentos'), box);

  const fields = (editable) => [
    { name: 'titulo', label: 'Título', required: true, col: 8, readonly: !editable },
    { name: 'responsavel_id', label: 'Responsável', type: 'select', numeric: true, col: 4, options: () => (opcoes.equipe || []).map((u) => [u.id, u.nome]) },
    { name: 'cliente_id', label: 'Cliente', type: 'select', numeric: true, col: 6, readonly: !editable, options: () => (opcoes.clientes || []).map((x) => [x.id, `${x.nome} (${x.email})`]), help: q.lead_id && !q.cliente_id ? `Vinculado ao lead #${q.lead_id}.` : null },
    { name: 'validade', label: 'Validade', type: 'date', col: 3, readonly: !editable },
    { name: 'moeda', label: 'Moeda', type: 'select', required: true, col: 3, readonly: !editable, options: [['BRL', 'BRL'], ['USD', 'USD'], ['EUR', 'EUR']] },
    { name: 'produto_id', label: 'Produto de interesse', type: 'select', numeric: true, col: 6, readonly: !editable, options: () => (opcoes.produtos || []).map((p) => [p.id, p.nome]) },
    { name: 'servico_id', label: 'Serviço de interesse', type: 'select', numeric: true, col: 6, readonly: !editable, options: () => (opcoes.servicos || []).map((s) => [s.id, s.nome]) },
    { name: 'descricao_solicitacao', label: 'Solicitação do cliente', type: 'textarea', rows: 3, readonly: !editable },
    { name: 'informacoes_adicionais', label: 'Informações para o cliente (escopo, observações) — Markdown', type: 'textarea', rows: 4, readonly: !editable },
    { name: 'condicoes_comerciais', label: 'Condições comerciais — Markdown', type: 'textarea', rows: 4, readonly: !editable },
    { name: 'observacoes_internas', label: 'Observações internas (não aparecem para o cliente)', type: 'textarea', rows: 3 }
  ];

  function draw() {
    box.textContent = '';
    const editable = canEdit && (isNew || q.editavel);
    const actions = [];
    if (!isNew) {
      actions.push(el('a', { class: 'btn btn-outline-secondary', href: `/api/admin/orcamentos/${q.id}/documento`, target: '_blank', rel: 'noopener' }, icon('printer'), ' Imprimir / PDF'));
      if (canEdit) for (const s of q.transicoes) actions.push(statusButton(s));
      if (q.status === 'aceito' && !q.pedido_id && ctx.can('pedidos.editar')) actions.push(el('button', { class: 'btn btn-success', type: 'button', onclick: generateOrder }, icon('receipt'), ' Gerar pedido'));
      if (q.pedido_id) actions.push(el('a', { class: 'btn btn-outline-success', href: `#/pedidos/${q.pedido_id}` }, icon('receipt'), ' Ver pedido'));
    }
    box.append(pageHeader(isNew ? 'Novo orçamento' : `${q.numero} — ${q.titulo}`, isNew ? 'Selecione o cliente, descreva o escopo e adicione os itens.' : `Criado em ${datetime(q.criado_em)}${q.enviado_em ? ` · enviado em ${datetime(q.enviado_em)}` : ''}`, ...actions));
    if (!isNew) box.append(el('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, badge(st[q.status], QUOTE_TONE[q.status]),
      !editable ? el('span', { class: 'small text-body-secondary' }, icon('lock'), ' Valores e condições bloqueados após o envio (somente observações internas e responsável podem mudar).') : null));

    if (!isNew && (q.cliente_nome || q.lead_nome)) {
      box.append(el('div', { class: 'alert alert-light border d-flex flex-wrap gap-3' },
        el('span', {}, icon('person'), ` ${q.cliente_nome || q.lead_nome}`), el('span', {}, icon('envelope'), ` ${q.cliente_email || q.lead_email}`),
        q.cliente_telefone || q.lead_telefone ? el('span', {}, icon('telephone'), ` ${q.cliente_telefone || q.lead_telefone}`) : null,
        q.lead_id ? el('a', { href: `#/leads/${q.lead_id}` }, 'Ver lead') : null, q.cliente_id ? el('a', { href: `#/clientes/${q.cliente_id}` }, 'Ver cliente') : null));
    }
    if (q.requisitos && Object.keys(q.requisitos).length) {
      box.append(el('details', { class: 'card card-body mb-3' }, el('summary', {}, 'Levantamento de requisitos enviado pelo cliente'),
        el('dl', { class: 'dl-compact mt-2 mb-0' }, Object.entries(q.requisitos).flatMap(([k, v]) => [el('dt', {}, k.replace(/_/g, ' ')), el('dd', {}, Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v))]))));
    }

    const form = buildForm(fields(editable).map((f) => ({ ...f, readonly: f.readonly || !canEdit })), q, ctx);
    const items = itemsEditor({ items: q.itens, discount: q.desconto, currency: q.moeda, readonly: !editable, opcoes });
    box.append(el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, form.node)),
      el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Itens'), items.node)));

    if (canEdit) {
      const save = el('button', { class: 'btn btn-primary', type: 'button' }, icon('check2'), isNew ? ' Criar orçamento' : ' Salvar');
      save.addEventListener('click', async () => {
        if (!form.validate()) return;
        const values = form.values();
        const payload = editable ? { ...values, ...items.values() } : { observacoes_internas: values.observacoes_internas, responsavel_id: values.responsavel_id };
        if (isNew && !payload.cliente_id && q.lead_id) payload.lead_id = q.lead_id;
        save.disabled = true;
        try {
          const r = isNew ? await post('/api/admin/orcamentos', payload) : await put(`/api/admin/orcamentos/${q.id}`, payload);
          toast(isNew ? `Orçamento ${r.numero} criado.` : 'Orçamento salvo.');
          if (isNew) { ctx.navigate(`orcamentos/${r.id}`); return; }
          q = r; draw();
        } catch (err) { form.showErrors(err.fields || {}, err.message); toastError(err); } finally { save.disabled = false; }
      });
      box.append(el('div', { class: 'sticky-save' }, save));
    }

    if (!isNew) {
      box.append(el('div', { class: 'card mt-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Histórico de alterações'),
        el('ul', { class: 'timeline' }, q.historico.map((h) => el('li', {}, el('div', { class: 'small text-body-secondary' }, `${datetime(h.criado_em)}${h.usuario_nome ? ` · ${h.usuario_nome}` : ''}`), el('div', {}, h.descricao)))))));
    }
  }

  const LABELS = { em_analise: 'Iniciar análise', em_elaboracao: 'Em elaboração', enviado: 'Marcar como enviado', aguardando_resposta: 'Aguardando resposta', aceito: 'Registrar aceite', recusado: 'Registrar recusa', expirado: 'Marcar expirado', cancelado: 'Cancelar' };
  function statusButton(s) {
    const tone = { aceito: 'btn-success', recusado: 'btn-outline-danger', cancelado: 'btn-outline-danger', enviado: 'btn-primary' }[s] || 'btn-outline-secondary';
    return el('button', { class: `btn ${tone}`, type: 'button', onclick: () => {
      const fields = [{ name: 'observacao', label: 'Observação (registrada no histórico)', type: 'textarea', rows: 2 }];
      if (s === 'recusado') fields.unshift({ name: 'motivo_recusa', label: 'Motivo da recusa', type: 'textarea', rows: 2 });
      formModal({
        title: LABELS[s], size: '', submitLabel: 'Confirmar', fields,
        onSubmit: async (v) => {
          q = await post(`/api/admin/orcamentos/${q.id}/status`, { status: s, ...v });
          toast(s === 'enviado' ? 'Orçamento marcado como enviado. O e-mail ao cliente é enviado se o provedor estiver configurado.' : 'Situação atualizada.');
          draw();
        }
      });
    } }, LABELS[s]);
  }

  async function generateOrder() {
    if (!(await confirmDialog({ title: 'Gerar pedido', message: 'Criar um pedido (rascunho) com os itens deste orçamento? Se o interessado ainda for um lead, ele será convertido em cliente.', confirmLabel: 'Gerar pedido', danger: false }))) return;
    try { const r = await post(`/api/admin/orcamentos/${q.id}/gerar-pedido`); ctx._opcoes = null; toast('Pedido criado.'); ctx.navigate(`pedidos/${r.pedido_id}`); } catch (err) { toastError(err); }
  }

  draw();
}
