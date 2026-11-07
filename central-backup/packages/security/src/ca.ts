// CA interna da central: emite o certificado TLS do gateway e um certificado individual por agente
// (ECDSA P-256). O sujeito do certificado do agente é definido pela CA, nunca copiado do pedido.
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { webcrypto, randomBytes, X509Certificate, createHash } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);
const subtle = webcrypto.subtle;
const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export interface PemPair { certPem: string; keyPem: string }
export interface IssuedCert extends PemPair { serial: string; fingerprint: string; notBefore: Date; notAfter: Date }

const toPem = (der: ArrayBuffer, label: string) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;
const fromPem = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
const newSerial = () => { const b = randomBytes(16); b[0]! &= 0x7f; return b.toString('hex'); };

async function newKeys() {
  return (await subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
}
async function exportKey(key: CryptoKey) { return toPem(await subtle.exportKey('pkcs8', key), 'PRIVATE KEY'); }
async function importKey(pem: string) { return subtle.importKey('pkcs8', fromPem(pem), ALG, true, ['sign']); }

export function certFingerprint(certPem: string): string {
  return createHash('sha256').update(new X509Certificate(certPem).raw).digest('hex');
}

export function certSummary(certPem: string) {
  const c = new X509Certificate(certPem);
  return { serial: c.serialNumber.toLowerCase(), fingerprint: certFingerprint(certPem), subject: c.subject, notBefore: new Date(c.validFrom), notAfter: new Date(c.validTo) };
}

export async function createCa(commonName: string, years = 10): Promise<PemPair> {
  const keys = await newKeys();
  const now = new Date();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: newSerial(), name: `CN=${commonName}`, notBefore: new Date(now.getTime() - 60_000), notAfter: new Date(now.getTime() + years * 365 * DAY),
    keys, signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
    ]
  });
  return { certPem: cert.toString('pem') + '\n', keyPem: await exportKey(keys.privateKey) };
}

async function issue(ca: PemPair, opts: { subject: string; publicKey: CryptoKey; days: number; extensions: x509.Extension[] }): Promise<IssuedCert> {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await importKey(ca.keyPem);
  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const notAfter = new Date(now.getTime() + opts.days * DAY);
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: newSerial(), subject: opts.subject, issuer: caCert.subject, notBefore, notAfter,
    signingKey: caKey, publicKey: opts.publicKey, signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      await x509.AuthorityKeyIdentifierExtension.create(caCert, false),
      ...opts.extensions
    ]
  });
  const certPem = cert.toString('pem') + '\n';
  const info = certSummary(certPem);
  return { certPem, keyPem: '', serial: info.serial, fingerprint: info.fingerprint, notBefore, notAfter };
}

/** Certificado TLS do gateway (servidor). */
export async function issueServerCert(ca: PemPair, { hostnames, ips = [], days = 397 }: { hostnames: string[]; ips?: string[]; days?: number }): Promise<IssuedCert> {
  const keys = await newKeys();
  const issued = await issue(ca, {
    subject: `CN=${hostnames[0] ?? 'gateway'}`, publicKey: keys.publicKey, days,
    extensions: [
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
      new x509.SubjectAlternativeNameExtension([...hostnames.map((h) => ({ type: 'dns' as const, value: h })), ...ips.map((ip) => ({ type: 'ip' as const, value: ip }))])
    ]
  });
  return { ...issued, keyPem: await exportKey(keys.privateKey) };
}

/** Lado do agente: gera a chave privada local e o pedido de certificado. A chave nunca sai do servidor. */
export async function createAgentCsr(): Promise<{ csrPem: string; keyPem: string }> {
  const keys = await newKeys();
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({ name: 'CN=agent-request', keys, signingAlgorithm: ALG });
  return { csrPem: csr.toString('pem') + '\n', keyPem: await exportKey(keys.privateKey) };
}

/**
 * Lado da central: valida a assinatura do pedido (prova de posse da chave) e emite o certificado
 * do agente com identidade definida aqui: CN=agent:<public_id> e SAN URI urn:central:agent:<id>.
 */
export async function signAgentCsr(ca: PemPair, csrPem: string, { agentPublicId, days = 90 }: { agentPublicId: string; days?: number }): Promise<IssuedCert> {
  let csr: x509.Pkcs10CertificateRequest;
  try { csr = new x509.Pkcs10CertificateRequest(csrPem); } catch { throw new Error('Pedido de certificado inválido.'); }
  if (!(await csr.verify())) throw new Error('A assinatura do pedido de certificado não confere.');
  const alg = csr.publicKey.algorithm as webcrypto.EcKeyAlgorithm;
  if (alg.name !== 'ECDSA' || alg.namedCurve !== 'P-256') throw new Error('O pedido precisa usar chave ECDSA P-256.');
  const publicKey = await csr.publicKey.export(ALG, ['verify']);
  return issue(ca, {
    subject: `CN=agent:${agentPublicId}`, publicKey, days,
    extensions: [
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
      new x509.SubjectAlternativeNameExtension([{ type: 'url', value: `urn:central:agent:${agentPublicId}` }])
    ]
  });
}

/** Extrai o public_id do agente do CN do certificado apresentado na conexão mTLS. */
export function agentIdFromSubject(subject: string | undefined): string | null {
  const m = /(?:^|\n|,\s*)CN=agent:([0-9a-f-]{36})(?:$|\n|,)/.exec(subject ?? '');
  return m ? m[1]! : null;
}
