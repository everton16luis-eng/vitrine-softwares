/** Gera números sequenciais por ano, ex.: ORC-2026-0001. Deve ser chamado dentro de uma transação. */
export async function nextDocumentNumber(tx, prefix) {
  const year = new Date().getUTCFullYear();
  const row = await tx.one(
    `INSERT INTO sequencias_documentos (prefixo, ano, ultimo) VALUES ($1, $2, 1)
     ON CONFLICT (prefixo, ano) DO UPDATE SET ultimo = sequencias_documentos.ultimo + 1 RETURNING ultimo`,
    [prefix, year]
  );
  return `${prefix}-${year}-${String(row.ultimo).padStart(4, '0')}`;
}
