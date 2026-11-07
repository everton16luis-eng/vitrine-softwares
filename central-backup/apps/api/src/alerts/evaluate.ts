// Avaliação das regras (worker, a cada minuto). Cada condição devolve as entidades que estão em
// falha AGORA; a central abre um incidente por regra × entidade (deduplicado pelo fingerprint),
// atualiza os que continuam, resolve os que normalizaram e notifica abertura, lembrete e resolução.
// As notificações saem depois do commit (rede fora da transação).
import type { Database, Tx } from '@central/database';
import { audit, SYSTEM } from '../audit.ts';
import type { SecretStore } from '../secrets.ts';
import { send, type Message, type SmtpConfig } from './channels.ts';

interface Firing { client_id: number; entity_type: string; entity_id: number; title: string; details: Record<string, unknown> }
type Rule = { id: number; client_id: number | null; kind: string; threshold: number | null; severity: string; remind_hours: number; channel_ids: number[] };

const DEFAULTS: Record<string, number> = { backup_atrasado: 26, agente_sem_contato: 10, disco: 90, memoria: 95 };

async function conditions(tx: Tx, rule: Rule): Promise<Firing[]> {
  const t = rule.threshold ?? DEFAULTS[rule.kind] ?? 0;
  const scope = 'AND ($1::bigint IS NULL OR x.client_id = $1)';
  const p = [rule.client_id];
  switch (rule.kind) {
    case 'backup_atrasado':
      return (await tx.many(`SELECT x.client_id, x.id, x.name, s.name AS server, x.last_success_at FROM backup_jobs x JOIN servers s ON s.id = x.server_id
        WHERE x.enabled AND x.archived_at IS NULL ${scope} AND coalesce(x.last_success_at, x.created_at) < now() - make_interval(hours => $2::int)`, [...p, Math.round(t)]))
        .map((r) => ({ client_id: r.client_id, entity_type: 'job', entity_id: r.id, title: `Sem backup validado há mais de ${Math.round(t)} h: ${r.name} (${r.server})`,
          details: { job: r.name, servidor: r.server, ultimo_validado: r.last_success_at ?? 'nunca' } }));
    case 'backup_falhou':
      return (await tx.many(`SELECT x.client_id, x.id, x.name, s.name AS server, x.last_status,
          (SELECT coalesce(r.error, sn.verify_error) FROM backup_runs r LEFT JOIN backup_snapshots sn ON sn.id = r.snapshot_id WHERE r.job_id = x.id ORDER BY r.id DESC LIMIT 1) AS error
        FROM backup_jobs x JOIN servers s ON s.id = x.server_id WHERE x.enabled AND x.archived_at IS NULL ${scope} AND x.last_status IN ('falhou', 'falha_verificacao')`, p))
        .map((r) => ({ client_id: r.client_id, entity_type: 'job', entity_id: r.id,
          title: `${r.last_status === 'falha_verificacao' ? 'Backup reprovado na verificação' : 'Backup falhou'}: ${r.name} (${r.server})`,
          details: { job: r.name, servidor: r.server, situacao: r.last_status, erro: String(r.error ?? '').slice(0, 500) } }));
    case 'agente_sem_contato':
      return (await tx.many(`SELECT x.client_id, x.id, x.name, x.last_seen_at FROM servers x
        WHERE x.archived_at IS NULL ${scope} AND x.connection_status <> 'sem_agente' AND (x.last_seen_at IS NULL OR x.last_seen_at < now() - make_interval(mins => $2::int))`, [...p, Math.round(t)]))
        .map((r) => ({ client_id: r.client_id, entity_type: 'servidor', entity_id: r.id, title: `Agente sem contato: ${r.name}`, details: { servidor: r.name, ultimo_contato: r.last_seen_at } }));
    case 'disco': case 'memoria': case 'servicos_com_falha': {
      const field = rule.kind === 'disco' ? 'disk_max_pct' : rule.kind === 'memoria' ? 'mem_used_pct' : 'failed_units';
      const limit = rule.kind === 'servicos_com_falha' ? Math.max(1, t) : t;
      return (await tx.many(`SELECT x.client_id, x.id, x.name, (x.last_metrics->>'${field}')::real AS v, x.last_metrics->'disks' AS disks FROM servers x
        WHERE x.archived_at IS NULL ${scope} AND x.last_metrics_at > now() - interval '15 minutes' AND (x.last_metrics->>'${field}')::real >= $2`, [...p, limit]))
        .map((r) => ({ client_id: r.client_id, entity_type: 'servidor', entity_id: r.id,
          title: rule.kind === 'disco' ? `Disco ${r.v}% em ${r.name}` : rule.kind === 'memoria' ? `Memória ${r.v}% em ${r.name}` : `${r.v} serviço(s) com falha em ${r.name}`,
          details: { servidor: r.name, valor: r.v, limite: limit, ...(rule.kind === 'disco' ? { discos: (r.disks ?? []).map((d: { mount: string; used: number; avail: number }) => `${d.mount}: ${Math.round((d.used / (d.used + d.avail)) * 100)}%`) } : {}) } }));
    }
    case 'repositorio_com_erro':
      return (await tx.many(`SELECT x.client_id, x.id, s.name AS server, x.last_check_ok, x.retention_error FROM backup_repositories x JOIN servers s ON s.id = x.server_id
        WHERE TRUE ${scope} AND (x.last_check_ok = false OR x.retention_error IS NOT NULL)`, p))
        .map((r) => ({ client_id: r.client_id, entity_type: 'repositorio', entity_id: r.id, title: `Repositório com erro (${r.server})`,
          details: { servidor: r.server, verificacao: r.last_check_ok === false ? 'reprovada' : 'ok', retencao: r.retention_error ? String(r.retention_error).slice(0, 300) : 'ok' } }));
    case 'destino_com_erro':
      // destino da empresa: um incidente por cliente que guarda backup nele
      return (await tx.many(`SELECT DISTINCT r.client_id, d.id, d.name, d.last_check_error FROM backup_destinations d JOIN backup_repositories r ON r.destination_id = d.id
        WHERE d.archived_at IS NULL AND d.status = 'erro' AND ($1::bigint IS NULL OR r.client_id = $1)`, p))
        .map((r) => ({ client_id: r.client_id, entity_type: 'destino', entity_id: r.id, title: `Destino de backup com erro: ${r.name}`, details: { destino: r.name, erro: String(r.last_check_error ?? '').slice(0, 300) } }));
    case 'teste_restauracao_falhou':
      return (await tx.many(`SELECT j.client_id, j.id, j.name, s.name AS server, r.error, r.finished_at FROM backup_jobs j JOIN servers s ON s.id = j.server_id
        LEFT JOIN restore_requests r ON r.id = j.last_restore_test_id
        WHERE j.archived_at IS NULL AND j.enabled AND j.last_restore_test_status = 'falhou' ${scope.replace(/x\./g, 'j.')}`, p))
        .map((r) => ({ client_id: r.client_id, entity_type: 'job', entity_id: r.id, title: `Teste de restauração falhou: ${r.name} (${r.server})`,
          details: { job: r.name, servidor: r.server, erro: String(r.error ?? '').slice(0, 300), em: r.finished_at } }));
    case 'pgbackrest_com_erro':
      return (await tx.many(`SELECT x.client_id, x.id, x.stanza, s.name AS server, x.last_error FROM pgbackrest_stanzas x JOIN servers s ON s.id = x.server_id
        WHERE x.archived_at IS NULL AND x.enabled AND x.status = 'erro' ${scope}`, p))
        .map((r) => ({ client_id: r.client_id, entity_type: 'pgbackrest', entity_id: r.id, title: `pgBackRest com erro: ${r.stanza} (${r.server})`,
          details: { stanza: r.stanza, servidor: r.server, erro: String(r.last_error ?? '').slice(0, 300) } }));
    default:
      return [];
  }
}

interface Outgoing { alertId: number; clientId: number; channelIds: number[]; message: Message }

export async function evaluateAlerts(db: Database, store: SecretStore, smtp: SmtpConfig) {
  const outgoing: Outgoing[] = [];
  const stats = await db.system(async (tx) => {
    const got = await tx.one('SELECT pg_try_advisory_xact_lock(727004) AS ok');
    if (!got?.ok) return null;
    const s = { opened: 0, resolved: 0, reminded: 0, retried: 0 };
    const rules = await tx.many<Rule>('SELECT id, client_id, kind, threshold, severity, remind_hours, channel_ids FROM alert_rules WHERE enabled AND archived_at IS NULL');
    const clients = new Map((await tx.many('SELECT id, legal_name FROM clients')).map((c) => [Number(c.id), String(c.legal_name)]));
    const msg = (event: Message['event'], a: Record<string, any>): Message => ({ event, alert: {
      id: a.public_id, title: a.title, severity: a.severity, status: a.status, client: clients.get(Number(a.client_id)) ?? String(a.client_id),
      entity_type: a.entity_type, entity_id: Number(a.entity_id), details: a.details, opened_at: new Date(a.opened_at).toISOString(), resolved_at: a.resolved_at ? new Date(a.resolved_at).toISOString() : null } });
    for (const rule of rules) {
      const firing = await conditions(tx, rule);
      const fps = new Set<string>();
      for (const f of firing) {
        const fp = `${rule.id}:${f.entity_type}:${f.entity_id}`;
        fps.add(fp);
        const a = await tx.one(`INSERT INTO alerts (client_id, rule_id, fingerprint, entity_type, entity_id, severity, title, details)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (fingerprint) WHERE status <> 'resolvido' DO UPDATE SET last_seen_at = now(), occurrences = alerts.occurrences + 1, title = EXCLUDED.title, details = EXCLUDED.details
          RETURNING *, (xmax = 0) AS inserted`, [f.client_id, rule.id, fp, f.entity_type, f.entity_id, rule.severity, f.title.slice(0, 300), JSON.stringify(f.details)]);
        if (a!.inserted) {
          s.opened++;
          outgoing.push({ alertId: Number(a!.id), clientId: f.client_id, channelIds: rule.channel_ids, message: msg('aberto', a!) });
          await audit(tx, SYSTEM, { action: 'alerta.abrir', entity: 'alerta', entityId: a!.public_id, clientId: f.client_id, details: { regra: rule.id, titulo: a!.title } });
        } else if (a!.status === 'aberto' && (!a!.last_notified_at || Date.now() - new Date(a!.last_notified_at).getTime() > rule.remind_hours * 3600_000)) {
          s.reminded++;
          outgoing.push({ alertId: Number(a!.id), clientId: f.client_id, channelIds: rule.channel_ids, message: msg('lembrete', a!) });
        }
      }
      const open = await tx.many("SELECT * FROM alerts WHERE rule_id = $1 AND status <> 'resolvido'", [rule.id]);
      for (const a of open) {
        if (fps.has(a.fingerprint)) continue;
        const r = await tx.one("UPDATE alerts SET status = 'resolvido', resolved_at = now() WHERE id = $1 RETURNING *", [a.id]);
        s.resolved++;
        outgoing.push({ alertId: Number(a.id), clientId: Number(a.client_id), channelIds: rule.channel_ids, message: msg('resolvido', r!) });
        await audit(tx, SYSTEM, { action: 'alerta.resolver', entity: 'alerta', entityId: a.public_id, clientId: Number(a.client_id) });
      }
    }
    // canal que falhou na última tentativa: reenvia a mesma mensagem (até 5 falhas em 24 h por alerta × canal)
    const retries = await tx.many(`SELECT n.channel_id, n.event, a.* FROM (
        SELECT DISTINCT ON (alert_id, channel_id) alert_id, channel_id, event, status, at FROM alert_notifications WHERE event <> 'teste' ORDER BY alert_id, channel_id, id DESC) n
      JOIN alerts a ON a.id = n.alert_id
      WHERE n.status = 'falhou' AND n.at > now() - interval '24 hours'
        AND (SELECT count(*) FROM alert_notifications x WHERE x.alert_id = n.alert_id AND x.channel_id = n.channel_id AND x.status = 'falhou' AND x.at > now() - interval '24 hours') < 5`);
    for (const r of retries) {
      if (outgoing.some((o) => o.alertId === Number(r.id))) continue;
      s.retried++;
      outgoing.push({ alertId: Number(r.id), clientId: Number(r.client_id), channelIds: [Number(r.channel_id)], message: msg(r.event, r) });
    }
    // regra desligada/arquivada: incidentes abertos dela são resolvidos (sem notificação)
    await tx.query(`UPDATE alerts a SET status = 'resolvido', resolved_at = now() FROM alert_rules r WHERE r.id = a.rule_id AND a.status <> 'resolvido' AND (NOT r.enabled OR r.archived_at IS NOT NULL)`);
    return s;
  });
  if (!stats) return null;
  const sent = await deliver(db, store, smtp, outgoing);
  return { ...stats, ...sent };
}

/** Entrega e registra cada notificação. Um canal com erro não impede os outros. */
export async function deliver(db: Database, store: SecretStore, smtp: SmtpConfig, outgoing: Outgoing[]) {
  let ok = 0;
  let failed = 0;
  for (const o of outgoing) {
    if (!o.channelIds.length) continue;
    const channels = await db.system(async (tx) => {
      const rows = await tx.many('SELECT * FROM notification_channels WHERE id = ANY($1::bigint[]) AND enabled AND archived_at IS NULL AND (client_id IS NULL OR client_id = $2)', [o.channelIds, o.clientId]);
      return Promise.all(rows.map(async (c) => ({ c, secret: c.secret_id ? await store.reveal(tx, Number(c.secret_id)) : null })));
    });
    for (const { c, secret } of channels) {
      let error: string | null = null;
      try { await send(c, secret, o.message, smtp); ok++; } catch (err) { error = (err as Error).message; failed++; }
      await db.system(async (tx) => {
        await tx.query('INSERT INTO alert_notifications (alert_id, client_id, channel_id, event, status, error) VALUES ($1, $2, $3, $4, $5, $6)',
          [o.alertId, o.clientId, c.id, o.message.event, error ? 'falhou' : 'enviado', error]);
        await tx.query(`UPDATE notification_channels SET last_ok_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_ok_at END, last_error = $2 WHERE id = $1`, [c.id, error]);
        if (!error) await tx.query('UPDATE alerts SET last_notified_at = now() WHERE id = $1', [o.alertId]);
      });
    }
  }
  return { sent: ok, failed };
}
