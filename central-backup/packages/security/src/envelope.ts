// Criptografia por envelope: dados cifrados com uma DEK (AES-256-GCM); a DEK é cifrada pela KEK
// (chave mestra), que fica num arquivo fora do banco. Formato do texto cifrado (base64url):
//   v1.<id da chave>.<iv 12 bytes><tag 16 bytes><dados>
// O "contexto" (AAD) amarra o texto a um uso (ex.: "totp:usuario:7"), impedindo trocar valores
// entre registros.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export class Keyring {
  private readonly keys: Map<string, Buffer>;
  readonly currentId: string;

  constructor(keys: Record<string, Buffer>, currentId: string) {
    for (const [id, key] of Object.entries(keys)) {
      if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error(`Identificador de chave inválido: ${id}`);
      if (key.length !== 32) throw new Error(`A chave "${id}" precisa ter 32 bytes.`);
    }
    if (!keys[currentId]) throw new Error('Chave atual não encontrada no chaveiro.');
    this.keys = new Map(Object.entries(keys));
    this.currentId = currentId;
  }

  /**
   * Lê a KEK de um arquivo com linhas "id:base64" (a última é a atual). Recusa arquivo legível por
   * outros usuários em sistemas POSIX.
   */
  static fromFile(path: string): Keyring {
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o077;
      if (mode) throw new Error(`O arquivo de chave ${path} não pode ser legível por grupo/outros (use chmod 400).`);
    }
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) throw new Error('Arquivo de chave vazio.');
    const keys: Record<string, Buffer> = {};
    let last = '';
    for (const line of lines) {
      const [id, b64] = line.split(':');
      if (!id || !b64) throw new Error('Linha inválida no arquivo de chave (formato id:base64).');
      keys[id] = Buffer.from(b64, 'base64');
      last = id;
    }
    return new Keyring(keys, last);
  }

  static generateLine(id = `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`): string {
    return `${id}:${randomBytes(32).toString('base64')}`;
  }

  encrypt(plaintext: Buffer | string, context: string): string {
    const key = this.keys.get(this.currentId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext) : plaintext), cipher.final()]);
    return `v1.${this.currentId}.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')}`;
  }

  decrypt(token: string, context: string): Buffer {
    const [version, id, body] = token.split('.');
    if (version !== 'v1' || !id || !body) throw new Error('Texto cifrado em formato desconhecido.');
    const key = this.keys.get(id);
    if (!key) throw new Error(`Chave "${id}" não está disponível no chaveiro.`);
    const raw = Buffer.from(body, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  }

  decryptText = (token: string, context: string) => this.decrypt(token, context).toString('utf8');

  /** Recifra com a chave atual (rotação da KEK). */
  rewrap(token: string, context: string): string {
    return token.split('.')[1] === this.currentId ? token : this.encrypt(this.decrypt(token, context), context);
  }
}
