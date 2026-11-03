import 'dotenv/config';

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');

export const env = Object.freeze({
  nodeEnv,
  isProduction,
  isTest,
  port: int(process.env.PORT, 3000),
  appUrl,
  databaseUrl: isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL,
  databaseSsl: bool(process.env.DATABASE_SSL),
  appSecret: process.env.APP_SECRET || '',
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 12),
  sessionIdleMinutes: int(process.env.SESSION_IDLE_MINUTES, 120),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  trustProxy: int(process.env.TRUST_PROXY, 0),
  storageDriver: process.env.STORAGE_DRIVER || 'local',
  uploadMaxBytes: int(process.env.UPLOAD_MAX_MB, 5) * 1024 * 1024,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || ''
  },
  implantacao: {
    // simulado: percorre todo o fluxo sem tocar no servidor (padrão fora de produção); linux: executa de verdade
    executor: process.env.IMPLANTACAO_EXECUTOR || (isProduction ? 'linux' : 'simulado'),
    chave: process.env.IMPLANTACAO_CHAVE || '',
    ips: (process.env.IMPLANTACAO_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    emailSsl: process.env.IMPLANTACAO_EMAIL_SSL || '',
    helper: process.env.IMPLANTACAO_HELPER || '/usr/local/lib/vitrine-implantacao/helper.mjs'
  },
  payments: {
    provider: process.env.PAYMENT_PROVIDER || '',
    mercadopagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    mercadopagoWebhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
  }
});

/** Valida configurações indispensáveis antes de iniciar o servidor. */
export function assertRuntimeConfig() {
  const problems = [];
  if (!env.databaseUrl) problems.push(isTest ? 'DATABASE_URL_TEST não definido.' : 'DATABASE_URL não definido.');
  if (!env.appSecret || env.appSecret.length < 32 || env.appSecret.startsWith('ALTERE')) {
    if (isProduction) problems.push('APP_SECRET ausente, curto (<32) ou com valor de exemplo.');
  }
  if (problems.length) {
    const err = new Error(`Configuração inválida:\n - ${problems.join('\n - ')}`);
    err.code = 'CONFIG_INVALID';
    throw err;
  }
}

/** Segredo efetivo: em desenvolvimento/teste, gera um fallback estável por processo se não configurado. */
export const appSecret = env.appSecret && !env.appSecret.startsWith('ALTERE')
  ? env.appSecret
  : `dev-only-secret-${process.pid}-not-for-production-use-000000`;
