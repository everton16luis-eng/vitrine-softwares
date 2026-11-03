import { enhanceForms } from './forms.js';

// Aviso de cookies: apenas informativo (somente cookies essenciais). A preferência
// de "já visto" fica no navegador do visitante — não é dado do sistema.
function cookieNotice() {
  const box = document.querySelector('[data-cookie-notice]');
  if (!box) return;
  let seen = false;
  try { seen = localStorage.getItem('aviso-cookies') === '1'; } catch { /* armazenamento indisponível */ }
  if (seen) return;
  box.hidden = false;
  box.querySelector('[data-cookie-ok]')?.addEventListener('click', () => {
    try { localStorage.setItem('aviso-cookies', '1'); } catch { /* ignora */ }
    box.hidden = true;
  });
}

// Botões "Contratar este plano" preenchem o assunto do formulário de orçamento.
function planButtons() {
  document.querySelectorAll('[data-select-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = document.querySelector('#solicitar input[name="assunto"]');
      if (field) field.value = `Interesse no plano: ${btn.dataset.selectPlan}`;
    });
  });
}

// Fecha o menu móvel ao navegar para uma âncora.
function mobileMenu() {
  const nav = document.getElementById('nav-principal');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a') && nav.classList.contains('show') && window.bootstrap) {
      window.bootstrap.Collapse.getOrCreateInstance(nav).hide();
    }
  });
}

export function toast(message, tone = 'success') {
  const region = document.querySelector('[data-toasts]');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `alert alert-${tone} shadow-sm mb-0`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  region.append(el);
  setTimeout(() => el.remove(), 5000);
}

// Carrossel de clientes e parceiros: velocidade constante, qualquer que seja o número de marcas.
function partnersMarquee() {
  document.querySelectorAll('[data-partners-marquee]').forEach((box) => {
    const n = Number(box.dataset.count) || 10;
    box.style.setProperty('--marquee-duration', `${Math.round(Math.max(20, n * 3.2))}s`);
  });
}

cookieNotice();
planButtons();
partnersMarquee();
mobileMenu();
enhanceForms();
