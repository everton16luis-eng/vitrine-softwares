import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { CONFIG_SCHEMAS } from '../lib/schemas.gen.ts';
import type { JsonSchema } from '../lib/openapi.ts';
import { PageHeader } from '../components/Layout.tsx';
import { DataList } from '../components/DataList.tsx';
import { Action } from '../components/Action.tsx';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Code, Dialog, Empty, Fields, Notice, Spinner, StatusBadge, statusLabel, Table, Td, Th } from '../components/ui/index.tsx';
import { fmtAgo, fmtDate } from '../lib/utils.ts';
import { Logs } from './Backup.tsx';

// ------------------------------------------------------------------ restaurações
const RESTORE_STATUS = ['aguardando_aprovacao', 'backup_seguranca', 'na_fila', 'restaurando', 'concluido', 'falhou', 'rejeitado', 'cancelado'].map((v) => ({ value: v, label: statusLabel(v) }));
const MODE: Record<string, string> = { temporario: 'diretório temporário', caminho: 'diretório novo', novo_banco: 'banco novo', producao: 'produção' };
export function RestoresPage() {
  return (
    <div>
      <PageHeader title="Restaurações" subtitle="Para pedir uma restauração, escolha o snapshot em Snapshots. Produção exige aprovação de outra pessoa." />
      <DataList path="/api/v1/restores" filters={[{ key: 'status', label: 'Situação', options: RESTORE_STATUS }]} rowLink={(r) => `/restauracoes/${r.id}`} refreshEvery={15}
        columns={[{ key: 'created_at', label: 'Pedida' }, { key: 'server_name', label: 'Servidor' }, { key: 'job_name', label: 'Job' }, { key: 'mode', label: 'Modo', render: (r) => MODE[r.mode] ?? r.mode },
          { key: 'status', label: 'Situação' }, { key: 'requested_by_email', label: 'Solicitante', render: (r) => (r.drill ? <Badge tone="info">teste automático</Badge> : r.requested_by_email) },
          { key: 'duration_s', label: 'Duração', render: (r) => (r.duration_s != null ? `${r.duration_s} s` : '—') }]} />
    </div>
  );
}

export function RestoreDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const d = useApi(`/api/v1/restores/${id}`);
  if (d.loading) return <Spinner />;
  if (d.error) return <Notice tone="bad">{d.error.message}</Notice>;
  const r = d.data;
  const waiting = r.status === 'aguardando_aprovacao';
  const own = user && Number(r.requested_by) === user.id;
  return (
    <div className="space-y-4">
      <PageHeader title={`Restauração para ${MODE[r.mode] ?? r.mode}`} subtitle={<><Link className="text-primary hover:underline" to={`/servidores/${r.server_id}`}>{r.server_name}</Link> · {r.job_name}</>}>
        {waiting && !own && <Action label="Aprovar" variant="destructive" method="POST" path={`/api/v1/restores/${r.id}/approve`} title="Aprovar restauração de produção"
          description={<>Antes de restaurar, a central faz um backup de segurança do estado atual e só segue se ele for validado. Digite <b>{r.server_name}</b> no campo de confirmação.</>}
          overrides={{ confirmation: { label: `Digite ${r.server_name} para confirmar` } }} successMessage="Aprovada. O backup de segurança começou." onDone={d.reload} />}
        {waiting && !own && <Action label="Rejeitar" method="POST" path={`/api/v1/restores/${r.id}/reject`} title="Rejeitar restauração" successMessage="Restauração rejeitada." onDone={d.reload} />}
        {['aguardando_aprovacao', 'na_fila', 'backup_seguranca'].includes(r.status) && <Action label="Cancelar" method="POST" path={`/api/v1/restores/${r.id}/cancel`} title="Cancelar restauração" confirm="A restauração não será executada." successMessage="Restauração cancelada." onDone={d.reload} />}
      </PageHeader>
      {waiting && own && <Notice tone="warn">Aguardando aprovação de outra pessoa com permissão para restaurar produção.</Notice>}
      <Card><CardContent>
        <Fields items={[['Situação', <StatusBadge value={r.status} />], ['Snapshot', <code className="text-xs">{String(r.snapshot).slice(0, 8)}</code>], ['Snapshot de', fmtDate(r.snapshot_taken_at)], ['Tipo', r.kind],
          ['Motivo', r.reason], ['Solicitante', r.drill ? 'teste automático' : r.requested_by_email], ['Aprovação', r.approved_by_email ? `${r.approved_by_email} em ${fmtDate(r.approved_at)}` : '—'], ['Observação da decisão', r.decision_note],
          ['Backup de segurança', r.safety_run ? <Link className="text-primary hover:underline" to={`/execucoes/${r.safety_run}`}>ver execução</Link> : '—'], ['Duração', r.duration_s != null ? `${r.duration_s} s` : '—'], ['Fim', fmtDate(r.finished_at)], ['Erro', r.error]]} />
      </CardContent></Card>
      {r.options && Object.keys(r.options).length > 0 && <Card><CardHeader><CardTitle>Opções</CardTitle></CardHeader><CardContent><Code>{JSON.stringify(r.options, null, 2)}</Code></CardContent></Card>}
      {r.result && <Card><CardHeader><CardTitle>Resultado</CardTitle></CardHeader><CardContent><Code>{JSON.stringify(r.result, null, 2)}</Code></CardContent></Card>}
      <Logs logs={r.logs ?? []} />
    </div>
  );
}

// ------------------------------------------------------------------ alertas
const ALERT_STATUS = [{ value: 'ativos', label: 'ativos' }, { value: 'aberto', label: 'abertos' }, { value: 'reconhecido', label: 'reconhecidos' }, { value: 'resolvido', label: 'resolvidos' }];
export function AlertsPage() {
  const [notif, setNotif] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Alertas" subtitle="Abertos automaticamente pelas regras e resolvidos quando a condição some." />
      <DataList path="/api/v1/alerts" params={{ limit: 200 }} filters={[{ key: 'status', label: 'Situação', options: ALERT_STATUS }]} refreshEvery={30}
        columns={[{ key: 'severity', label: 'Severidade' }, { key: 'title', label: 'Alerta' }, { key: 'client_name', label: 'Cliente' }, { key: 'status', label: 'Situação' },
          { key: 'opened_at', label: 'Aberto', render: (r) => fmtAgo(r.opened_at) }, { key: 'occurrences', label: 'Ocorrências' },
          { key: 'acknowledged_by', label: 'Reconhecido por', render: (r) => (r.acknowledged_by ? `${r.acknowledged_by}: ${r.ack_note ?? ''}` : '—') }, { key: 'resolved_at', label: 'Resolvido' }]}
        rowActions={(r, reload) => <>
          <Button size="sm" variant="ghost" onClick={() => setNotif(r)}>Notificações</Button>
          {r.status === 'aberto' && <Action label="Reconhecer" method="POST" path={`/api/v1/alerts/${r.id}/ack`} title="Reconhecer alerta" description="Os lembretes param; o alerta continua aberto até a condição sumir." successMessage="Alerta reconhecido." onDone={reload} />}
        </>} />
      {notif && <Notifications alert={notif} onClose={() => setNotif(null)} />}
    </div>
  );
}

function Notifications({ alert, onClose }: { alert: any; onClose: () => void }) {
  const n = useApi(`/api/v1/alerts/${alert.id}/notifications`);
  return (
    <Dialog open onClose={onClose} title={`Notificações — ${alert.title}`} wide>
      {n.loading ? <Spinner /> : n.error ? <Notice tone="bad">{n.error.message}</Notice> : !n.data.items.length ? <Empty>Nenhuma notificação enviada (sem canais na regra?).</Empty> : (
        <Table><thead><tr><Th>Quando</Th><Th>Evento</Th><Th>Canal</Th><Th>Situação</Th><Th>Erro</Th></tr></thead>
          <tbody>{n.data.items.map((x: any, i: number) => <tr key={i}><Td>{fmtDate(x.at)}</Td><Td>{x.event}</Td><Td>{x.channel} ({x.kind})</Td><Td><StatusBadge value={x.status} /></Td><Td className="text-xs">{x.error ?? '—'}</Td></tr>)}</tbody></Table>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ regras
const KIND_HELP: Record<string, string> = {
  backup_atrasado: 'Limite: horas sem backup validado (vazio = usa o RPO do cliente).', disco: 'Limite: % de uso do disco mais cheio.', memoria: 'Limite: % de memória usada.',
  agente_sem_contato: 'Limite: minutos sem contato.', backup_falhou: 'Sem limite.', servicos_com_falha: 'Limite: número de unidades com falha.'
};
export function RulesPage() {
  return (
    <div>
      <PageHeader title="Regras de alerta" subtitle="O que vira alerta e para quais canais vai." />
      <DataList path="/api/v1/alert-rules"
        columns={[{ key: 'name', label: 'Nome' }, { key: 'kind', label: 'Tipo' }, { key: 'threshold', label: 'Limite' }, { key: 'severity', label: 'Severidade' }, { key: 'remind_hours', label: 'Lembrete (h)' },
          { key: 'channel_ids', label: 'Canais', render: (r) => r.channel_ids?.length ?? 0 }, { key: 'enabled', label: 'Ativa' }, { key: 'client_id', label: 'Cliente', render: (r) => (r.client_id ? `#${r.client_id}` : 'global') }]}
        rowActions={(r, reload) => <>
          <Action label="Editar" method="PATCH" path={`/api/v1/alert-rules/${r.id}`} title="Editar regra" initial={r} overrides={{ threshold: { help: KIND_HELP[r.kind] } }} onDone={reload} successMessage="Regra atualizada." />
          <Action label="Arquivar" variant="ghost" method="POST" path={`/api/v1/alert-rules/${r.id}/archive`} title="Arquivar regra" confirm={`A regra "${r.name}" deixa de gerar alertas.`} successMessage="Regra arquivada." onDone={reload} />
        </>}
        actions={(reload) => <>
          <Action label="Criar recomendadas" method="POST" path="/api/v1/alert-rules/recommended" title="Regras recomendadas" description="Cria as regras globais que ainda não existem (backup atrasado e com falha, agente sem contato, disco, memória, serviços, repositório, destino, teste de restauração e pgBackRest)." successMessage={(x) => (x.items.length ? `${x.items.length} regra(s) criada(s).` : 'As regras recomendadas já existem.')} onDone={reload} />
          <Action label="Nova regra" icon={<Plus />} variant="default" method="POST" path="/api/v1/alert-rules" overrides={(v) => ({ threshold: { help: KIND_HELP[v.kind] } })} onDone={reload} successMessage="Regra criada." />
        </>} />
    </div>
  );
}

// ------------------------------------------------------------------ canais
const S = CONFIG_SCHEMAS.channels;
const channelOv = (v: Record<string, any>) => ({
  config: v.kind === 'email' ? { schema: S.email as JsonSchema } : v.kind === 'whatsapp' ? { schema: S.whatsapp as JsonSchema, help: 'API oficial do WhatsApp Business (Meta). Números com DDI, só dígitos.' } : { hidden: true },
  secret: v.kind === 'webhook' ? { schema: S.webhook_secret as JsonSchema, help: 'A URL e a chave ficam cifradas. Cada envio leva assinatura HMAC-SHA256.' } : v.kind === 'whatsapp' ? { schema: S.whatsapp_secret as JsonSchema } : { hidden: true }
});
export function ChannelsPage() {
  return (
    <div>
      <PageHeader title="Canais de notificação" subtitle="E-mail, webhook e WhatsApp. Segredos são cifrados e não voltam pela API." />
      <DataList path="/api/v1/notification-channels"
        columns={[{ key: 'name', label: 'Nome' }, { key: 'kind', label: 'Tipo' }, { key: 'config', label: 'Destino', render: (r) => (r.config?.to ? r.config.to.join(', ') : r.kind === 'webhook' ? 'URL cifrada' : '—') },
          { key: 'has_secret', label: 'Segredo', render: (r) => (r.has_secret ? 'definido' : '—') }, { key: 'enabled', label: 'Ativo' }, { key: 'last_ok_at', label: 'Último envio ok' }, { key: 'last_error', label: 'Último erro' }]}
        rowActions={(r, reload) => <>
          <Action label="Testar" method="POST" path={`/api/v1/notification-channels/${r.id}/test`} title="Testar canal" confirm="Envia uma mensagem de teste agora." successMessage={(x) => (x?.ok === false ? `Falhou: ${x.error}` : 'Mensagem de teste enviada.')} onDone={reload} />
          <Action label="Editar" method="PATCH" path={`/api/v1/notification-channels/${r.id}`} title="Editar canal" initial={{ ...r, secret: undefined }} overrides={() => ({ ...channelOv(r), secret: { ...channelOv(r).secret, help: 'Deixe em branco para manter o segredo atual.' } })} onDone={reload} successMessage="Canal atualizado." />
          <Action label="Arquivar" variant="ghost" method="POST" path={`/api/v1/notification-channels/${r.id}/archive`} title="Arquivar canal" confirm={`O canal "${r.name}" sai das regras.`} successMessage="Canal arquivado." onDone={reload} />
        </>}
        actions={(reload) => <Action label="Novo canal" icon={<Plus />} variant="default" method="POST" path="/api/v1/notification-channels" initial={{ enabled: true }} overrides={channelOv} transform={(b) => (b.kind === 'webhook' ? { ...b, config: {} } : b)} onDone={reload} successMessage="Canal criado." />} />
    </div>
  );
}
