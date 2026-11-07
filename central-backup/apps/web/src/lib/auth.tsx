import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, onUnauthorized, setCsrf } from './api.ts';
import { ROUTE_PERMS } from './perms.gen.ts';

export type Me = { id: number; email: string; name: string; roles: string[]; permissions: string[]; all_clients: boolean };
type MfaState = 'ok' | 'verificar' | 'configurar';
type Ctx = {
  user: Me | null;
  mfa: MfaState | null;
  ready: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<MfaState>;
  logout: () => Promise<void>;
  can: (perm: string | null | undefined) => boolean;
  /** Permissão da rota (gerada da API): `canRoute('POST', '/api/v1/clients')`. */
  canRoute: (method: string, path: string) => boolean;
};
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/api/v1/auth/me');
      setCsrf(me.csrf); setUser(me.user); setMfa(me.mfa);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setCsrf(null); setUser(null); setMfa(null);
    } finally { setReady(true); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => { setUser(null); setMfa(null); setCsrf(null); }), []);

  const login = async (email: string, password: string) => {
    const r = await api.post('/api/v1/auth/login', { email, password });
    setCsrf(r.csrf);
    await refresh();
    return r.mfa as MfaState;
  };
  const logout = async () => {
    try { await api.post('/api/v1/auth/logout'); } finally { setCsrf(null); setUser(null); setMfa(null); }
  };
  const can = (perm: string | null | undefined) => {
    if (!user || mfa !== 'ok') return false;
    if (!perm) return true;
    return user.permissions.includes('*') || user.permissions.includes(perm);
  };
  const canRoute = (method: string, path: string) => {
    const key = `${method.toUpperCase()} ${path.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/[0-9a-f-]{20,}(?=\/|$)/gi, '/{id}')}`;
    if (!(key in ROUTE_PERMS)) return can(null);
    // rotas de sistema exigem também escopo total de clientes
    if (key.startsWith('GET /api/v1/system') || key.startsWith('POST /api/v1/system')) return !!user?.all_clients && can(ROUTE_PERMS[key]);
    return can(ROUTE_PERMS[key]);
  };
  return <AuthCtx.Provider value={{ user, mfa, ready, refresh, login, logout, can, canRoute }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
