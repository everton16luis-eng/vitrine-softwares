import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './helpers.js';

const skip = !h.hasTestDatabase() && 'DATABASE_URL_TEST não configurado';
const { runSeeds } = await import('../../backend/src/database/seeder.js');
const { invalidateSettings } = await import('../../backend/src/modules/settings/settings.service.js');

describe('site público: vitrine de serviços e identidade provisória', { skip }, () => {
  before(h.resetDatabase);
  after(h.closeDatabase);

  test('página inicial traz as seções da vitrine e o espaço reservado da logo', async () => {
    const res = await h.anon().get('/');
    assert.equal(res.status, 200);
    for (const id of ['servicos', 'como-trabalhamos', 'projetos', 'sobre', 'contato']) assert.match(res.text, new RegExp(`id="${id}"`));
    assert.match(res.text, /Transformamos ideias em soluções digitais/);
    assert.match(res.text, /class="brand-logo-slot"/);
    assert.match(res.text, /Sua empresa de tecnologia/);
    assert.match(res.text, /data-ajax-form="\/api\/publico\/contato"/);
  });

  test('tema aplica a paleta configurável', async () => {
    const css = await h.anon().get('/theme.css');
    assert.match(css.text, /--brand-navy:#0F172A;--brand-blue:#0EA5E9;--brand-purple:#8B5CF6;/);
  });

  test('seed troca apenas os padrões antigos e preserva edições do painel', async () => {
    await h.db.query(`UPDATE configuracoes SET valor = '"Sua Marca Software"' WHERE chave = 'nome_comercial'`);
    await h.db.query(`UPDATE configuracoes SET valor = '"#2fd8a4"' WHERE chave = 'cor_destaque'`);
    await h.db.query(`UPDATE configuracoes SET valor = '"#123456"' WHERE chave = 'cor_primaria'`);
    await h.db.query(`UPDATE conteudos SET valor = 'Título editado no painel' WHERE chave = 'home.hero.titulo'`);
    await runSeeds({ log: () => {} });
    invalidateSettings();
    const cfg = Object.fromEntries((await h.db.many('SELECT chave, valor FROM configuracoes')).map((r) => [r.chave, r.valor]));
    assert.equal(cfg.nome_comercial, 'Sua empresa de tecnologia');
    assert.equal(cfg.cor_destaque, '#0EA5E9');
    assert.equal(cfg.cor_primaria, '#123456');
    assert.equal((await h.db.one("SELECT valor FROM conteudos WHERE chave = 'home.hero.titulo'")).valor, 'Título editado no painel');
  });
});
