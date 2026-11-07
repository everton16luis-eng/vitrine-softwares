// Envio pelos canais: e-mail (SMTP via nodemailer), webhook (JSON assinado com HMAC-SHA256) e
// WhatsApp (API Cloud da Meta). Nenhum segredo vai para logs ou para o banco em texto claro.
import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { Type, type Static } from 'typebox';
import { validate } from '@central/contracts';
import { redact } from '@central/shared';

export const EmailConfig = Type.Object({ to: Type.Array(Type.String({ format: 'email', maxLength: 200 }), { minItems: 1, maxItems: 20 }) }, { additionalProperties: false });
export const WebhookSecret = Type.Object({
  url: Type.String({ pattern: '^(https://[^\\s]+|http://(127\\.0\\.0\\.1|localhost)(:\\d+)?/[^\\s]*)$', maxLength: 500 }),
  signing_key: Type.String({ minLength: 16, maxLength: 200 })
}, { additionalProperties: false });
export const WhatsappConfig = Type.Object({
  phone_number_id: Type.String({ pattern: '^\\d{5,30}$' }),
  to: Type.Array(Type.String({ pattern: '^\\d{10,15}$' }), { minItems: 1, maxItems: 10 }),
  /** modelo aprovado na Meta (obrigatório para mensagem fora da janela de 24 h) */
  template: Type.Optional(Type.String({ pattern: '^[a-z0-9_]{1,100}$' })),
  language: Type.Optional(Type.String({ pattern: '^[a-z]{2}(_[A-Z]{2})?$' })),
  api_base: Type.Optional(Type.String({ pattern: '^(https://graph\\.facebook\\.com/v\\d+\\.\\d+|http://(127\\.0\\.0\\.1|localhost):\\d+)$' }))
}, { additionalProperties: false });
export const WhatsappSecret = Type.Object({ access_token: Type.String({ minLength: 20, maxLength: 1000 }) }, { additionalProperties: false });

export function checkChannel(kind: string, config: unknown, secret: unknown | undefined, requireSecret: boolean) {
  const errs: Record<string, string> = {};
  const check = (schema: Parameters<typeof validate>[0], v: unknown, prefix: string) => {
    const r = validate(schema, v);
    if (!r.ok) for (const [k, m] of Object.entries(r.errors)) errs[`${prefix}.${k}`] = m;
  };
  if (kind === 'email') check(EmailConfig, config, 'config');
  if (kind === 'webhook') { check(Type.Object({}, { additionalProperties: false }), config, 'config'); if (secret !== undefined || requireSecret) check(WebhookSecret, secret, 'secret'); }
  if (kind === 'whatsapp') { check(WhatsappConfig, config, 'config'); if (secret !== undefined || requireSecret) check(WhatsappSecret, secret, 'secret'); }
  return errs;
}

export interface Message {
  event: 'aberto' | 'lembrete' | 'resolvido' | 'teste';
  alert: { id: string; title: string; severity: string; status: string; client: string; entity_type: string; entity_id: number; details: Record<string, unknown>; opened_at: string; resolved_at?: string | null };
}

const EVENT_LABEL: Record<Message['event'], string> = { aberto: 'ALERTA', lembrete: 'LEMBRETE', resolvido: 'RESOLVIDO', teste: 'TESTE' };
export const subject = (m: Message) => `[Central de Backup] ${EVENT_LABEL[m.event]} ${m.alert.severity === 'critico' ? '(crítico) ' : ''}${m.alert.title}`;
export function textBody(m: Message) {
  const lines = [subject(m), '', `Cliente: ${m.alert.client}`, `Desde: ${new Date(m.alert.opened_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`];
  if (m.alert.resolved_at) lines.push(`Resolvido: ${new Date(m.alert.resolved_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  for (const [k, v] of Object.entries(m.alert.details)) lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  lines.push('', `Alerta ${m.alert.id}`);
  return lines.join('\n');
}

export interface SmtpConfig { url: string | null; from: string | null }

export async function send(channel: { kind: string; config: Record<string, any> }, secret: string | null, m: Message, smtp: SmtpConfig) {
  const known = [secret ?? '', smtp.url ?? ''].filter(Boolean);
  try {
    if (channel.kind === 'email') {
      if (!smtp.url || !smtp.from) throw new Error('SMTP não configurado na central (SMTP_URL e SMTP_FROM).');
      const t = nodemailer.createTransport(smtp.url, { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 } as never);
      await t.sendMail({ from: smtp.from, to: (channel.config as Static<typeof EmailConfig>).to.join(', '), subject: subject(m), text: textBody(m) });
      return;
    }
    if (channel.kind === 'webhook') {
      const s = JSON.parse(secret ?? '{}') as Static<typeof WebhookSecret>;
      const body = JSON.stringify({ event: m.event, alert: m.alert });
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = createHmac('sha256', s.signing_key).update(`${ts}.${body}`).digest('hex');
      const res = await fetch(s.url, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'user-agent': 'central-backup', 'x-central-timestamp': ts, 'x-central-assinatura': `sha256=${sig}` } });
      if (!res.ok) throw new Error(`webhook respondeu ${res.status}`);
      return;
    }
    if (channel.kind === 'whatsapp') {
      const c = channel.config as Static<typeof WhatsappConfig>;
      const token = (JSON.parse(secret ?? '{}') as Static<typeof WhatsappSecret>).access_token;
      const base = c.api_base ?? 'https://graph.facebook.com/v20.0';
      for (const to of c.to) {
        const payload = c.template
          ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: c.template, language: { code: c.language ?? 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: subject(m).slice(0, 1000) }] }] } }
          : { messaging_product: 'whatsapp', to, type: 'text', text: { body: textBody(m).slice(0, 4000) } };
        const res = await fetch(`${base}/${c.phone_number_id}/messages`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`API do WhatsApp respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return;
    }
    throw new Error(`canal desconhecido: ${channel.kind}`);
  } catch (err) {
    throw new Error(redact((err as Error).message, known).slice(0, 1000));
  }
}
