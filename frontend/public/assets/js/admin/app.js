// Painel administrativo: autenticação, layout e roteamento por hash (#/rota/id).
// A interface esconde itens sem permissão apenas por usabilidade — o servidor
// valida todas as permissões em cada requisição.
import { api, get, post, setCsrf, setUnauthorizedHandler } from '../shared/api.js';
import { el, icon, toast, toastError, loading, errorState, datetime } from '../shared/ui.js';
import { pickImage } from './media-picker.js';

const ROUTES = {
  '': () => import('./pages/dashboard.js'),
  produtos: () => import('./pages/products.js'),
  categorias: () => import('./pages/categories.js'),
  servicos: () => import('./pages/services.js'),
  planos: () => import('./pages/plans.js'),
  midia: () => import('./pages/media.js'),
  conteudo: () => import('./pages/content.js'),
  parceiros: () => import('./pages/partners.js'),
  leads: () => import('./pages/leads.js'),
  clientes: () => import('./pages/customers.js'),
  orcamentos: () => import('./pages/quotes.js'),
  pedidos: () => import('./pages/orders.js'),
  contratos: () => import('./pages/contracts.js'),
  suporte: () => import('./pages/support.js'),
  implantacoes: () => import('./pages/deployments.js'),
  receitas: () => import('./pages/recipes.js'),
  dominios: () => import('./pages/domains.js'),
  lgpd: () => import('./pages/privacy.js'),
  relatorios: () => import('./pages/reports.js'),
  auditoria: () => import('./pages/audit.js'),
  usuarios: () => import('./pages/users.js'),
  configuracoes: () => import('./pages/settings.js'),
  perfil: () => import('./pages/profile.js')
};

const MENU = [
  { group: 'Visão geral', items: [{ route: '', label: 'Painel', icon: 'speedometer2', perm: 'dashboard.ver' }] },
  { group: 'Catálogo', items: [
    { route: 'produtos', label: 'Produtos', icon: 'box-seam', perm: 'produtos.ver' },
    { route: 'categorias', label: 'Categorias', icon: 'tags', perm: 'categorias.ver' },
    { route: 'servicos', label: 'Serviços', icon: 'tools', perm: 'servicos.ver' },
    { route: 'planos', label: 'Planos e preços', icon: 'currency-dollar', perm: 'planos.ver' }
  ] },
  { group: 'Comercial', items: [
    { route: 'leads', label: 'Contatos e leads', icon: 'inbox', perm: 'leads.ver' },
    { route: 'clientes', label: 'Clientes', icon: 'people', perm: 'clientes.ver' },
    { route: 'orcamentos', label: 'Orçamentos', icon: 'file-earmark-text', perm: 'orcamentos.ver' },
    { route: 'pedidos', label: 'Pedidos e pagamentos', icon: 'receipt', perm: 'pedidos.ver' },
    { route: 'contratos', label: 'Contratos e licenças', icon: 'file-earmark-lock', perm: 'contratos.ver' },
    { route: 'suporte', label: 'Chamados', icon: 'life-preserver', perm: 'suporte.ver' }
  ] },
  { group: 'Implantação', items: [
    { route: 'implantacoes', label: 'Implantações', icon: 'rocket-takeoff', perm: 'implantacoes.ver' },
    { route: 'receitas', label: 'Receitas por software', icon: 'diagram-3', perm: 'implantacoes.ver' },
    { route: 'dominios', label: 'Domínios e SSL', icon: 'globe2', perm: 'implantacoes.ver' }
  ] },
  { group: 'Conteúdo', items: [
    { route: 'conteudo', label: 'Páginas e textos', icon: 'layout-text-window', perm: 'conteudo.ver' },
    { route: 'parceiros', label: 'Clientes e parceiros', icon: 'buildings', perm: 'parceiros.ver' },
    { route: 'midia', label: 'Biblioteca de mídia', icon: 'images', perm: 'midia.ver' }
  ] },
  { group: 'Gestão', items: [
    { route: 'relatorios', label: 'Relatórios', icon: 'bar-chart-line', perm: 'relatorios.ver' },
    { route: 'lgpd', label: 'Privacidade (LGPD)', icon: 'shield-lock', perm: 'lgpd.ver' },
    { route: 'auditoria', label: 'Auditoria', icon: 'journal-check', perm: 'auditoria.ver' },
    { route: 'usuarios', label: 'Usuários e perfis', icon: 'person-gear', perm: 'usuarios.ver' },
    { route: 'configuracoes', label: 'Configurações', icon: 'gear', perm: 'configuracoes.ver' }
  ] }
];

const root = document.getElementById('app');
const ctx = {
  user: null,
  can(perm) { return this.user?.permissoes.includes('*') || this.user?.permissoes.includes(perm); },
  navigate(path) { location.hash = `#/${path}`; },
  pickImage: () => pickImage(),
  _opcoes: null,
  async opcoes(force = false) {
    if (!this._opcoes || force) this._opcoes = await get('/api/admin/opcoes');
    return this._opcoes;
  }
};

setUnauthorizedHandler(() => { if (ctx.user) { ctx.user = null; toast('Sua sessão expirou. Entre novamente.', 'warning'); renderLogin(); } });

// ---------------------------------------------------------------- login
function renderLogin() {
  root.textContent = '';
  const email = el('input', { class: 'form-control', type: 'email', id: 'login-email', autocomplete: 'username', required: true });
  const senha = el('input', { class: 'form-control', type: 'password', id: 'login-senha', autocomplete: 'current-password', required: true });
  const error = el('div', { class: 'alert alert-danger d-none', role: 'alert' });
  const btn = el('button', { class: 'btn btn-primary w-100', type: 'submit' }, 'Entrar');
  const form = el('form', { class: 'login-card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.classList.add('d-none');
    if (!email.value || !senha.value) { error.textContent = 'Informe e-mail e senha.'; error.classList.remove('d-none'); return; }
    btn.disabled = true;
    try {
      const r = await post('/api/auth/login', { email: email.value, senha: senha.value, area: 'admin' });
      setCsrf(r.csrf);
      await boot();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('d-none');
      senha.value = '';
      senha.focus();
    } finally { btn.disabled = false; }
  } },
  el('div', { class: 'login-brand' }, el('span', { class: 'brand-mark' }, 'A'), el('div', {}, el('h1', { class: 'h4 mb-0' }, 'Painel administrativo'), el('p', { class: 'text-body-secondary mb-0 small' }, 'Acesso restrito à equipe'))),
  error,
  el('div', { class: 'mb-3' }, el('label', { class: 'form-label', for: 'login-email' }, 'E-mail'), email),
  el('div', { class: 'mb-3' }, el('label', { class: 'form-label', for: 'login-senha' }, 'Senha'), senha),
  btn,
  el('div', { class: 'd-flex justify-content-between mt-3 small' },
    el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', onclick: () => forgot(email.value) }, 'Esqueci minha senha'),
    el('a', { href: '/' }, 'Voltar ao site')));
  root.append(el('main', { class: 'login-wrap', id: 'admin-main' }, form));
  email.focus();
}

async function forgot(prefill) {
  const { formModal } = await import('../shared/ui.js');
  formModal({
    title: 'Recuperar acesso', submitLabel: 'Enviar link', size: '',
    fields: [{ name: 'email', label: 'E-mail cadastrado', type: 'email', required: true }],
    values: { email: prefill },
    onSubmit: async (v) => { const r = await post('/api/auth/esqueci-senha', v); toast(r.mensagem, 'info'); }
  });
}

// ---------------------------------------------------------------- layout
let main;
let navNode;
async function renderShell() {
  root.textContent = '';
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => ctx.can(i.perm)) })).filter((g) => g.items.length);
  navNode = el('nav', { class: 'admin-sidebar', id: 'admin-sidebar', 'aria-label': 'Menu administrativo' },
    el('a', { class: 'admin-brand', href: '#/' }, el('span', { class: 'brand-mark' }, 'A'), el('span', {}, 'Administração')),
    groups.map((g) => el('div', { class: 'nav-group' }, el('p', { class: 'nav-group-title' }, g.group),
      el('ul', {}, g.items.map((i) => el('li', {}, el('a', { href: `#/${i.route}`, dataset: { route: i.route } }, icon(i.icon), el('span', {}, i.label))))))),
    el('div', { class: 'sidebar-footer' }, el('a', { href: '/', target: '_blank', rel: 'noopener' }, icon('box-arrow-up-right'), ' Ver site')));

  const bell = el('button', { class: 'btn btn-icon position-relative', type: 'button', 'aria-label': 'Notificações', onclick: showNotifications }, icon('bell'), el('span', { class: 'notif-count d-none' }));
  const header = el('header', { class: 'admin-header' },
    el('button', { class: 'btn btn-icon d-lg-none', type: 'button', 'aria-label': 'Abrir menu', 'aria-controls': 'admin-sidebar', onclick: () => document.body.classList.toggle('sidebar-open') }, icon('list')),
    el('div', { class: 'flex-grow-1' }),
    bell,
    el('div', { class: 'dropdown' },
      el('button', { class: 'btn btn-user dropdown-toggle', type: 'button', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false' }, icon('person-circle'), el('span', { class: 'd-none d-sm-inline' }, ` ${ctx.user.nome}`)),
      el('ul', { class: 'dropdown-menu dropdown-menu-end' },
        el('li', {}, el('span', { class: 'dropdown-item-text small text-body-secondary' }, ctx.user.perfis.join(', '))),
        el('li', {}, el('a', { class: 'dropdown-item', href: '#/perfil' }, icon('key'), ' Minha senha')),
        el('li', {}, el('button', { class: 'dropdown-item', type: 'button', onclick: logout }, icon('box-arrow-right'), ' Sair')))));
  main = el('main', { class: 'admin-main', id: 'admin-main', tabindex: '-1' });
  root.append(el('div', { class: 'admin-layout' }, navNode, el('div', { class: 'admin-content' }, header, main)),
    el('div', { class: 'sidebar-backdrop', onclick: () => document.body.classList.remove('sidebar-open') }));
  refreshNotificationCount(bell);
  setInterval(() => refreshNotificationCount(bell), 60_000);
}

async function refreshNotificationCount(bell) {
  try {
    const n = await get('/api/admin/notificacoes');
    const badgeNode = bell.querySelector('.notif-count');
    badgeNode.textContent = n.nao_lidas > 9 ? '9+' : String(n.nao_lidas);
    badgeNode.classList.toggle('d-none', !n.nao_lidas);
    bell.setAttribute('aria-label', `Notificações (${n.nao_lidas} não lidas)`);
  } catch { /* silencioso */ }
}

async function showNotifications() {
  const { infoModal } = await import('../shared/ui.js');
  const body = el('div', {}, loading());
  const modal = infoModal({ title: 'Notificações', body });
  try {
    const n = await get('/api/admin/notificacoes');
    body.textContent = '';
    if (!n.itens.length) body.append(el('p', { class: 'text-body-secondary' }, 'Nenhuma notificação.'));
    body.append(el('ul', { class: 'list-group' }, n.itens.map((i) => el('li', { class: `list-group-item ${i.lida ? '' : 'fw-semibold'}` },
      i.link ? el('a', { href: i.link, onclick: () => modal.close() }, i.titulo) : i.titulo,
      i.mensagem ? el('div', { class: 'small text-body-secondary fw-normal' }, i.mensagem) : null,
      el('div', { class: 'small text-body-secondary fw-normal' }, datetime(i.criado_em))))));
    if (n.nao_lidas) await post('/api/admin/notificacoes/lidas', {});
    refreshNotificationCount(document.querySelector('.admin-header .btn-icon[aria-label^="Notificações"]'));
  } catch (err) { body.textContent = ''; body.append(errorState(err)); }
}

async function logout() {
  try { await post('/api/auth/logout'); } catch { /* ignora */ }
  ctx.user = null;
  setCsrf(null);
  renderLogin();
}

// ---------------------------------------------------------------- roteamento
let renderSeq = 0;
async function route() {
  if (!ctx.user) return;
  document.body.classList.remove('sidebar-open');
  const [pathPart, queryPart = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...params] = pathPart.split('/');
  ctx.query = new URLSearchParams(queryPart);
  const seq = ++renderSeq;
  navNode.querySelectorAll('a[data-route]').forEach((a) => {
    const active = a.dataset.route === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  main.textContent = '';
  main.append(loading());
  const loader = ROUTES[name] ?? null;
  if (!loader) { main.textContent = ''; main.append(errorState(new Error('Página não encontrada.'))); return; }
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;
    main.textContent = '';
    await mod.render(main, ctx, params);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== renderSeq) return;
    main.textContent = '';
    main.append(errorState(err, route));
    if (err.status !== 403) console.error(err);
  }
}

async function boot() {
  try {
    const me = await get('/api/auth/me');
    if (me.usuario.tipo !== 'equipe') { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); renderLogin(); return; }
    setCsrf(me.csrf);
    ctx.user = me.usuario;
    ctx._opcoes = null;
    await renderShell();
    if (!location.hash || location.hash === '#') location.hash = ctx.can('dashboard.ver') ? '#/' : `#/${MENU.flatMap((g) => g.items).find((i) => ctx.can(i.perm))?.route || 'perfil'}`;
    route();
  } catch (err) {
    if (err.status === 401) renderLogin();
    else { root.textContent = ''; root.append(errorState(err, boot)); toastError(err); }
  }
}

window.addEventListener('hashchange', route);
boot();
