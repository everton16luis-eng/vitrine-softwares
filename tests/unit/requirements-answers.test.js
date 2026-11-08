// Regras puras do Levantamento de Requisitos: respostas por tipo, progresso, 5 porquês,
// nome do arquivo e texto seguro do relatório.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswer, normalizeOptions, formatAnswer, isAnswered, computeProgress, normalizeWhyLevels, reportFileName, QUESTION_TYPES
} from '../../backend/src/modules/requirements/answers.js';
import { richText, longDate, LEGAL_NOTE } from '../../backend/src/modules/requirements/report-document.js';
import { countPages } from '../../backend/src/services/pdf.js';

const q = (tipo, extra = {}) => ({ tipo, opcoes: [], ...extra });
const fieldOf = (fn) => { try { fn(); } catch (e) { return e.fields || e.campos || e.message; } return null; };

describe('normalizeAnswer', () => {
  test('os oito tipos previstos existem', () => {
    assert.deepEqual(Object.keys(QUESTION_TYPES).sort(), ['data', 'numero', 'observacoes', 'selecao_multipla', 'selecao_unica', 'sim_nao', 'texto_curto', 'texto_longo']);
  });

  test('texto: limpa espaços, mantém quebras no longo e respeita limites', () => {
    assert.deepEqual(normalizeAnswer(q('texto_curto'), { valor: '  Cerca de 2 horas  ' }), { valor: { valor: 'Cerca de 2 horas', detalhe: null }, pulada: false });
    assert.equal(normalizeAnswer(q('texto_longo'), { valor: 'linha 1\nlinha 2' }).valor.valor, 'linha 1\nlinha 2');
    assert.ok(fieldOf(() => normalizeAnswer(q('texto_curto'), { valor: 'x'.repeat(501) })));
  });

  test('vazio vira "sem resposta" e pular descarta a resposta', () => {
    assert.deepEqual(normalizeAnswer(q('texto_longo'), { valor: '   ' }), { valor: null, pulada: false });
    assert.deepEqual(normalizeAnswer(q('selecao_multipla', { opcoes: ['A', 'B'] }), { valor: [] }), { valor: null, pulada: false });
    assert.deepEqual(normalizeAnswer(q('texto_longo'), { valor: 'algo', pulada: true }), { valor: null, pulada: true });
  });

  test('sim/não, seleção única e múltipla só aceitam alternativas existentes', () => {
    assert.equal(normalizeAnswer(q('sim_nao'), { valor: 'SIM' }).valor.valor, 'sim');
    assert.ok(fieldOf(() => normalizeAnswer(q('sim_nao'), { valor: 'talvez' })));
    const sel = q('selecao_unica', { opcoes: ['Navegador', 'Celular'] });
    assert.equal(normalizeAnswer(sel, { valor: 'Celular' }).valor.valor, 'Celular');
    assert.ok(fieldOf(() => normalizeAnswer(sel, { valor: 'Tablet' })));
    const multi = q('selecao_multipla', { opcoes: ['Papel', 'Planilha', 'WhatsApp'] });
    assert.deepEqual(normalizeAnswer(multi, { valor: ['WhatsApp', 'Papel', 'Papel'] }).valor.valor, ['Papel', 'WhatsApp'], 'ordem das alternativas, sem repetição');
    assert.ok(fieldOf(() => normalizeAnswer(multi, { valor: ['Fax'] })));
  });

  test('número aceita formato brasileiro e data exige AAAA-MM-DD válida', () => {
    assert.equal(normalizeAnswer(q('numero'), { valor: '1.250,5' }).valor.valor, 1250.5);
    assert.equal(normalizeAnswer(q('numero'), { valor: 42 }).valor.valor, 42);
    assert.ok(fieldOf(() => normalizeAnswer(q('numero'), { valor: '12 kg' })));
    assert.equal(normalizeAnswer(q('data'), { valor: '2027-03-15' }).valor.valor, '2027-03-15');
    assert.ok(fieldOf(() => normalizeAnswer(q('data'), { valor: '2027-02-30' })));
  });

  test('complemento só nos tipos estruturados; complemento sozinho conta como resposta', () => {
    const r = normalizeAnswer(q('sim_nao'), { valor: null, detalhe: 'Depende do setor' });
    assert.deepEqual(r, { valor: { valor: null, detalhe: 'Depende do setor' }, pulada: false });
    assert.ok(isAnswered(r));
    assert.equal(normalizeAnswer(q('texto_curto'), { valor: 'a', detalhe: 'ignorado' }).valor.detalhe, null);
  });
});

describe('alternativas, formatação e progresso', () => {
  test('alternativas: mínimo de duas, sem repetidas (ignora caixa)', () => {
    assert.deepEqual(normalizeOptions('selecao_unica', [' Sim ', 'Não']), ['Sim', 'Não']);
    assert.deepEqual(normalizeOptions('texto_longo', ['x']), []);
    assert.ok(fieldOf(() => normalizeOptions('selecao_unica', ['Só uma'])));
    assert.ok(fieldOf(() => normalizeOptions('selecao_multipla', ['A', 'a'])));
  });

  test('formatAnswer escreve a resposta legível', () => {
    const r = (valor, detalhe = null) => ({ valor: { valor, detalhe } });
    assert.equal(formatAnswer(q('sim_nao'), r('nao', 'Ainda não')), 'Não — Ainda não');
    assert.equal(formatAnswer(q('selecao_multipla'), r(['Papel', 'WhatsApp'])), 'Papel; WhatsApp');
    assert.equal(formatAnswer(q('numero'), r(1250.5)), '1.250,5');
    assert.equal(formatAnswer(q('data'), r('2027-03-15')), '15/03/2027');
    assert.equal(formatAnswer(q('texto_longo'), { valor: null, pulada: true }), '');
  });

  test('computeProgress conta respondidas, puladas e obrigatórias pendentes', () => {
    const etapas = [
      { id: 1, perguntas: [
        { id: 11, obrigatoria: true, enunciado: 'A', resposta: { valor: { valor: 'x', detalhe: null } } },
        { id: 12, obrigatoria: false, resposta: { valor: null, pulada: true } }
      ] },
      { id: 2, perguntas: [{ id: 21, obrigatoria: true, enunciado: 'B', resposta: null }, { id: 22, obrigatoria: false, resposta: null }] }
    ];
    const p = computeProgress(etapas);
    assert.equal(p.total, 4);
    assert.equal(p.respondidas, 1);
    assert.equal(p.puladas, 1);
    assert.equal(p.percentual, 25);
    assert.deepEqual(p.obrigatorias_pendentes, [{ id: 21, etapa_id: 2, enunciado: 'B' }]);
    assert.deepEqual(p.etapas.map((e) => e.obrigatorias_pendentes), [0, 1]);
    assert.equal(computeProgress([]).percentual, 0);
  });

  test('5 porquês: no máximo cinco níveis, pergunta padrão quando vazia', () => {
    const n = normalizeWhyLevels([{ pergunta: '', resposta: ' Porque sim ' }, { pergunta: 'Por que atrasa?', resposta: '' }]);
    assert.equal(n.length, 2);
    assert.match(n[0].pergunta, /^Por que/);
    assert.equal(n[0].resposta, 'Porque sim');
    assert.deepEqual(normalizeWhyLevels(null), []);
    assert.ok(fieldOf(() => normalizeWhyLevels(Array.from({ length: 6 }, () => ({ pergunta: 'p', resposta: 'r' })))));
  });
});

describe('relatório', () => {
  test('nome do arquivo: levantamento-requisitos-<cliente>-<projeto>.pdf, sem acentos; sufixo da versão a partir da 2', () => {
    assert.equal(reportFileName('Joana Prado', 'Gestão de encomendas', 1), 'levantamento-requisitos-joana-prado-gestao-de-encomendas.pdf');
    assert.equal(reportFileName('Hélio Araújo', 'Prontuário & Agenda!', 3), 'levantamento-requisitos-helio-araujo-prontuario-agenda-v3.pdf');
    assert.equal(reportFileName('', '', null), 'levantamento-requisitos-cliente-projeto.pdf');
  });

  test('richText escapa HTML, cria links e listas', () => {
    const out = String(richText('<script>alert(1)</script>\nVeja https://exemplo.com.br/a. Contato: a@b.com.br\n\nItens:\n- um\n- dois'));
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
    assert.ok(out.includes('<a href="https://exemplo.com.br/a">https://exemplo.com.br/a</a>.'), 'pontuação final fora do link');
    assert.ok(out.includes('<a href="mailto:a@b.com.br">'));
    assert.ok(out.includes('<p>Itens:</p><ul><li>um</li><li>dois</li></ul>'));
    assert.equal(String(richText('  ')), '');
  });

  test('data por extenso e observação legal literal', () => {
    assert.equal(longDate('2026-11-05'), '5 de novembro de 2026');
    assert.equal(longDate(null), '—');
    assert.match(LEGAL_NOTE, /^Este documento representa o levantamento inicial/);
    assert.match(LEGAL_NOTE, /nem representa aprovação de escopo ou orçamento\.$/);
  });

  test('countPages lê a árvore de páginas do PDF', () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n3 0 obj << /Type /Page >> endobj', 'latin1');
    assert.equal(countPages(pdf), 3);
    assert.equal(countPages(Buffer.from('%PDF-1.4\n<< /Type /Page >>\n<< /Type /Page >>', 'latin1')), 2);
  });
});
