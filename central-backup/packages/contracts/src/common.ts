import { Type, type Static, type TSchema } from 'typebox';
import { Check, Errors } from 'typebox/value';

export const Uuid = Type.String({ format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
export const Id = Type.Integer({ minimum: 1, maximum: 9_007_199_254_740_991 });
export const IsoDate = Type.String({ format: 'date-time' });

/** Lista paginada por cursor. */
export const Page = <T extends TSchema>(item: T) => Type.Object({ items: Type.Array(item), next_cursor: Type.Union([Type.String(), Type.Null()]) });
export const PageQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  cursor: Type.Optional(Type.String({ maxLength: 200 })),
  q: Type.Optional(Type.String({ maxLength: 100 }))
}, { additionalProperties: false });
export type PageQuery = Static<typeof PageQuery>;

/** Corpo de erro (RFC 9457). */
export const Problem = Type.Object({
  type: Type.String(), title: Type.String(), status: Type.Integer(), code: Type.String(),
  fields: Type.Optional(Type.Record(Type.String(), Type.String())), request_id: Type.Optional(Type.String())
});

/** Valida um valor contra o esquema e devolve as mensagens por campo (para o agente e testes). */
export function validate<T extends TSchema>(schema: T, value: unknown): { ok: true; value: Static<T> } | { ok: false; errors: Record<string, string> } {
  if (Check(schema, value)) return { ok: true, value: value as Static<T> };
  const errors: Record<string, string> = {};
  for (const e of Errors(schema, value)) {
    const key = (e.instancePath || '/').slice(1).replace(/\//g, '.') || '_';
    errors[key] ??= e.message;
  }
  return { ok: false, errors };
}

/**
 * Caminho absoluto (Linux "/…" ou Windows "C:\…") sem segmento "..", sem caracteres de controle.
 * String.raw: as barras invertidas chegam intactas ao RegExp.
 */
export const SAFE_PATH_PATTERN = String.raw`^(?!.*(^|[\\/])\.\.([\\/]|$))(/|[A-Za-z]:[\\/])[^\x00-\x1f]*$`;
