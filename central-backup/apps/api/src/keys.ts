// Chaves do sistema:
//   - KEK (arquivo, fora do banco): cifra os segredos guardados no banco. Usada por painel e worker.
//   - CA interna + certificado TLS do gateway: cópias cifradas no banco e cópia de uso em
//     GATEWAY_DIR (0600), lida só pelo gateway — o gateway não recebe a KEK.
//   - Chave de assinatura de tarefas (Ed25519): privada cifrada no banco; só painel/worker assinam.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { Keyring, createCa, issueServerCert, generateSigningKeyPair, certSummary } from '@central/security';
import type { Database } from '@central/database';
import type { Config } from './config.ts';

export const KEY_CONTEXT = { ca: 'system_keys:ca', gatewayTls: 'system_keys:gateway_tls', taskSigning: 'system_keys:task_signing' } as const;

function writePrivate(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(file, 0o600);
}

/** Cria a KEK se não existir (instalação nova). Nunca sobrescreve. */
export function ensureKekFile(file: string): { created: boolean } {
  if (existsSync(file)) return { created: false };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `# KEK da Central de Backup — guarde uma cópia segura FORA dos backups.\n${Keyring.generateLine()}\n`, { mode: 0o400, flag: 'wx' });
  return { created: true };
}

export const loadKeyring = (config: Config) => Keyring.fromFile(config.kekFile);

/**
 * Gera CA, certificado do gateway e chave de assinatura que ainda não existirem e exporta o material
 * do gateway. Idempotente; nunca troca uma chave existente (rotação é operação separada).
 */
export async function initSystemKeys(db: Database, keyring: Keyring, config: Config, log: (m: string) => void = () => {}) {
  await db.system(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('system_keys'))");
    const rows = new Map((await tx.many('SELECT name, key_id, cert_pem, public_pem, private_enc FROM system_keys')).map((r) => [r.name as string, r]));

    let ca = rows.get('ca');
    if (!ca) {
      const pair = await createCa('Central de Backup — CA interna');
      const info = certSummary(pair.certPem);
      ca = { name: 'ca', key_id: info.serial, cert_pem: pair.certPem, private_enc: keyring.encrypt(pair.keyPem, KEY_CONTEXT.ca) };
      await tx.query('INSERT INTO system_keys (name, key_id, cert_pem, private_enc) VALUES ($1, $2, $3, $4)', ['ca', ca.key_id, ca.cert_pem, ca.private_enc]);
      log('CA interna criada.');
    }
    const caPair = { certPem: ca.cert_pem as string, keyPem: keyring.decryptText(ca.private_enc as string, KEY_CONTEXT.ca) };

    let tls = rows.get('gateway_tls');
    const tlsHosts = tls ? certSummary(tls.cert_pem as string).subject : '';
    if (!tls || !tlsHosts.includes(`CN=${config.gateway.hostnames[0]}`)) {
      const ips = config.gateway.hostnames.filter((h) => /^[\d.]+$|:/.test(h));
      const names = config.gateway.hostnames.filter((h) => !ips.includes(h));
      const cert = await issueServerCert(caPair, { hostnames: names.length ? names : ['localhost'], ips: [...ips, ...(names.includes('localhost') ? ['127.0.0.1'] : [])] });
      tls = { name: 'gateway_tls', key_id: cert.serial, cert_pem: cert.certPem, private_enc: keyring.encrypt(cert.keyPem, KEY_CONTEXT.gatewayTls) };
      await tx.query(`INSERT INTO system_keys (name, key_id, cert_pem, private_enc) VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO UPDATE SET key_id = EXCLUDED.key_id, cert_pem = EXCLUDED.cert_pem, private_enc = EXCLUDED.private_enc, created_at = now()`,
      ['gateway_tls', tls.key_id, tls.cert_pem, tls.private_enc]);
      log(`Certificado do gateway emitido para: ${config.gateway.hostnames.join(', ')}.`);
    }

    if (!rows.get('task_signing')) {
      const pair = generateSigningKeyPair();
      const keyId = `t${Date.now().toString(36)}`;
      await tx.query('INSERT INTO system_keys (name, key_id, public_pem, private_enc) VALUES ($1, $2, $3, $4)', ['task_signing', keyId, pair.publicPem, keyring.encrypt(pair.privatePem, KEY_CONTEXT.taskSigning)]);
      await tx.query('INSERT INTO task_signing_keys_history (key_id, public_pem) VALUES ($1, $2)', [keyId, pair.publicPem]);
      log('Chave de assinatura de tarefas criada.');
    }

    // material de uso do gateway
    writePrivate(path.join(config.gatewayDir, 'ca.pem'), caPair.certPem);
    writePrivate(path.join(config.gatewayDir, 'ca-key.pem'), caPair.keyPem);
    writePrivate(path.join(config.gatewayDir, 'tls.pem'), `${tls.cert_pem as string}${caPair.certPem}`);
    writePrivate(path.join(config.gatewayDir, 'tls-key.pem'), keyring.decryptText(tls.private_enc as string, KEY_CONTEXT.gatewayTls));
  });
}

export interface GatewayMaterial { caCertPem: string; caKeyPem: string; tlsCertPem: string; tlsKeyPem: string }

export function loadGatewayMaterial(config: Config): GatewayMaterial {
  const read = (f: string) => {
    const p = path.join(config.gatewayDir, f);
    if (!existsSync(p)) throw new Error(`Arquivo ${p} não encontrado. Execute "npm run ca:init".`);
    return readFileSync(p, 'utf8');
  };
  return { caCertPem: read('ca.pem'), caKeyPem: read('ca-key.pem'), tlsCertPem: read('tls.pem'), tlsKeyPem: read('tls-key.pem') };
}

/** Chave privada de assinatura de tarefas (painel e worker). */
export async function loadTaskSigner(db: Database, keyring: Keyring) {
  const row = await db.system((tx) => tx.one('SELECT key_id, private_enc FROM system_keys WHERE name = $1', ['task_signing']));
  if (!row) throw new Error('Chave de assinatura de tarefas inexistente. Execute "npm run ca:init".');
  return { keyId: row.key_id as string, privatePem: keyring.decryptText(row.private_enc as string, KEY_CONTEXT.taskSigning) };
}
