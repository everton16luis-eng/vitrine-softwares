import { showErrors } from './forms.js';

const form = document.querySelector('[data-reset-form]');
const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
// Remove o token da barra de endereços e do histórico assim que lido.
history.replaceState(null, '', location.pathname + (params.get('convite') ? '?convite=1' : ''));

if (form) {
  const error = form.querySelector('[data-form-error]');
  const success = form.querySelector('[data-form-success]');
  if (token.length !== 64) {
    error.textContent = 'Link inválido ou incompleto. Solicite um novo link.';
    error.classList.remove('d-none');
    form.querySelector('[data-submit]').disabled = true;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.classList.add('d-none');
    const senha = form.senha.value;
    const errors = {};
    if (senha.length < 10) errors.senha = 'A senha deve ter ao menos 10 caracteres.';
    else if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) errors.senha = 'Use letras e números.';
    if (form.confirmacao.value !== senha) errors.confirmacao = 'As senhas não conferem.';
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    const btn = form.querySelector('[data-submit]');
    btn.disabled = true;
    try {
      const res = await fetch('/api/auth/redefinir-senha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token, senha })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.campos) showErrors(form, data.campos);
        error.textContent = data.erro || 'Não foi possível salvar a senha.';
        error.classList.remove('d-none');
        btn.disabled = false;
        return;
      }
      form.querySelectorAll('.mb-3, [data-submit]').forEach((el) => el.classList.add('d-none'));
      success.innerHTML = '';
      success.append(document.createTextNode(`${data.mensagem} `));
      const a1 = Object.assign(document.createElement('a'), { href: '/cliente', textContent: 'Área do cliente' });
      const a2 = Object.assign(document.createElement('a'), { href: '/admin', textContent: 'Painel administrativo' });
      success.append(a1, document.createTextNode(' · '), a2);
      success.classList.remove('d-none');
    } catch {
      error.textContent = 'Falha de conexão.';
      error.classList.remove('d-none');
      btn.disabled = false;
    }
  });
}
