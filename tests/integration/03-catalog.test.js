import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';

describe('produtos, publicação e catálogo público', { skip }, () => {
  let admin;
  let categoriaId;
  let produtoId;
  before(async () => {
    await h.resetDatabase();
    await h.createStaff('admin@teste.local');
    admin = await h.loginAs('admin@teste.local');
    categoriaId = (await admin.post('/api/admin/categorias', { nome: 'Categoria Teste' })).body.id;
  });
  after(h.closeDatabase);

  test('cria produto com slug gerado e valida campos', async () => {
    const invalid = await admin.post('/api/admin/produtos', { nome: 'X', resumo: 'curto' });
    assert.equal(invalid.status, 422);
    assert.ok(invalid.body.campos.categoria_id && invalid.body.campos.resumo);
    const res = await admin.post('/api/admin/produtos', { nome: 'Sistema de Estoque Ágil', categoria_id: categoriaId, resumo: 'Controle de estoque para pequenas empresas.', preco: '1.500,00', status_comercial: 'em_desenvolvimento' });
    assert.equal(res.status, 201);
    assert.equal(res.body.slug, 'sistema-de-estoque-agil');
    assert.equal(res.body.preco, '1500.00');
    assert.equal(res.body.publicado, false);
    produtoId = res.body.id;
  });

  test('não permite arquivar via edição nem slug duplicado', async () => {
    const r1 = await admin.put(`/api/admin/produtos/${produtoId}`, { status_comercial: 'arquivado' });
    assert.equal(r1.status, 422);
    const r2 = await admin.post('/api/admin/produtos', { nome: 'Outro', slug: 'churchflow', categoria_id: categoriaId, resumo: 'Resumo válido para o teste.' });
    assert.equal(r2.status, 409);
  });

  test('edita produto e funcionalidades', async () => {
    const r = await admin.put(`/api/admin/produtos/${produtoId}`, { resumo: 'Controle de estoque com alertas de reposição.', destaque: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.destaque, true);
    const f = await admin.post(`/api/admin/produtos/${produtoId}/funcionalidades`, { titulo: 'Alertas de reposição', descricao: 'Aviso de estoque mínimo' });
    assert.equal(f.status, 201);
    const upd = await admin.put(`/api/admin/produtos/${produtoId}/funcionalidades/${f.body.id}`, { titulo: 'Alertas inteligentes' });
    assert.equal(upd.body.titulo, 'Alertas inteligentes');
    const other = await admin.put(`/api/admin/produtos/1/funcionalidades/${f.body.id}`, { titulo: 'Invasão' });
    assert.equal(other.status, 404, 'item de outro produto não pode ser alterado');
  });

  test('produto não publicado não aparece no catálogo nem na página pública', async () => {
    const list = await h.anon().get('/api/publico/produtos?limite=30');
    assert.ok(!list.body.items.some((p) => p.id === produtoId));
    assert.equal((await h.anon().get('/softwares/sistema-de-estoque-agil')).status, 404);
  });

  test('publicação e despublicação controlam a visibilidade', async () => {
    const pub = await admin.post(`/api/admin/produtos/${produtoId}/publicar`, {});
    assert.equal(pub.status, 200);
    assert.equal(pub.body.publicado, true);
    const page = await h.anon().get('/softwares/sistema-de-estoque-agil');
    assert.equal(page.status, 200);
    assert.match(page.text, /Sistema de Estoque Ágil/);
    assert.match(page.text, /Em desenvolvimento/);
    assert.ok(!page.text.includes('>Contratar<'), 'produto em desenvolvimento não oferece "Contratar"');
    const sitemap = await h.anon().get('/sitemap.xml');
    assert.match(sitemap.text, /softwares\/sistema-de-estoque-agil/);
    await admin.post(`/api/admin/produtos/${produtoId}/despublicar`, {});
    assert.equal((await h.anon().get('/softwares/sistema-de-estoque-agil')).status, 404);
    assert.ok(!(await h.anon().get('/sitemap.xml')).text.includes('sistema-de-estoque-agil'));
  });

  test('categoria com produtos publicados não pode ser desativada', async () => {
    await admin.post(`/api/admin/produtos/${produtoId}/publicar`, {});
    const r = await admin.put(`/api/admin/categorias/${categoriaId}`, { ativa: false });
    assert.equal(r.status, 409);
    const del = await admin.del(`/api/admin/categorias/${categoriaId}`);
    assert.equal(del.status, 409);
  });

  test('arquivamento despublica e preserva o registro', async () => {
    const r = await admin.post(`/api/admin/produtos/${produtoId}/arquivar`, {});
    assert.equal(r.body.status_comercial, 'arquivado');
    assert.equal(r.body.publicado, false);
    assert.equal((await admin.post(`/api/admin/produtos/${produtoId}/publicar`, {})).status, 409);
    assert.equal((await admin.post(`/api/admin/produtos/${produtoId}/restaurar`, {})).status, 200);
  });

  test('filtros, pesquisa e paginação no catálogo público', async () => {
    const all = await h.anon().get('/api/publico/produtos');
    assert.equal(all.body.total, 5);
    const busca = await h.anon().get('/api/publico/produtos?busca=abastecimento');
    assert.deepEqual(busca.body.items.map((p) => p.slug), ['fleetmanager'], 'busca em funcionalidades');
    const cat = await h.anon().get('/api/publico/produtos?categoria=gestao-de-locacoes');
    assert.deepEqual(cat.body.items.map((p) => p.slug), ['spacecontrol']);
    const modelo = await h.anon().get('/api/publico/produtos?modelo=personalizado');
    assert.deepEqual(modelo.body.items.map((p) => p.slug), ['sistemas-personalizados']);
    const disp = await h.anon().get('/api/publico/produtos?disponibilidade=em_desenvolvimento');
    assert.equal(disp.body.total, 3);
    const p1 = await h.anon().get('/api/publico/produtos?limite=2&pagina=1');
    const p2 = await h.anon().get('/api/publico/produtos?limite=2&pagina=2');
    assert.equal(p1.body.pages, 3);
    assert.equal(p1.body.items.length, 2);
    assert.notEqual(p1.body.items[0].id, p2.body.items[0].id);
    const sqlish = await h.anon().get(`/api/publico/produtos?busca=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(sqlish.status, 200);
    assert.equal(sqlish.body.total, 0);
  });

  test('páginas públicas principais respondem e têm SEO básico', async () => {
    for (const path of ['/', '/softwares', '/softwares/churchflow', '/softwares/churchflow/demonstracao', '/softwares/portal-de-noticias', '/softwares/portal-de-noticias/demonstracao', '/servicos', '/contato', '/orcamento', '/sobre', '/politica-de-privacidade', '/perguntas-frequentes', '/robots.txt']) {
      const r = await h.anon().get(path);
      assert.equal(r.status, 200, path);
    }
    const home = await h.anon().get('/');
    assert.match(home.text, /<link rel="canonical"/);
    assert.match(home.text, /og:title/);
    const product = await h.anon().get('/softwares/churchflow');
    assert.match(product.text, /"@type":"SoftwareApplication"/);
    assert.ok(!product.text.includes('"offers"'), 'sem oferta em dados estruturados para produto sem preço/indisponível');
    assert.ok(!product.text.includes('aggregateRating'));
    assert.equal((await h.anon().get('/pagina-que-nao-existe')).status, 404);
  });

  test('conteúdo com HTML malicioso é exibido escapado', async () => {
    await admin.put(`/api/admin/produtos/${produtoId}`, { nome: 'Teste <script>alert(1)</script>', resumo: 'Resumo com <img src=x onerror=alert(1)>' });
    await admin.post(`/api/admin/produtos/${produtoId}/publicar`, {});
    const r = await h.anon().get('/softwares/sistema-de-estoque-agil');
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('<script>alert(1)</script>'));
    assert.ok(!r.text.includes('<img src=x'));
  });

  test('contagem de visualizações agregada', async () => {
    const before = await h.db.one('SELECT coalesce(sum(total),0)::int n FROM visualizacoes_produtos');
    await h.anon().get('/softwares/churchflow').set('User-Agent', 'Mozilla/5.0');
    await h.anon().get('/softwares/churchflow').set('User-Agent', 'Googlebot/2.1');
    await new Promise((r) => setTimeout(r, 100));
    const after = await h.db.one('SELECT coalesce(sum(total),0)::int n FROM visualizacoes_produtos');
    assert.equal(after.n - before.n, 1, 'robôs não são contados');
  });
});
