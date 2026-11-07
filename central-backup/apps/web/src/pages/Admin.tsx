import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Download, Plus } from 'lucide-react';
import { api, download, qs, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { DataList, cell } from '../components/DataList.tsx';
import { Action } from '../components/Action.tsx';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Code, Empty, Fields, Input, Label, Notice, Select, Spinner, StatusBadge, statusLabel, Table, Td, Th } from '../components/ui/index.tsx';
import { fmtBytes, fmtDate } from '../lib/utils.ts';
import { toast } from '../components/toast.tsx';
import { Logs } from './Backup.tsx';
import { TASK_COLUMNS } from './Cadastros.tsx';

// ------------------------------------------------------------------ relatórios
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export function ReportsPage() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 86400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [client, setClient] = useState('');
  const clients = useApi('/api/v1/clients?limit=200');
  const params = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString(), client_id: client || undefined };
  const rep = useApi(`/api/v1/reports/backups${qs(params)}`, []);
  return (
    <div className="space-y-4">
      <PageHeader title="Relatório de backups" subtitle="Execuções, taxa de sucesso, duração e tamanho por job, no período.">
        <Button variant="outline" size="sm" onClick={() => download(`/api/v1/reports/backups${qs({ ...params, format: 'csv' })}`, 'relatorio.csv').catch((e) => toast(e.message, 'bad'))}><Download />Baixar CSV</Button>
      </PageHeader>
      <Card><CardContent className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="de">De</Label><Input id="de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="ate">Até</Label><Input id="ate" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="min-w-56"><Label htmlFor="cli">Cliente</Label><Select id="cli" value={client} onChange={(e) => setClient(e.target.value)}><option value="">Todos</option>{clients.data?.items?.map((c: any) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</Select></div>
      </CardContent></Card>
      <Card>
        {rep.error && <div className="p-4"><Notice tone="bad">{rep.error.message}</Notice></div>}
        {rep.loading ? <Spinner /> : !rep.data?.items?.length ? <Empty>Sem execuções no período.</Empty> : (
          <Table><thead><tr>{['Cliente', 'Servidor', 'Job', 'Tipo', 'Execuções', 'Validadas', 'Falhas', 'Sucesso', 'Duração média', 'Dados novos', 'Último validado', 'Snapshots', 'Repositório'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>{rep.data.items.map((i: any, n: number) => (
              <tr key={n}><Td>{i.cliente}</Td><Td>{i.servidor}</Td><Td>{i.job}</Td><Td>{i.tipo}</Td><Td className="tabular">{i.execucoes}</Td><Td className="tabular">{i.validadas}</Td><Td className="tabular">{i.falhas}</Td>
                <Td className="tabular">{i.taxa_sucesso != null ? `${Number(i.taxa_sucesso).toLocaleString('pt-BR')}%` : '—'}</Td><Td className="tabular">{i.duracao_media_s != null ? `${Math.round(i.duracao_media_s)} s` : '—'}</Td>
                <Td className="tabular">{fmtBytes(i.bytes_novos)}</Td><Td>{fmtDate(i.ultimo_validado)}</Td><Td className="tabular">{i.snapshots_validos}</Td><Td className="tabular">{fmtBytes(i.repositorio_bytes)}</Td></tr>
            ))}</tbody></Table>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ tarefas
const TASK_STATUS = ['pendente', 'na_fila', 'aguardando_agente', 'executando', 'concluido', 'falhou', 'cancelado'].map((v) => ({ value: v, label: statusLabel(v) }));
export function TasksPage() {
  return (
    <div>
      <PageHeader title="Tarefas dos agentes" subtitle="Operações do catálogo enviadas aos agentes, assinadas pela central." />
      <DataList path="/api/v1/tasks" filters={[{ key: 'status', label: 'Situação', options: TASK_STATUS }]} rowLink={(t) => `/tarefas/${t.id}`} columns={TASK_COLUMNS} refreshEvery={15} />
    </div>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  const t = useApi(`/api/v1/tasks/${id}`);
  if (t.loading) return <Spinner />;
  if (t.error) return <Notice tone="bad">{t.error.message}</Notice>;
  const r = t.data;
  const active = ['pendente', 'na_fila', 'aguardando_agente'].includes(r.status);
  return (
    <div className="space-y-4">
      <PageHeader title={`Tarefa ${r.operation}`} subtitle={<Link className="text-primary hover:underline" to={`/agentes/${r.agent_id}`}>{r.server_name} — {r.client_name}</Link>}>
        <Button variant="outline" size="sm" onClick={t.reload}>Atualizar</Button>
        {active && <Action label="Cancelar" variant="destructive" method="POST" path={`/api/v1/tasks/${r.id}/cancel`} title="Cancelar tarefa" confirm="A tarefa não será entregue ao agente." successMessage="Tarefa cancelada." onDone={t.reload} />}
      </PageHeader>
      <Card><CardContent>
        <Fields items={[['Situação', <StatusBadge value={r.status} />], ['Tentativa', `${r.attempt} de ${r.max_attempts}`], ['Prazo', `${r.timeout_s} s`], ['Criada', fmtDate(r.created_at)], ['Início', fmtDate(r.started_at)], ['Fim', fmtDate(r.finished_at)], ['Expira', fmtDate(r.expires_at)], ['Erro', r.error]]} />
      </CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Parâmetros</CardTitle></CardHeader><CardContent><Code>{JSON.stringify(r.params, null, 2)}</Code></CardContent></Card>
        <Card><CardHeader><CardTitle>Resultado</CardTitle></CardHeader><CardContent>{r.result ? <Code>{JSON.stringify(r.result, null, 2)}</Code> : <span className="text-sm text-muted-foreground">—</span>}</CardContent></Card>
      </div>
      <Logs logs={r.logs ?? []} />
    </div>
  );
}

// ------------------------------------------------------------------ usuários
export function UsersPage() {
  const roles = useApi('/api/v1/roles');
  return (
    <div className="space-y-4">
      <PageHeader title="Usuários" subtitle="Cada usuário tem perfis (permissões) e, opcionalmente, uma lista de clientes que pode ver." />
      <DataList path="/api/v1/users" search
        columns={[{ key: 'name', label: 'Nome' }, { key: 'email', label: 'E-mail' }, { key: 'roles', label: 'Perfis' }, { key: 'status', label: 'Situação' },
          { key: 'totp_enabled', label: '2FA', render: (r) => (r.totp_enabled ? <Badge tone="ok">ativo</Badge> : <Badge tone="warn">pendente</Badge>) },
          { key: 'client_ids', label: 'Clientes', render: (r) => (r.client_ids?.length ? r.client_ids.length : 'todos (pelo perfil)') }, { key: 'last_login_at', label: 'Último acesso' }, { key: 'locked_until', label: 'Bloqueado até' }]}
        rowActions={(r, reload) => <>
          <Action label="Editar" method="PATCH" path={`/api/v1/users/${r.id}`} title={`Editar ${r.name}`} initial={r} onDone={reload} successMessage="Usuário atualizado." />
          <Action label="Redefinir 2FA" variant="ghost" method="POST" path={`/api/v1/users/${r.id}/reset-mfa`} title="Redefinir verificação em duas etapas" confirm={`${r.name} terá de configurar o autenticador de novo no próximo acesso. As sessões abertas são encerradas.`} typeToConfirm={r.email} successMessage="2FA redefinido." onDone={reload} />
        </>}
        actions={(reload) => <Action label="Novo usuário" icon={<Plus />} variant="default" method="POST" path="/api/v1/users" overrides={{ password: { help: 'Mínimo de 12 caracteres. O usuário configura o 2FA no primeiro acesso.' } }} onDone={reload} successMessage="Usuário criado." />} />
      <Card><CardHeader><CardTitle>Perfis</CardTitle></CardHeader>
        {roles.loading ? <Spinner /> : <Table><thead><tr><Th>Perfil</Th><Th>Código</Th><Th>Descrição</Th><Th>Permissões</Th></tr></thead>
          <tbody>{roles.data?.items?.map((r: any) => <tr key={r.code}><Td className="font-medium">{r.name}</Td><Td><code className="text-xs">{r.code}</code></Td><Td className="text-xs">{r.description}</Td><Td className="text-xs">{cell('p', r.permissions)}</Td></tr>)}</tbody></Table>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ auditoria
export function AuditPage() {
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try { setCheck(await api.get('/api/v1/audit/verify')); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Auditoria" subtitle="Registro encadeado por hash: qualquer alteração ou remoção quebra a cadeia.">
        <Button size="sm" loading={busy} onClick={verify}>Verificar integridade</Button>
      </PageHeader>
      {check && (check.ok
        ? <Notice tone="ok">Cadeia íntegra: {check.checked} registros conferidos.</Notice>
        : <Notice tone="bad">Cadeia quebrada no registro {check.broken_id} ({check.checked} conferidos antes).</Notice>)}
      <DataList path="/api/v1/audit" search
        columns={[{ key: 'at', label: 'Quando' }, { key: 'actor_email', label: 'Quem', render: (r) => r.actor_email ?? r.actor_type }, { key: 'ip', label: 'IP' }, { key: 'action', label: 'Ação' },
          { key: 'entity', label: 'Entidade', render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` }, { key: 'client_id', label: 'Cliente' },
          { key: 'details', label: 'Detalhes', render: (r) => (r.details && Object.keys(r.details).length ? <code className="text-xs break-all">{JSON.stringify(r.details)}</code> : '—') }]} />
    </div>
  );
}

// ------------------------------------------------------------------ sistema
export function SystemPage() {
  const b = useApi('/api/v1/system/backups');
  const k = useApi('/api/v1/system/keys');
  const running = b.data?.items?.some((i: any) => i.status === 'executando');
  return (
    <div className="space-y-4">
      <PageHeader title="Sistema" subtitle="Backup do banco da própria central e estado das chaves de cifragem.">
        {b.data?.configured && <Action label="Fazer backup agora" variant="default" method="POST" path="/api/v1/system/backups/run" title="Backup da central" confirm="pg_dump do banco da central direto para o repositório configurado, depois verificação." disabled={running} successMessage="Backup da central iniciado." onDone={() => setTimeout(b.reload, 1500)} />}
      </PageHeader>
      {b.error && <Notice tone="bad">{b.error.message}</Notice>}
      {b.data && !b.data.configured && <Notice tone="warn">Backup da central desligado: defina SELF_BACKUP_REPOSITORY e SELF_BACKUP_PASSWORD_FILE no .env (veja docs/central-backup/fase-8.md).</Notice>}
      {b.data?.configured && (
        <Card><CardContent>
          <Fields items={[['Repositório', <code className="text-xs break-all">{b.data.repository}</code>], ['Agenda', `${b.data.schedule} (${b.data.timezone})`], ['Próximo', fmtDate(b.data.next_run_at)], ['Último validado', fmtDate(b.data.last_validated_at)]]} />
        </CardContent></Card>
      )}
      <Card><CardHeader><CardTitle>Backups da central</CardTitle><Button size="sm" variant="ghost" onClick={b.reload}>Atualizar</Button></CardHeader>
        {b.loading ? <Spinner /> : !b.data?.items?.length ? <Empty>Nenhum backup da central ainda.</Empty> : (
          <Table><thead><tr><Th>Início</Th><Th>Origem</Th><Th>Situação</Th><Th>Snapshot</Th><Th>Tamanho</Th><Th>Tabelas</Th><Th>Fim</Th><Th>Erro</Th></tr></thead>
            <tbody>{b.data.items.map((i: any) => <tr key={i.id}><Td>{fmtDate(i.started_at)}</Td><Td>{i.trigger}</Td><Td><StatusBadge value={i.status} /></Td><Td>{i.snapshot_id ? <code className="text-xs">{String(i.snapshot_id).slice(0, 8)}</code> : '—'}</Td>
              <Td className="tabular">{fmtBytes(i.bytes)}</Td><Td className="tabular">{i.tables ?? '—'}</Td><Td>{fmtDate(i.finished_at)}</Td><Td className="text-xs">{i.error ?? '—'}</Td></tr>)}</tbody></Table>
        )}
      </Card>
      <Card><CardHeader><CardTitle>Chaves (KEK)</CardTitle></CardHeader><CardContent className="space-y-3">
        {k.loading ? <Spinner /> : k.error ? <Notice tone="bad">{k.error.message}</Notice> : <>
          <Fields items={[['KEK atual', <code>{k.data.current_kek}</code>], ['Rotação pendente', k.data.rotation_pending ? <Badge tone="warn">sim — rode a rotação de novo</Badge> : <Badge tone="ok">não</Badge>]]} />
          <Table><thead><tr><Th>Identificador</Th><Th>Textos cifrados</Th></tr></thead><tbody>{Object.entries(k.data.usage ?? {}).map(([id, n]) => <tr key={id}><Td><code>{id}</code>{id === k.data.current_kek && <Badge tone="ok" className="ml-2">atual</Badge>}</Td><Td className="tabular">{String(n)}</Td></tr>)}</tbody></Table>
          <p className="text-xs text-muted-foreground">A rotação e o kit de recuperação são feitos no servidor da central (npm run central -- chaves …), nunca pelo navegador: o material das chaves não passa pela API.</p>
        </>}
      </CardContent></Card>
    </div>
  );
}

// ------------------------------------------------------------------ minha conta
export function AccountPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader title="Minha conta" subtitle={`${user?.name} · ${user?.email}`}>
        <Action label="Trocar senha" variant="default" method="POST" path="/api/v1/me/password" title="Trocar senha" overrides={{ current_password: { widget: 'password' }, new_password: { widget: 'password', help: 'Mínimo de 12 caracteres.' } }} successMessage="Senha alterada." />
      </PageHeader>
      <Card><CardContent><Fields items={[['Perfis', user?.roles.join(', ')], ['Clientes', user?.all_clients ? 'todos' : 'restrito'], ['Permissões', user?.permissions.includes('*') ? 'todas (administrador)' : user?.permissions.join(', ')]]} /></CardContent></Card>
      <DataList title="Sessões abertas" path="/api/v1/auth/sessions"
        columns={[{ key: 'created_at', label: 'Início' }, { key: 'last_seen_at', label: 'Última atividade' }, { key: 'ip', label: 'IP' }, { key: 'user_agent', label: 'Navegador', render: (r) => <span className="text-xs">{r.user_agent}</span> },
          { key: 'expires_at', label: 'Expira' }, { key: 'current', label: '', render: (r) => (r.current ? <Badge tone="info">esta sessão</Badge> : '') }]}
        rowActions={(r, reload) => (r.current ? null : <Action label="Encerrar" variant="ghost" method="DELETE" path={`/api/v1/auth/sessions/${r.id}`} title="Encerrar sessão" confirm="A sessão é desconectada na hora." successMessage="Sessão encerrada." onDone={reload} body={{}} />)} />
    </div>
  );
}
