import { db } from '../../database/pool.js';
import { env } from '../../config/env.js';
import { v, parse } from '../../utils/validation.js';
import { audit } from '../../services/audit.js';

const CACHE_MS = 30_000;
let cache = null;

/** Definição das configurações editáveis. Segredos de integração NÃO ficam aqui: vivem no .env. */
const HEX = /^#[0-9a-f]{6}$/i;
export const SETTINGS_SCHEMA = {
  nome_comercial: v.string({ min: 2, max: 80 }),
  slogan: v.string({ max: 120, nullable: true }),
  logo_url: v.url({ allowRelative: true, nullable: true }),
  favicon_url: v.url({ allowRelative: true, nullable: true }),
  email_contato: v.email({ nullable: true }),
  telefone: v.phone({ nullable: true }),
  whatsapp: v.string({ max: 20, pattern: /^\d{10,15}$/, patternMessage: 'Somente dígitos, com DDI e DDD (ex.: 5511999999999).', nullable: true }),
  whatsapp_mensagem: v.string({ max: 200, nullable: true }),
  endereco: v.string({ max: 200, nullable: true }),
  razao_social: v.string({ max: 160, nullable: true }),
  documento_empresa: v.string({ max: 30, nullable: true }),
  instagram: v.url({ nullable: true }),
  linkedin: v.url({ nullable: true }),
  github: v.url({ nullable: true }),
  youtube: v.url({ nullable: true }),
  cor_primaria: v.string({ pattern: HEX, patternMessage: 'Use uma cor hexadecimal (#RRGGBB).' }),
  cor_destaque: v.string({ pattern: HEX, patternMessage: 'Use uma cor hexadecimal (#RRGGBB).' }),
  seo_titulo_padrao: v.string({ max: 70 }),
  seo_descricao_padrao: v.string({ max: 170 }),
  moeda_padrao: v.currency(),
  aviso_site: v.string({ max: 300, nullable: true }),
  aviso_site_ativo: v.bool(),
  notificar_email_novos_contatos: v.bool(),
  email_notificacoes: v.email({ nullable: true }),
  rastrear_visualizacoes: v.bool(),
  condicoes_orcamento_padrao: v.text({ max: 3000, nullable: true }),
  validade_orcamento_dias: v.int({ min: 1, max: 365 })
};

/** Chaves que podem ser lidas pelo site público. */
const PUBLIC_KEYS = new Set(['nome_comercial', 'slogan', 'logo_url', 'favicon_url', 'email_contato', 'telefone', 'whatsapp',
  'whatsapp_mensagem', 'endereco', 'instagram', 'linkedin', 'github', 'youtube', 'cor_primaria', 'cor_destaque',
  'seo_titulo_padrao', 'seo_descricao_padrao', 'moeda_padrao', 'aviso_site', 'aviso_site_ativo', 'razao_social']);

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const rows = await db.many('SELECT chave, valor FROM configuracoes');
  const data = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  cache = { at: Date.now(), data };
  return data;
}

export async function getPublicSettings() {
  const all = await getSettings();
  return Object.fromEntries(Object.entries(all).filter(([k]) => PUBLIC_KEYS.has(k)));
}

export function invalidateSettings() { cache = null; }

export async function updateSettings(input, req) {
  const value = parse(SETTINGS_SCHEMA, input, { partial: true });
  const before = await getSettings({ fresh: true });
  const changed = [];
  for (const [key, val] of Object.entries(value)) {
    if (JSON.stringify(before[key]) === JSON.stringify(val)) continue;
    await db.query(
      `INSERT INTO configuracoes (chave, valor, publica) VALUES ($1, $2, $3)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, publica = EXCLUDED.publica`,
      [key, JSON.stringify(val), PUBLIC_KEYS.has(key)]
    );
    changed.push(key);
  }
  invalidateSettings();
  if (changed.length) await audit(req, 'atualizar', 'configuracoes', null, { campos: changed });
  return getSettings({ fresh: true });
}

/** Situação das integrações sem expor segredos. */
export function integrationStatus() {
  const p = env.payments;
  return {
    email: { configurado: Boolean(env.smtp.host), provedor: env.smtp.host ? 'SMTP' : null, remetente: env.smtp.from || null },
    pagamentos: {
      provedor_ativo: p.provider || null,
      mercadopago: { configurado: Boolean(p.mercadopagoAccessToken && p.mercadopagoWebhookSecret) },
      stripe: { configurado: Boolean(p.stripeSecretKey && p.stripeWebhookSecret) }
    },
    armazenamento: { driver: env.storageDriver }
  };
}
