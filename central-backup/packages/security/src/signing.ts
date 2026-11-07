// Assinatura Ed25519 das tarefas enviadas aos agentes. A chave privada fica com a central (cifrada
// pela KEK); o agente recebe a pública no registro e recusa qualquer tarefa que não confira.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '@central/shared';

export interface SignedEnvelope<T> { payload: T; signature: string; key_id: string }

export function generateSigningKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  };
}

export function signPayload<T>(payload: T, privatePem: string | KeyObject, keyId: string): SignedEnvelope<T> {
  const key = typeof privatePem === 'string' ? createPrivateKey(privatePem) : privatePem;
  const signature = sign(null, Buffer.from(canonicalJson({ key_id: keyId, payload })), key).toString('base64');
  return { payload, signature, key_id: keyId };
}

export function verifyPayload<T>(envelope: SignedEnvelope<T>, publicKeys: Record<string, string>): boolean {
  const pem = publicKeys[envelope.key_id];
  if (!pem || typeof envelope.signature !== 'string') return false;
  try {
    return verify(null, Buffer.from(canonicalJson({ key_id: envelope.key_id, payload: envelope.payload })), createPublicKey(pem), Buffer.from(envelope.signature, 'base64'));
  } catch {
    return false;
  }
}
