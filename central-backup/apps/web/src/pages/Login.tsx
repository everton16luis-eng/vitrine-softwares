import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Shield } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Button, Card, CardContent, Code, Input, Label, Notice, Spinner } from '../components/ui/index.tsx';

function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2 font-semibold"><Shield className="size-5 text-primary" />Central de Backup</div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await login(email, password); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Entrar">
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></div>
        <div><Label htmlFor="senha">Senha</Label><Input id="senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button type="submit" className="w-full" loading={busy}>Entrar</Button>
      </form>
    </Shell>
  );
}

export function MfaVerifyPage() {
  const { refresh, logout } = useAuth();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api.post('/api/v1/auth/mfa/verify', { code: code.trim() }); await refresh(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Verificação em duas etapas">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">Digite o código de 6 dígitos do aplicativo autenticador ou um código de recuperação.</p>
        <div><Label htmlFor="code">Código</Label><Input id="code" inputMode="text" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button type="submit" className="w-full" loading={busy}>Verificar</Button>
        <Button type="button" variant="link" className="w-full" onClick={() => void logout()}>Entrar com outra conta</Button>
      </form>
    </Shell>
  );
}

export function MfaSetupPage() {
  const { refresh, logout } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.post('/api/v1/auth/mfa/setup').then(async (s) => { setSetup(s); setQr(await QRCode.toDataURL(s.otpauth_uri, { margin: 1, width: 220 })); }, (e: ApiError) => setErr(e.message));
  }, []);
  const enable = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api.post('/api/v1/auth/mfa/enable', { code: code.trim() }); setCodes(r.recovery_codes); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  if (codes) {
    return (
      <Shell title="Códigos de recuperação">
        <Notice tone="warn">Guarde estes códigos fora do computador. Cada um vale uma vez e eles não serão mostrados de novo.</Notice>
        <Code>{codes.join('\n')}</Code>
        <Button variant="outline" className="w-full" onClick={() => void navigator.clipboard.writeText(codes.join('\n'))}>Copiar</Button>
        <Button className="w-full" onClick={() => void refresh()}>Já guardei, continuar</Button>
      </Shell>
    );
  }
  return (
    <Shell title="Ative a verificação em duas etapas">
      <p className="text-sm text-muted-foreground">É obrigatória. Leia o código no aplicativo autenticador (Google Authenticator, Aegis, 1Password…) e digite o número gerado.</p>
      {!setup && !err && <Spinner />}
      {qr && <img src={qr} alt="Código QR para o aplicativo autenticador" className="mx-auto rounded bg-white p-2" width={220} height={220} />}
      {setup && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Não consegue ler? Digite a chave</summary><Code>{setup.secret}</Code></details>}
      <form onSubmit={enable} className="space-y-3">
        <div><Label htmlFor="code">Código de 6 dígitos</Label><Input id="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button type="submit" className="w-full" loading={busy} disabled={!setup}>Ativar</Button>
        <Button type="button" variant="link" className="w-full" onClick={() => void logout()}>Sair</Button>
      </form>
    </Shell>
  );
}
