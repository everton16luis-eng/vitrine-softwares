import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, toDecimal, formatMoney, calculateTotals } from '../../backend/src/utils/money.js';
import { v, validate, parse } from '../../backend/src/utils/validation.js';

describe('dinheiro (centavos, sem ponto flutuante)', () => {
  test('interpreta formatos brasileiros e internacionais', () => {
    assert.equal(parseMoney('1.234,56'), 123456n);
    assert.equal(parseMoney('1234.56'), 123456n);
    assert.equal(parseMoney('1234'), 123400n);
    assert.equal(parseMoney('R$ 10,5'), 1050n);
    assert.equal(parseMoney('1.234'), 123400n);
    assert.equal(parseMoney('0,01'), 1n);
  });
  test('rejeita formatos inválidos e mais de 2 casas', () => {
    assert.equal(parseMoney('abc'), null);
    assert.equal(parseMoney('1,234'), null); // 3 casas decimais
    assert.equal(parseMoney('12.3.4'), null);
    assert.equal(parseMoney(''), null);
  });
  test('converte e formata sem perda de precisão', () => {
    assert.equal(toDecimal(1n), '0.01');
    assert.equal(toDecimal(99999999999999n), '999999999999.99');
    assert.equal(formatMoney('1234567.89'), 'R$ 1.234.567,89');
    assert.equal(formatMoney(5n, 'USD'), 'US$ 0,05');
  });
  test('0,10 + 0,20 = 0,30 exatamente', () => {
    const { total } = calculateTotals([{ quantidade: 1, preco_unitario: parseMoney('0.10') }, { quantidade: 1, preco_unitario: parseMoney('0.20') }]);
    assert.equal(toDecimal(total), '0.30');
  });
  test('calcula itens, descontos e total', () => {
    const r = calculateTotals([
      { quantidade: 3, preco_unitario: parseMoney('33.33'), desconto: 0n },
      { quantidade: 2, preco_unitario: parseMoney('1500.00'), desconto: parseMoney('100') }
    ], parseMoney('50.00'));
    assert.equal(toDecimal(r.lines[0].total), '99.99');
    assert.equal(toDecimal(r.lines[1].total), '2900.00');
    assert.equal(toDecimal(r.subtotal), '2999.99');
    assert.equal(toDecimal(r.total), '2949.99');
    assert.deepEqual(r.errors, []);
  });
  test('impede descontos maiores que o valor', () => {
    const r1 = calculateTotals([{ quantidade: 1, preco_unitario: 1000n, desconto: 1001n }]);
    assert.equal(r1.errors.length, 1);
    const r2 = calculateTotals([{ quantidade: 1, preco_unitario: 1000n }], 1001n);
    assert.equal(r2.errors.length, 1);
  });
});

describe('validação e normalização de entradas', () => {
  const schema = { nome: v.string({ min: 2, max: 10 }), email: v.email(), idade: v.int({ min: 0, optional: true }), ativo: v.bool() };
  test('normaliza espaços, e-mail em minúsculas e descarta campos não previstos', () => {
    const { value, errors } = validate(schema, { nome: '  Ana   Lu ', email: ' ANA@Exemplo.COM ', perfil: 'administrador', idade: '30' });
    assert.equal(errors, null);
    assert.deepEqual(value, { nome: 'Ana Lu', email: 'ana@exemplo.com', idade: 30, ativo: false });
    assert.equal('perfil' in value, false);
  });
  test('retorna mensagens por campo', () => {
    const { errors } = validate(schema, { nome: 'A', email: 'invalido', idade: 'x' });
    assert.ok(errors.nome && errors.email && errors.idade);
  });
  test('remove caracteres de controle', () => {
    assert.equal(parse({ s: v.string() }, { s: 'a\u0000b\u0007c' }).s, 'a b c');
  });
  test('URLs: somente http(s) ou relativas quando permitido', () => {
    assert.ok(validate({ u: v.url() }, { u: 'javascript:alert(1)' }).errors);
    assert.ok(validate({ u: v.url() }, { u: '/relativa' }).errors);
    assert.equal(validate({ u: v.url({ allowRelative: true }) }, { u: '/assets/a.svg' }).errors, null);
  });
  test('datas inválidas são rejeitadas', () => {
    assert.ok(validate({ d: v.date() }, { d: '2026-02-30' }).errors);
    assert.equal(validate({ d: v.date() }, { d: '2026-02-28' }).errors, null);
  });
  test('modo parcial ignora campos ausentes', () => {
    assert.deepEqual(validate(schema, { nome: 'Bia' }, { partial: true }).value, { nome: 'Bia' });
  });
});
