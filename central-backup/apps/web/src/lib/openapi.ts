// O formulário de cada ação vem do schema publicado pela própria API (/api/v1/openapi.json): os
// campos, limites e enums são os mesmos que o servidor valida, sem uma segunda cópia no front.
import { api } from './api.ts';

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  nullable?: boolean;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number;
  minItems?: number; maxItems?: number;
  pattern?: string; format?: string; description?: string; default?: unknown;
  additionalProperties?: boolean | JsonSchema;
};

let spec: Promise<any> | null = null;
export function loadSpec() {
  if (!spec) spec = api.get('/api/v1/openapi.json').catch((e) => { spec = null; throw e; });
  return spec;
}

/** Schema do corpo de `method path` (path no formato do OpenAPI, com {id}). */
export async function bodySchema(method: string, path: string): Promise<JsonSchema | null> {
  const s = await loadSpec();
  const op = s.paths?.[path]?.[method.toLowerCase()];
  if (!op) throw new Error(`Operação ${method} ${path} não existe na API.`);
  return op.requestBody?.content?.['application/json']?.schema ?? null;
}

/** Valores possíveis de um campo enumerado (enum direto ou anyOf de literais). */
export function enumValues(s: JsonSchema): unknown[] | null {
  if (s.enum) return s.enum;
  if (s.anyOf && s.anyOf.every((x) => x.enum?.length === 1 || x.const !== undefined)) return s.anyOf.map((x) => x.const ?? x.enum![0]);
  return null;
}
export const typeOf = (s: JsonSchema): string | undefined => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) ?? (s.anyOf ? s.anyOf.map(typeOf).find(Boolean) : undefined);
