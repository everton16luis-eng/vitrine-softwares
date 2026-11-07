import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronRight, File, Folder, Plus } from 'lucide-react';
import { qs, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { CONFIG_SCHEMAS } from '../lib/schemas.gen.ts';
import type { JsonSchema } from '../lib/openapi.ts';
import { PageHeader } from '../components/Layout.tsx';
import { DataList, cell } from '../components/DataList.tsx';
import { Action, ActionDialog } from '../components/Action.tsx';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Code, Dialog, Empty, Fields, Notice, Spinner, StatusBadge, statusLabel, Table, Tabs, Td, Th } from '../components/ui/index.tsx';
import { fmtBytes, fmtDate } from '../lib/utils.ts';

// ------------------------------------------------------------------ armazenamento
const storageOv = (v: Record<string, any>) => (v.kind ? { config: { schema: CONFIG_SCHEMAS.storage[v.kind] as JsonSchema, help: v.kind === 'local_rest' ? 'rest-server da própria central, em modo append-only. O diretório precisa existir e ser gravável pela central.' : 'Bucket S3 compatível. A credencial é definida depois, em "Credencial".' } } : { config: { hidden: true } });

export function StoragePage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Armazenamento" subtitle="Destinos dos repositórios de backup. Credenciais ficam cifradas e não voltam pela API." />
      <DataList path="/api/v1/storage" rowLink={(r) => `/armazenamento/${r.id}`}
        columns={[{ key: 'name', label: 'Nome' }, { key: 'kind', label: 'Tipo' }, { key: 'client_id', label: 'Cliente', render: (r) => (r.client_id ? `#${r.client_id}` : 'compartilhado') },
          { key: 'immutable', label: 'Imutável' }, { key: 'status', label: 'Situação' }, { key: 'repositories', label: 'Repositórios' }, { key: 'capacity_bytes', label: 'Capacidade' }, { key: 'last_check_at', label: 'Último teste' }]}
        actions={(reload) => <Action label="Novo destino" icon={<Plus />} variant="default" method="POST" path="/api/v1/storage" initial={{ immutable: true }} overrides={storageOv} onDone={reload} successMessage="Destino cadastrado." />} />
      <DataList title="Repositórios" path="/api/v1/repositories"
        columns={[{ key: 'server_name', label: 'Servidor' }, { key: 'destination_name', label: 'Destino' }, { key: 'tool', label: 'Ferramenta' }, { key: 'snapshots', label: 'Snapshots' },
          { key: 'size_bytes', label: 'Tamanho' }, { key: 'last_check_ok', label: 'Última verificação', render: (r) => (r.last_check_at ? <Badge tone={r.last_check_ok ? 'ok' : 'bad'}>{r.last_check_ok ? 'ok' : 'falhou'} · {fmtDate(r.last_check_at)}</Badge> : '—') },
          { key: 'last_retention_at', label: 'Retenção' }, { key: 'retention_error', label: 'Erro de retenção' }]} />
    </div>
  );
}

export function StorageDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const d = useApi(`/api/v1/storage/${id}`);
  if (d.loading) return <Spinner />;
  if (d.error) return <Notice tone="bad">{d.error.message}</Notice>;
  const r = d.data;
  return (
    <div className="space-y-4">
      <PageHeader title={r.name} subtitle={r.kind === 's3' ? 'S3 compatível' : 'rest-server local (append-only)'}>
        <Action label="Testar" variant="default" method="POST" path={`/api/v1/storage/${r.id}/test`} title="Testar destino" confirm="A central verifica acesso, espaço e escrita no destino." successMessage={(x) => (x?.ok === false ? `Falhou: ${x.error}` : 'Destino respondeu corretamente.')} onDone={d.reload} />
        {r.kind === 's3' && <Action label={r.has_credential ? 'Trocar credencial' : 'Definir credencial'} method="PUT" path={`/api/v1/storage/${r.id}/credential`} title="Credencial do bucket" description="Guardada cifrada; não é exibida depois." successMessage="Credencial guardada." onDone={d.reload} />}
        <Action label="Editar" method="PATCH" path={`/api/v1/storage/${r.id}`} title="Editar destino" initial={r} overrides={() => ({ config: { schema: CONFIG_SCHEMAS.storage[r.kind] as JsonSchema } })} onDone={d.reload} successMessage="Destino atualizado." />
        <Action label="Arquivar" variant="destructive" method="POST" path={`/api/v1/storage/${r.id}/archive`} title="Arquivar destino" typeToConfirm={r.name} confirm="Só é possível arquivar um destino sem repositórios em uso." successMessage="Destino arquivado." onDone={() => nav('/armazenamento')} />
      </PageHeader>
      <Card><CardContent>
        <Fields items={[['Tipo', r.kind], ['Situação', <StatusBadge value={r.status} />], ['Imutável', r.immutable ? 'sim' : 'não'], ['Credencial', r.kind === 's3' ? (r.has_credential ? 'definida' : 'não definida') : 'gerada por repositório'],
          ['Capacidade', fmtBytes(r.capacity_bytes)], ['Repositórios', r.repositories], ['Último teste', fmtDate(r.last_check_at)], ['Erro do teste', r.last_check_error],
          ...Object.entries(r.config ?? {}).map(([k, v]) => [k, String(v)] as [string, string])]} />
      </CardContent></Card>
    </div>
  );
}

// ------------------------------------------------------------------ políticas
const RET: Record<string, string> = { keep_last: 'últimos', keep_hourly: 'por hora', keep_daily: 'diários', keep_weekly: 'semanais', keep_monthly: 'mensais', keep_yearly: 'anuais' };
const retention = (r: any) => Object.entries(r.retention ?? {}).filter(([, v]) => v).map(([k, v]) => `${RET[k] ?? k}: ${v}`).join(', ');
export function PoliciesPage() {
  return (
    <div>
      <PageHeader title="Políticas de backup" subtitle="Agenda, retenção, verificação e testes periódicos de restauração." />
      <DataList path="/api/v1/backup-policies"
        columns={[{ key: 'name', label: 'Nome' }, { key: 'schedule', label: 'Agenda' }, { key: 'timezone', label: 'Fuso' }, { key: 'retention', label: 'Retenção', render: retention },
          { key: 'verify_subset_percent', label: 'Verificação', render: (r) => `${r.verify_subset_percent}%` }, { key: 'restore_test_days', label: 'Teste de restauração', render: (r) => (r.restore_test_days ? `a cada ${r.restore_test_days} d` : 'desligado') },
          { key: 'client_id', label: 'Cliente', render: (r) => (r.client_id ? `#${r.client_id}` : 'global') }]}
        rowActions={(r, reload) => <Action label="Editar" method="PATCH" path={`/api/v1/backup-policies/${r.id}`} title="Editar política" initial={r} onDone={reload} successMessage="Política atualizada." />}
        actions={(reload) => <Action label="Nova política" icon={<Plus />} variant="default" method="POST" path="/api/v1/backup-policies" initial={{ timezone: 'America/Sao_Paulo', retention: { keep_last: 7, keep_daily: 7, keep_weekly: 4, keep_monthly: 6 }, verify_subset_percent: 5 }}
          overrides={{ schedule: { help: 'Cron de 5 campos. Ex.: 0 2 * * * (todo dia às 2h).' } }} onDone={reload} successMessage="Política criada." />} />
    </div>
  );
}

// ------------------------------------------------------------------ jobs
const JOB_COLUMNS = [{ key: 'name', label: 'Job' }, { key: 'server_name', label: 'Servidor' }, { key: 'kind', label: 'Tipo' }, { key: 'policy_name', label: 'Política' },
  { key: 'enabled', label: 'Ativo' }, { key: 'last_status', label: 'Último' }, { key: 'last_success_at', label: 'Último validado' }, { key: 'next_run_at', label: 'Próximo' },
  { key: 'last_restore_test_status', label: 'Teste de restauração' }];
const jobOv = (v: Record<string, any>) => ({
  application_id: { hidden: v.kind !== 'arquivos' }, paths: { hidden: v.kind !== 'arquivos', help: 'Opcional se escolher uma aplicação (usa diretórios de dados e configuração dela).' },
  excludes: { hidden: v.kind !== 'arquivos' }, database_id: { hidden: v.kind !== 'banco' }
});
export function JobsPage() {
  return (
    <div>
      <PageHeader title="Jobs de backup" subtitle="O que é copiado de cada servidor, com qual política e para qual destino." />
      <DataList path="/api/v1/backup-jobs" search rowLink={(r) => `/jobs/${r.id}`} columns={JOB_COLUMNS}
        rowActions={(r, reload) => <Action label="Executar" method="POST" path={`/api/v1/backup-jobs/${r.id}/run`} title={`Executar ${r.name}`} confirm="O backup entra na fila agora e é verificado ao terminar." successMessage="Backup enfileirado." onDone={reload} />}
        actions={(reload) => <Action label="Novo job" icon={<Plus />} variant="default" method="POST" path="/api/v1/backup-jobs" initial={{ enabled: true }} overrides={jobOv} onDone={reload} successMessage="Job criado." />} />
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<'execucoes' | 'snapshots'>('execucoes');
  const j = useApi(`/api/v1/backup-jobs/${id}`);
  if (j.loading) return <Spinner />;
  if (j.error) return <Notice tone="bad">{j.error.message}</Notice>;
  const r = j.data;
  return (
    <div className="space-y-4">
      <PageHeader title={r.name} subtitle={<Link className="text-primary hover:underline" to={`/servidores/${r.server_id}`}>{r.server_name}</Link>}>
        <Action label="Executar agora" variant="default" method="POST" path={`/api/v1/backup-jobs/${r.id}/run`} title="Executar backup" confirm="O backup entra na fila agora e é verificado ao terminar." successMessage="Backup enfileirado." onDone={j.reload} />
        <Action label="Editar" method="PATCH" path={`/api/v1/backup-jobs/${r.id}`} title="Editar job" initial={r} onDone={j.reload} successMessage="Job atualizado." />
        <Action label="Arquivar" variant="destructive" method="POST" path={`/api/v1/backup-jobs/${r.id}/archive`} title="Arquivar job" typeToConfirm={r.name} confirm="O job para de rodar. Snapshots existentes seguem a retenção." successMessage="Job arquivado." onDone={() => nav('/jobs')} />
      </PageHeader>
      <Card><CardContent>
        <Fields items={[['Tipo', r.kind], ['Política', `${r.policy_name} (${r.schedule}, ${r.timezone})`], ['Ativo', r.enabled ? 'sim' : 'não'], ['Caminhos', cell('a', r.paths)], ['Exclusões', cell('a', r.excludes)],
          ['Último', <StatusBadge value={r.last_status} />], ['Última execução', fmtDate(r.last_run_at)], ['Último validado', fmtDate(r.last_success_at)], ['Próxima', fmtDate(r.next_run_at)],
          ['Último teste de restauração', r.last_restore_test_at ? <>{fmtDate(r.last_restore_test_at)} <StatusBadge value={r.last_restore_test_status} /></> : 'nunca']]} />
      </CardContent></Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'execucoes', label: 'Execuções' }, { id: 'snapshots', label: 'Snapshots' }]} />
      {tab === 'execucoes' ? <RunsList params={{ job_id: r.id }} /> : <SnapshotsList params={{ job_id: r.id }} />}
    </div>
  );
}

// ------------------------------------------------------------------ execuções
const RUN_STATUS = ['pendente', 'na_fila', 'executando', 'validando', 'validado', 'falhou', 'falha_verificacao', 'cancelado'].map((v) => ({ value: v, label: statusLabel(v) }));
function RunsList({ params = {} }: { params?: Record<string, unknown> }) {
  return (
    <DataList path="/api/v1/backup-runs" params={{ limit: 100, ...params }} filters={[{ key: 'status', label: 'Situação', options: RUN_STATUS }]} rowLink={(r) => `/execucoes/${r.id}`} refreshEvery={15}
      columns={[{ key: 'created_at', label: 'Criada' }, { key: 'job_name', label: 'Job' }, { key: 'trigger', label: 'Origem' }, { key: 'status', label: 'Situação' },
        { key: 'started_at', label: 'Início' }, { key: 'finished_at', label: 'Fim' }, { key: 'snapshot', label: 'Snapshot', render: (r) => (r.snapshot ? <code className="text-xs">{r.snapshot.slice(0, 8)}</code> : '—') },
        { key: 'error', label: 'Erro', render: (r) => <span className="text-xs">{r.error ?? '—'}</span> }]} />
  );
}
export function RunsPage() {
  return <div><PageHeader title="Execuções de backup" subtitle="Cada backup só conta como bom depois da verificação (restic check e conferência do conteúdo)." /><RunsList /></div>;
}

export function RunDetailPage() {
  const { id } = useParams();
  const d = useApi(`/api/v1/backup-runs/${id}`);
  if (d.loading) return <Spinner />;
  if (d.error) return <Notice tone="bad">{d.error.message}</Notice>;
  const r = d.data;
  const logs = d.data.logs ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={`Execução de ${r.job_name}`} subtitle={<Link className="text-primary hover:underline" to={`/jobs/${r.job_id}`}>ver job</Link>} />
      <Card><CardContent>
        <Fields items={[['Situação', <StatusBadge value={r.status} />], ['Origem', r.trigger], ['Agendada para', fmtDate(r.scheduled_for)], ['Início', fmtDate(r.started_at)], ['Fim', fmtDate(r.finished_at)],
          ['Snapshot', r.snapshot], ['Tarefa', r.task_id ? <Link className="text-primary hover:underline" to={`/tarefas/${r.task_id}`}>{String(r.task_id).slice(0, 8)}</Link> : '—'], ['Erro', r.error]]} />
      </CardContent></Card>
      {r.summary && <Card><CardHeader><CardTitle>Resumo</CardTitle></CardHeader><CardContent><Code>{JSON.stringify(r.summary, null, 2)}</Code></CardContent></Card>}
      <Logs logs={logs} />
    </div>
  );
}

export function Logs({ logs }: { logs: any[] }) {
  return (
    <Card><CardHeader><CardTitle>Log</CardTitle></CardHeader>
      {!logs.length ? <Empty>Sem linhas de log.</Empty> : (
        <div className="max-h-[480px] overflow-y-auto p-3 font-mono text-xs">
          {logs.map((l, i) => <div key={i} className={l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-warning' : ''}><span className="text-muted-foreground">{new Date(l.at).toLocaleTimeString('pt-BR')} [{l.attempt}] </span>{l.message}</div>)}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ snapshots
const SNAP_STATUS = ['pendente', 'validado', 'falha_verificacao', 'removido'].map((v) => ({ value: v, label: statusLabel(v) }));
function SnapshotsList({ params = {} }: { params?: Record<string, unknown> }) {
  const { can } = useAuth();
  const [browse, setBrowse] = useState<any>(null);
  const [restore, setRestore] = useState<{ sn: any; includes: string[] } | null>(null);
  return (
    <>
      <DataList path="/api/v1/snapshots" params={{ limit: 100, ...params }} filters={[{ key: 'status', label: 'Situação', options: SNAP_STATUS }]}
        columns={[{ key: 'taken_at', label: 'Data' }, { key: 'job_name', label: 'Job' }, { key: 'restic_id', label: 'ID', render: (r) => <code className="text-xs">{r.restic_id.slice(0, 8)}</code> },
          { key: 'status', label: 'Situação' }, { key: 'size_bytes', label: 'Tamanho' }, { key: 'added_bytes', label: 'Novos' }, { key: 'verified_at', label: 'Verificado' },
          { key: 'legal_hold', label: 'Retenção legal', render: (r) => (r.legal_hold ? <Badge tone="info">retido</Badge> : '—') }]}
        rowActions={(r, reload) => r.status === 'removido' ? null : <>
          {can('restauracoes.solicitar') && <Button size="sm" variant="outline" onClick={() => setBrowse(r)}>Arquivos</Button>}
          {can('restauracoes.solicitar') && r.status === 'validado' && <Button size="sm" variant="default" onClick={() => setRestore({ sn: r, includes: [] })}>Restaurar</Button>}
          <Action label="Verificar" method="POST" path={`/api/v1/snapshots/${r.id}/verify`} title="Verificar snapshot" confirm="Lê os dados do snapshot no repositório e confere a integridade." successMessage="Verificação enfileirada." onDone={reload} />
          <Action label={r.legal_hold ? 'Liberar retenção' : 'Reter'} method="POST" path={`/api/v1/snapshots/${r.id}/legal-hold`} title={r.legal_hold ? 'Liberar retenção legal' : 'Aplicar retenção legal'}
            initial={{ hold: !r.legal_hold }} overrides={{ hold: { hidden: true } }} transform={(b) => ({ ...b, hold: !r.legal_hold })}
            description={r.legal_hold ? 'O snapshot volta a seguir a política de retenção.' : 'O snapshot não é removido pela retenção até a liberação.'} successMessage="Retenção atualizada." onDone={reload} />
        </>} />
      {browse && <FileBrowser sn={browse} onClose={() => setBrowse(null)} onRestore={(includes) => { setRestore({ sn: browse, includes }); setBrowse(null); }} />}
      {restore && <RestoreDialog sn={restore.sn} includes={restore.includes} onClose={() => setRestore(null)} />}
    </>
  );
}
export function SnapshotsPage() {
  return <div><PageHeader title="Snapshots" subtitle="Pontos de restauração. Só snapshots validados podem ser restaurados." /><SnapshotsList /></div>;
}

function FileBrowser({ sn, onClose, onRestore }: { sn: any; onClose: () => void; onRestore: (includes: string[]) => void }) {
  const [dir, setDir] = useState('/');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ls = useApi(`/api/v1/snapshots/${sn.id}/files${qs({ path: dir })}`);
  const parts = dir.split('/').filter(Boolean);
  const items: any[] = (ls.data?.items ?? []).filter((i: any) => i.path !== dir);
  const toggle = (p: string) => { const n = new Set(sel); if (n.has(p)) n.delete(p); else n.add(p); setSel(n); };
  return (
    <Dialog open onClose={onClose} title={`Arquivos do snapshot ${sn.restic_id.slice(0, 8)}`} wide>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="cursor-pointer text-primary hover:underline" onClick={() => setDir('/')}>/</button>
          {parts.map((p, i) => <span key={i} className="flex items-center gap-1"><ChevronRight className="size-3" /><button className="cursor-pointer text-primary hover:underline" onClick={() => setDir('/' + parts.slice(0, i + 1).join('/'))}>{p}</button></span>)}
        </div>
        {ls.error && <Notice tone="bad">{ls.error.message}</Notice>}
        {ls.loading ? <Spinner /> : !items.length ? <Empty>Pasta vazia.</Empty> : (
          <Table><thead><tr><Th /><Th>Nome</Th><Th>Tamanho</Th><Th>Modificado</Th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.path} className="hover:bg-muted/50">
                <Td><input type="checkbox" aria-label={`Selecionar ${i.name}`} checked={sel.has(i.path)} onChange={() => toggle(i.path)} /></Td>
                <Td>{i.type === 'dir' ? <button className="flex cursor-pointer items-center gap-1 text-primary hover:underline" onClick={() => setDir(i.path)}><Folder className="size-4" />{i.name}</button> : <span className="flex items-center gap-1"><File className="size-4 text-muted-foreground" />{i.name}</span>}</Td>
                <Td className="tabular">{i.type === 'dir' ? '—' : fmtBytes(i.size)}</Td><Td>{fmtDate(i.mtime)}</Td>
              </tr>
            ))}</tbody></Table>
        )}
        {ls.data?.truncated && <Notice tone="warn">Lista limitada a 1000 itens.</Notice>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{sel.size} selecionado(s)</span>
          <div className="flex gap-2"><Button variant="outline" onClick={onClose}>Fechar</Button>{sn.status === 'validado' && <Button onClick={() => onRestore([...sel])}>{sel.size ? 'Restaurar selecionados' : 'Restaurar tudo'}</Button>}</div>
        </div>
      </div>
    </Dialog>
  );
}

function RestoreDialog({ sn, includes, onClose }: { sn: any; includes: string[]; onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const isDb = !!sn.stdin_filename;
  const modes = isDb ? ['novo_banco', ...(can('restaurar.producao') ? ['producao'] : [])] : ['temporario', 'caminho'];
  return (
    <ActionDialog label="Restaurar" title={`Restaurar snapshot ${sn.restic_id.slice(0, 8)} (${sn.job_name})`} method="POST" path="/api/v1/restores" onClose={onClose}
      initial={{ snapshot_id: sn.id, mode: modes[0], includes }}
      overrides={(v) => ({
        snapshot_id: { hidden: true },
        mode: { schema: { type: 'string', enum: modes }, help: v.mode === 'producao' ? 'Por cima da produção: exige aprovação de outra pessoa e um backup de segurança validado antes.' : v.mode === 'novo_banco' ? 'Cria um banco novo ao lado do original.' : v.mode === 'temporario' ? 'Restaura no diretório temporário do agente.' : 'Restaura num diretório novo ou vazio.' },
        includes: { hidden: isDb }, target_dir: { hidden: v.mode !== 'caminho' }, new_name: { hidden: !isDb || v.mode !== 'novo_banco', help: 'Opcional: sem nome, a central gera um.' },
        new_file: { hidden: !isDb || v.mode !== 'novo_banco', help: 'Só para SQLite.' }, confirmation: { hidden: v.mode !== 'producao', label: 'Digite o nome do servidor para confirmar' }
      })}
      transform={(b) => ({ ...b, snapshot_id: sn.id })}
      submitLabel="Solicitar restauração" successMessage="Restauração solicitada." onDone={(r) => nav(`/restauracoes/${r.id}`)} />
  );
}

// ------------------------------------------------------------------ pgBackRest
const PGBR_COLUMNS = [{ key: 'stanza', label: 'Stanza' }, { key: 'server_name', label: 'Servidor' }, { key: 'status', label: 'Situação' }, { key: 'full_schedule', label: 'Full' }, { key: 'diff_schedule', label: 'Diff' },
  { key: 'last_backup_at', label: 'Último backup', render: (r: any) => (r.last_backup_at ? `${fmtDate(r.last_backup_at)} (${r.last_backup_type})` : '—') }, { key: 'last_backup_bytes', label: 'Tamanho' }, { key: 'enabled', label: 'Ativa' }];
export function PgbackrestPage() {
  return (
    <div>
      <PageHeader title="pgBackRest" subtitle="Backups físicos de PostgreSQL com WAL contínuo. O repositório e a cifra ficam no pgbackrest.conf do servidor." />
      <DataList path="/api/v1/pgbackrest-stanzas" rowLink={(r) => `/pgbackrest/${r.id}`} columns={PGBR_COLUMNS}
        actions={(reload) => <Action label="Nova stanza" icon={<Plus />} variant="default" method="POST" path="/api/v1/pgbackrest-stanzas" initial={{ timezone: 'America/Sao_Paulo', full_schedule: '0 1 * * 0', diff_schedule: '0 1 * * 1-6', enabled: true }}
          overrides={{ database_id: { help: 'Opcional: o banco PostgreSQL cadastrado que esta stanza protege.' } }} onDone={reload} successMessage="Stanza cadastrada." />} />
    </div>
  );
}

export function PgbackrestDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const d = useApi(`/api/v1/pgbackrest-stanzas/${id}`);
  if (d.loading) return <Spinner />;
  if (d.error) return <Notice tone="bad">{d.error.message}</Notice>;
  const r = d.data;
  const runs: any[] = d.data.runs ?? [];
  const summary = d.data.summary;
  return (
    <div className="space-y-4">
      <PageHeader title={`Stanza ${r.stanza}`} subtitle={<Link className="text-primary hover:underline" to={`/servidores/${r.server_id}`}>{r.server_name}</Link>}>
        <Action label="Executar" variant="default" method="POST" path={`/api/v1/pgbackrest-stanzas/${r.id}/run`} title="Executar pgBackRest" initial={{ type: 'diff' }}
          description="full/diff/incr fazem backup, check do WAL e info; info só consulta." successMessage="Execução enfileirada." onDone={d.reload} />
        <Action label="Editar" method="PATCH" path={`/api/v1/pgbackrest-stanzas/${r.id}`} title="Editar stanza" initial={r} onDone={d.reload} successMessage="Stanza atualizada." />
        <Action label="Arquivar" variant="destructive" method="POST" path={`/api/v1/pgbackrest-stanzas/${r.id}/archive`} title="Arquivar stanza" typeToConfirm={r.stanza} confirm="A central para de agendar. Os backups no repositório do pgBackRest não são apagados." successMessage="Stanza arquivada." onDone={() => nav('/pgbackrest')} />
      </PageHeader>
      <Card><CardContent>
        <Fields items={[['Situação', <StatusBadge value={r.status} />], ['Full', `${r.full_schedule} (próximo ${fmtDate(r.next_full_at)})`], ['Diff', r.diff_schedule ? `${r.diff_schedule} (próximo ${fmtDate(r.next_diff_at)})` : '—'], ['Fuso', r.timezone],
          ['Último backup', r.last_backup_label ? `${r.last_backup_label} (${r.last_backup_type})` : '—'], ['Em', fmtDate(r.last_backup_at)], ['Tamanho no repositório', fmtBytes(r.last_backup_bytes)], ['WAL', r.wal_min ? `${r.wal_min} → ${r.wal_max}` : '—'],
          ['Último info', fmtDate(r.last_info_at)], ['Erro', r.last_error]]} />
      </CardContent></Card>
      {summary?.problems?.length > 0 && <Notice tone="bad">{summary.problems.join(' · ')}</Notice>}
      {summary?.backups?.length > 0 && (
        <Card><CardHeader><CardTitle>Backups no repositório</CardTitle></CardHeader>
          <Table><thead><tr><Th>Rótulo</Th><Th>Tipo</Th><Th>Início</Th><Th>Fim</Th><Th>Tamanho</Th><Th>No repositório</Th><Th>Erro</Th></tr></thead>
            <tbody>{summary.backups.map((b: any) => <tr key={b.label}><Td><code className="text-xs">{b.label}</code></Td><Td>{b.type}</Td><Td>{fmtDate(b.start)}</Td><Td>{fmtDate(b.stop)}</Td><Td>{fmtBytes(b.size)}</Td><Td>{fmtBytes(b.repo_size)}</Td><Td>{b.error ? <Badge tone="bad">sim</Badge> : '—'}</Td></tr>)}</tbody></Table>
        </Card>
      )}
      <Card><CardHeader><CardTitle>Execuções</CardTitle></CardHeader>
        {!runs.length ? <Empty>Nenhuma execução ainda.</Empty> : (
          <Table><thead><tr><Th>Criada</Th><Th>Tipo</Th><Th>Origem</Th><Th>Situação</Th><Th>Fim</Th><Th>Erro</Th></tr></thead>
            <tbody>{runs.map((x) => <tr key={x.id}><Td>{fmtDate(x.created_at)}</Td><Td>{x.type}</Td><Td>{x.trigger}</Td><Td><StatusBadge value={x.status} /></Td><Td>{fmtDate(x.finished_at)}</Td><Td className="text-xs">{x.error ?? '—'}</Td></tr>)}</tbody></Table>
        )}
      </Card>
    </div>
  );
}
