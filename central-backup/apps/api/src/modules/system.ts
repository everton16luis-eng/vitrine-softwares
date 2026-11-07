// /api/v1/system — saúde da própria central: backup do banco da central e uso das chaves (KEK).
// Nunca devolve material de chave nem a credencial do repositório.
import type { FastifyInstance } from 'fastify';
import { forbidden, conflict, validationError } from '@central/shared';
import type { Database } from '@central/database';
import { requireAuth } from '../http/auth.ts';
import { audit } from '../audit.ts';
import type { Config } from '../config.ts';
import { runSelfBackup } from '../system/selfbackup.ts';
import { kekUsage } from '../system/rotation.ts';
import { parseCron, nextRun } from '../backups/cron.ts';
import { Keyring } from '@central/security';

/** Mostra o repositório sem credenciais (rest:https://usuario:senha@host/x → rest:https://host/x). */
export function safeRepo(repo: string | null) {
  if (!repo) return null;
  return repo.replace(/\/\/[^/@]*@/, '//');
}

export async function systemRoutes(app: FastifyInstance, { db, config }: { db: Database; config: Config }) {
  const onlyAll = (req: { user?: { scope: unknown } }) => { if (req.user!.scope !== '*') throw forbidden('Exige acesso a todos os clientes.'); };

  app.get('/api/v1/system/backups', { preValidation: requireAuth('sistema.ver') }, async (req) => {
    onlyAll(req);
    const items = await db.withScope('*', (tx) => tx.many('SELECT id, trigger, status, snapshot_id, bytes, tables, details, error, started_at, finished_at FROM system_backups ORDER BY id DESC LIMIT 60'));
    const lastOk = items.find((i) => i.status === 'validado');
    return {
      configured: Boolean(config.selfBackup.repository),
      repository: safeRepo(config.selfBackup.repository),
      schedule: config.selfBackup.schedule, timezone: config.selfBackup.timezone,
      next_run_at: config.selfBackup.repository ? nextRun(parseCron(config.selfBackup.schedule), config.selfBackup.timezone, new Date()) : null,
      last_validated_at: lastOk?.finished_at ?? null,
      items
    };
  });

  app.post('/api/v1/system/backups/run', { preValidation: requireAuth('configuracoes.gerenciar'), config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    onlyAll(req);
    if (!config.selfBackup.repository) throw validationError({ SELF_BACKUP_REPOSITORY: 'Configure o repositório do backup da central.' }, 'Backup da central não configurado.');
    if (await db.withScope('*', (tx) => tx.one("SELECT 1 FROM system_backups WHERE status = 'executando'"))) throw conflict('Já existe um backup da central em andamento.');
    await db.withScope('*', (tx) => audit(tx, { type: 'usuario', id: req.user!.id, ip: req.ip }, { action: 'central.backup_solicitar', entity: 'sistema', entityId: 'central' }));
    // roda fora da requisição; o andamento aparece em GET /system/backups
    void runSelfBackup(db, config, 'manual').catch(() => null);
    return reply.code(202).send({ started: true });
  });

  app.get('/api/v1/system/keys', { preValidation: requireAuth('sistema.ver') }, async (req) => {
    onlyAll(req);
    const kr = Keyring.fromFile(config.kekFile);
    const usage = await kekUsage(db);
    return { current_kek: kr.currentId, usage, rotation_pending: Object.entries(usage).some(([id, n]) => id !== kr.currentId && n > 0) };
  });
}
