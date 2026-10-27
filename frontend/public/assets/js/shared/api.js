// Cliente HTTP compartilhado pelo painel e pela área do cliente.
// Envia o token CSRF em todas as requisições que alteram estado.

let csrf = null;
let onUnauthorized = () => {};

export const setCsrf = (token) => { csrf = token; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.fields = data.campos || null;
    this.code = data.codigo;
  }
}

export async function api(path, { method = 'GET', body, form, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (form) payload = form; // FormData (upload): o navegador define o Content-Type
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Falha de conexão com o servidor.', 0);
  }
  if (raw) {
    if (!res.ok) throw new ApiError('Não foi possível concluir o download.', res.status);
    return res;
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError(data.erro || 'Erro inesperado.', res.status, data);
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const del = (p) => api(p, { method: 'DELETE' });

/** Baixa um arquivo autenticado (CSV, JSON) sem expor o conteúdo em URLs. */
export async function download(path, filename) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
