// Cifragem dos segredos das instalações (AES-256-GCM).
// A chave vem de IMPLANTACAO_CHAVE (64 caracteres hexadecimais). Sem ela, é derivada
// do APP_SECRET por HKDF — trocar o APP_SECRET nesse caso torna os segredos ilegíveis.
import crypto from 'node:crypto';
import { env, appSecret } from '../../config/env.js';

let cachedKey = null;

function key() {
  if (cachedKey) return cachedKey;
  if (env.implantacao.chave) {
    if (!/^[0-9a-f]{64}$/i.test(env.implantacao.chave)) throw new Error('IMPLANTACAO_CHAVE deve ter 64 caracteres hexadecimais (32 bytes).');
    cachedKey = Buffer.from(env.implantacao.chave, 'hex');
  } else {
    cachedKey = Buffer.from(crypto.hkdfSync('sha256', appSecret, 'vitrine-implantacao', 'segredos-das-instalacoes', 32));
  }
  return cachedKey;
}

/** Formato: v1.<iv base64url>.<tag base64url>.<dados base64url> */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload) {
  const [ver, iv, tag, data] = String(payload).split('.');
  if (ver !== 'v1' || !iv || !tag || data === undefined) throw new Error('Segredo em formato desconhecido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Segredo aleatório para variáveis do tipo "gerado" e senhas de banco (sem caracteres que exijam escape). */
export const generateSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
