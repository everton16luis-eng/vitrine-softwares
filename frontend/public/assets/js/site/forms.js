// Aprimoramento progressivo dos formulários públicos: validação acessível no
// navegador, envio via fetch, prevenção de envios duplicados e exibição dos
// erros devolvidos pelo servidor (que também valida tudo).

/** Converte FormData com nomes "a[b]" e "a[b][]" em objeto aninhado. */
export function formToObject(form) {
  const out = {};
  for (const [rawKey, value] of new FormData(form).entries()) {
    const parts = rawKey.replace(/\]/g, '').split('[');
    let node = out;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      if (last) {
        if (part === '') return;
        node[part] = value;
      } else if (parts[i + 1] === '' ) {
        node[part] = Array.isArray(node[part]) ? node[part] : [];
        node[part].push(value);
      } else {
        node[part] = node[part] && typeof node[part] === 'object' ? node[part] : {};
        node = node[part];
      }
    });
  }
  return out;
}

const MESSAGES = {
  valueMissing: 'Campo obrigatório.',
  typeMismatch: 'Formato inválido.',
  tooShort: (el) => `Informe ao menos ${el.minLength} caracteres.`,
  tooLong: (el) => `Use no máximo ${el.maxLength} caracteres.`
};

function fieldError(el) {
  const v = el.validity;
  if (v.valid) return '';
  if (el.type === 'checkbox' && v.valueMissing) return 'É necessário marcar esta opção.';
  if (el.type === 'email' && v.typeMismatch) return 'Informe um e-mail válido.';
  for (const key of Object.keys(MESSAGES)) if (v[key]) return typeof MESSAGES[key] === 'function' ? MESSAGES[key](el) : MESSAGES[key];
  return 'Valor inválido.';
}

export function showErrors(form, errors = {}) {
  form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`) || form.querySelector(`[name^="${CSS.escape(name)}["]`);
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (input) { input.classList.add('is-invalid'); input.setAttribute('aria-invalid', 'true'); first ||= input; }
    if (slot) slot.textContent = msg;
  }
  first?.focus();
}

function validateLocally(form) {
  const errors = {};
  form.querySelectorAll('input, select, textarea').forEach((el) => {
    if (el.closest('.hp-field') || el.type === 'hidden') return;
    el.removeAttribute('aria-invalid');
    const msg = fieldError(el);
    if (msg) errors[el.name] = msg;
  });
  return errors;
}

function setBusy(form, busy) {
  const btn = form.querySelector('[data-submit]');
  const spinner = form.querySelector('[data-spinner]');
  if (btn) { btn.disabled = busy; btn.setAttribute('aria-busy', String(busy)); }
  spinner?.classList.toggle('d-none', !busy);
}

async function refreshToken(form) {
  const input = form.querySelector('input[name="form_token"]');
  if (!input) return;
  try {
    const res = await fetch('/api/publico/form-token', { credentials: 'same-origin' });
    if (res.ok) input.value = (await res.json()).token;
  } catch { /* mantém o token atual */ }
}

export function enhanceForms(root = document) {
  root.querySelectorAll('form[data-ajax-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.sending === '1') return; // impede envio duplicado
      const generalError = form.querySelector('[data-form-error]');
      const success = form.querySelector('[data-form-success]');
      generalError?.classList.add('d-none');

      const local = validateLocally(form);
      if (Object.keys(local).length) {
        showErrors(form, local);
        if (generalError) { generalError.textContent = 'Verifique os campos destacados.'; generalError.classList.remove('d-none'); }
        return;
      }
      showErrors(form, {});
      form.dataset.sending = '1';
      setBusy(form, true);
      try {
        const body = formToObject(form);
        for (const key of ['consentimento', 'aceita_comunicacoes']) if (form.querySelector(`[name="${key}"]`)) body[key] = form.querySelector(`[name="${key}"]`).checked;
        const res = await fetch(form.dataset.ajaxForm, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.campos) showErrors(form, data.campos);
          if (generalError) { generalError.textContent = data.erro || 'Não foi possível enviar. Tente novamente.'; generalError.classList.remove('d-none'); generalError.focus?.(); }
          if (data.codigo === 'FORM_TOKEN') await refreshToken(form);
          return;
        }
        // Sucesso: oculta os campos e mostra a confirmação.
        [...form.children].forEach((el) => { if (el !== success) el.classList.add('d-none'); });
        if (success) {
          success.textContent = data.mensagem || 'Enviado com sucesso.';
          success.classList.remove('d-none');
          success.focus();
        }
      } catch {
        if (generalError) { generalError.textContent = 'Falha de conexão. Verifique sua internet e tente novamente.'; generalError.classList.remove('d-none'); }
      } finally {
        form.dataset.sending = '0';
        setBusy(form, false);
      }
    });
  });
}
