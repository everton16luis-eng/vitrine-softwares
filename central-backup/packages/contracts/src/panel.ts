// Contratos do painel (/api/v1) usados pela API e, depois, pelo frontend.
import { Type, type Static } from 'typebox';
import { CLIENT_STATUS } from '@central/shared';

const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(t: T) => Type.Union([t, Type.Null()]);

export const LoginRequest = Type.Object({
  email: Type.String({ format: 'email', maxLength: 200 }),
  password: Type.String({ minLength: 1, maxLength: 256 })
}, { additionalProperties: false });

export const MfaVerifyRequest = Type.Object({ code: Type.String({ pattern: '^\\d{6}$|^[A-Z0-9]{4}-[A-Z0-9]{4}$' }) }, { additionalProperties: false });

export const ClientInput = Type.Object({
  legal_name: Type.String({ minLength: 2, maxLength: 200 }),
  trade_name: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
  cnpj: Type.Optional(Nullable(Type.String({ maxLength: 18 }))),
  tech_contact: Type.Optional(Nullable(Type.String({ maxLength: 150 }))),
  email: Type.Optional(Nullable(Type.String({ format: 'email', maxLength: 200 }))),
  phone: Type.Optional(Nullable(Type.String({ maxLength: 30 }))),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
  status: Type.Optional(Type.Union(CLIENT_STATUS.map((s) => Type.Literal(s)))),
  rpo_minutes: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 525_600 }))),
  rto_minutes: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 525_600 })))
}, { additionalProperties: false });
export type ClientInput = Static<typeof ClientInput>;
export const ClientPatch = Type.Partial(ClientInput, { additionalProperties: false });

export const ServerInput = Type.Object({
  client_id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 2, maxLength: 120, pattern: '^[^\\x00-\\x1f]+$' }),
  hostname: Type.Optional(Nullable(Type.String({ maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' }))),
  ip_addresses: Type.Optional(Type.Array(Type.String({ maxLength: 45 }), { maxItems: 20 })),
  provider: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
  notes: Type.Optional(Nullable(Type.String({ maxLength: 5000 })))
}, { additionalProperties: false });
export type ServerInput = Static<typeof ServerInput>;
export const ServerPatch = Type.Partial(Type.Omit(ServerInput, ['client_id']), { additionalProperties: false });

export const EnrollmentCodeRequest = Type.Object({ ttl_minutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 1440, default: 30 })) }, { additionalProperties: false });

export const TaskRequest = Type.Object({
  operation: Type.String({ maxLength: 60 }),
  params: Type.Unknown()
}, { additionalProperties: false });

export const UserInput = Type.Object({
  email: Type.String({ format: 'email', maxLength: 200 }),
  name: Type.String({ minLength: 2, maxLength: 150 }),
  password: Type.String({ minLength: 12, maxLength: 256 }),
  roles: Type.Array(Type.String({ maxLength: 40 }), { minItems: 1, maxItems: 10, uniqueItems: true }),
  client_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 1000, uniqueItems: true }))
}, { additionalProperties: false });
