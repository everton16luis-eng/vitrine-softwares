// Cofre de segredos com criptografia por envelope:
//   KEK (arquivo, fora do banco) → cifra a DEK de cada cliente → a DEK cifra os segredos do cliente.
//   Segredos da empresa (client_id nulo) são cifrados direto pela KEK.
// Segredos nunca voltam pela API do painel: só são abertos internamente, para selar à chave de um
// agente ou para a central usar (ex.: manutenção de repositório).
import { randomBytes } from 'node:crypto';
import { Keyring } from '@central/security';
import { notFound } from '@central/shared';
import type { Tx } from '@central/database';

const dekContext = (clientId: number) => `client_keys:${clientId}`;
const secretContext = (publicId: string, kind: string) => `secrets:${publicId}:${kind}`;

export class SecretStore {
  private readonly kek: Keyring;
  constructor(kek: Keyring) { this.kek = kek; }

  private async keyringFor(tx: Tx, clientId: number | null, create: boolean): Promise<Keyring> {
    if (clientId == null) return this.kek;
    let row = await tx.one('SELECT dek_enc FROM client_keys WHERE client_id = $1', [clientId]);
    if (!row) {
      if (!create) throw new Error('Chave do cliente inexistente.');
      const dek = randomBytes(32);
      row = await tx.one(`INSERT INTO client_keys (client_id, dek_enc) VALUES ($1, $2)
        ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id RETURNING dek_enc`, [clientId, this.kek.encrypt(dek, dekContext(clientId))]);
    }
    return new Keyring({ dek: this.kek.decrypt(row!.dek_enc, dekContext(clientId)) }, 'dek');
  }

  /** Guarda um segredo novo e devolve o id interno. */
  async put(tx: Tx, input: { clientId: number | null; kind: string; value: string; createdBy?: number | null }): Promise<number> {
    if (!input.value) throw new Error('Segredo vazio.');
    const kr = await this.keyringFor(tx, input.clientId, true);
    const pub = (await tx.one('SELECT gen_random_uuid() AS id'))!.id as string;
    const row = await tx.one('INSERT INTO secrets (public_id, client_id, kind, ciphertext, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [pub, input.clientId, input.kind, kr.encrypt(input.value, secretContext(pub, input.kind)), input.createdBy ?? null]);
    return Number(row!.id);
  }

  async replace(tx: Tx, id: number, value: string) {
    const s = await tx.one('SELECT public_id, client_id, kind FROM secrets WHERE id = $1 FOR UPDATE', [id]);
    if (!s) throw notFound('Segredo');
    const kr = await this.keyringFor(tx, s.client_id == null ? null : Number(s.client_id), true);
    await tx.query('UPDATE secrets SET ciphertext = $2, rotated_at = now() WHERE id = $1', [id, kr.encrypt(value, secretContext(s.public_id, s.kind))]);
  }

  /** Uso interno apenas (nunca devolver ao navegador). */
  async reveal(tx: Tx, id: number): Promise<string> {
    const s = await tx.one('SELECT public_id, client_id, kind, ciphertext FROM secrets WHERE id = $1', [id]);
    if (!s) throw notFound('Segredo');
    const kr = await this.keyringFor(tx, s.client_id == null ? null : Number(s.client_id), false);
    return kr.decryptText(s.ciphertext, secretContext(s.public_id, s.kind));
  }

  /** Rotação da DEK de um cliente: DEK nova e todos os segredos dele recifrados (mesma transação). */
  async rotateClientKey(tx: Tx, clientId: number): Promise<number> {
    const row = await tx.one('SELECT dek_enc FROM client_keys WHERE client_id = $1 FOR UPDATE', [clientId]);
    if (!row) return 0;
    const oldKr = new Keyring({ dek: this.kek.decrypt(row.dek_enc, dekContext(clientId)) }, 'dek');
    const dek = randomBytes(32);
    const newKr = new Keyring({ dek }, 'dek');
    let n = 0;
    for (const s of await tx.many('SELECT id, public_id, kind, ciphertext FROM secrets WHERE client_id = $1 FOR UPDATE', [clientId])) {
      const ctx = secretContext(s.public_id, s.kind);
      await tx.query('UPDATE secrets SET ciphertext = $2 WHERE id = $1', [s.id, newKr.encrypt(oldKr.decrypt(s.ciphertext, ctx), ctx)]);
      n++;
    }
    await tx.query('UPDATE client_keys SET dek_enc = $2, rotated_at = now() WHERE client_id = $1', [clientId, this.kek.encrypt(dek, dekContext(clientId))]);
    return n;
  }

  /** Rotação da KEK: recifra as DEKs (os segredos em si não mudam). */
  async rewrapAll(tx: Tx): Promise<{ deks: number; companySecrets: number }> {
    let deks = 0; let company = 0;
    for (const r of await tx.many('SELECT client_id, dek_enc FROM client_keys FOR UPDATE')) {
      const next = this.kek.rewrap(r.dek_enc, dekContext(Number(r.client_id)));
      if (next !== r.dek_enc) { await tx.query('UPDATE client_keys SET dek_enc = $2, rotated_at = now() WHERE client_id = $1', [r.client_id, next]); deks++; }
    }
    for (const s of await tx.many('SELECT id, public_id, kind, ciphertext FROM secrets WHERE client_id IS NULL FOR UPDATE')) {
      const next = this.kek.rewrap(s.ciphertext, secretContext(s.public_id, s.kind));
      if (next !== s.ciphertext) { await tx.query('UPDATE secrets SET ciphertext = $2 WHERE id = $1', [s.id, next]); company++; }
    }
    return { deks, companySecrets: company };
  }
}
