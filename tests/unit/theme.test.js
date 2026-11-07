import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeVariables, contrast, PAPER, DEFAULT_COLORS } from '../../backend/src/views/theme.js';

test('tema padrão: tinta, destaque e linha com contraste AA', () => {
  const v = themeVariables({});
  assert.equal(v['--brand-ink'], DEFAULT_COLORS.primaria);
  assert.equal(v['--brand-accent'], DEFAULT_COLORS.destaque);
  assert.equal(v['--brand-on-accent'], '#FFFFFF');
  assert.ok(contrast(v['--brand-on-accent'], v['--brand-accent']) >= 4.5);
  assert.ok(contrast(v['--brand-accent-text'], '#FFFFFF') >= 4.5);
  assert.ok(contrast(v['--brand-line-text'], '#FFFFFF') >= 4.5);
});

test('cores claras escolhidas no painel continuam legíveis', () => {
  for (const cor of ['#2FD8A4', '#FFE066', '#0EA5E9', '#F8FAFC', '#8B5CF6']) {
    const v = themeVariables({ cor_primaria: cor, cor_destaque: cor, cor_secundaria: cor });
    assert.ok(contrast(v['--brand-ink'], PAPER) >= 9, `tinta a partir de ${cor}`);
    assert.ok(contrast(v['--brand-on-accent'], v['--brand-accent']) >= 3, `texto sobre ${cor}`);
    assert.ok(contrast(v['--brand-accent-text'], '#FFFFFF') >= 4.5, `destaque como texto a partir de ${cor}`);
    assert.ok(contrast(v['--brand-line-text'], '#FFFFFF') >= 4.5, `linha como texto a partir de ${cor}`);
  }
});

test('valores inválidos voltam ao padrão', () => {
  const v = themeVariables({ cor_primaria: 'red', cor_destaque: '#12', cor_secundaria: null });
  assert.equal(v['--brand-ink'], DEFAULT_COLORS.primaria);
  assert.equal(v['--brand-accent'], DEFAULT_COLORS.destaque);
  assert.equal(v['--brand-line'], DEFAULT_COLORS.secundaria);
});
