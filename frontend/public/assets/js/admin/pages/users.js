import { get, post, put } from '../../shared/api.js';
import { el, icon, badge, datetime, dataTable, formModal, infoModal, confirmDialog, toast, toastError, withBusy } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

function showLink(r) {
  if (!r.link_acesso) { toast(r.mensagem); return; }
  const input = el('input', { class: 'form-control', readonly: true, value: r.link_acesso, onfocus: (e) => e.target.select() });
  infoModal({ title: 'Link de acesso (exibido uma única vez)', body: el('div', {}, el('p', {}, r.mensagem), input,
    el('button', { class: 'btn btn-sm btn-outline-secondary mt-2', type: 'button', onclick: () => navigator.clipboard?.writeText(r.link_acesso).then(() => toast('Link copiado.')) }, icon('clipboard'), ' Copiar')) });
}

export async function render(c, ctx) {
  const canEdit = ctx.can('usuarios.editar');
  let roles = await get('/api/admin/perfis');
  const roleOptions = () => roles.perfis.map((p) => [p.id, p.nome]);
  const table = dataTable({
    caption: 'Usuários',
    columns: [
      { label: 'Usuário', render: (r) => el('div', {}, el('strong', {}, r.nome), el('div', { class: 'small text-body-secondary' }, r.email)) },
      { label: 'Perfis', render: (r) => r.perfis.map((p) => badge(p.nome, p.codigo === 'administrador' ? 'dark' : 'light border')) },
      { label: 'Situação', render: (r) => [r.ativo ? badge('Ativo', 'success') : badge('Inativo', 'secondary'), r.bloqueado ? badge('Bloqueado temporariamente', 'warning') : null, !r.senha_definida ? badge('Convite pendente', 'info') : null] },
      { label: 'Último acesso', render: (r) => datetime(r.ultimo_login_em) },
      ...(canEdit ? [{ label: '', class: 'text-end', render: (r) => el('div', { class: 'btn-group btn-group-sm' },
        el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: () => edit(r) }, 'Editar'),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', onclick: async (e) => {
          if (!(await confirmDialog({ title: 'Redefinir acesso', message: `Gerar novo link de definição de senha para ${r.nome}? As sessões atuais serão encerradas.`, confirmLabel: 'Gerar link', danger: false }))) return;
          const res = await withBusy(e.currentTarget, () => post(`/api/admin/usuarios/${r.id}/redefinir-acesso`));
          if (res) showLink(res);
        } }, 'Redefinir acesso')) }] : [])
    ],
    load: (page) => get(`/api/admin/usuarios?pagina=${page}`)
  });

  function edit(u) {
    formModal({
      title: u ? `Editar ${u.nome}` : 'Novo usuário da equipe',
      fields: [
        { name: 'nome', label: 'Nome', required: true, col: 6 }, { name: 'email', label: 'E-mail', type: 'email', required: true, col: 6 },
        { name: 'perfis', label: 'Perfis de acesso', type: 'checklist', numeric: true, options: roleOptions },
        { name: 'ativo', label: 'Conta ativa', type: 'checkbox' },
        u ? null : { type: 'section', label: 'Senha', help: 'O usuário define a própria senha por um link de uso único (enviado por e-mail ou exibido para você copiar).' }
      ].filter(Boolean),
      values: u ? { ...u, perfis: u.perfis.map((p) => p.id) } : { ativo: true, perfis: [] },
      onSubmit: async (v) => {
        if (u) { await put(`/api/admin/usuarios/${u.id}`, v); toast('Usuário atualizado. Se as permissões mudaram, ele precisará entrar novamente.'); }
        else { const r = await post('/api/admin/usuarios', v); showLink(r); }
        table.refresh();
      }
    });
  }

  const rolesBox = el('div');
  function drawRoles() {
    rolesBox.textContent = '';
    const groups = [...new Set(roles.permissoes.map((p) => p.grupo))];
    rolesBox.append(el('div', { class: 'row g-3' }, roles.perfis.map((r) => el('div', { class: 'col-md-6 col-xl-3' }, el('div', { class: 'card h-100' }, el('div', { class: 'card-body' },
      el('h3', { class: 'h6' }, r.nome), el('p', { class: 'small text-body-secondary' }, r.descricao),
      el('p', { class: 'small mb-2' }, r.codigo === 'administrador' ? 'Acesso integral (fixo).' : `${r.permissoes.length} permissões`),
      canEdit && r.codigo !== 'administrador' ? el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => formModal({
        title: `Permissões — ${r.nome}`, size: 'modal-xl',
        fields: groups.map((g) => ({ name: `g_${g}`, label: g.toUpperCase(), type: 'checklist',
          options: roles.permissoes.filter((p) => p.grupo === g && !p.somente_admin && (r.codigo !== 'consulta' || p.codigo.endsWith('.ver'))).map((p) => [p.codigo, `${p.descricao} (${p.codigo})`]) })),
        values: Object.fromEntries(groups.map((g) => [`g_${g}`, r.permissoes])),
        onSubmit: async (v) => { roles = await put(`/api/admin/perfis/${r.id}/permissoes`, { permissoes: Object.values(v).flat() }); toast('Permissões atualizadas.'); drawRoles(); }
      }) }, 'Editar permissões') : null))))));
  }

  c.append(pageHeader('Usuários e perfis', 'Somente administradores gerenciam usuários. Ninguém se torna administrador pelo site público ou por parâmetros da requisição.',
    canEdit ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => edit(null) }, icon('person-plus'), ' Novo usuário') : null),
  el('div', { class: 'card mb-4' }, el('div', { class: 'card-body' }, table.node)),
  el('h2', { class: 'h5' }, 'Perfis de acesso'), rolesBox);
  table.refresh();
  drawRoles();
}

export { toastError };
