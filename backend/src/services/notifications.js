import { db } from '../database/pool.js';

/**
 * Cria notificação interna. Sem usuarioId, fica visível para toda a equipe
 * que possui a `permissao` informada (ou para todos, se permissao for nula).
 */
export async function notify({ usuarioId = null, permissao = null, tipo, titulo, mensagem = null, link = null }, conn = db) {
  await conn.query(
    'INSERT INTO notificacoes (usuario_id, permissao, tipo, titulo, mensagem, link) VALUES ($1,$2,$3,$4,$5,$6)',
    [usuarioId, permissao, tipo, titulo.slice(0, 200), mensagem, link]
  );
}
