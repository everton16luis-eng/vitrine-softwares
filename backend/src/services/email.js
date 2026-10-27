import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { db } from '../database/pool.js';
import { escapeHtml } from '../utils/html.js';

let transporter = null;

export const isEmailConfigured = () => Boolean(env.smtp.host);

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined
    });
  }
  return transporter;
}

/** Substitui {{variavel}} pelos valores. Valores ausentes viram string vazia. */
export function renderTemplate(text, vars = {}) {
  return String(text).replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, key) => (vars[key] ?? '').toString());
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  return `${(user || '').slice(0, 2)}***@${domain || ''}`;
}

/**
 * Envia e-mail a partir de um modelo editável (tabela modelos_email).
 * Se o SMTP não estiver configurado, registra "nao_configurado" e retorna
 * { enviado: false } — a aplicação nunca afirma que a mensagem foi entregue.
 */
export async function sendTemplate(chave, to, vars = {}) {
  const tpl = await db.one('SELECT assunto, corpo, ativo FROM modelos_email WHERE chave = $1', [chave]);
  if (!tpl || !tpl.ativo) return { enviado: false, status: 'modelo_inativo' };
  const subject = renderTemplate(tpl.assunto, vars).slice(0, 200);
  const text = renderTemplate(tpl.corpo, vars);
  return sendRaw({ to, subject, text, modelo: chave });
}

export async function sendRaw({ to, subject, text, modelo = null }) {
  if (!to) return { enviado: false, status: 'sem_destinatario' };
  if (!isEmailConfigured()) {
    if (!env.isTest) console.warn(`[email] envio indisponível (SMTP não configurado): "${subject}" para ${maskEmail(to)}`);
    await db.query('INSERT INTO emails_registro (modelo, destinatario, assunto, status) VALUES ($1,$2,$3,$4)', [modelo, to, subject, 'nao_configurado']);
    return { enviado: false, status: 'nao_configurado' };
  }
  try {
    const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b2333">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
    await getTransporter().sendMail({ from: env.smtp.from, to, subject, text, html: htmlBody });
    await db.query('INSERT INTO emails_registro (modelo, destinatario, assunto, status) VALUES ($1,$2,$3,$4)', [modelo, to, subject, 'enviado']);
    return { enviado: true, status: 'enviado' };
  } catch (err) {
    console.error(`[email] falha ao enviar "${subject}" para ${maskEmail(to)}: ${err.message}`);
    await db.query('INSERT INTO emails_registro (modelo, destinatario, assunto, status, erro) VALUES ($1,$2,$3,$4,$5)',
      [modelo, to, subject, 'falhou', err.message.slice(0, 500)]);
    return { enviado: false, status: 'falhou' };
  }
}

/** Envio que nunca derruba a requisição principal. */
export function sendTemplateSafe(chave, to, vars) {
  return sendTemplate(chave, to, vars).catch((err) => {
    console.error(`[email] erro inesperado (${chave}): ${err.message}`);
    return { enviado: false, status: 'falhou' };
  });
}
