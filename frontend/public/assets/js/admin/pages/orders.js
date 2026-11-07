import { get, post, put } from '../../shared/api.js';
import { el, icon, badge, date, datetime, money, dataTable, buildForm, formModal, confirmDialog, toast, toastError, debounce } from '../../shared/ui.js';
import { pageHeader, entries } from './_crud.js';
import { itemsEditor } from '../items-editor.js';

const ORDER_TONE = { rascunho: 'secondary', aguardando_pagamento: 'warning', em_andamento: 'info', concluido: 'success', cancelado: 'dark' };
const PAY_TONE = { pendente: 'warning', parcial: 'info', pago: 'success', estornado: 'danger' };
const PAYMENT_TONE = { pendente: 'warning', confirmado: 'success', falhou: 'danger', estornado: 'danger', cancelado: 'secondary' };

export async function render(c, ctx, params) {
  const opcoes = await ctx.opcoes();
  if (params[0]) return editor(c, ctx, params[0], opcoes);
  const st = opcoes.status;
  const state = { busca: '', status: '', status_pagamento: '', inicio: '', fim: '' };
  const table = dataTable({
    caption: 'Pedidos',
    columns: [
      { label: 'Número', key: 'numero' }, { label: 'Cliente', key: 'cliente_nome' }, { label: 'Data', render: (r) => date(r.data_pedido) },
      { label: 'Situação', render: (r) => badge(st.pedido[r.status], ORDER_TONE[r.status]) },
      { label: 'Pagamento', render: (r) => badge(st.pagamento[r.status_pagamento], PAY_TONE[r.status_pagamento]) },
      { label: 'Total', class: 'text-end', render: (r) => money(r.total, r.moeda) }
    ],
    load: (page) => get(`/api/admin/pedidos?${new URLSearchParams({ pagina: page, ...Object.fromEntries(Object.entries(state).filter(([, v]) => v)) })}`),
    onRowClick: (r) => ctx.navigate(`pedidos/${r.id}`),
    empty: 'Nenhum pedido registrado.'
  });
  const sel = (name, label, opts) => el('select', { class: 'form-select', 'aria-label': label, onchange: (e) => { state[name] = e.target.value; table.refresh(1); } }, el('option', { value: '' }, label), entries(opts).map(([k, l]) => el('option', { value: k }, l)));
  const dt = (name, label) => el('input', { type: 'date', class: 'form-control', 'aria-label': label, title: label, onchange: (e) => { state[name] = e.target.value; table.refresh(1); } });
  c.append(pageHeader('Pedidos e pagamentos', 'Pedidos, pagamentos e contratos são registros distintos. Um pedido só é "pago" após a confirmação de pagamentos.',
    ctx.can('pedidos.editar') ? el('a', { class: 'btn btn-primary', href: '#/pedidos/novo' }, icon('plus-lg'), ' Novo pedido') : null),
  el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('div', { class: 'toolbar' },
      el('input', { type: 'search', class: 'form-control', placeholder: 'Número ou cliente', 'aria-label': 'Pesquisar pedidos', oninput: debounce((e) => { state.busca = e.target.value; table.refresh(1); }) }),
      sel('status', 'Todas as situações', st.pedido), sel('status_pagamento', 'Todos os pagamentos', st.pagamento), dt('inicio', 'Data inicial'), dt('fim', 'Data final')),
    table.node)));
  table.refresh();
}

async function editor(c, ctx, idParam, opcoes) {
  const isNew = idParam === 'novo';
  const st = opcoes.status;
  const canEdit = ctx.can('pedidos.editar');
  let o = isNew ? { status: 'rascunho', itens: [], desconto: '0', moeda: 'BRL', cliente_id: Number(ctx.query.get('cliente')) || null } : await get(`/api/admin/pedidos/${Number(idParam)}`);
  const box = el('div');
  c.append(el('a', { href: '#/pedidos', class: 'back-link' }, icon('arrow-left'), ' Pedidos'), box);

  const LABELS = { aguardando_pagamento: 'Liberar para pagamento', em_andamento: 'Iniciar execução', concluido: 'Concluir pedido', cancelado: 'Cancelar pedido' };

  function draw() {
    box.textContent = '';
    const draft = isNew || o.status === 'rascunho';
    const finished = ['concluido', 'cancelado'].includes(o.status);
    const actions = [];
    if (!isNew && canEdit) for (const s of o.transicoes) actions.push(el('button', { class: `btn ${s === 'cancelado' ? 'btn-outline-danger' : s === 'concluido' ? 'btn-success' : 'btn-primary'}`, type: 'button', onclick: () => changeStatus(s) }, LABELS[s]));
    box.append(pageHeader(isNew ? 'Novo pedido' : `Pedido ${o.numero}`, isNew ? 'O pedido é criado como rascunho e nunca é marcado como pago automaticamente.' : `Cliente: ${o.cliente_nome}${o.orcamento_numero ? ` · origem: orçamento ${o.orcamento_numero}` : ''}`, ...actions));
    if (!isNew) {
      box.append(el('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, badge(st.pedido[o.status], ORDER_TONE[o.status]), badge(`Pagamento: ${st.pagamento[o.status_pagamento]}`, PAY_TONE[o.status_pagamento]),
        el('span', { class: 'small text-body-secondary' }, `Pago: ${money(o.total_pago, o.moeda)} · Saldo: ${money(o.saldo, o.moeda)}`),
        o.desconto_autorizado_por_nome ? el('span', { class: 'small text-body-secondary' }, `Desconto autorizado por ${o.desconto_autorizado_por_nome}`) : null));
    }

    const form = buildForm([
      { name: 'cliente_id', label: 'Cliente', type: 'select', numeric: true, required: true, col: 6, readonly: !draft, options: () => (opcoes.clientes || []).map((x) => [x.id, `${x.nome} (${x.email})`]) },
      { name: 'forma_pagamento', label: 'Forma de pagamento prevista', type: 'select', col: 3, readonly: finished, options: entries(st.metodos) },
      { name: 'moeda', label: 'Moeda', type: 'select', required: true, col: 3, readonly: !draft, options: [['BRL', 'BRL'], ['USD', 'USD'], ['EUR', 'EUR']] },
      { name: 'data_pedido', label: 'Data do pedido', type: 'date', col: 3, readonly: finished },
      { name: 'data_vencimento', label: 'Vencimento', type: 'date', col: 3, readonly: finished },
      { name: 'observacoes', label: 'Observações', type: 'textarea', rows: 2, readonly: finished }
    ].map((f) => ({ ...f, readonly: f.readonly || !canEdit })), o, ctx);
    const items = itemsEditor({ items: o.itens, discount: o.desconto, currency: o.moeda, readonly: !draft || !canEdit, opcoes });
    box.append(el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, form.node)),
      el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Produtos e serviços'),
        !draft ? el('p', { class: 'small text-body-secondary' }, icon('lock'), ' Itens e valores ficam bloqueados após sair do rascunho.') : null,
        ctx.can('pedidos.autorizar_desconto') ? null : el('p', { class: 'small text-body-secondary' }, 'Descontos exigem a permissão "Autorizar descontos".'), items.node)));

    if (canEdit && !finished) {
      const save = el('button', { class: 'btn btn-primary', type: 'button' }, icon('check2'), isNew ? ' Criar pedido' : ' Salvar');
      save.addEventListener('click', async () => {
        if (!form.validate()) return;
        const payload = draft ? { ...form.values(), ...items.values() } : form.values();
        save.disabled = true;
        try {
          const r = isNew ? await post('/api/admin/pedidos', payload) : await put(`/api/admin/pedidos/${o.id}`, payload);
          toast(isNew ? `Pedido ${r.numero} criado.` : 'Pedido salvo.');
          if (isNew) { ctx.navigate(`pedidos/${r.id}`); return; }
          o = r; draw();
        } catch (err) { form.showErrors(err.fields || {}, err.message); toastError(err); } finally { save.disabled = false; }
      });
      box.append(el('div', { class: 'sticky-save' }, save));
    }
    if (isNew) return;

    // Pagamentos
    const canRegister = ctx.can('pagamentos.registrar');
    const canConfirm = ctx.can('pagamentos.confirmar');
    const payAction = async (p, action, msg) => {
      if (!(await confirmDialog({ title: 'Confirmar', message: msg, confirmLabel: 'Confirmar', danger: action !== 'confirmar' }))) return;
      try { o = await post(`/api/admin/pagamentos/${p.id}/${action}`); toast('Pagamento atualizado.'); draw(); } catch (err) { toastError(err); }
    };
    box.append(el('div', { class: 'card mt-3' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, el('h2', { class: 'h6 mb-0' }, 'Pagamentos'),
        canRegister && ['aguardando_pagamento', 'em_andamento'].includes(o.status) ? el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => formModal({
          title: 'Registrar pagamento manual', size: '',
          fields: [
            { type: 'section', label: 'Somente pagamentos efetivamente recebidos e conferidos', help: 'Pagamentos online serão confirmados apenas pela notificação validada do gateway, quando a integração existir.' },
            { name: 'valor', label: 'Valor', type: 'money', required: true, col: 6 },
            { name: 'metodo', label: 'Método', type: 'select', required: true, col: 6, options: entries(st.metodos).filter(([k]) => k !== 'gateway') },
            { name: 'referencia_externa', label: 'Referência (ID do PIX, comprovante…)', col: 12 },
            { name: 'observacoes', label: 'Observações', type: 'textarea', rows: 2 },
            canConfirm ? { name: 'confirmar', label: 'Já conferi o recebimento: registrar como confirmado', type: 'checkbox' } : null
          ].filter(Boolean),
          values: { metodo: o.forma_pagamento && o.forma_pagamento !== 'gateway' ? o.forma_pagamento : 'pix', valor: o.saldo },
          onSubmit: async (v) => { o = await post(`/api/admin/pedidos/${o.id}/pagamentos`, v); toast('Pagamento registrado.'); draw(); }
        }) }, icon('plus-lg'), ' Registrar pagamento') : null),
      o.pagamentos.length ? el('div', { class: 'table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Pagamentos' }, el('table', { class: 'table table-sm align-middle mb-0' },
        el('thead', {}, el('tr', {}, ['Data', 'Valor', 'Método', 'Origem', 'Situação', 'Referência', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, o.pagamentos.map((p) => el('tr', {},
          el('td', {}, datetime(p.criado_em)), el('td', {}, money(p.valor, o.moeda)), el('td', {}, st.metodos[p.metodo]), el('td', {}, p.provedor === 'manual' ? 'Manual' : p.provedor),
          el('td', {}, badge(p.status, PAYMENT_TONE[p.status]), p.confirmado_por_nome ? el('div', { class: 'small text-body-secondary' }, `por ${p.confirmado_por_nome} em ${datetime(p.confirmado_em)}`) : null),
          el('td', { class: 'small' }, p.referencia_externa || '—'),
          el('td', { class: 'text-end' }, el('div', { class: 'btn-group btn-group-sm' },
            p.status === 'pendente' && canConfirm && p.provedor === 'manual' ? el('button', { class: 'btn btn-outline-success', type: 'button', onclick: () => payAction(p, 'confirmar', 'Confirma que este valor foi efetivamente recebido?') }, 'Confirmar') : null,
            p.status === 'pendente' && canEdit ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => payAction(p, 'cancelar', 'Cancelar este registro de pagamento pendente?') }, 'Cancelar') : null,
            p.status === 'confirmado' && canConfirm ? el('button', { class: 'btn btn-outline-danger', type: 'button', onclick: () => payAction(p, 'estornar', 'Registrar estorno deste pagamento? A situação do pedido será recalculada.') }, 'Estornar') : null)))))))
        : el('p', { class: 'small text-body-secondary mb-0' }, o.status === 'rascunho' ? 'Libere o pedido para pagamento para registrar pagamentos.' : 'Nenhum pagamento registrado.'))));

    box.append(el('div', { class: 'row g-3 mt-0' },
      el('div', { class: 'col-lg-6' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Contratos e licenças vinculados'),
        o.contratos.length || o.licencas.length ? el('ul', { class: 'small mb-0' }, o.contratos.map((x) => el('li', {}, `Contrato ${x.numero} — ${x.titulo} (${st.contrato[x.status]})`)), o.licencas.map((x) => el('li', {}, `Licença ${x.identificador} (${st.licenca[x.status]})`)))
          : el('p', { class: 'small text-body-secondary mb-2' }, 'Nenhum vínculo.'),
        ctx.can('contratos.editar') ? el('a', { class: 'btn btn-sm btn-outline-secondary mt-2', href: '#/contratos' }, 'Gerenciar contratos e licenças') : null))),
      el('div', { class: 'col-lg-6' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Histórico'),
        el('ul', { class: 'timeline' }, o.historico.map((h) => el('li', {}, el('div', { class: 'small text-body-secondary' }, `${datetime(h.criado_em)}${h.usuario_nome ? ` · ${h.usuario_nome}` : ''}`), el('div', {}, h.descricao)))))))));
  }

  function changeStatus(s) {
    formModal({
      title: LABELS[s], size: '', submitLabel: 'Confirmar',
      fields: [{ name: 'observacao', label: 'Observação (histórico)', type: 'textarea', rows: 2 }],
      onSubmit: async (v) => { o = await post(`/api/admin/pedidos/${o.id}/status`, { status: s, ...v }); toast('Situação do pedido atualizada.'); draw(); }
    });
  }

  draw();
}
