// Registro de auditoria. A tabela é append-only e encadeada por hash (ver migration 0001).
// Detalhes passam por stripSecrets: nenhum segredo entra na auditoria.
import { stripSecrets } from '@central/shared';
import type { Tx } from '@central/database';

export interface AuditActor { type: 'usuario' | 'agente' | 'sistema'; id?: number | null; ip?: string | null }

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  clientId?: number | null;
  details?: Record<string, unknown>;
}

export async function audit(tx: Tx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (actor_type, actor_id, ip, action, entity, entity_id, client_id, details)
     VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8)`,
    [actor.type, actor.id ?? null, actor.ip ?? null, entry.action, entry.entity, entry.entityId == null ? null : String(entry.entityId), entry.clientId ?? null, JSON.stringify(stripSecrets(entry.details ?? {}))]
  );
}

export const SYSTEM: AuditActor = { type: 'sistema' };
