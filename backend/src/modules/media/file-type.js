// Identificação do tipo real do arquivo pelos "magic bytes" — a extensão e o
// Content-Type enviados pelo navegador não são confiáveis.

export const IMAGE_TYPES = {
  jpg: { mime: 'image/jpeg', exts: ['jpg', 'jpeg'] },
  png: { mime: 'image/png', exts: ['png'] },
  webp: { mime: 'image/webp', exts: ['webp'] }
};
export const DOCUMENT_TYPES = {
  pdf: { mime: 'application/pdf', exts: ['pdf'] },
  zip: { mime: 'application/zip', exts: ['zip'] }
};

export function detectType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'zip';
  return null;
}

/**
 * Valida o arquivo enviado: tipo real permitido, extensão coerente e tamanho.
 * Retorna { type, mime } ou lança um erro com mensagem amigável.
 */
export function validateFile({ buffer, originalname, size }, { allowDocuments = false, maxBytes }) {
  const allowed = allowDocuments ? { ...IMAGE_TYPES, ...DOCUMENT_TYPES } : IMAGE_TYPES;
  if (!buffer || !size) return { error: 'Nenhum arquivo recebido.' };
  if (maxBytes && size > maxBytes) return { error: 'Arquivo acima do tamanho máximo permitido.' };
  const ext = String(originalname || '').toLowerCase().split('.').pop();
  const type = detectType(buffer);
  if (!type || !allowed[type]) {
    return { error: allowDocuments ? 'Tipo de arquivo não permitido. Envie JPG, PNG, WEBP, PDF ou ZIP.' : 'Tipo de arquivo não permitido. Envie JPG, PNG ou WEBP.' };
  }
  if (!allowed[type].exts.includes(ext)) return { error: 'A extensão do arquivo não corresponde ao seu conteúdo.' };
  return { type, mime: allowed[type].mime };
}
