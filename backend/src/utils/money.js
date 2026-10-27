// Aritmética monetária em centavos (BigInt), sem ponto flutuante.

/**
 * Converte "1.234,56", "1234.56", "1234", 1234.5 ou "R$ 10,00" em centavos (BigInt).
 * Retorna null se o formato for inválido. Aceita no máximo 2 casas decimais.
 */
export function parseMoney(input) {
  if (typeof input === 'bigint') return input;
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // O último separador é o decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.234" = mil duzentos e trinta e quatro
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const cents = BigInt(int) * 100n + BigInt((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** Centavos -> string decimal "1234.56" (formato aceito pelo NUMERIC). */
export function toDecimal(cents) {
  const c = BigInt(cents);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const s = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Formata para exibição (pt-BR). Aceita centavos BigInt ou string decimal do banco. */
export function formatMoney(value, currency = 'BRL') {
  if (value === null || value === undefined || value === '') return '';
  const cents = typeof value === 'bigint' ? value : parseMoney(value);
  if (cents === null) return '';
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(abs % 100n).padStart(2, '0');
  const symbol = { BRL: 'R$', USD: 'US$', EUR: '€' }[currency] || currency;
  return `${neg ? '-' : ''}${symbol} ${int},${frac}`;
}

/**
 * Calcula totais de itens comerciais.
 * items: [{ quantidade:int, preco_unitario:cents, desconto:cents }]
 * Regras: desconto do item <= bruto do item; desconto geral <= subtotal.
 */
export function calculateTotals(items, discount = 0n) {
  const errors = [];
  const lines = items.map((item, i) => {
    const qty = BigInt(item.quantidade);
    const gross = qty * BigInt(item.preco_unitario);
    const itemDiscount = BigInt(item.desconto || 0n);
    if (itemDiscount > gross) errors.push(`Item ${i + 1}: o desconto não pode ser maior que o valor do item.`);
    return { ...item, total: gross - itemDiscount < 0n ? 0n : gross - itemDiscount };
  });
  const subtotal = lines.reduce((acc, l) => acc + l.total, 0n);
  const desconto = BigInt(discount || 0n);
  if (desconto > subtotal) errors.push('O desconto geral não pode ser maior que o subtotal.');
  return { lines, subtotal, desconto, total: subtotal - desconto < 0n ? 0n : subtotal - desconto, errors };
}
