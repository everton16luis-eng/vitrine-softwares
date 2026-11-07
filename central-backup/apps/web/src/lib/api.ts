// Cliente da API do painel. A sessão fica num cookie HttpOnly (SameSite=Strict); toda requisição que
// altera estado leva o token CSRF devolvido pelo login e por /auth/me.
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  constructor(status: number, message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.status = status; this.code = code; this.fields = fields;
  }
}

let csrf: string | null = null;
export const setCsrf = (v: string | null) => { csrf = v; };

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (fn: Listener) => { unauthorizedListeners.add(fn); return () => { unauthorizedListeners.delete(fn); }; };

export async function request(method: string, path: string, body?: unknown, opts: { raw?: boolean; signal?: AbortSignal } = {}) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
  if (!res.ok) {
    let title = `Erro ${res.status}`; let code: string | undefined; let fields: Record<string, string> | undefined;
    try {
      const p = await res.json();
      title = p.title ?? p.message ?? title; code = p.code; fields = p.fields;
    } catch { /* corpo não é JSON */ }
    if (res.status === 401 && !path.startsWith('/api/v1/auth/')) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, title, code, fields);
  }
  if (opts.raw) return res;
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('json') ? res.json() : res.text();
}

export const api = {
  get: <T = any>(path: string, signal?: AbortSignal) => request('GET', path, undefined, { signal }) as Promise<T>,
  post: <T = any>(path: string, body?: unknown) => request('POST', path, body ?? {}) as Promise<T>,
  patch: <T = any>(path: string, body: unknown) => request('PATCH', path, body) as Promise<T>,
  put: <T = any>(path: string, body: unknown) => request('PUT', path, body) as Promise<T>,
  del: <T = any>(path: string) => request('DELETE', path) as Promise<T>
};

/** Monta a query string sem campos vazios. */
export function qs(params: Record<string, unknown>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Carrega um GET e expõe recarga; `path` nulo não busca nada. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const ctrl = useRef<AbortController | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!path) { setData(null); setLoading(false); return; }
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    if (!silent) setLoading(true);
    try {
      const d = await api.get<T>(path, c.signal);
      if (!c.signal.aborted) { setData(d); setError(null); }
    } catch (e) {
      if (!c.signal.aborted) setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { void load(); return () => ctrl.current?.abort(); }, [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

/** Baixa um arquivo da API (relatórios, playbook) respeitando a sessão. */
export async function download(path: string, fallbackName: string) {
  const res = (await request('GET', path, undefined, { raw: true })) as Response;
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  saveBlob(blob, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
