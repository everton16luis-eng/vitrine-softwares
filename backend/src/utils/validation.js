// Validador declarativo mínimo, sem dependências.
// Cada regra recebe o valor bruto e devolve { value } ou { error }.
import { ValidationError } from './errors.js';
import { parseMoney } from './money.js';

const EMAIL_RE = /^[^\s@<>()[\],;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function rule(fn, { optional = false, nullable = false, default: def } = {}) {
  return (raw) => {
    if (isEmpty(raw)) {
      if (def !== undefined) return { value: typeof def === 'function' ? def() : def };
      if (optional || nullable) return { value: nullable ? null : undefined };
      return { error: 'Campo obrigatório.' };
    }
    return fn(raw);
  };
}

/** Remove caracteres de controle (exceto quebras de linha) e espaços nas pontas. */
export function cleanText(value, { multiline = false } = {}) {
  let s = String(value).normalize('NFC');
  s = multiline ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return multiline ? s.replace(/\r\n/g, '\n').trim() : s.replace(/\s+/g, ' ').trim();
}

export const v = {
  string: ({ min = 0, max = 255, multiline = false, pattern, patternMessage, ...o } = {}) => rule((raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'Texto inválido.' };
    const s = cleanText(raw, { multiline });
    if (s.length < min) return { error: `Informe ao menos ${min} caracteres.` };
    if (s.length > max) return { error: `Use no máximo ${max} caracteres.` };
    if (pattern && !pattern.test(s)) return { error: patternMessage || 'Formato inválido.' };
    return { value: s };
  }, o),
  text: (o = {}) => v.string({ max: 20000, multiline: true, ...o }),
  email: (o = {}) => rule((raw) => {
    const s = cleanText(raw).toLowerCase();
    if (s.length > 254 || !EMAIL_RE.test(s)) return { error: 'Informe um e-mail válido.' };
    return { value: s };
  }, o),
  phone: (o = {}) => rule((raw) => {
    const s = cleanText(raw);
    const digits = s.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15 || !/^[\d\s()+-]+$/.test(s)) return { error: 'Informe um telefone válido com DDD.' };
    return { value: s };
  }, o),
  slug: (o = {}) => rule((raw) => {
    const s = cleanText(raw).toLowerCase();
    if (s.length > 160 || !SLUG_RE.test(s)) return { error: 'Use apenas letras minúsculas, números e hífens.' };
    return { value: s };
  }, o),
  url: ({ allowRelative = false, ...o } = {}) => rule((raw) => {
    const s = cleanText(raw);
    if (s.length > 500) return { error: 'URL muito longa.' };
    if (allowRelative && /^\/(?!\/)[\w\-./?=&%#]*$/.test(s)) return { value: s };
    try {
      const u = new URL(s);
      if (!['http:', 'https:'].includes(u.protocol)) return { error: 'Use um endereço http(s).' };
      return { value: u.toString() };
    } catch {
      return { error: 'URL inválida.' };
    }
  }, o),
  int: ({ min = -2147483648, max = 2147483647, ...o } = {}) => rule((raw) => {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n)) return { error: 'Informe um número inteiro.' };
    if (n < min) return { error: `O valor mínimo é ${min}.` };
    if (n > max) return { error: `O valor máximo é ${max}.` };
    return { value: n };
  }, o),
  id: (o = {}) => v.int({ min: 1, ...o }),
  bool: (o = {}) => rule((raw) => {
    if (typeof raw === 'boolean') return { value: raw };
    const s = String(raw).toLowerCase();
    if (['true', '1', 'on', 'sim'].includes(s)) return { value: true };
    if (['false', '0', 'off', 'nao', 'não'].includes(s)) return { value: false };
    return { error: 'Valor inválido.' };
  }, { default: false, ...o }),
  money: ({ max = '999999999999.99', ...o } = {}) => rule((raw) => {
    const cents = parseMoney(raw);
    if (cents === null) return { error: 'Informe um valor monetário válido (ex.: 1500,00).' };
    if (cents < 0n) return { error: 'O valor não pode ser negativo.' };
    if (cents > parseMoney(max)) return { error: 'Valor acima do permitido.' };
    return { value: cents };
  }, o),
  date: (o = {}) => rule((raw) => {
    const s = cleanText(raw);
    if (!DATE_RE.test(s)) return { error: 'Data inválida (use AAAA-MM-DD).' };
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { error: 'Data inválida.' };
    return { value: s };
  }, o),
  enum: (values, o = {}) => rule((raw) => {
    const s = String(raw);
    return values.includes(s) ? { value: s } : { error: 'Opção inválida.' };
  }, o),
  currency: (o = {}) => v.enum(['BRL', 'USD', 'EUR'], { default: 'BRL', ...o }),
  array: (itemRule, { min = 0, max = 100, ...o } = {}) => rule((raw) => {
    if (!Array.isArray(raw)) return { error: 'Lista inválida.' };
    if (raw.length < min) return { error: `Informe ao menos ${min} item(ns).` };
    if (raw.length > max) return { error: `Máximo de ${max} itens.` };
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = itemRule(raw[i]);
      if (r.error) return { error: `Item ${i + 1}: ${typeof r.error === 'string' ? r.error : 'inválido.'}` };
      if (r.value !== undefined) out.push(r.value);
    }
    return { value: out };
  }, { default: o.optional ? undefined : () => [], ...o }),
  object: (shape, o = {}) => rule((raw) => {
    if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Objeto inválido.' };
    const { value, errors } = validate(shape, raw);
    return errors ? { error: Object.values(errors)[0] } : { value };
  }, o)
};

/**
 * Valida `input` com o `shape`. Campos fora do shape são descartados
 * (impede atribuição em massa de campos como "perfil" ou "cliente_id").
 * Em modo `partial`, campos ausentes são ignorados (útil em PATCH).
 */
export function validate(shape, input = {}, { partial = false } = {}) {
  const value = {};
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const [key, check] of Object.entries(shape)) {
    if (partial && !(key in src)) continue;
    const r = check(src[key]);
    if (r.error) errors[key] = r.error;
    else if (r.value !== undefined) value[key] = r.value;
  }
  return { value, errors: Object.keys(errors).length ? errors : null };
}

/** Igual a `validate`, mas lança ValidationError. */
export function parse(shape, input, opts) {
  const { value, errors } = validate(shape, input, opts);
  if (errors) throw new ValidationError(errors);
  return value;
}

export function parseId(raw, label = 'Identificador') {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) {
    throw new ValidationError({ id: `${label} inválido.` }, `${label} inválido.`);
  }
  return n;
}
