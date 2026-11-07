// Acesso ao PostgreSQL. Toda consulta a dados de clientes passa por withScope(), que abre uma
// transação, assume o papel "central_app" (sujeito à RLS) e declara o escopo de clientes.
// Consultas sempre parametrizadas ($1, $2…); nenhum valor vindo de requisição é concatenado em SQL.
import pg from 'pg';

export type Scope = '*' | readonly number[];

export interface Tx {
  query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>>;
  one<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<R | null>;
  many<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<R[]>;
}

export interface DbOptions { connectionString: string; appRole?: string | null; max?: number }

// bigint/numeric chegam como string; contagens e ids cabem em number.
pg.types.setTypeParser(20, (v) => Number(v));
// bigint[] (ex.: array_agg de ids) também vira number[]
const parseIntArray = pg.types.getTypeParser(1007 as never) as (s: string) => number[];
pg.types.setTypeParser(1016 as never, (v: string) => parseIntArray(v));

export class Database {
  readonly pool: pg.Pool;
  private readonly appRole: string | null;

  constructor({ connectionString, appRole = 'central_app', max = 10 }: DbOptions) {
    this.pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, application_name: 'central-backup' });
    this.appRole = appRole;
    if (appRole && !/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error('Nome de papel inválido.');
  }

  /** Transação com escopo de clientes. '*' = todos (processos internos e usuários sem restrição). */
  async withScope<T>(scope: Scope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const value = scope === '*' ? '*' : scope.filter((n) => Number.isInteger(n) && n > 0).join(',');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.appRole) await client.query(`SET LOCAL ROLE ${this.appRole}`);
      await client.query("SELECT set_config('app.client_scope', $1, true)", [value]);
      const tx: Tx = {
        query: (text, params = []) => client.query(text, params),
        one: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
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

  /** Atalho para processos internos (gateway, worker) — escopo total, ainda como central_app. */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.withScope('*', fn);
  }

  /** Conexão de dono (sem SET ROLE): apenas migrations e seeds. */
  async owner<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  close() { return this.pool.end(); }
}

/** Erros do PostgreSQL convertidos em mensagens úteis (violação de unicidade etc.). */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}
export const isUniqueViolation = (err: unknown, constraint?: string) =>
  pgErrorCode(err) === '23505' && (!constraint || (err as { constraint?: string }).constraint === constraint);
