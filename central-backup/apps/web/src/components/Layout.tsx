import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Activity, AppWindow, Archive, Bell, BellRing, Boxes, Building2, ClipboardList, Database, FileBarChart, HardDrive, History, KeyRound,
  LifeBuoy, ListChecks, LogOut, Menu, Moon, PlayCircle, Radio, RotateCcw, Server, Shield, ShieldCheck, Sun, Users, Workflow
} from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import { Button } from './ui/index.tsx';
import { cn } from '../lib/utils.ts';

type Item = { to: string; label: string; icon: ReactNode; perm?: string; system?: boolean };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Operação', items: [
    { to: '/', label: 'Visão geral', icon: <Activity />, perm: 'monitoramento.ver' },
    { to: '/alertas', label: 'Alertas', icon: <BellRing />, perm: 'alertas.ver' },
    { to: '/execucoes', label: 'Execuções', icon: <PlayCircle />, perm: 'backups.ver' },
    { to: '/restauracoes', label: 'Restaurações', icon: <RotateCcw />, perm: 'restauracoes.solicitar' }
  ] },
  { title: 'Cadastros', items: [
    { to: '/clientes', label: 'Clientes', icon: <Building2 />, perm: 'clientes.ver' },
    { to: '/servidores', label: 'Servidores', icon: <Server />, perm: 'servidores.ver' },
    { to: '/agentes', label: 'Agentes', icon: <Radio />, perm: 'agentes.ver' },
    { to: '/bancos', label: 'Bancos de dados', icon: <Database />, perm: 'bancos.ver' },
    { to: '/aplicacoes', label: 'Aplicações', icon: <AppWindow />, perm: 'aplicacoes.ver' }
  ] },
  { title: 'Backup', items: [
    { to: '/armazenamento', label: 'Armazenamento', icon: <HardDrive />, perm: 'armazenamento.ver' },
    { to: '/politicas', label: 'Políticas', icon: <ListChecks />, perm: 'backups.ver' },
    { to: '/jobs', label: 'Jobs', icon: <Workflow />, perm: 'backups.ver' },
    { to: '/snapshots', label: 'Snapshots', icon: <Archive />, perm: 'backups.ver' },
    { to: '/pgbackrest', label: 'pgBackRest', icon: <Boxes />, perm: 'backups.ver' }
  ] },
  { title: 'Continuidade', items: [
    { to: '/dr', label: 'Planos de DR', icon: <LifeBuoy />, perm: 'dr.ver' },
    { to: '/regras', label: 'Regras de alerta', icon: <Bell />, perm: 'alertas.ver' },
    { to: '/canais', label: 'Canais', icon: <Radio />, perm: 'alertas.ver' },
    { to: '/relatorios', label: 'Relatórios', icon: <FileBarChart />, perm: 'relatorios.ver' }
  ] },
  { title: 'Administração', items: [
    { to: '/tarefas', label: 'Tarefas', icon: <ClipboardList />, perm: 'agentes.ver' },
    { to: '/usuarios', label: 'Usuários', icon: <Users />, perm: 'usuarios.gerenciar' },
    { to: '/auditoria', label: 'Auditoria', icon: <History />, perm: 'auditoria.ver' },
    { to: '/sistema', label: 'Sistema', icon: <ShieldCheck />, perm: 'sistema.ver', system: true },
    { to: '/conta', label: 'Minha conta', icon: <KeyRound /> }
  ] }
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try { const v = localStorage.getItem('cb-tema'); if (v) return v === 'escuro'; } catch { /* sem storage */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('cb-tema', dark ? 'escuro' : 'claro'); } catch { /* sem storage */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export function Layout() {
  const { user, can, logout } = useAuth();
  const [dark, setDark] = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const nav = (
    <nav className="flex flex-col gap-4 p-3 text-sm">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => can(i.perm) && (!i.system || user?.all_clients));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</div>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'}
                className={({ isActive }) => cn('flex items-center gap-2 rounded-md px-2 py-1.5 [&_svg]:size-4', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-muted')}>
                {i.icon}{i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 font-semibold"><Shield className="size-5 text-primary" />Central de Backup</div>
          {nav}
        </div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-card" onClick={(e) => e.stopPropagation()}>{nav}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></Button>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{user?.name} · {user?.roles.join(', ')}</span>
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label={dark ? 'Tema claro' : 'Tema escuro'}>{dark ? <Sun /> : <Moon />}</Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}><LogOut />Sair</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6"><Outlet /></main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold">{title}</h1>{subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}</div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
