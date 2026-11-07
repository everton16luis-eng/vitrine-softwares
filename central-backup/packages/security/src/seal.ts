// Segredos destinados a um agente: cifrados para a chave pública X25519 dele (ECDH efêmero +
// HKDF-SHA256 + AES-256-GCM). Só o agente de destino abre; o contexto (ex.: id da tarefa) entra
// como dado autenticado, então um segredo não pode ser reaproveitado em outra tarefa.
import { generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const INFO = Buffer.from('central-seal-v1');

export function generateSealKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}

const raw = (pem: string) => createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(-32);

export function isSealPublicKey(pem: string): boolean {
  try { return createPublicKey(pem).asymmetricKeyType === 'x25519'; } catch { return false; }
}

export function seal(plaintext: string, recipientPublicPem: string, context: string): string {
  const recipient = createPublicKey(recipientPublicPem);
  if (recipient.asymmetricKeyType !== 'x25519') throw new Error('Chave do agente não é X25519.');
  const eph = generateKeyPairSync('x25519');
  const ephRaw = eph.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephRaw, raw(recipientPublicPem)]), INFO, 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(context));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return `s1.${Buffer.concat([ephRaw, iv, c.getAuthTag(), ct]).toString('base64url')}`;
}

export function openSealed(sealed: string, privatePem: string, context: string): string {
  if (!sealed.startsWith('s1.')) throw new Error('Formato de segredo desconhecido.');
  const buf = Buffer.from(sealed.slice(3), 'base64url');
  if (buf.length < 32 + 12 + 16) throw new Error('Segredo truncado.');
  const ephRaw = buf.subarray(0, 32);
  const priv = createPrivateKey(privatePem);
  const ephPub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), ephRaw]), format: 'der', type: 'spki' });
  const shared = diffieHellman({ privateKey: priv, publicKey: ephPub });
  const myRaw = createPublicKey(priv).export({ type: 'spki', format: 'der' }).subarray(-32);
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephRaw, myRaw]), INFO, 32));
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(32, 44));
  d.setAAD(Buffer.from(context));
  d.setAuthTag(buf.subarray(44, 60));
  return Buffer.concat([d.update(buf.subarray(60)), d.final()]).toString('utf8');
}
