// TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, passo de 30 s) — compatível com Google Authenticator,
// Microsoft Authenticator, 1Password, Bitwarden etc.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Base32 inválido.');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secretBase32: string, timeMs = Date.now(), { step = 30, digits = 6 } = {}): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = h[h.length - 1]! & 15;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Confere o código aceitando ±1 passo (relógios defasados). Devolve o contador usado, para que o
 * chamador impeça a reutilização do mesmo código (anti-replay), ou null se inválido.
 */
export function verifyTotp(secretBase32: string, code: string, timeMs = Date.now(), lastUsedCounter = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(timeMs / 1000 / 30);
  for (const delta of [0, -1, 1]) {
    const counter = now + delta;
    if (counter <= lastUsedCounter) continue;
    const expected = Buffer.from(totpCode(secretBase32, counter * 30_000));
    if (timingSafeEqual(expected, Buffer.from(code))) return counter;
  }
  return null;
}

export function totpUri(secretBase32: string, account: string, issuer = 'Central de Backup'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
