import { Link } from 'react-router';
import { useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty, Notice, Spinner, StatusBadge, Table, Td, Th } from '../components/ui/index.tsx';
import { fmtAgo, fmtPct } from '../lib/utils.ts';

const HEALTH: Record<string, string> = { ok: 'ok', atencao: 'atenção', critico: 'crítico', sem_agente: 'sem agente' };

export function OverviewPage() {
  const { can } = useAuth();
  const ov = useApi('/api/v1/monitoring/overview');
  const alerts = useApi(can('alertas.ver') ? '/api/v1/alerts?status=ativos&limit=10' : null);
  const items: any[] = ov.data?.items ?? [];
  const count = (h: string) => items.filter((s) => s.health === h).length;
  const tiles = [
    { label: 'Servidores', value: items.length, tone: 'default' as const },
    { label: 'Saudáveis', value: count('ok'), tone: 'ok' as const },
    { label: 'Com atenção', value: count('atencao'), tone: 'warn' as const },
    { label: 'Críticos', value: count('critico'), tone: 'bad' as const },
    { label: 'Sem agente', value: count('sem_agente'), tone: 'default' as const }
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Visão geral" subtitle="Saúde dos servidores e dos backups, a partir dos dados enviados pelos agentes." />
      {ov.error && <Notice tone="bad">{ov.error.message}</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="tabular text-2xl font-semibold">{ov.loading ? '…' : t.value}</div>{t.tone !== 'default' && <div className={`mt-1 h-1 rounded ${t.tone === 'ok' ? 'bg-success' : t.tone === 'warn' ? 'bg-warning' : 'bg-destructive'}`} />}</CardContent></Card>
        ))}
      </div>
      {can('alertas.ver') && (
        <Card>
          <CardHeader><CardTitle>Alertas ativos</CardTitle><Link to="/alertas" className="text-sm text-primary hover:underline">Ver todos</Link></CardHeader>
          {alerts.loading ? <Spinner /> : !(alerts.data?.items?.length) ? <Empty>Nenhum alerta ativo.</Empty> : (
            <Table><thead><tr><Th>Severidade</Th><Th>Alerta</Th><Th>Cliente</Th><Th>Desde</Th><Th>Situação</Th></tr></thead>
              <tbody>{alerts.data.items.map((a: any) => (
                <tr key={a.id}><Td><StatusBadge value={a.severity} /></Td><Td>{a.title}</Td><Td>{a.client_name}</Td><Td>{fmtAgo(a.opened_at)}</Td><Td><StatusBadge value={a.status} /></Td></tr>
              ))}</tbody></Table>
          )}
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Servidores</CardTitle></CardHeader>
        {ov.loading ? <Spinner /> : !items.length ? <Empty>Nenhum servidor cadastrado. Comece em <Link className="text-primary" to="/clientes">Clientes</Link> e depois <Link className="text-primary" to="/servidores">Servidores</Link>.</Empty> : (
          <Table>
            <thead><tr><Th>Servidor</Th><Th>Cliente</Th><Th>Saúde</Th><Th>CPU</Th><Th>Memória</Th><Th>Disco</Th><Th>Jobs</Th><Th>Último contato</Th><Th>Problemas</Th></tr></thead>
            <tbody>{items.map((s) => {
              const m = s.last_metrics ?? {};
              return (
                <tr key={s.id} className="hover:bg-muted/50">
                  <Td><Link className="font-medium text-primary hover:underline" to={`/servidores/${s.id}`}>{s.name}</Link></Td>
                  <Td>{s.client_name}</Td>
                  <Td><Badge tone={s.health === 'ok' ? 'ok' : s.health === 'atencao' ? 'warn' : s.health === 'critico' ? 'bad' : 'default'}>{HEALTH[s.health] ?? s.health}</Badge></Td>
                  <Td className="tabular">{fmtPct(m.cpu_pct)}</Td><Td className="tabular">{fmtPct(m.mem_used_pct)}</Td><Td className="tabular">{fmtPct(m.disk_max_pct)}</Td>
                  <Td className="tabular">{s.jobs}{Number(s.jobs_failing) > 0 && <span className="text-destructive"> ({s.jobs_failing} com falha)</span>}</Td>
                  <Td>{fmtAgo(s.last_seen_at)}</Td>
                  <Td className="text-xs">{s.problems?.length ? s.problems.join('; ') : <span className="text-muted-foreground">—</span>}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
