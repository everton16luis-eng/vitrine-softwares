// /api/v1 — canais de notificação, regras de alerta, incidentes e relatórios.
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound, conflict, validationError, forbidden } from '@central/shared';
import type { Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import type { SecretStore } from '../secrets.ts';
import { checkChannel, send } from '../alerts/channels.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const UuidParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const KINDS = ['backup_atrasado', 'backup_falhou', 'agente_sem_contato', 'disco', 'memoria', 'servicos_com_falha', 'repositorio_com_erro', 'destino_com_erro', 'teste_restauracao_falhou', 'pgbackrest_com_erro'] as const;
const ChannelInput = Type.Object({
  client_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  kind: Type.Union([Type.Literal('email'), Type.Literal('webhook'), Type.Literal('whatsapp')]),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  config: Type.Record(Type.String(), Type.Unknown()),
  secret: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  enabled: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const ChannelPatch = Type.Object({
  name: Type.Optional(ChannelInput.properties.name), config: Type.Optional(ChannelInput.properties.config),
  secret: ChannelInput.properties.secret, enabled: ChannelInput.properties.enabled
}, { additionalProperties: false });
const RuleInput = Type.Object({
  client_id: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  kind: Type.Union(KINDS.map((k) => Type.Literal(k))),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  threshold: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100_000 }), Type.Null()])),
  severity: Type.Optional(Type.Union([Type.Literal('aviso'), Type.Literal('critico')])),
  remind_hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
  channel_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 20, uniqueItems: true })),
  enabled: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
const RulePatch = Type.Object({
  name: Type.Optional(RuleInput.properties.name), threshold: RuleInput.properties.threshold, severity: RuleInput.properties.severity,
  remind_hours: RuleInput.properties.remind_hours, channel_ids: RuleInput.properties.channel_ids, enabled: RuleInput.properties.enabled
}, { additionalProperties: false });

/** Conjunto recomendado (limites usuais; tudo editável depois). */
const RECOMMENDED: { kind: (typeof KINDS)[number]; name: string; threshold: number | null; severity: 'aviso' | 'critico' }[] = [
  { kind: 'backup_falhou', name: 'Backup falhou ou foi reprovado na verificação', threshold: null, severity: 'critico' },
  { kind: 'backup_atrasado', name: 'Sem backup validado há mais de 26 h', threshold: 26, severity: 'critico' },
  { kind: 'agente_sem_contato', name: 'Agente sem contato há 10 min', threshold: 10, severity: 'critico' },
  { kind: 'disco', name: 'Disco acima de 90%', threshold: 90, severity: 'aviso' },
  { kind: 'memoria', name: 'Memória acima de 95%', threshold: 95, severity: 'aviso' },
  { kind: 'servicos_com_falha', name: 'Serviço systemd com falha', threshold: 1, severity: 'aviso' },
  { kind: 'repositorio_com_erro', name: 'Repositório reprovado na verificação ou na retenção', threshold: null, severity: 'critico' },
  { kind: 'destino_com_erro', name: 'Destino de backup com erro', threshold: null, severity: 'critico' },
  { kind: 'teste_restauracao_falhou', name: 'Teste periódico de restauração falhou', threshold: null, severity: 'critico' },
  { kind: 'pgbackrest_com_erro', name: 'pgBackRest com erro (backup ou arquivamento de WAL)', threshold: null, severity: 'critico' }
];

export async function alertRoutes(app: FastifyInstance, { db, store, config }: { db: Database; store: SecretStore; config: Config }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const actor = (req: { user?: { id: number }; ip: string }) => ({ type: 'usuario' as const, id: req.user?.id ?? null, ip: req.ip });
  const CH_COLS = `id, client_id, kind, name, config, (secret_id IS NOT NULL) AS has_secret, enabled, last_ok_at, last_error, created_at, updated_at`;

  // ------------------------------------------------------------ canais
  r.get('/api/v1/notification-channels', { preValidation: requireAuth('alertas.ver') }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT ${CH_COLS} FROM notification_channels WHERE archived_at IS NULL ORDER BY id`))
  }));

  r.post('/api/v1/notification-channels', { preValidation: requireAuth('alertas.gerenciar'), schema: { body: ChannelInput } }, async (req, reply) => {
    const b = req.body;
    if (b.client_id == null && req.user!.scope !== '*') throw forbidden('Canais da empresa exigem acesso a todos os clientes.');
    const errs = checkChannel(b.kind, b.config, b.secret, b.kind !== 'email');
    if (Object.keys(errs).length) throw validationError(errs, 'Configuração do canal inválida.');
    const row = await db.withScope(req.user!.scope, async (tx) => {
      const secretId = b.secret ? await store.put(tx, { clientId: b.client_id ?? null, kind: `canal_${b.kind}`, value: JSON.stringify(b.secret), createdBy: req.user!.id }) : null;
      const c = await tx.one(`INSERT INTO notification_channels (client_id, kind, name, config, secret_id, enabled) VALUES ($1, $2, $3, $4, $5, coalesce($6, true)) RETURNING ${CH_COLS}`,
        [b.client_id ?? null, b.kind, b.name.trim(), JSON.stringify(b.config), secretId, b.enabled ?? null]);
      await audit(tx, actor(req), { action: 'canal.criar', entity: 'canal', entityId: c!.id, clientId: c!.client_id, details: { tipo: b.kind } });
      return c;
    });
    return reply.code(201).send(row);
  });

  r.patch('/api/v1/notification-channels/:id', { preValidation: requireAuth('alertas.gerenciar'), schema: { params: IdParams, body: ChannelPatch } }, async (req) => {
    const b = req.body;
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM notification_channels WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Canal');
      const errs = checkChannel(cur.kind, b.config ?? cur.config, b.secret, false);
      if (Object.keys(errs).length) throw validationError(errs, 'Configuração do canal inválida.');
      let secretId = cur.secret_id;
      if (b.secret) {
        if (secretId) await store.replace(tx, Number(secretId), JSON.stringify(b.secret));
        else secretId = await store.put(tx, { clientId: cur.client_id, kind: `canal_${cur.kind}`, value: JSON.stringify(b.secret), createdBy: req.user!.id });
      }
      const c = await tx.one(`UPDATE notification_channels SET name = coalesce($2, name), config = coalesce($3, config), secret_id = $4, enabled = coalesce($5, enabled) WHERE id = $1 RETURNING ${CH_COLS}`,
        [cur.id, b.name?.trim() ?? null, b.config ? JSON.stringify(b.config) : null, secretId, b.enabled ?? null]);
      await audit(tx, actor(req), { action: b.secret ? 'canal.alterar_segredo' : 'canal.alterar', entity: 'canal', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b).filter((k) => k !== 'secret') } });
      return c;
    });
  });

  r.post('/api/v1/notification-channels/:id/archive', { preValidation: requireAuth('alertas.gerenciar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const c = await tx.one('UPDATE notification_channels SET archived_at = now(), enabled = false WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!c) throw notFound('Canal');
      await audit(tx, actor(req), { action: 'canal.arquivar', entity: 'canal', entityId: c.id, clientId: c.client_id });
      return { ok: true };
    });
  });

  /** Envio real de uma mensagem de teste pelo canal. */
  r.post('/api/v1/notification-channels/:id/test', { preValidation: requireAuth('alertas.gerenciar'), schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
    const { c, secret } = await db.withScope(req.user!.scope, async (tx) => {
      const c = await tx.one('SELECT * FROM notification_channels WHERE id = $1 AND archived_at IS NULL', [req.params.id]);
      if (!c) throw notFound('Canal');
      return { c, secret: c.secret_id ? await store.reveal(tx, Number(c.secret_id)) : null };
    });
    let error: string | null = null;
    try {
      await send(c, secret, { event: 'teste', alert: { id: 'teste', title: `Teste do canal ${c.name}`, severity: 'aviso', status: 'aberto', client: 'Central de Backup', entity_type: 'canal', entity_id: Number(c.id), details: { solicitado_por: req.user!.email }, opened_at: new Date().toISOString() } }, config.smtp);
    } catch (err) { error = (err as Error).message; }
    await db.withScope(req.user!.scope, async (tx) => {
      await tx.query('UPDATE notification_channels SET last_ok_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_ok_at END, last_error = $2 WHERE id = $1', [c.id, error]);
      await audit(tx, actor(req), { action: 'canal.testar', entity: 'canal', entityId: c.id, clientId: c.client_id, details: { resultado: error ? 'falhou' : 'enviado' } });
    });
    return { ok: !error, error };
  });

  // ------------------------------------------------------------ regras
  r.get('/api/v1/alert-rules', { preValidation: requireAuth('alertas.ver') }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many('SELECT * FROM alert_rules WHERE archived_at IS NULL ORDER BY id'))
  }));

  async function checkChannels(tx: Parameters<Parameters<Database['withScope']>[1]>[0], ids: number[] | undefined, clientId: number | null) {
    if (!ids?.length) return;
    const found = await tx.many('SELECT id, client_id FROM notification_channels WHERE id = ANY($1::bigint[]) AND archived_at IS NULL', [ids]);
    if (found.length !== ids.length) throw validationError({ channel_ids: 'Canal inexistente.' });
    if (found.some((c) => c.client_id != null && Number(c.client_id) !== clientId)) throw validationError({ channel_ids: 'Canal de outro cliente.' });
  }

  r.post('/api/v1/alert-rules', { preValidation: requireAuth('alertas.gerenciar'), schema: { body: RuleInput } }, async (req, reply) => {
    const b = req.body;
    if (b.client_id == null && req.user!.scope !== '*') throw forbidden('Regras da empresa exigem acesso a todos os clientes.');
    const row = await db.withScope(req.user!.scope, async (tx) => {
      await checkChannels(tx, b.channel_ids, b.client_id ?? null);
      const rule = await tx.one(`INSERT INTO alert_rules (client_id, kind, name, threshold, severity, remind_hours, channel_ids, enabled)
        VALUES ($1, $2, $3, $4, coalesce($5, 'aviso'), coalesce($6, 24), $7, coalesce($8, true)) RETURNING *`,
      [b.client_id ?? null, b.kind, b.name.trim(), b.threshold ?? null, b.severity ?? null, b.remind_hours ?? null, b.channel_ids ?? [], b.enabled ?? null]);
      await audit(tx, actor(req), { action: 'regra.criar', entity: 'regra_alerta', entityId: rule!.id, clientId: rule!.client_id, details: { tipo: b.kind, limite: b.threshold } });
      return rule;
    });
    return reply.code(201).send(row);
  });

  r.post('/api/v1/alert-rules/recommended', {
    preValidation: requireAuth('alertas.gerenciar'),
    schema: { body: Type.Object({ channel_ids: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 20, uniqueItems: true }) }, { additionalProperties: false }) }
  }, async (req, reply) => {
    if (req.user!.scope !== '*') throw forbidden('Regras da empresa exigem acesso a todos os clientes.');
    const rows = await db.withScope(req.user!.scope, async (tx) => {
      await checkChannels(tx, req.body.channel_ids, null);
      const existing = new Set((await tx.many('SELECT kind FROM alert_rules WHERE client_id IS NULL AND archived_at IS NULL')).map((x) => x.kind));
      const out = [];
      for (const rec of RECOMMENDED) {
        if (existing.has(rec.kind)) continue;
        out.push(await tx.one(`INSERT INTO alert_rules (client_id, kind, name, threshold, severity, channel_ids) VALUES (NULL, $1, $2, $3, $4, $5) RETURNING *`,
          [rec.kind, rec.name, rec.threshold, rec.severity, req.body.channel_ids]));
      }
      await audit(tx, actor(req), { action: 'regra.recomendadas', entity: 'regra_alerta', entityId: 0, details: { criadas: out.length } });
      return out;
    });
    return reply.code(201).send({ items: rows });
  });

  r.patch('/api/v1/alert-rules/:id', { preValidation: requireAuth('alertas.gerenciar'), schema: { params: IdParams, body: RulePatch } }, async (req) => {
    const b = req.body;
    return db.withScope(req.user!.scope, async (tx) => {
      const cur = await tx.one('SELECT * FROM alert_rules WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [req.params.id]);
      if (!cur) throw notFound('Regra');
      await checkChannels(tx, b.channel_ids, cur.client_id == null ? null : Number(cur.client_id));
      const rule = await tx.one(`UPDATE alert_rules SET name = coalesce($2, name), threshold = CASE WHEN $3 THEN $4 ELSE threshold END, severity = coalesce($5, severity),
          remind_hours = coalesce($6, remind_hours), channel_ids = coalesce($7, channel_ids), enabled = coalesce($8, enabled) WHERE id = $1 RETURNING *`,
      [cur.id, b.name?.trim() ?? null, 'threshold' in b, b.threshold ?? null, b.severity ?? null, b.remind_hours ?? null, b.channel_ids ?? null, b.enabled ?? null]);
      await audit(tx, actor(req), { action: 'regra.alterar', entity: 'regra_alerta', entityId: cur.id, clientId: cur.client_id, details: { campos: Object.keys(b) } });
      return rule;
    });
  });

  r.post('/api/v1/alert-rules/:id/archive', { preValidation: requireAuth('alertas.gerenciar'), schema: { params: IdParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const x = await tx.one('UPDATE alert_rules SET archived_at = now(), enabled = false WHERE id = $1 AND archived_at IS NULL RETURNING id, client_id', [req.params.id]);
      if (!x) throw notFound('Regra');
      await audit(tx, actor(req), { action: 'regra.arquivar', entity: 'regra_alerta', entityId: x.id, clientId: x.client_id });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ incidentes
  r.get('/api/v1/alerts', {
    preValidation: requireAuth('alertas.ver'),
    schema: { querystring: Type.Object({ status: Type.Optional(Type.Union([Type.Literal('aberto'), Type.Literal('reconhecido'), Type.Literal('resolvido'), Type.Literal('ativos')])), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }) }
  }, async (req) => ({
    items: await db.withScope(req.user!.scope, (tx) => tx.many(`SELECT a.public_id AS id, a.client_id, c.legal_name AS client_name, a.rule_id, ar.kind, a.entity_type, a.entity_id, a.severity, a.title, a.details,
        a.status, a.opened_at, a.last_seen_at, a.occurrences, a.acknowledged_at, u.email AS acknowledged_by, a.ack_note, a.resolved_at, a.last_notified_at
      FROM alerts a JOIN clients c ON c.id = a.client_id JOIN alert_rules ar ON ar.id = a.rule_id LEFT JOIN users u ON u.id = a.acknowledged_by
      WHERE ($1::text IS NULL OR ($1 = 'ativos' AND a.status <> 'resolvido') OR a.status = $1) ORDER BY (a.status = 'resolvido'), a.severity = 'aviso', a.opened_at DESC LIMIT $2`,
    [req.query.status ?? null, req.query.limit ?? 100]))
  }));

  r.get('/api/v1/alerts/:id/notifications', { preValidation: requireAuth('alertas.ver'), schema: { params: UuidParams } }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const a = await tx.one('SELECT id FROM alerts WHERE public_id = $1', [req.params.id]);
      if (!a) throw notFound('Alerta');
      return { items: await tx.many('SELECT n.event, n.status, n.error, n.at, ch.name AS channel, ch.kind FROM alert_notifications n JOIN notification_channels ch ON ch.id = n.channel_id WHERE n.alert_id = $1 ORDER BY n.id DESC', [a.id]) };
    });
  });

  r.post('/api/v1/alerts/:id/ack', {
    preValidation: requireAuth('alertas.gerenciar'),
    schema: { params: UuidParams, body: Type.Object({ note: Type.String({ minLength: 3, maxLength: 1000 }) }, { additionalProperties: false }) }
  }, async (req) => {
    return db.withScope(req.user!.scope, async (tx) => {
      const a = await tx.one(`UPDATE alerts SET status = 'reconhecido', acknowledged_by = $2, acknowledged_at = now(), ack_note = $3 WHERE public_id = $1 AND status = 'aberto' RETURNING public_id, client_id`,
        [req.params.id, req.user!.id, req.body.note]);
      if (!a) throw conflict('O alerta não está aberto.');
      await audit(tx, actor(req), { action: 'alerta.reconhecer', entity: 'alerta', entityId: a.public_id, clientId: a.client_id, details: { nota: req.body.note } });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ relatórios
  r.get('/api/v1/reports/backups', {
    preValidation: requireAuth('relatorios.ver'),
    schema: { querystring: Type.Object({
      from: Type.Optional(Type.String({ format: 'date-time' })), to: Type.Optional(Type.String({ format: 'date-time' })),
      client_id: Type.Optional(Type.Integer({ minimum: 1 })), format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv')]))
    }, { additionalProperties: false }) }
  }, async (req, reply) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (!(from < to)) throw validationError({ from: 'O início precisa ser antes do fim.' });
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`
      SELECT c.legal_name AS cliente, s.name AS servidor, j.name AS job, j.kind AS tipo,
        count(r.id) AS execucoes,
        count(r.id) FILTER (WHERE r.status = 'validado') AS validadas,
        count(r.id) FILTER (WHERE r.status IN ('falhou', 'falha_verificacao')) AS falhas,
        round(100.0 * count(r.id) FILTER (WHERE r.status = 'validado') / nullif(count(r.id) FILTER (WHERE r.status NOT IN ('na_fila', 'executando', 'cancelado')), 0), 1) AS taxa_sucesso,
        round(avg((r.summary->>'duration_s')::numeric) FILTER (WHERE r.status = 'validado'), 0) AS duracao_media_s,
        coalesce(sum((r.summary->>'data_added')::numeric) FILTER (WHERE r.status = 'validado'), 0) AS bytes_novos,
        j.last_success_at AS ultimo_validado,
        (SELECT count(*) FROM backup_snapshots sn WHERE sn.job_id = j.id AND sn.status = 'validado') AS snapshots_validos,
        (SELECT rp.size_bytes FROM backup_repositories rp WHERE rp.id = j.repository_id) AS repositorio_bytes
      FROM backup_jobs j JOIN servers s ON s.id = j.server_id JOIN clients c ON c.id = j.client_id
      LEFT JOIN backup_runs r ON r.job_id = j.id AND r.created_at BETWEEN $1 AND $2
      WHERE j.archived_at IS NULL AND ($3::bigint IS NULL OR j.client_id = $3)
      GROUP BY c.legal_name, s.name, j.id ORDER BY c.legal_name, s.name, j.name`, [from, to, req.query.client_id ?? null]));
    if (req.query.format === 'csv') {
      const cols = ['cliente', 'servidor', 'job', 'tipo', 'execucoes', 'validadas', 'falhas', 'taxa_sucesso', 'duracao_media_s', 'bytes_novos', 'ultimo_validado', 'snapshots_validos', 'repositorio_bytes'];
      const cell = (v: unknown) => {
        const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
        // fórmula em planilha: neutraliza =, +, -, @ no início
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const csv = [cols.join(';'), ...items.map((i) => cols.map((c) => cell(i[c])).join(';'))].join('\r\n');
      return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="relatorio-backups-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv"`).send('﻿' + csv);
    }
    return { from, to, items };
  });
}
