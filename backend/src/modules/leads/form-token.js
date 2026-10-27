// Token anti-spam de formulários: carimbo de tempo assinado com HMAC.
// Rejeita envios feitos rápido demais (robôs) ou com token adulterado/expirado.
import { hmac, safeEqual } from '../../utils/common.js';

const MIN_SECONDS = 3;
const MAX_HOURS = 24;

export function issueFormToken(now = Date.now()) {
  const ts = Math.floor(now / 1000).toString(36);
  return `${ts}.${hmac(`form:${ts}`).slice(0, 32)}`;
}

export function checkFormToken(token, now = Date.now()) {
  if (typeof token !== 'string' || !/^[a-z0-9]+\.[a-f0-9]{32}$/.test(token)) return 'invalido';
  const [ts, sig] = token.split('.');
  if (!safeEqual(sig, hmac(`form:${ts}`).slice(0, 32))) return 'invalido';
  const age = now / 1000 - Number.parseInt(ts, 36);
  if (age < MIN_SECONDS) return 'rapido';
  if (age > MAX_HOURS * 3600) return 'expirado';
  return null;
}
