import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

async function pngBuffer() {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 40, height: 30, channels: 3, background: '#2fd8a4' } }).png().toBuffer();
}

describe('uploads e biblioteca de mídia', { skip }, () => {
  let admin;
  let consulta;
  let fileId;
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    await h.createStaff('consulta@teste.local', 'consulta');
    admin = await h.loginAs('admin@teste.local');
    consulta = await h.loginAs('consulta@teste.local');
  });
  after(async () => {
    if (fileId) await admin.del(`/api/admin/midia/${fileId}`);
    await h.closeDatabase();
  });

  test('aceita imagem válida, gera nome seguro e registra origem', async () => {
    const res = await admin.req('post', '/api/admin/midia').attach('arquivo', await pngBuffer(), { filename: '../../etc/passwd.png', contentType: 'image/png' })
      .field('texto_alternativo', 'Quadrado verde').field('origem', 'proprio');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.chave, /^\d{4}\/\d{2}\/[a-f0-9]{32}\.png$/);
    assert.equal(res.body.largura, 40);
    assert.ok(!res.body.nome_original.includes('/'));
    fileId = res.body.id;
    const served = await h.anon().get(res.body.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
  });

  test('rejeita conteúdo falso, SVG e extensão incoerente', async () => {
    const fake = await admin.req('post', '/api/admin/midia').attach('arquivo', Buffer.from('<?php echo 1; ?> conteúdo qualquer'), { filename: 'shell.png', contentType: 'image/png' });
    assert.equal(fake.status, 422);
    const svg = await admin.req('post', '/api/admin/midia').attach('arquivo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    assert.equal(svg.status, 422);
    const mismatch = await admin.req('post', '/api/admin/midia').attach('arquivo', await pngBuffer(), { filename: 'foto.jpg', contentType: 'image/jpeg' });
    assert.equal(mismatch.status, 422);
    const none = await admin.req('post', '/api/admin/midia').field('texto_alternativo', 'x');
    assert.equal(none.status, 422);
  });

  test('rejeita arquivos acima do limite', async () => {
    const big = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(6 * 1024 * 1024)]);
    const res = await admin.req('post', '/api/admin/midia').attach('arquivo', big, { filename: 'grande.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
  });

  test('upload exige permissão', async () => {
    const res = await consulta.req('post', '/api/admin/midia').attach('arquivo', await pngBuffer(), { filename: 'a.png' });
    assert.equal(res.status, 403);
  });

  test('arquivo em uso não pode ser excluído', async () => {
    const cat = await admin.post('/api/admin/categorias', { nome: 'Com imagem', imagem_id: fileId });
    assert.equal(cat.status, 201);
    assert.equal((await admin.del(`/api/admin/midia/${fileId}`)).status, 409);
    await admin.put(`/api/admin/categorias/${cat.body.id}`, { imagem_id: null });
  });

  test('caminhos com path traversal não são servidos', async () => {
    const r = await h.anon().get('/uploads/..%2F..%2Fpackage.json');
    assert.notEqual(r.status, 200);
  });
});

describe('cabeçalhos e tratamento de erros', { skip }, () => {
  before(h.resetDatabase);
  after(h.closeDatabase);

  test('cabeçalhos de segurança presentes', async () => {
    const r = await h.anon().get('/');
    assert.match(r.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.headers['x-frame-options'] || /frame-ancestors/.test(r.headers['content-security-policy']));
    assert.equal(r.headers['x-powered-by'], undefined);
  });

  test('requisição de outra origem é bloqueada', async () => {
    const r = await h.anon().post('/api/publico/contato').set('Origin', 'https://site-malicioso.example').send({});
    assert.equal(r.status, 403);
  });

  test('JSON malformado e IDs inválidos retornam erros controlados', async () => {
    await h.createStaff('admin2@teste.local');
    const s = await h.loginAs('admin2@teste.local');
    const bad = await s.req('post', '/api/admin/categorias').set('Content-Type', 'application/json').send('{"nome":');
    assert.equal(bad.status, 400);
    const id = await s.get('/api/admin/produtos/abc');
    assert.equal(id.status, 422);
    const missing = await s.get('/api/admin/produtos/999999');
    assert.equal(missing.status, 404);
    assert.ok(!JSON.stringify(missing.body).includes('SELECT'));
  });

  test('rota de API inexistente e página inexistente', async () => {
    assert.equal((await h.anon().get('/api/nao-existe')).status, 404);
    const page = await h.anon().get('/nao/existe/mesmo').set('Accept', 'text/html');
    assert.equal(page.status, 404);
    assert.match(page.text, /Página não encontrada/);
  });

  test('robots e sitemap', async () => {
    const robots = await h.anon().get('/robots.txt');
    assert.match(robots.text, /Disallow: \/admin/);
    const sm = await h.anon().get('/sitemap.xml');
    assert.match(sm.headers['content-type'], /xml/);
    assert.match(sm.text, /softwares\/churchflow/);
  });

  test('solicitação de titular (LGPD) é registrada', async () => {
    const r = await h.anon().post('/api/publico/lgpd').send({ nome: 'Titular', email: 'titular@teste.local', tipo: 'acesso', form_token: h.formToken() });
    assert.equal(r.status, 201);
    const row = await h.db.one("SELECT status FROM solicitacoes_titulares WHERE email = 'titular@teste.local'");
    assert.equal(row.status, 'recebida');
  });
});
