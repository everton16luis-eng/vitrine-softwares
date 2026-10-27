import { db } from '../database/pool.js';
import { clientIp } from '../utils/common.js';

const SENSITIVE = /senha|password|token|hash|secret|segredo|csrf|cookie|documento/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return depth > 3 ? '[lista]' : value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    if (depth > 3) return '[objeto]';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[omitido]' : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/**
 * Registra ação administrativa. Nunca registra senhas, tokens ou documentos.
 * `ctx` pode ser o `req` do Express ou { user, ip }.
 */
export async function audit(ctx, acao, entidade, entidadeId = null, detalhes = {}, conn = db) {
  const user = ctx?.user || null;
  const ip = ctx?.ip !== undefined && ctx.socket ? clientIp(ctx) : ctx?.ip || null;
  await conn.query(
    `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [user?.id || null, user?.nome || null, acao, entidade, entidadeId === null ? null : String(entidadeId), JSON.stringify(sanitize(detalhes) || {}), ip]
  );
}

export const _sanitizeForTests = sanitize;
