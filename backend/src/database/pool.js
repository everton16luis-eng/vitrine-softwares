import pg from 'pg';
import { env } from '../config/env.js';

// NUMERIC (1700) e BIGINT (20) são devolvidos como string para não perder precisão.
// COUNT(*) retorna BIGINT; convertemos explicitamente com ::int quando necessário.
pg.types.setTypeParser(1082, (value) => value); // DATE como 'YYYY-MM-DD', sem conversão de fuso.

let pool;

export function getPool() {
  if (!pool) {
    if (!env.databaseUrl) {
      throw new Error('Banco de dados não configurado: defina DATABASE_URL no arquivo .env.');
    }
    pool = new pg.Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: env.isTest ? 5 : 15,
      idleTimeoutMillis: 30_000
    });
    pool.on('error', (err) => {
      console.error('[db] erro inesperado em conexão ociosa:', err.message);
    });
  }
  return pool;
}

/** Executa uma consulta parametrizada. Nunca concatene valores do usuário no SQL. */
export function query(text, params = []) {
  return getPool().query(text, params);
}

export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

export async function many(text, params = []) {
  const { rows } = await query(text, params);
  return rows;
}

/**
 * Executa `fn` dentro de uma transação. `fn` recebe um client com a mesma
 * interface de `query`. Faz ROLLBACK automaticamente em caso de erro.
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      query: (text, params = []) => client.query(text, params),
      one: async (text, params = []) => (await client.query(text, params)).rows[0] || null,
      many: async (text, params = []) => (await client.query(text, params)).rows
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Interface comum para funções que aceitam tanto o pool quanto uma transação. */
export const db = { query, one, many };

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
