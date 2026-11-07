// Editor de itens comerciais (orçamentos e pedidos) com prévia dos totais.
// A prévia usa centavos inteiros; o valor oficial é sempre recalculado no servidor.
import { el, icon, money, toCents, centsToStr, parseMoneyInput } from '../shared/ui.js';

export function itemsEditor({ items = [], discount = '0', currency = 'BRL', readonly = false, opcoes = {} }) {
  const tbody = el('tbody');
  const discountInput = el('input', { class: 'form-control form-control-sm text-end', inputmode: 'decimal', value: String(discount || '0').replace('.', ','), readonly: readonly || null, 'aria-label': 'Desconto geral' });
  const totals = { subtotal: el('strong'), desconto: el('strong'), total: el('strong', { class: 'fs-5' }) };
  const rows = [];

  function catalogSelect(item) {
    const sel = el('select', { class: 'form-select form-select-sm', disabled: readonly || null, 'aria-label': 'Vincular a produto ou serviço' }, el('option', { value: '' }, 'Item avulso'),
      el('optgroup', { label: 'Produtos' }, (opcoes.produtos || []).map((p) => el('option', { value: `p:${p.id}`, selected: item.produto_id === p.id || null }, p.nome))),
      el('optgroup', { label: 'Serviços' }, (opcoes.servicos || []).map((s) => el('option', { value: `s:${s.id}`, selected: item.servico_id === s.id || null }, s.nome))),
      el('optgroup', { label: 'Planos' }, (opcoes.planos || []).map((p) => el('option', { value: `pl:${p.id}`, selected: item.plano_id === p.id || null }, p.nome))));
    return sel;
  }

  function addRow(item = { descricao: '', quantidade: 1, preco_unitario: '', desconto: '0' }) {
    const r = {
      link: catalogSelect(item),
      descricao: el('input', { class: 'form-control form-control-sm', value: item.descricao, maxlength: 300, readonly: readonly || null, 'aria-label': 'Descrição' }),
      quantidade: el('input', { class: 'form-control form-control-sm text-end', type: 'number', min: 1, step: 1, value: item.quantidade, readonly: readonly || null, 'aria-label': 'Quantidade' }),
      preco: el('input', { class: 'form-control form-control-sm text-end', inputmode: 'decimal', value: String(item.preco_unitario ?? '').replace('.', ','), readonly: readonly || null, 'aria-label': 'Preço unitário' }),
      desconto: el('input', { class: 'form-control form-control-sm text-end', inputmode: 'decimal', value: String(item.desconto ?? '0').replace('.', ','), readonly: readonly || null, 'aria-label': 'Desconto do item' }),
      total: el('span')
    };
    r.link.addEventListener('change', () => {
      const [kind, id] = r.link.value.split(':');
      const list = { p: opcoes.produtos, s: opcoes.servicos, pl: opcoes.planos }[kind] || [];
      const found = list.find((x) => String(x.id) === id);
      if (found && !r.descricao.value) r.descricao.value = found.nome;
      if (kind === 'pl' && found?.preco && !r.preco.value) r.preco.value = String(found.preco).replace('.', ',');
      recalc();
    });
    const tr = el('tr', {}, el('td', {}, r.link), el('td', {}, r.descricao), el('td', { class: 'w-qty' }, r.quantidade), el('td', { class: 'w-money' }, r.preco), el('td', { class: 'w-money' }, r.desconto), el('td', { class: 'text-end w-money' }, r.total),
      el('td', {}, readonly ? null : el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', 'aria-label': 'Remover item', onclick: () => { rows.splice(rows.indexOf(r), 1); tr.remove(); recalc(); } }, icon('x-lg'))));
    [r.quantidade, r.preco, r.desconto].forEach((i) => i.addEventListener('input', recalc));
    rows.push(r);
    tbody.append(tr);
    recalc();
  }

  function recalc() {
    let subtotal = 0;
    for (const r of rows) {
      const line = Math.max(0, (Number(r.quantidade.value) || 0) * toCents(r.preco.value) - toCents(r.desconto.value));
      r.total.textContent = money(centsToStr(line), currency);
      subtotal += line;
    }
    const d = toCents(discountInput.value);
    totals.subtotal.textContent = money(centsToStr(subtotal), currency);
    totals.desconto.textContent = money(centsToStr(d), currency);
    totals.total.textContent = money(centsToStr(Math.max(0, subtotal - d)), currency);
  }
  discountInput.addEventListener('input', recalc);

  items.forEach((i) => addRow(i));
  if (!items.length && !readonly) addRow();

  const node = el('div', { class: 'items-editor' },
    el('div', { class: 'table-responsive', tabindex: '0', role: 'region', 'aria-label': 'Itens' }, el('table', { class: 'table table-sm align-middle' },
      el('thead', {}, el('tr', {}, ['Vínculo', 'Descrição', 'Qtd.', 'Valor unit.', 'Desconto', 'Total', ''].map((h) => el('th', { scope: 'col' }, h)))), tbody)),
    readonly ? null : el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => addRow() }, icon('plus-lg'), ' Adicionar item'),
    el('div', { class: 'totals' },
      el('div', {}, el('span', {}, 'Subtotal'), totals.subtotal),
      el('div', {}, el('label', { for: 'desc-geral' }, 'Desconto geral'), Object.assign(discountInput, { id: 'desc-geral' })),
      el('div', {}, el('span', {}, 'Total'), totals.total)));

  return {
    node,
    values() {
      return {
        itens: rows.map((r) => {
          const [kind, id] = r.link.value.split(':');
          return {
            descricao: r.descricao.value.trim(), quantidade: Number(r.quantidade.value),
            preco_unitario: parseMoneyInput(r.preco.value) || '0', desconto: parseMoneyInput(r.desconto.value) || '0',
            produto_id: kind === 'p' ? Number(id) : null, servico_id: kind === 's' ? Number(id) : null, plano_id: kind === 'pl' ? Number(id) : null
          };
        }),
        desconto: parseMoneyInput(discountInput.value) || '0'
      };
    }
  };
}
