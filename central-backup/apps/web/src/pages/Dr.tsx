import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Download, Plus } from 'lucide-react';
import { download, saveBlob, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { DataList } from '../components/DataList.tsx';
import { Action } from '../components/Action.tsx';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Code, Empty, Fields, Notice, Spinner, Table, Tabs, Td, Th } from '../components/ui/index.tsx';
import { fmtDate } from '../lib/utils.ts';
import { toast } from '../components/toast.tsx';

const PHASE: Record<string, string> = { infra: 'Infraestrutura', agente: 'Agente', pacotes: 'Pacotes', dados: 'Dados', aplicacao: 'Aplicação', rede: 'Rede' };
const sevTone = (s: string) => (s === 'critico' ? 'bad' : s === 'aviso' ? 'warn' : 'info') as 'bad' | 'warn' | 'info';

export function DrPlansPage() {
  return (
    <div>
      <PageHeader title="Planos de recuperação de desastre" subtitle="Gerados a partir do inventário, dos backups validados e das restaurações medidas. Nada é estimado sem dizer a base." />
      <DataList path="/api/v1/dr-plans" rowLink={(r) => `/dr/${r.id}`}
        columns={[{ key: 'name', label: 'Plano' }, { key: 'server_name', label: 'Servidor' }, { key: 'ready', label: 'Pronto', render: (r) => <Badge tone={r.ready ? 'ok' : 'bad'}>{r.ready ? 'pronto' : 'com pendências'}</Badge> },
          { key: 'rpo_minutes', label: 'RPO (min)' }, { key: 'rto_minutes', label: 'RTO (min)' }, { key: 'revision', label: 'Revisão' }, { key: 'generated_at', label: 'Gerado' }, { key: 'last_exercise_at', label: 'Último exercício' }]}
        actions={(reload) => <Action label="Novo plano" icon={<Plus />} variant="default" method="POST" path="/api/v1/dr-plans" initial={{ target: { os_name: 'Ubuntu', os_version: '24.04', arch: 'x86_64' } }}
          overrides={{ target: { help: 'Como será a máquina nova (o plano confere compatibilidade e capacidade).' } }} onDone={reload} successMessage="Plano gerado." />} />
    </div>
  );
}

type T = 'resumo' | 'passos' | 'reproduzir' | 'exercicios';
export function DrPlanDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { canRoute } = useAuth();
  const [tab, setTab] = useState<T>('resumo');
  const d = useApi(`/api/v1/dr-plans/${id}`);
  if (d.loading) return <Spinner />;
  if (d.error) return <Notice tone="bad">{d.error.message}</Notice>;
  const r = d.data; const p = r.plan ?? {};
  return (
    <div className="space-y-4">
      <PageHeader title={r.name} subtitle={<><Link className="text-primary hover:underline" to={`/servidores/${r.server_id}`}>{r.server_name}</Link> · revisão {r.revision} · {fmtDate(r.generated_at)}</>}>
        <Action label="Regenerar" variant="default" method="POST" path={`/api/v1/dr-plans/${r.id}/regenerate`} title="Regenerar plano" initial={{ target: r.target }} description="Recalcula com o inventário, os snapshots e as medições atuais." successMessage="Plano regenerado." onDone={d.reload} />
        {canRoute('GET', `/api/v1/dr-plans/${r.id}/ansible`) && <Button variant="outline" size="sm" onClick={() => download(`/api/v1/dr-plans/${r.id}/ansible`, 'dr.yml').catch((e) => toast(e.message, 'bad'))}><Download />Playbook Ansible</Button>}
        <Action label="Cloud-init" method="POST" path={`/api/v1/dr-plans/${r.id}/cloud-init`} title="Gerar cloud-init" wide successMessage=""
          description="Gera o user-data da máquina nova: instala o agente e o registra com um código de uso único (vale pelo tempo escolhido). Um servidor novo é cadastrado para o cliente."
          renderResult={(text: string) => <div className="space-y-2"><Notice tone="warn">Contém um código de registro de uso único. Não publique este arquivo.</Notice><Code>{text}</Code>
            <Button variant="outline" size="sm" onClick={() => saveBlob(new Blob([text], { type: 'text/cloud-config' }), `cloud-init-${r.server_name}.yaml`)}><Download />Baixar</Button></div>} onDone={d.reload} />
        <Action label="Registrar exercício" method="POST" path={`/api/v1/dr-plans/${r.id}/exercises`} title="Registrar exercício de DR" description="O RTO medido é a duração real entre início e fim." successMessage="Exercício registrado." onDone={d.reload} />
        <Action label="Arquivar" variant="destructive" method="POST" path={`/api/v1/dr-plans/${r.id}/archive`} title="Arquivar plano" typeToConfirm={r.name} successMessage="Plano arquivado." onDone={() => nav('/dr')} />
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Situação</div><Badge tone={p.ready ? 'ok' : 'bad'} className="mt-1">{p.ready ? 'pronto para executar' : 'com pendências críticas'}</Badge></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">RPO atual / projetado</div><div className="tabular text-lg font-semibold">{p.rpo?.atual_min ?? '—'} / {p.rpo?.projetado_min ?? '—'} min</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">RTO estimado</div><div className="tabular text-lg font-semibold">{p.rto?.estimado_min ?? '—'} min</div><div className="text-xs text-muted-foreground">vazão {p.rto?.vazao}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Último exercício</div><div className="text-sm">{r.exercises?.[0] ? `${fmtDate(r.exercises[0].finished_at)} (${r.exercises[0].outcome})` : 'nunca'}</div></CardContent></Card>
      </div>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: 'resumo', label: 'Pendências' }, { id: 'passos', label: 'Passos' }, { id: 'reproduzir', label: 'O que reproduzir' }, { id: 'exercicios', label: 'Exercícios' }]} />
      {tab === 'resumo' && (
        <Card>{!p.findings?.length ? <Empty>Nenhuma pendência.</Empty> : (
          <ul className="divide-y divide-border">{p.findings.map((f: any, i: number) => <li key={i} className="flex gap-3 px-4 py-2 text-sm"><Badge tone={sevTone(f.severity)}>{f.severity}</Badge><span>{f.message}</span></li>)}</ul>
        )}<CardContent className="border-t border-border text-xs text-muted-foreground">Base do RTO: {p.rto?.base}</CardContent></Card>
      )}
      {tab === 'passos' && (
        <Card><Table><thead><tr><Th>#</Th><Th>Fase</Th><Th>Passo</Th><Th>Como</Th><Th>Automático</Th><Th>Minutos</Th><Th>Base</Th></tr></thead>
          <tbody>{(p.steps ?? []).map((s: any) => <tr key={s.order}><Td>{s.order}</Td><Td>{PHASE[s.phase] ?? s.phase}</Td><Td className="font-medium">{s.title}</Td><Td className="text-xs">{s.how}</Td><Td>{s.automated ? 'sim' : 'manual'}</Td><Td className="tabular">{Math.round(s.minutes)}</Td><Td className="text-xs text-muted-foreground">{s.basis}</Td></tr>)}</tbody></Table></Card>
      )}
      {tab === 'reproduzir' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Origem e destino</CardTitle></CardHeader><CardContent>
            <Fields items={[['Origem', `${p.source?.server} — ${p.source?.os} ${p.source?.arch ?? ''}`], ['Inventário de', fmtDate(p.source?.inventory_at)], ['Destino', `${p.target?.os_name} ${p.target?.os_version} ${p.target?.arch}`], ['Domínios', p.domains?.join(', ') || '—']]} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Pontos de restauração</CardTitle></CardHeader>
            {!p.restore_points?.length ? <Empty>Nenhum snapshot validado.</Empty> : <Table><tbody>{p.restore_points.map((x: any) => <tr key={x.job_id}><Td>{x.job}</Td><Td><code className="text-xs">{x.restic_id.slice(0, 8)}</code></Td><Td>{fmtDate(x.taken_at)}</Td></tr>)}</tbody></Table>}
          </Card>
          <Card><CardHeader><CardTitle>Pacotes ({p.packages?.length ?? 0})</CardTitle></CardHeader><CardContent className="text-sm">{p.packages?.join(', ') || '—'}</CardContent></Card>
          <Card><CardHeader><CardTitle>Serviços ({p.services?.length ?? 0})</CardTitle></CardHeader><CardContent className="text-sm">{p.services?.join(', ') || '—'}</CardContent></Card>
        </div>
      )}
      {tab === 'exercicios' && (
        <Card>{!r.exercises?.length ? <Empty>Nenhum exercício registrado. Um plano só é confiável depois de testado.</Empty> : (
          <Table><thead><tr><Th>Início</Th><Th>Tipo</Th><Th>Resultado</Th><Th>RTO medido</Th><Th>RTO estimado</Th><Th>RPO medido</Th><Th>Revisão</Th><Th>Notas</Th></tr></thead>
            <tbody>{r.exercises.map((e: any) => <tr key={e.public_id}><Td>{fmtDate(e.started_at)}</Td><Td>{e.kind}</Td><Td><Badge tone={e.outcome === 'sucesso' ? 'ok' : e.outcome === 'parcial' ? 'warn' : 'bad'}>{e.outcome}</Badge></Td>
              <Td className="tabular">{e.measured_rto_minutes ?? '—'} min</Td><Td className="tabular">{e.estimated_rto_minutes ?? '—'} min</Td><Td className="tabular">{e.measured_rpo_minutes ?? '—'}</Td><Td>{e.plan_revision}</Td><Td className="text-xs">{e.notes}</Td></tr>)}</tbody></Table>
        )}</Card>
      )}
    </div>
  );
}
