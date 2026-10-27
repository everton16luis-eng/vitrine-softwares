// Camada de armazenamento. Em desenvolvimento usa o disco local; para produção
// é possível adicionar um driver (S3, R2, GCS...) implementando a mesma interface:
//   save(buffer, { key, privado, mime }) -> { key }
//   read(key, { privado }) -> Readable
//   remove(key, { privado })
//   publicUrl(key) -> string
import { env } from '../../config/env.js';
import { localDriver } from './local.js';

const drivers = { local: localDriver };

export function storage() {
  const driver = drivers[env.storageDriver];
  if (!driver) throw new Error(`Driver de armazenamento desconhecido: ${env.storageDriver}`);
  return driver;
}
