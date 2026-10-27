// Itens comerciais (orçamentos e pedidos): validação e cálculo de totais em centavos.
import { v, parse } from '../../utils/validation.js';
import { calculateTotals, toDecimal } from '../../utils/money.js';
import { ValidationError } from '../../utils/errors.js';

export const itemSchema = {
  descricao: v.string({ min: 2, max: 300 }),
  produto_id: v.id({ nullable: true }),
  servico_id: v.id({ nullable: true }),
  plano_id: v.id({ nullable: true }),
  quantidade: v.int({ min: 1, max: 100000 }),
  preco_unitario: v.money(),
  desconto: v.money({ default: 0n })
};

/** Valida itens e desconto geral e devolve linhas com totais (centavos BigInt). */
export function prepareItems(rawItems, rawDiscount, { requireItems = false } = {}) {
  if (!Array.isArray(rawItems)) throw new ValidationError({ itens: 'Informe a lista de itens.' });
  if (rawItems.length > 100) throw new ValidationError({ itens: 'Máximo de 100 itens.' });
  if (requireItems && !rawItems.length) throw new ValidationError({ itens: 'Adicione ao menos um item.' });
  const items = rawItems.map((it, i) => {
    try {
      return parse(itemSchema, it);
    } catch (err) {
      const first = err.details ? Object.entries(err.details)[0] : null;
      throw new ValidationError({ itens: `Item ${i + 1}: ${first ? `${first[0]} — ${first[1]}` : 'inválido.'}` });
    }
  });
  const { desconto } = parse({ desconto: v.money({ default: 0n }) }, { desconto: rawDiscount });
  const totals = calculateTotals(items, desconto);
  if (totals.errors.length) throw new ValidationError({ itens: totals.errors.join(' ') }, totals.errors[0]);
  return totals;
}

/** Substitui os itens de um documento (orcamento_itens / pedido_itens). */
export async function saveItems(tx, table, fk, docId, lines) {
  await tx.query(`DELETE FROM ${table} WHERE ${fk} = $1`, [docId]);
  for (const [i, l] of lines.entries()) {
    await tx.query(
      `INSERT INTO ${table} (${fk}, descricao, produto_id, servico_id, plano_id, quantidade, preco_unitario, desconto, total, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [docId, l.descricao, l.produto_id ?? null, l.servico_id ?? null, l.plano_id ?? null, l.quantidade,
        toDecimal(l.preco_unitario), toDecimal(l.desconto || 0n), toDecimal(l.total), i]
    );
  }
}
