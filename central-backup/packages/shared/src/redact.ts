// Máscara de segredos em textos de log: valores conhecidos da tarefa + padrões comuns.

const PATTERNS: RegExp[] = [
  /(password|passwd|senha|secret|token|api[_-]?key|authorization)(\s*[=:]\s*|"\s*:\s*")([^\s"',;]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^:/\s]+):([^@\s]+)@/gi
];

export function redact(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const s of knownSecrets) if (s && s.length >= 4) out = out.split(s).join('***');
  out = out.replace(PATTERNS[0]!, (_m, k: string, sep: string) => `${k}${sep}***`);
  out = out.replace(PATTERNS[1]!, '***chave privada***');
  out = out.replace(PATTERNS[2]!, (_m, proto: string, user: string) => `${proto}://${user}:***@`);
  return out;
}

/** Remove recursivamente campos sigilosos de objetos antes de auditar ou registrar. */
const SECRET_KEYS = /^(password|senha|secret|token|code|codigo|totp|private_?key|chave|credential|credencial)/i;
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '***' : stripSecrets(v);
    return out as T;
  }
  return value;
}
