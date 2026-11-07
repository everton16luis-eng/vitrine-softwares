import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório (base64url). Só o hash é guardado no banco. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Código de instalação de agente: 128 bits, legível (grupos de 4, sem caracteres ambíguos).
 * Ex.: "K7QF-2M9X-RT4H-PZ8C-W3NB-6YJD-…"
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function enrollmentCode(): string {
  const bytes = randomBytes(26);
  let out = '';
  for (let i = 0; i < 26; i++) out += CODE_ALPHABET[bytes[i]! & 31];
  return out.match(/.{1,4}/g)!.join('-');
}
export const normalizeEnrollmentCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
