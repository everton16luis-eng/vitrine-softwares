import { get, post, put, del, api, download } from '../../shared/api.js';
import { el, icon, badge, date, datetime, money, dataTable, formModal, confirmDialog, infoModal, toast, toastError, debounce, withBusy } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

const FIELDS = [
  { name: 'nome', label: 'Nome', required: true, col: 6 },
  { name: 'email', label: 'E-mail', type: 'email', required: true, col: 6 },
  { name: 'telefone', label: 'Telefone', type: 'tel', col: 6 },
  { name: 'empresa', label: 'Empresa', col: 6 },
  { name: 'documento', label: 'CPF/CNPJ', col: 6, help: 'Preencha somente quando necessário (ex.: contrato ou emissão fiscal).' },
  { name: 'observacoes', label: 'Observações internas', type: 'textarea' }
];

export async function render(c, ctx, params) {
  if (params[0]) return detail(c, ctx, Number(params[0]));
  const canEdit = ctx.can('clientes.editar');
  let busca = '';
  const table = dataTable({
    caption: 'Clientes',
    columns: [
      { label: 'Cliente', render: (r) => el('div', {}, el('strong', {}, r.nome), el('div', { class: 'small text-body-secondary' }, r.email)) },
      { label: 'Empresa', render: (r) => r.empresa || '—' },
      { label: 'Orçamentos', key: 'total_orcamentos', class: 'text-end' }, { label: 'Pedidos', key: 'total_pedidos', class: 'text-end' },
      { label: 'Área do cliente', render: (r) => (r.acesso_ativo ? badge('Ativa', 'success') : badge('Sem acesso', 'light border')) },
      { label: 'Cadastro', render: (r) => date(r.criado_em) }
    ],
    load: (page) => get(`/api/admin/clientes?pagina=${page}&busca=${encodeURIComponent(busca)}`),
    onRowClick: (r) => ctx.navigate(`clientes/${r.id}`),
    empty: 'Nenhum cliente. Converta leads ou cadastre manualmente.'
  });
  c.append(pageHeader('Clientes', 'Dados mínimos necessários ao relacionamento comercial. Acesso restrito por permissão.',
    ctx.can('clientes.exportar') ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => download(`/api/admin/clientes/exportar.csv?busca=${encodeURIComponent(busca)}`, 'clientes.csv'), 'Exportação registrada na auditoria.') }, icon('download'), ' Exportar') : null,
    canEdit ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => formModal({ title: 'Novo cliente', fields: FIELDS, onSubmit: async (v) => { const r = await post('/api/admin/clientes', v); ctx._opcoes = null; toast('Cliente cadastrado.'); ctx.navigate(`clientes/${r.id}`); } }) }, icon('plus-lg'), ' Novo cliente') : null),
  el('div', { class: 'card' }, el('div', { class: 'card-body' },
    el('div', { class: 'toolbar' }, el('input', { type: 'search', class: 'form-control', placeholder: 'Nome, e-mail ou empresa', 'aria-label': 'Pesquisar clientes', oninput: debounce((e) => { busca = e.target.value; table.refresh(1); }) })),
    table.node)));
  table.refresh();
}

async function detail(c, ctx, id) {
  const opcoes = await ctx.opcoes();
  const canEdit = ctx.can('clientes.editar');
  let cust = await get(`/api/admin/clientes/${id}`);
  const box = el('div');
  c.append(el('a', { href: '#/clientes', class: 'back-link' }, icon('arrow-left'), ' Clientes'), box);
  const reload = async () => { cust = await get(`/api/admin/clientes/${id}`); draw(); };

  function accessCard() {
    const conta = cust.conta;
    const items = [el('h2', { class: 'h6' }, 'Área do cliente')];
    if (!conta) items.push(el('p', { class: 'small text-body-secondary' }, 'Acesso não habilitado.'));
    else items.push(el('p', { class: 'small' }, conta.ativo ? badge('Ativo', 'success') : badge('Desativado', 'secondary'), ' ', conta.senha_definida ? `Último acesso: ${datetime(conta.ultimo_login_em)}` : 'Aguardando definição de senha'));
    if (canEdit && !cust.anonimizado_em) {
      items.push(el('button', { class: 'btn btn-sm btn-outline-primary me-2', type: 'button', onclick: async (e) => {
        const r = await withBusy(e.currentTarget, () => post(`/api/admin/clientes/${id}/acesso`));
        if (!r) return;
        if (r.link_convite) {
          const input = el('input', { class: 'form-control', readonly: true, value: r.link_convite, onfocus: (ev) => ev.target.select() });
          infoModal({ title: 'Link de acesso (exibido uma única vez)', body: el('div', {}, el('p', {}, r.mensagem), input,
            el('button', { class: 'btn btn-sm btn-outline-secondary mt-2', type: 'button', onclick: () => navigator.clipboard?.writeText(r.link_convite).then(() => toast('Link copiado.')) }, icon('clipboard'), ' Copiar')) });
        } else toast(r.mensagem);
        reload();
      } }, icon('envelope'), conta ? ' Reenviar convite' : ' Habilitar acesso'));
      if (conta?.ativo) items.push(el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ message: 'Desativar o acesso deste cliente? As sessões ativas serão encerradas.', confirmLabel: 'Desativar' }))) return;
        try { await del(`/api/admin/clientes/${id}/acesso`); toast('Acesso desativado.'); reload(); } catch (err) { toastError(err); }
      } }, 'Desativar acesso'));
    }
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, items));
  }

  function filesCard() {
    const input = el('input', { type: 'file', class: 'd-none', accept: '.pdf,.zip,.png,.jpg,.jpeg,.webp', onchange: () => {
      const file = input.files[0];
      if (!file) return;
      formModal({ title: `Disponibilizar ${file.name}`, size: '', fields: [{ name: 'titulo', label: 'Título exibido ao cliente', required: true }, { name: 'descricao', label: 'Descrição', type: 'textarea', rows: 2 }], values: { titulo: file.name },
        onSubmit: async (v) => { const fd = new FormData(); fd.append('arquivo', file); fd.append('titulo', v.titulo); if (v.descricao) fd.append('descricao', v.descricao);
          await api(`/api/admin/clientes/${id}/arquivos`, { method: 'POST', form: fd }); toast('Arquivo disponibilizado na área do cliente.'); input.value = ''; reload(); } });
    } });
    return el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex justify-content-between align-items-center' }, el('h2', { class: 'h6 mb-0' }, 'Arquivos para download'),
        canEdit && !cust.anonimizado_em ? el('span', {}, input, el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => input.click() }, icon('upload'), ' Enviar')) : null),
      cust.arquivos.length ? el('ul', { class: 'list-unstyled mt-2 mb-0' }, cust.arquivos.map((a) => el('li', { class: 'd-flex justify-content-between gap-2 py-1 border-bottom' },
        el('button', { class: 'btn btn-link btn-sm p-0 text-start', type: 'button', onclick: () => download(`/api/admin/arquivos-privados/${a.arquivo_id}`, a.nome_original).catch(toastError) }, a.titulo),
        canEdit ? el('button', { class: 'btn btn-sm btn-link text-danger', type: 'button', 'aria-label': `Remover ${a.titulo}`, onclick: async () => {
          if (!(await confirmDialog({ message: `Remover "${a.titulo}" da área do cliente?`, confirmLabel: 'Remover' }))) return;
          try { await del(`/api/admin/clientes/${id}/arquivos/${a.id}`); reload(); } catch (err) { toastError(err); }
        } }, icon('trash')) : null))) : el('p', { class: 'small text-body-secondary mt-2 mb-0' }, 'Nenhum arquivo.')));
  }

  function lgpdCard() {
    if (!ctx.can('lgpd.ver')) return null;
    return el('div', { class: 'card mb-3 border-warning-subtle' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Privacidade (LGPD)'),
      el('button', { class: 'btn btn-sm btn-outline-secondary me-2', type: 'button', onclick: (e) => withBusy(e.currentTarget, () => download(`/api/admin/clientes/${id}/dados-titular`, `dados-titular-${id}.json`), 'Relatório de dados gerado.') }, icon('filetype-json'), ' Exportar dados do titular'),
      ctx.can('lgpd.editar') && !cust.anonimizado_em ? el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', onclick: async () => {
        if (!(await confirmDialog({ title: 'Anonimizar titular', message: 'Os dados pessoais deste cliente, de seus leads e mensagens serão removidos de forma irreversível. Pedidos e contratos serão mantidos sem identificação pessoal. Confirma?', confirmLabel: 'Anonimizar' }))) return;
        try { await post(`/api/admin/clientes/${id}/anonimizar`); toast('Titular anonimizado.'); ctx._opcoes = null; reload(); } catch (err) { toastError(err); }
      } }, icon('person-x'), ' Anonimizar') : null));
  }

  const listCard = (title, rows, render, empty) => el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, title),
    rows.length ? el('ul', { class: 'list-unstyled mb-0' }, rows.map((r) => el('li', { class: 'py-1 border-bottom' }, render(r)))) : el('p', { class: 'small text-body-secondary mb-0' }, empty)));

  function draw() {
    box.textContent = '';
    const st = opcoes.status;
    box.append(pageHeader(cust.nome, `Cliente #${cust.id} desde ${date(cust.criado_em)}${cust.anonimizado_em ? ' · ANONIMIZADO' : ''}`,
      canEdit && !cust.anonimizado_em ? el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => formModal({ title: 'Editar cliente', fields: FIELDS, values: cust,
        onSubmit: async (v) => { await put(`/api/admin/clientes/${id}`, v); ctx._opcoes = null; toast('Cliente atualizado.'); reload(); } }) }, icon('pencil'), ' Editar') : null,
      ctx.can('orcamentos.editar') && !cust.anonimizado_em ? el('a', { class: 'btn btn-outline-primary', href: `#/orcamentos/novo?cliente=${id}` }, icon('file-earmark-plus'), ' Novo orçamento') : null,
      ctx.can('pedidos.editar') && !cust.anonimizado_em ? el('a', { class: 'btn btn-primary', href: `#/pedidos/novo?cliente=${id}` }, icon('receipt'), ' Novo pedido') : null));
    box.append(el('div', { class: 'row g-3' },
      el('div', { class: 'col-lg-4' },
        el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Cadastro'), el('dl', { class: 'dl-compact mb-0' },
          el('dt', {}, 'E-mail'), el('dd', {}, cust.email), el('dt', {}, 'Telefone'), el('dd', {}, cust.telefone || '—'),
          el('dt', {}, 'Empresa'), el('dd', {}, cust.empresa || '—'), el('dt', {}, 'Documento'), el('dd', {}, cust.documento || '—'),
          el('dt', {}, 'Origem'), el('dd', {}, cust.origem), el('dt', {}, 'Observações'), el('dd', { class: 'pre-wrap' }, cust.observacoes || '—')))),
        accessCard(), filesCard(), lgpdCard()),
      el('div', { class: 'col-lg-8' },
        listCard('Orçamentos', cust.orcamentos, (o) => [el('a', { href: `#/orcamentos/${o.id}` }, `${o.numero} — ${o.titulo}`), ' ', badge(st.orcamento[o.status], 'light border'), ` ${money(o.total, o.moeda)}`], 'Nenhum orçamento.'),
        listCard('Pedidos', cust.pedidos, (o) => [el('a', { href: `#/pedidos/${o.id}` }, o.numero), ' ', badge(st.pedido[o.status], 'light border'), ' ', badge(st.pagamento[o.status_pagamento], o.status_pagamento === 'pago' ? 'success' : 'warning'), ` ${money(o.total, o.moeda)} · ${date(o.data_pedido)}`], 'Nenhum pedido.'),
        listCard('Contratos', cust.contratos, (o) => [`${o.numero} — ${o.titulo} `, badge(st.contrato[o.status], 'light border'), ` ${date(o.data_inicio)} → ${o.data_fim ? date(o.data_fim) : 'indeterminado'}`], 'Nenhum contrato.'),
        listCard('Licenças', cust.licencas, (l) => [`${l.identificador} · ${l.produto_nome} `, badge(st.licenca[l.status], l.status === 'ativa' ? 'success' : 'secondary'), ` ${st.tipos_licenca[l.tipo]}${l.data_fim ? ` até ${date(l.data_fim)}` : ''}`], 'Nenhuma licença.'),
        listCard('Chamados de suporte', cust.chamados, (t) => [`${t.assunto} `, badge(st.chamado[t.status], 'light border'), ` ${date(t.criado_em)}`], 'Nenhum chamado.'))));
  }
  draw();
}
