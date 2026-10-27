// Template HTML com escape automático: todo valor interpolado é escapado,
// exceto fragmentos produzidos pelo próprio `html` ou marcados com `raw()`.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

/** Marca uma string como HTML confiável. Use apenas com conteúdo gerado pelo sistema. */
export const raw = (value) => new SafeHtml(String(value ?? ''));

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Serializa JSON para uso seguro em <script type="application/ld+json">. */
export function jsonForScript(data) {
  return raw(JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}

/** Permite apenas URLs http(s), mailto, tel, wa.me ou relativas; demais viram "#". */
export function safeUrl(url) {
  if (!url) return '#';
  const s = String(url).trim();
  if (/^\/(?!\/)/.test(s) || s.startsWith('#')) return s;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  return '#';
}
