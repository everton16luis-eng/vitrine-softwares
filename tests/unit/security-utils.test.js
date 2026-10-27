import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { html, escapeHtml, jsonForScript, safeUrl } from '../../backend/src/utils/html.js';
import { renderMarkdown } from '../../backend/src/utils/markdown.js';
import { detectType, validateFile } from '../../backend/src/modules/media/file-type.js';
import { issueFormToken, checkFormToken } from '../../backend/src/modules/leads/form-token.js';
import { verifyStripeSignature, verifyMercadoPagoSignature } from '../../backend/src/modules/payments/gateways.js';
import { toCsv } from '../../backend/src/utils/common.js';
import { _sanitizeForTests } from '../../backend/src/services/audit.js';
import { passwordProblem } from '../../backend/src/modules/auth/password.js';

describe('proteção contra XSS', () => {
  test('templates escapam valores interpolados', () => {
    const out = String(html`<p title="${'"><script>'}">${'<img src=x onerror=alert(1)>'}</p>`);
    assert.ok(!out.includes('<script>'));
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('&lt;img'));
  });
  test('JSON-LD não permite fechar a tag script', () => {
    assert.ok(!String(jsonForScript({ a: '</script><script>alert(1)</script>' })).includes('</script>'));
  });
  test('Markdown não preserva HTML e bloqueia links javascript:', () => {
    const out = renderMarkdown('## Título\n<script>alert(1)</script>\n[x](javascript:alert(1)) [ok](https://exemplo.com)');
    assert.ok(!out.includes('<script>'));
    assert.ok(!out.includes('javascript:'));
    assert.ok(out.includes('<a href="https://exemplo.com"'));
    assert.ok(out.includes('<h3>Título</h3>'));
  });
  test('safeUrl neutraliza esquemas perigosos', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl('/softwares'), '/softwares');
    assert.equal(safeUrl('//evil.com'), '#');
  });
  test('escapeHtml trata aspas', () => assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;'));
});

describe('validação de uploads pelo conteúdo', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  test('detecta tipos reais', () => {
    assert.equal(detectType(png), 'png');
    assert.equal(detectType(Buffer.from('%PDF-1.7 xxxxxxxx')), 'pdf');
    assert.equal(detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  });
  test('rejeita arquivo com extensão de imagem mas conteúdo de texto', () => {
    assert.ok(validateFile({ buffer: Buffer.from('<?php system($_GET[1]); ?> padding'), originalname: 'foto.png', size: 40 }, {}).error);
  });
  test('rejeita extensão incoerente com o conteúdo', () => {
    assert.ok(validateFile({ buffer: png, originalname: 'imagem.jpg', size: png.length }, {}).error);
  });
  test('rejeita PDF quando só imagens são aceitas', () => {
    const pdf = Buffer.from('%PDF-1.7 xxxxxxxxxxxx');
    assert.ok(validateFile({ buffer: pdf, originalname: 'a.pdf', size: pdf.length }, {}).error);
    assert.equal(validateFile({ buffer: pdf, originalname: 'a.pdf', size: pdf.length }, { allowDocuments: true }).type, 'pdf');
  });
  test('respeita o tamanho máximo', () => {
    assert.ok(validateFile({ buffer: png, originalname: 'a.png', size: 10_000_000 }, { maxBytes: 1000 }).error);
  });
});

describe('token anti-spam de formulários', () => {
  test('aceita token válido após alguns segundos', () => assert.equal(checkFormToken(issueFormToken(Date.now() - 5000)), null));
  test('rejeita envio imediato (robô)', () => assert.equal(checkFormToken(issueFormToken()), 'rapido'));
  test('rejeita token adulterado ou expirado', () => {
    const t = issueFormToken(Date.now() - 5000);
    assert.equal(checkFormToken(`${t.slice(0, -1)}${t.endsWith('0') ? '1' : '0'}`), 'invalido');
    assert.equal(checkFormToken(issueFormToken(Date.now() - 25 * 3600 * 1000)), 'expirado');
    assert.equal(checkFormToken(undefined), 'invalido');
  });
});

describe('assinaturas de webhooks (gateways futuros)', () => {
  test('Stripe: aceita assinatura correta e rejeita alterada ou antiga', () => {
    const secret = 'whsec_teste';
    const body = '{"id":"evt_1"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret), true);
    assert.equal(verifyStripeSignature(`${body} `, `t=${t},v1=${sig}`, secret), false);
    assert.equal(verifyStripeSignature(body, `t=${t - 3600},v1=${sig}`, secret), false);
  });
  test('Mercado Pago: valida o manifesto', () => {
    const secret = 'mp_teste';
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
    assert.equal(verifyMercadoPagoSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123' }, secret), true);
    assert.equal(verifyMercadoPagoSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-2', dataId: '123' }, secret), false);
  });
});

describe('outros controles', () => {
  test('CSV neutraliza fórmulas de planilha', () => {
    const csv = toCsv([{ label: 'Nome', key: 'n' }], [{ n: '=HYPERLINK("http://x")' }]);
    assert.ok(csv.includes("'=HYPERLINK"));
  });
  test('auditoria omite campos sensíveis', () => {
    const s = _sanitizeForTests({ nome: 'x', senha: '123', token: 'abc', nested: { senha_hash: 'h' } });
    assert.equal(s.senha, '[omitido]');
    assert.equal(s.token, '[omitido]');
    assert.equal(s.nested.senha_hash, '[omitido]');
  });
  test('política de senha', () => {
    assert.ok(passwordProblem('curta1'));
    assert.ok(passwordProblem('somenteletras'));
    assert.equal(passwordProblem('Senha-Forte-2026'), null);
  });
});
