// /api/v1 — monitoramento: visão geral, séries de métricas por servidor e exportação Prometheus.
import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound, validationError } from '@central/shared';
import type { Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import type { Config } from '../config.ts';
import { prometheusText } from '../monitoring/metrics.ts';

const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });

export async function monitoringRoutes(app: FastifyInstance, { db, config }: { db: Database; config: Config }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();

  /** Situação de cada servidor: conexão, última amostra e a saúde dos backups. */
  r.get('/api/v1/monitoring/overview', { preValidation: requireAuth('monitoramento.ver') }, async (req) => {
    const items = await db.withScope(req.user!.scope, (tx) => tx.many(`
      SELECT s.id, s.name, s.client_id, c.legal_name AS client_name, s.connection_status, s.last_seen_at, s.last_metrics, s.last_metrics_at,
        (SELECT count(*) FROM backup_jobs j WHERE j.server_id = s.id AND j.archived_at IS NULL AND j.enabled) AS jobs,
        (SELECT count(*) FROM backup_jobs j WHERE j.server_id = s.id AND j.archived_at IS NULL AND j.enabled
           AND j.last_status IN ('falhou', 'falha_verificacao')) AS jobs_failing,
        (SELECT min(j.last_success_at) FROM backup_jobs j WHERE j.server_id = s.id AND j.archived_at IS NULL AND j.enabled) AS oldest_success,
        (SELECT count(*) FROM backup_jobs j WHERE j.server_id = s.id AND j.archived_at IS NULL AND j.enabled AND j.last_success_at IS NULL) AS jobs_never_ok
      FROM servers s JOIN clients c ON c.id = s.client_id WHERE s.archived_at IS NULL ORDER BY c.legal_name, s.name`));
    const offlineMs = config.agent.offlineAfterS * 1000;
    return {
      items: items.map((s) => {
        const online = s.connection_status === 'online' && s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < offlineMs;
        const m = s.last_metrics;
        const problems: string[] = [];
        if (s.connection_status !== 'sem_agente' && !online) problems.push('agente sem contato');
        if (m?.disk_max_pct >= 90) problems.push(`disco ${m.disk_max_pct}%`);
        if (m?.mem_used_pct >= 95) problems.push(`memória ${m.mem_used_pct}%`);
        if (m?.failed_units > 0) problems.push(`${m.failed_units} serviço(s) com falha`);
        if (Number(s.jobs_failing) > 0) problems.push(`${s.jobs_failing} job(s) de backup com falha`);
        if (Number(s.jobs_never_ok) > 0) problems.push(`${s.jobs_never_ok} job(s) sem backup validado`);
        return { ...s, online: Boolean(online), health: problems.length ? (online ? 'atencao' : 'critico') : s.connection_status === 'sem_agente' ? 'sem_agente' : 'ok', problems };
      })
    };
  });

  r.get('/api/v1/servers/:id/metrics', {
    preValidation: requireAuth('monitoramento.ver'),
    schema: {
      params: IdParams,
      querystring: Type.Object({
        from: Type.Optional(Type.String({ format: 'date-time' })), to: Type.Optional(Type.String({ format: 'date-time' })),
        resolution: Type.Optional(Type.Union([Type.Literal('bruta'), Type.Literal('hora')]))
      }, { additionalProperties: false })
    }
  }, async (req) => {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600_000);
    if (!(from < to)) throw validationError({ from: 'O início precisa ser antes do fim.' });
    const spanH = (to.getTime() - from.getTime()) / 3600_000;
    const resolution = req.query.resolution ?? (spanH > 48 ? 'hora' : 'bruta');
    if (resolution === 'bruta' && spanH > 24 * 14) throw validationError({ from: 'Métricas brutas ficam 14 dias; use resolução por hora.' });
    return db.withScope(req.user!.scope, async (tx) => {
      const s = await tx.one('SELECT id, name, last_metrics FROM servers WHERE id = $1', [req.params.id]);
      if (!s) throw notFound('Servidor');
      const points = resolution === 'hora'
        ? await tx.many(`SELECT hour AS at, cpu_avg AS cpu_pct, cpu_max, load1_avg AS load1, mem_used_avg AS mem_used_pct, mem_used_max, disk_max_pct, net_rx_avg AS net_rx_bps, net_tx_avg AS net_tx_bps
            FROM server_metrics_hourly WHERE server_id = $1 AND hour BETWEEN $2 AND $3 ORDER BY hour LIMIT 10000`, [s.id, from, to])
        : await tx.many(`SELECT at, cpu_pct, load1, mem_used_pct, swap_used_pct, disk_max_pct, net_rx_bps, net_tx_bps, failed_units
            FROM server_metrics WHERE server_id = $1 AND at BETWEEN $2 AND $3 ORDER BY at LIMIT 20160`, [s.id, from, to]);
      return { server_id: s.id, from, to, resolution, points, current: s.last_metrics };
    });
  });

  /**
   * Exportação para um Prometheus externo (scrape em 127.0.0.1). Desligado sem METRICS_TOKEN.
   * Os agentes não expõem porta: as métricas chegam pela conexão de saída e a central as publica aqui.
   */
  const tokenHash = config.metricsToken ? createHash('sha256').update(config.metricsToken).digest() : null;
  r.get('/api/v1/metrics', { schema: { hide: true }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!tokenHash) return reply.code(404).type('application/problem+json').send({ type: 'about:blank', title: 'Rota não encontrada.', status: 404, code: 'NAO_ENCONTRADO' });
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!timingSafeEqual(createHash('sha256').update(given).digest(), tokenHash)) return reply.code(401).header('www-authenticate', 'Bearer').send({ status: 401, code: 'NAO_AUTENTICADO', title: 'Token inválido.' });
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(await prometheusText(db, { offlineAfterS: config.agent.offlineAfterS }));
  });
}
