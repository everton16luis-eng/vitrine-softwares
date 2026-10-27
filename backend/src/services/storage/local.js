import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = path.resolve(here, '../../../../storage');
export const PUBLIC_DIR = path.join(STORAGE_ROOT, 'uploads');
export const PRIVATE_DIR = path.join(STORAGE_ROOT, 'private');

const KEY_RE = /^\d{4}\/\d{2}\/[a-f0-9]{32}\.(jpg|png|webp|pdf|zip)$/;

/** Resolve a chave dentro da pasta base, impedindo path traversal. */
function resolveKey(key, privado) {
  if (!KEY_RE.test(key)) throw new Error('Chave de arquivo inválida.');
  const base = privado ? PRIVATE_DIR : PUBLIC_DIR;
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error('Caminho fora da área de armazenamento.');
  return full;
}

export const localDriver = {
  async save(buffer, { key, privado = false }) {
    const full = resolveKey(key, privado);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer, { flag: 'wx' }); // 'wx' falha se já existir: nunca sobrescreve
    return { key };
  },
  read(key, { privado = false } = {}) {
    return createReadStream(resolveKey(key, privado));
  },
  async remove(key, { privado = false } = {}) {
    await unlink(resolveKey(key, privado)).catch((err) => { if (err.code !== 'ENOENT') throw err; });
  },
  publicUrl(key) {
    return `/uploads/${key}`;
  }
};
