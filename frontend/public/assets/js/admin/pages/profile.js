import { post } from '../../shared/api.js';
import { el, icon, buildForm, toast } from '../../shared/ui.js';
import { pageHeader } from './_crud.js';

export function render(c, ctx) {
  const form = buildForm([
    { name: 'senha_atual', label: 'Senha atual', type: 'password', required: true, col: 12 },
    { name: 'nova_senha', label: 'Nova senha', type: 'password', required: true, col: 6, help: 'Mínimo de 10 caracteres, com letras e números.' },
    { name: 'confirmacao', label: 'Confirme a nova senha', type: 'password', required: true, col: 6 }
  ]);
  const save = el('button', { class: 'btn btn-primary mt-3', type: 'button', onclick: async () => {
    if (!form.validate()) return;
    const v = form.values();
    if (v.nova_senha !== v.confirmacao) { form.showErrors({ confirmacao: 'As senhas não conferem.' }); return; }
    save.disabled = true;
    try { const r = await post('/api/auth/alterar-senha', { senha_atual: v.senha_atual, nova_senha: v.nova_senha }); toast(r.mensagem); form.node.reset(); }
    catch (err) { form.showErrors(err.fields || {}, err.message); } finally { save.disabled = false; }
  } }, icon('key'), ' Alterar senha');
  c.append(pageHeader('Minha senha', `${ctx.user.nome} · ${ctx.user.email}`), el('div', { class: 'card', style: null }, el('div', { class: 'card-body narrow-form' }, form.node, save)));
}
