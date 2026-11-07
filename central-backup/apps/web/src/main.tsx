import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { Layout } from './components/Layout.tsx';
import { Toaster } from './components/toast.tsx';
import { Notice, Spinner } from './components/ui/index.tsx';
import { LoginPage, MfaSetupPage, MfaVerifyPage } from './pages/Login.tsx';
import { OverviewPage } from './pages/Overview.tsx';
import { AgentDetailPage, AgentsPage, ApplicationDetailPage, ApplicationsPage, ClientDetailPage, ClientsPage, DatabaseDetailPage, DatabasesPage, ServerDetailPage, ServersPage } from './pages/Cadastros.tsx';
import { JobDetailPage, JobsPage, PgbackrestDetailPage, PgbackrestPage, PoliciesPage, RunDetailPage, RunsPage, SnapshotsPage, StorageDetailPage, StoragePage } from './pages/Backup.tsx';
import { AlertsPage, ChannelsPage, RestoreDetailPage, RestoresPage, RulesPage } from './pages/Operacao.tsx';
import { DrPlanDetailPage, DrPlansPage } from './pages/Dr.tsx';
import { AccountPage, AuditPage, ReportsPage, SystemPage, TaskDetailPage, TasksPage, UsersPage } from './pages/Admin.tsx';

// tema antes da primeira pintura (evita piscar)
try {
  const t = localStorage.getItem('cb-tema');
  if (t === 'escuro' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch { /* sem storage */ }

function Guard({ perm, children }: { perm?: string; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <Notice tone="warn">Seu perfil não tem acesso a esta página.</Notice>;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('monitoramento.ver')) return <OverviewPage />;
  return <Notice tone="info">Bem-vindo. Use o menu para navegar. <Link className="text-primary" to="/conta">Minha conta</Link></Notice>;
}

function App() {
  const { ready, user, mfa } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <LoginPage />;
  if (mfa === 'configurar') return <MfaSetupPage />;
  if (mfa === 'verificar') return <MfaVerifyPage />;
  const g = (perm: string | undefined, el: ReactNode) => <Guard perm={perm}>{el}</Guard>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="alertas" element={g('alertas.ver', <AlertsPage />)} />
        <Route path="regras" element={g('alertas.ver', <RulesPage />)} />
        <Route path="canais" element={g('alertas.ver', <ChannelsPage />)} />
        <Route path="clientes" element={g('clientes.ver', <ClientsPage />)} />
        <Route path="clientes/:id" element={g('clientes.ver', <ClientDetailPage />)} />
        <Route path="servidores" element={g('servidores.ver', <ServersPage />)} />
        <Route path="servidores/:id" element={g('servidores.ver', <ServerDetailPage />)} />
        <Route path="agentes" element={g('agentes.ver', <AgentsPage />)} />
        <Route path="agentes/:id" element={g('agentes.ver', <AgentDetailPage />)} />
        <Route path="tarefas" element={g('agentes.ver', <TasksPage />)} />
        <Route path="tarefas/:id" element={g('agentes.ver', <TaskDetailPage />)} />
        <Route path="bancos" element={g('bancos.ver', <DatabasesPage />)} />
        <Route path="bancos/:id" element={g('bancos.ver', <DatabaseDetailPage />)} />
        <Route path="aplicacoes" element={g('aplicacoes.ver', <ApplicationsPage />)} />
        <Route path="aplicacoes/:id" element={g('aplicacoes.ver', <ApplicationDetailPage />)} />
        <Route path="armazenamento" element={g('armazenamento.ver', <StoragePage />)} />
        <Route path="armazenamento/:id" element={g('armazenamento.ver', <StorageDetailPage />)} />
        <Route path="politicas" element={g('backups.ver', <PoliciesPage />)} />
        <Route path="jobs" element={g('backups.ver', <JobsPage />)} />
        <Route path="jobs/:id" element={g('backups.ver', <JobDetailPage />)} />
        <Route path="execucoes" element={g('backups.ver', <RunsPage />)} />
        <Route path="execucoes/:id" element={g('backups.ver', <RunDetailPage />)} />
        <Route path="snapshots" element={g('backups.ver', <SnapshotsPage />)} />
        <Route path="pgbackrest" element={g('backups.ver', <PgbackrestPage />)} />
        <Route path="pgbackrest/:id" element={g('backups.ver', <PgbackrestDetailPage />)} />
        <Route path="restauracoes" element={g('restauracoes.solicitar', <RestoresPage />)} />
        <Route path="restauracoes/:id" element={g('restauracoes.solicitar', <RestoreDetailPage />)} />
        <Route path="dr" element={g('dr.ver', <DrPlansPage />)} />
        <Route path="dr/:id" element={g('dr.ver', <DrPlanDetailPage />)} />
        <Route path="relatorios" element={g('relatorios.ver', <ReportsPage />)} />
        <Route path="usuarios" element={g('usuarios.gerenciar', <UsersPage />)} />
        <Route path="auditoria" element={g('auditoria.ver', <AuditPage />)} />
        <Route path="sistema" element={g('sistema.ver', <SystemPage />)} />
        <Route path="conta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
