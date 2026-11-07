// Senhas com Argon2id (m=64 MiB, t=3, p=1) — ver docs/central-backup/04-seguranca.md §3.
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string, { email }: { email?: string } = {}): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > 256) return 'Senha longa demais.';
  if (new Set(password).size < 5) return 'A senha é repetitiva demais.';
  const lower = password.toLowerCase();
  if (email && lower.includes(email.split('@')[0]!.toLowerCase())) return 'A senha não pode conter o e-mail.';
  if (/^(senha|password|123456|qwerty|admin)/.test(lower)) return 'Senha muito comum.';
  return null;
}

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}

/** Hash fixo para comparar quando o usuário não existe (tempo de resposta uniforme). */
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= await hashPassword('senha-inexistente-para-tempo-constante');
  await verifyPassword(dummyHash, password);
  return false;
}
