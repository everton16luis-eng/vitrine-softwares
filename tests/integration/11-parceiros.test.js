import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';
import { isLogoProcessingAvailable } from '../../backend/src/modules/partners/logo-processor.js';

const skip = (!h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado') || (!isLogoProcessingAvailable() && 'sharp não instalado');

async function logoPng(color = '#1d4ed8') {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="100%" height="100%" fill="#ffffff"/><rect x="100" y="50" width="400" height="100" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('clientes e parceiros', { skip }, () => {
  let admin;
  let editor;
  let consulta;
  const ids = [];
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    await h.createStaff('editor@teste.local', 'editor_conteudo');
    await h.createStaff('consulta@teste.local', 'consulta');
    admin = await h.loginAs('admin@teste.local');
    editor = await h.loginAs('editor@teste.local');
    consulta = await h.loginAs('consulta@teste.local');
  });
  after(async () => {
    for (const id of ids) await admin.del(`/api/admin/parceiros/${id}`);
    await h.closeDatabase();
  });

  test('cadastra, envia logomarca e gera versões padronizadas', async () => {
    const created = await editor.post('/api/admin/parceiros', { nome: 'Empresa Alfa', ativo: true, divulgacao_autorizada: true, ordem: 10 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.push(created.body.id);
    assert.equal(created.body.publico, false, 'sem logo não aparece');

    const up = await editor.req('post', `/api/admin/parceiros/${created.body.id}/logo`).attach('arquivo', await logoPng(), { filename: 'alfa.png', contentType: 'image/png' });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.publico, true);
    assert.equal(up.body.logo_original_chave, undefined, 'chave do original não é exposta');
    assert.match(up.body.logo_mono_url, /^\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{32}\.webp$/);
    assert.equal(up.body.logo_info.tela, '480x240');
    assert.equal(up.body.logo_info.fundo, 'removido');

    const served = await h.anon().get(up.body.logo_mono_url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['x-content-type-options'], 'nosniff');

    const original = await editor.get(`/api/admin/parceiros/${created.body.id}/logo/original`);
    assert.equal(original.status, 200);
    assert.match(original.headers['content-disposition'], /^attachment;/);
  });

  test('substituir e reprocessar trocam os arquivos e apagam os antigos', async () => {
    const id = ids[0];
    const before = (await admin.get(`/api/admin/parceiros/${id}`)).body;
    const up = await admin.req('post', `/api/admin/parceiros/${id}/logo`).attach('arquivo', await logoPng('#16a34a'), { filename: 'alfa-nova.png', contentType: 'image/png' });
    assert.equal(up.status, 200);
    assert.notEqual(up.body.logo_mono_url, before.logo_mono_url);
    assert.equal((await h.anon().get(before.logo_mono_url)).status, 404);

    const re = await admin.post(`/api/admin/parceiros/${id}/logo/reprocessar`);
    assert.equal(re.status, 200);
    assert.notEqual(re.body.logo_mono_url, up.body.logo_mono_url);
    assert.equal((await h.anon().get(re.body.logo_mono_url)).status, 200);

    const all = await admin.post('/api/admin/parceiros/reprocessar');
    assert.equal(all.status, 200);
    assert.deepEqual({ total: all.body.total, falhas: all.body.falhas.length }, { total: 1, falhas: 0 });
  });

  test('valida arquivos enviados', async () => {
    const id = ids[0];
    const send = (buf, filename, contentType) => admin.req('post', `/api/admin/parceiros/${id}/logo`).attach('arquivo', buf, { filename, contentType });
    assert.equal((await send(Buffer.from('<?php echo 1; ?>'), 'logo.png', 'image/png')).status, 422);
    assert.equal((await send(await logoPng(), 'logo.svg', 'image/svg+xml')).status, 422, 'extensão incoerente');
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
    const res = await send(evil, 'logo.svg', 'image/svg+xml');
    assert.equal(res.status, 422);
    assert.ok(res.body.campos?.arquivo);
    const okSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><circle cx="50" cy="50" r="40" fill="#e11d48"/><rect x="110" y="30" width="170" height="40" fill="#334155"/></svg>');
    const ok = await send(okSvg, 'logo.svg', 'image/svg+xml');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.logo_mono_url, /\.webp$/, 'SVG nunca é publicado; vira bitmap');
  });

  test('somente ativos e autorizados aparecem na página inicial', async () => {
    const mk = async (nome, extra) => {
      const r = await admin.post('/api/admin/parceiros', { nome, ...extra });
      ids.push(r.body.id);
      await admin.req('post', `/api/admin/parceiros/${r.body.id}/logo`).attach('arquivo', await logoPng(), { filename: 'x.png', contentType: 'image/png' });
      return r.body.id;
    };
    await mk('Empresa Sem Autorizacao', { ativo: true, divulgacao_autorizada: false });
    const inativa = await mk('Empresa Inativa', { ativo: false, divulgacao_autorizada: true });

    const home = await h.anon().get('/');
    assert.equal(home.status, 200);
    assert.match(home.text, /id="clientes"/);
    assert.match(home.text, /Empresas que confiam em nossas soluções/);
    assert.match(home.text, /alt="Empresa Alfa"/);
    assert.doesNotMatch(home.text, /Empresa Sem Autorizacao/);
    assert.doesNotMatch(home.text, /Empresa Inativa/);
    assert.match(home.text, /loading="lazy"/);

    await admin.put(`/api/admin/parceiros/${inativa}`, { ativo: true });
    assert.match((await h.anon().get('/')).text, /alt="Empresa Inativa"/);
  });

  test('seção fica oculta quando não há marcas públicas', async () => {
    await h.db.query('UPDATE parceiros SET divulgacao_autorizada = false');
    const home = await h.anon().get('/');
    assert.doesNotMatch(home.text, /id="clientes"/);
  });

  test('exige permissão e apaga os arquivos ao excluir', async () => {
    assert.equal((await consulta.get('/api/admin/parceiros')).status, 403);
    assert.equal((await consulta.post('/api/admin/parceiros', { nome: 'X' })).status, 403);
    const r = await admin.post('/api/admin/parceiros', { nome: 'Empresa Temporaria' });
    const up = await admin.req('post', `/api/admin/parceiros/${r.body.id}/logo`).attach('arquivo', await logoPng(), { filename: 'x.png', contentType: 'image/png' });
    assert.equal((await admin.del(`/api/admin/parceiros/${r.body.id}`)).status, 204);
    assert.equal((await h.anon().get(up.body.logo_mono_url)).status, 404);
    assert.equal((await h.anon().get(up.body.logo_cor_url)).status, 404);
  });
});
