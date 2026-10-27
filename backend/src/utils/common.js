import crypto from 'node:crypto';
import { appSecret } from '../config/env.js';

export function slugify(text = '') {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150) || 'item';
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const hmac = (value) => crypto.createHmac('sha256', appSecret).update(String(value)).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Lê paginação de query string com limites seguros. */
export function pagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(query.pagina ?? query.page, 10) || 1));
  const limit = Math.max(1, Math.min(maxLimit, Number.parseInt(query.limite ?? query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export function paged(rows, total, { page, limit }) {
  return { items: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escapa curingas de LIKE para que a busca do usuário seja literal. */
export const likeTerm = (term) => `%${String(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Gera CSV (RFC 4180) protegido contra injeção de fórmulas em planilhas. */
export function toCsv(columns, rows) {
  const cell = (value) => {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => cell(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(';'));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}
