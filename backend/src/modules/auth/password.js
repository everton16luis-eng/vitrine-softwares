import argon2 from 'argon2';

// Parâmetros Argon2id recomendados pela OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, OPTIONS);

let dummyHash;
/** Verifica a senha; sem hash (usuário inexistente) compara com um hash fictício para igualar o tempo de resposta. */
export async function verifyPassword(hash, password) {
  if (!hash) {
    dummyHash ||= await argon2.hash('senha-ficticia-para-tempo-constante', OPTIONS);
    await argon2.verify(dummyHash, String(password || 'x')).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, String(password || ''));
  } catch {
    return false;
  }
}

/** Política de senha: 10 a 128 caracteres, com letras e números, diferente do e-mail. */
export function passwordProblem(password, email = '') {
  const s = String(password || '');
  if (s.length < 10) return 'A senha deve ter ao menos 10 caracteres.';
  if (s.length > 128) return 'A senha deve ter no máximo 128 caracteres.';
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'A senha deve conter letras e números.';
  if (email && s.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length >= 4) {
    return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}
