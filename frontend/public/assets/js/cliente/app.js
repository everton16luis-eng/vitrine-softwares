// Área do cliente. O servidor identifica o cliente pela sessão; nenhum ID de
// cliente é enviado pelo navegador.
import { get, post, put, download, setCsrf, setUnauthorizedHandler } from '../shared/api.js';
import { el, icon, badge, money, date, datetime, loading, emptyState, errorState, buildForm, formModal, confirmDialog, toast, toastError } from '../shared/ui.js';

const root = document.getElementById('app');
let user = null;
let main;

const ORDER = { aguardando_pagamento: 'Aguardando pagamento', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado' };
const PAY = { pendente: 'Pendente', parcial: 'Parcialmente pago', pago: 'Pago', estornado: 'Estornado' };
const QUOTE = { enviado: 'Enviado', aguardando_resposta: 'Aguardando sua resposta', aceito: 'Aceito', recusado: 'Recusado', expirado: 'Expirado' };
const LIC = { ativa: 'Ativa', suspensa: 'Suspensa', expirada: 'Expirada', revogada: 'Revogada' };
const LIC_TYPE = { perpetua: 'Perpétua', assinatura: 'Assinatura', avaliacao: 'Avaliação', personalizada: 'Personalizada' };
const TICKET = { aberto: 'Aberto', em_atendimento: 'Em atendimento', respondido: 'Respondido', fechado: 'Fechado' };
const CONTRACT = { vigente: 'Vigente', suspenso: 'Suspenso', encerrado: 'Encerrado', cancelado: 'Cancelado' };

const NAV = [['', 'Início', 'house'], ['pedidos', 'Pedidos', 'receipt'], ['orcamentos', 'Orçamentos', 'file-earmark-text'], ['contratos', 'Contratos e licenças', 'file-earmark-lock'],
  ['arquivos', 'Downloads', 'download'], ['suporte', 'Suporte', 'life-preserver'], ['dados', 'Meus dados', 'person']];

setUnauthorizedHandler(() => { if (user) { user = null; toast('Sua sessão expirou. Entre novamente.', 'warning'); renderLogin(); } });

function renderLogin() {
  root.textContent = '';
  const email = el('input', { class: 'form-control', type: 'email', id: 'c-email', autocomplete: 'username', required: true });
  const senha = el('input', { class: 'form-control', type: 'password', id: 'c-senha', autocomplete: 'current-password', required: true });
  const error = el('div', { class: 'alert alert-danger d-none', role: 'alert' });
  const btn = el('button', { class: 'btn btn-primary w-100', type: 'submit' }, 'Entrar');
  root.append(el('main', { class: 'login-wrap', id: 'cliente-main' }, el('form', { class: 'login-card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.classList.add('d-none');
    btn.disabled = true;
    try {
      const r = await post('/api/auth/login', { email: email.value, senha: senha.value, area: 'cliente' });
      setCsrf(r.csrf);
      await boot();
    } catch (err) { error.textContent = err.message; error.classList.remove('d-none'); senha.value = ''; } finally { btn.disabled = false; }
  } },
  el('div', { class: 'login-brand' }, el('span', { class: 'brand-logo-slot', 'aria-hidden': 'true' }), el('div', {}, el('h1', { class: 'h4 mb-0' }, 'Área do cliente'), el('p', { class: 'small text-body-secondary mb-0' }, 'Pedidos, orçamentos, contratos e licenças'))),
  error,
  el('div', { class: 'mb-3' }, el('label', { class: 'form-label', for: 'c-email' }, 'E-mail'), email),
  el('div', { class: 'mb-3' }, el('label', { class: 'form-label', for: 'c-senha' }, 'Senha'), senha),
  btn,
  el('p', { class: 'small text-body-secondary mt-3 mb-1' }, 'O acesso é habilitado pela nossa equipe para clientes com contrato ou pedido.'),
  el('div', { class: 'login-foot' },
    el('button', { class: 'btn btn-link btn-sm p-0', type: 'button', onclick: () => formModal({ title: 'Recuperar senha', size: '', submitLabel: 'Enviar link', fields: [{ name: 'email', label: 'E-mail', type: 'email', required: true }], values: { email: email.value },
      onSubmit: async (v) => { const r = await post('/api/auth/esqueci-senha', v); toast(r.mensagem, 'info'); } }) }, 'Esqueci minha senha'),
    el('a', { href: '/' }, 'Voltar ao site')))));
  email.focus();
}

function renderShell() {
  root.textContent = '';
  main = el('main', { class: 'container client-main', id: 'cliente-main', tabindex: '-1' });
  root.append(el('header', { class: 'client-header' }, el('div', { class: 'container' },
    el('div', { class: 'client-top' },
      el('a', { href: '#/', class: 'brand-mark' }, el('span', { class: 'brand-logo-slot', 'aria-hidden': 'true' }), el('span', {}, 'Área do cliente')),
      el('div', { class: 'client-user' }, el('span', {}, user.nome),
        el('a', { class: 'btn btn-sm btn-outline-ink', href: '/' }, 'Ir ao site'),
        el('button', { class: 'btn btn-sm btn-outline-ink', type: 'button', onclick: async () => { await post('/api/auth/logout').catch(() => {}); user = null; renderLogin(); } }, 'Sair'))),
    el('nav', { class: 'client-nav', 'aria-label': 'Menu da área do cliente' }, NAV.map(([r, l, i]) => el('a', { href: `#/${r}`, dataset: { route: r } }, icon(i), el('span', {}, l)))))), main);
}

const statusBadge = (map, value, good) => badge(map[value] || value, value === good ? 'success' : ['cancelado', 'recusado', 'expirado', 'revogada', 'suspensa', 'expirada', 'suspenso'].includes(value) ? 'danger' : ['aguardando_pagamento', 'aguardando_resposta', 'enviado', 'pendente', 'parcial', 'aberto'].includes(value) ? 'warning' : 'secondary');

const VIEWS = {
  async ''(c) {
    const r = await get('/api/cliente/resumo');
    const card = (label, value, href, ic) => el('div', { class: 'col-6 col-lg-3' }, el('a', { class: 'kpi', href }, el('span', { class: 'kpi-icon' }, icon(ic)), el('div', {}, el('strong', { class: 'kpi-value' }, value), el('span', { class: 'kpi-label' }, label))));
    c.append(el('h1', { class: 'h3 mb-3' }, `Olá, ${user.nome.split(' ')[0]}`),
      el('div', { class: 'row g-3' }, card('Pedidos', r.pedidos, '#/pedidos', 'receipt'), card('Orçamentos aguardando resposta', r.orcamentos_aguardando, '#/orcamentos', 'file-earmark-text'),
        card('Licenças ativas', r.licencas_ativas, '#/contratos', 'patch-check'), card('Chamados abertos', r.chamados_abertos, '#/suporte', 'life-preserver')));
  },
  async pedidos(c, [id]) {
    if (id) {
      const o = await get(`/api/cliente/pedidos/${Number(id)}`);
      c.append(el('a', { href: '#/pedidos', class: 'back-link' }, icon('arrow-left'), ' Pedidos'), el('h1', { class: 'h3' }, `Pedido ${o.numero}`),
        el('p', {}, statusBadge(ORDER, o.status, 'concluido'), ' ', statusBadge(PAY, o.status_pagamento, 'pago'), ` · ${date(o.data_pedido)}${o.data_vencimento ? ` · vencimento ${date(o.data_vencimento)}` : ''}`),
        el('div', { class: 'card mb-3' }, el('div', { class: 'card-body table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Itens do pedido' }, el('table', { class: 'table' },
          el('thead', {}, el('tr', {}, ['Item', 'Qtd.', 'Valor unit.', 'Desconto', 'Total'].map((h) => el('th', {}, h)))),
          el('tbody', {}, o.itens.map((i) => el('tr', {}, el('td', {}, i.descricao), el('td', {}, i.quantidade), el('td', {}, money(i.preco_unitario, o.moeda)), el('td', {}, money(i.desconto, o.moeda)), el('td', {}, money(i.total, o.moeda))))),
          el('tfoot', {}, el('tr', {}, el('td', { colspan: 4, class: 'text-end' }, 'Desconto'), el('td', {}, money(o.desconto, o.moeda))), el('tr', {}, el('th', { colspan: 4, class: 'text-end' }, 'Total'), el('th', {}, money(o.total, o.moeda))))))),
        el('div', { class: 'card' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Pagamentos'),
          o.pagamentos.length ? el('ul', { class: 'mb-0' }, o.pagamentos.map((p) => el('li', {}, `${money(p.valor, o.moeda)} — ${p.status === 'confirmado' ? `confirmado em ${datetime(p.confirmado_em)}` : p.status}`)))
            : el('p', { class: 'text-body-secondary mb-0' }, 'Nenhum pagamento registrado. Pagamentos online ainda não estão disponíveis; combine a forma de pagamento com a nossa equipe.'))));
      return;
    }
    const list = await get('/api/cliente/pedidos');
    c.append(el('h1', { class: 'h3 mb-3' }, 'Pedidos'));
    if (!list.length) { c.append(emptyState('Nenhum pedido', 'Seus pedidos aparecerão aqui.')); return; }
    c.append(el('div', { class: 'list-group' }, list.map((o) => el('a', { class: 'list-group-item list-group-item-action d-flex flex-wrap justify-content-between gap-2', href: `#/pedidos/${o.id}` },
      el('span', {}, el('strong', {}, o.numero), ` · ${date(o.data_pedido)}`), el('span', {}, statusBadge(ORDER, o.status, 'concluido'), ' ', statusBadge(PAY, o.status_pagamento, 'pago'), ` ${money(o.total, o.moeda)}`)))));
  },
  async orcamentos(c, [id]) {
    if (id) {
      const q = await get(`/api/cliente/orcamentos/${Number(id)}`);
      const awaiting = ['enviado', 'aguardando_resposta'].includes(q.status);
      c.append(el('a', { href: '#/orcamentos', class: 'back-link' }, icon('arrow-left'), ' Orçamentos'), el('h1', { class: 'h3' }, `${q.numero} — ${q.titulo}`),
        el('p', {}, statusBadge(QUOTE, q.status, 'aceito'), ` · validade ${date(q.validade)} · total ${money(q.total, q.moeda)}`),
        el('div', { class: 'd-flex flex-wrap gap-2 mb-3' },
          el('a', { class: 'btn btn-outline-secondary', href: `/api/cliente/orcamentos/${q.id}/documento`, target: '_blank', rel: 'noopener' }, icon('printer'), ' Ver documento / imprimir'),
          awaiting ? el('button', { class: 'btn btn-success', type: 'button', onclick: async () => {
            if (!(await confirmDialog({ title: 'Aceitar orçamento', message: `Confirma o aceite do orçamento ${q.numero} no valor de ${money(q.total, q.moeda)}? Nossa equipe entrará em contato para formalizar o pedido.`, confirmLabel: 'Aceitar', danger: false }))) return;
            try { await post(`/api/cliente/orcamentos/${q.id}/resposta`, { resposta: 'aceitar' }); toast('Orçamento aceito. Obrigado!'); route(); } catch (err) { toastError(err); }
          } }, icon('check2'), ' Aceitar') : null,
          awaiting ? el('button', { class: 'btn btn-outline-danger', type: 'button', onclick: () => formModal({ title: 'Recusar orçamento', size: '', submitLabel: 'Recusar', fields: [{ name: 'motivo', label: 'Motivo (opcional)', type: 'textarea', rows: 3 }],
            onSubmit: async (v) => { await post(`/api/cliente/orcamentos/${q.id}/resposta`, { resposta: 'recusar', ...v }); toast('Resposta registrada.'); route(); } }) }, 'Recusar') : null),
        el('div', { class: 'card' }, el('div', { class: 'card-body table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Itens do orçamento' }, el('table', { class: 'table mb-0' },
          el('thead', {}, el('tr', {}, ['Item', 'Qtd.', 'Valor unit.', 'Total'].map((h) => el('th', {}, h)))),
          el('tbody', {}, q.itens.map((i) => el('tr', {}, el('td', {}, i.descricao), el('td', {}, i.quantidade), el('td', {}, money(i.preco_unitario, q.moeda)), el('td', {}, money(i.total, q.moeda)))))))),
        q.condicoes_comerciais ? el('div', { class: 'card mt-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Condições'), el('p', { class: 'pre-wrap mb-0' }, q.condicoes_comerciais))) : null);
      return;
    }
    const list = await get('/api/cliente/orcamentos');
    c.append(el('h1', { class: 'h3 mb-3' }, 'Orçamentos'));
    if (!list.length) { c.append(emptyState('Nenhum orçamento', 'Orçamentos enviados pela nossa equipe aparecerão aqui.')); return; }
    c.append(el('div', { class: 'list-group' }, list.map((q) => el('a', { class: 'list-group-item list-group-item-action d-flex flex-wrap justify-content-between gap-2', href: `#/orcamentos/${q.id}` },
      el('span', {}, el('strong', {}, q.numero), ` · ${q.titulo}`), el('span', {}, statusBadge(QUOTE, q.status, 'aceito'), ` ${money(q.total, q.moeda)}`)))));
  },
  async contratos(c) {
    const [contratos, licencas] = await Promise.all([get('/api/cliente/contratos'), get('/api/cliente/licencas')]);
    c.append(el('h1', { class: 'h3 mb-3' }, 'Contratos e licenças'),
      el('h2', { class: 'h5' }, 'Contratos'),
      contratos.length ? el('div', { class: 'list-group mb-4' }, contratos.map((k) => el('div', { class: 'list-group-item d-flex flex-wrap justify-content-between gap-2' },
        el('span', {}, el('strong', {}, k.numero), ` · ${k.titulo} · ${date(k.data_inicio)} → ${k.data_fim ? date(k.data_fim) : 'indeterminado'}`),
        el('span', {}, statusBadge(CONTRACT, k.status, 'vigente'), k.possui_arquivo ? el('button', { class: 'btn btn-sm btn-link', type: 'button', onclick: () => download(`/api/cliente/contratos/${k.id}/arquivo`, `${k.numero}.pdf`).catch(toastError) }, icon('download'), ' Documento') : null))))
        : emptyState('Nenhum contrato'),
      el('h2', { class: 'h5' }, 'Licenças'),
      licencas.length ? el('div', { class: 'table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Licenças' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, ['Identificador', 'Produto', 'Tipo', 'Validade', 'Situação', 'Limites'].map((h) => el('th', {}, h)))),
        el('tbody', {}, licencas.map((l) => el('tr', {}, el('td', {}, l.identificador), el('td', {}, l.produto_nome), el('td', {}, LIC_TYPE[l.tipo]),
          el('td', {}, `${date(l.data_inicio)} → ${l.data_fim ? date(l.data_fim) : 'sem término'}`), el('td', {}, statusBadge(LIC, l.status, 'ativa')), el('td', {}, l.limites || '—'))))))
        : emptyState('Nenhuma licença'));
  },
  async arquivos(c) {
    const list = await get('/api/cliente/arquivos');
    c.append(el('h1', { class: 'h3 mb-3' }, 'Downloads'));
    if (!list.length) { c.append(emptyState('Nenhum arquivo disponível', 'Arquivos liberados pela nossa equipe (instaladores, manuais, documentos) aparecerão aqui.')); return; }
    c.append(el('div', { class: 'list-group' }, list.map((a) => el('div', { class: 'list-group-item d-flex flex-wrap justify-content-between gap-2 align-items-center' },
      el('div', {}, el('strong', {}, a.titulo), a.descricao ? el('div', { class: 'small text-body-secondary' }, a.descricao) : null, el('div', { class: 'small text-body-secondary' }, `${(a.tamanho / 1024).toFixed(0)} KB · ${date(a.criado_em)}`)),
      el('button', { class: 'btn btn-outline-primary btn-sm', type: 'button', onclick: (e) => { e.currentTarget.disabled = true; download(`/api/cliente/arquivos/${a.id}/download`, a.nome_original).catch(toastError).finally(() => { e.target.disabled = false; }); } }, icon('download'), ' Baixar')))));
  },
  async suporte(c) {
    const [list, produtos] = await Promise.all([get('/api/cliente/chamados'), get('/api/cliente/produtos-licenciados')]);
    c.append(el('div', { class: 'd-flex justify-content-between align-items-center mb-3' }, el('h1', { class: 'h3 mb-0' }, 'Suporte'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => formModal({
        title: 'Abrir chamado',
        fields: [{ name: 'assunto', label: 'Assunto', required: true }, { name: 'produto_id', label: 'Produto', type: 'select', numeric: true, options: produtos.map((p) => [p.id, p.nome]) },
          { name: 'mensagem', label: 'Descreva a solicitação', type: 'textarea', rows: 6, required: true }],
        onSubmit: async (v) => { await post('/api/cliente/chamados', v); toast('Chamado aberto. Responderemos por aqui.'); route(); }
      }) }, icon('plus-lg'), ' Abrir chamado')));
    if (!list.length) { c.append(emptyState('Nenhum chamado', 'Abra um chamado para dúvidas ou solicitações de suporte.')); return; }
    c.append(list.map((t) => el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' },
      el('div', { class: 'd-flex flex-wrap justify-content-between gap-2' }, el('h2', { class: 'h6 mb-1' }, t.assunto), el('span', {}, statusBadge(TICKET, t.status, 'respondido'))),
      el('p', { class: 'small text-body-secondary' }, `${datetime(t.criado_em)}${t.produto_nome ? ` · ${t.produto_nome}` : ''}`),
      el('p', { class: 'pre-wrap' }, t.mensagem),
      t.resposta ? el('div', { class: 'alert alert-light border mb-0' }, el('strong', {}, 'Resposta da equipe'), el('p', { class: 'pre-wrap mb-0' }, t.resposta)) : null))));
  },
  async dados(c) {
    const p = await get('/api/cliente/perfil');
    const form = buildForm([
      { name: 'nome', label: 'Nome', required: true, col: 6 }, { name: 'email', label: 'E-mail (para alterar, fale com a equipe)', readonly: true, col: 6 },
      { name: 'telefone', label: 'Telefone', col: 6 }, { name: 'empresa', label: 'Empresa', col: 6 }
    ], p);
    const pass = buildForm([
      { name: 'senha_atual', label: 'Senha atual', type: 'password', required: true, col: 12 },
      { name: 'nova_senha', label: 'Nova senha', type: 'password', required: true, col: 6, help: 'Mínimo de 10 caracteres, com letras e números.' },
      { name: 'confirmacao', label: 'Confirmação', type: 'password', required: true, col: 6 }
    ]);
    c.append(el('h1', { class: 'h3 mb-3' }, 'Meus dados'),
      el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, form.node, el('button', { class: 'btn btn-primary mt-3', type: 'button', onclick: async (e) => {
        if (!form.validate()) return;
        e.currentTarget.disabled = true;
        try { await put('/api/cliente/perfil', form.values()); toast('Dados atualizados.'); } catch (err) { form.showErrors(err.fields || {}, err.message); } finally { e.target.disabled = false; }
      } }, 'Salvar dados'))),
      el('div', { class: 'card mb-3' }, el('div', { class: 'card-body' }, el('h2', { class: 'h6' }, 'Alterar senha'), pass.node, el('button', { class: 'btn btn-outline-primary mt-3', type: 'button', onclick: async () => {
        if (!pass.validate()) return;
        const v = pass.values();
        if (v.nova_senha !== v.confirmacao) { pass.showErrors({ confirmacao: 'As senhas não conferem.' }); return; }
        try { const r = await post('/api/auth/alterar-senha', { senha_atual: v.senha_atual, nova_senha: v.nova_senha }); toast(r.mensagem); pass.node.reset(); } catch (err) { pass.showErrors(err.fields || {}, err.message); }
      } }, 'Alterar senha'))),
      el('p', { class: 'small text-body-secondary' }, 'Para solicitar acesso, correção ou exclusão de dados pessoais, use o ', el('a', { href: '/privacidade/solicitacao' }, 'formulário de solicitações de titulares'), '.'));
  }
};

async function route() {
  if (!user) return;
  const [name = '', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  main.closest('body').querySelectorAll('.client-nav a').forEach((a) => {
    const active = a.dataset.route === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  main.textContent = '';
  main.append(loading());
  const view = VIEWS[name];
  try {
    if (!view) throw new Error('Página não encontrada.');
    const box = el('div');
    await view(box, params);
    main.textContent = '';
    main.append(box);
    main.focus({ preventScroll: true });
  } catch (err) { main.textContent = ''; main.append(errorState(err, route)); }
}

async function boot() {
  try {
    const me = await get('/api/auth/me');
    if (me.usuario.tipo !== 'cliente') {
      root.textContent = '';
      root.append(el('main', { class: 'login-wrap' }, el('div', { class: 'login-card' }, el('h1', { class: 'h5' }, 'Você está conectado como equipe'),
        el('p', {}, 'A área do cliente é exclusiva para contas de clientes.'), el('a', { class: 'btn btn-primary', href: '/admin' }, 'Ir para o painel'))));
      return;
    }
    setCsrf(me.csrf);
    user = me.usuario;
    renderShell();
    route();
  } catch (err) {
    if (err.status === 401) renderLogin(); else { root.textContent = ''; root.append(errorState(err, boot)); }
  }
}

window.addEventListener('hashchange', route);
boot();
