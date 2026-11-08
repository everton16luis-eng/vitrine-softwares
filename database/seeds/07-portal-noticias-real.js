// Troca o produto de exemplo "Portal de Notícias" pelo sistema real (Portal Regional de Notícias),
// com capturas das telas em funcionamento. Para bancos já instalados: em instalações novas o seed 03
// já grava os dados atuais e nada muda aqui.
// Cada parte só é trocada se ainda estiver EXATAMENTE como o exemplo antigo deixou — textos, itens,
// perguntas, imagens e capa alterados no painel são preservados. Nenhum registro do cliente é apagado:
// só saem as linhas do próprio exemplo (funcionalidades, perguntas e imagens SVG antigas).
import { PRODUCTS } from './03-catalogo.js';

const SLUG = 'portal-de-noticias';
const OLD = {
  nome: 'Portal de Notícias',
  resumo: 'Portal regional de notícias com coleta automatizada de fontes autorizadas, sugestões editoriais por IA, revisão humana obrigatória, publicidade e redes sociais.',
  capa: '/assets/images/produtos/portal-de-noticias-capa.svg',
  funcionalidades: ['Coleta automatizada', 'Deduplicação', 'Sugestões por IA', 'Revisão humana obrigatória', 'Modelos de matéria', 'SEO técnico',
    'Crédito de fonte e autor', 'Publicidade', 'Redes sociais', 'Painel completo'],
  beneficios: ['Menos trabalho manual', 'Controle editorial', 'Receita com anúncios', 'Mais alcance'],
  faqs: ['A IA publica notícias sozinha?', 'Os dados da demonstração são reais?'],
  imagens: ['portal-de-noticias-revisao.svg', 'portal-de-noticias-fontes.svg', 'portal-de-noticias-publicidade.svg'].map((f) => `/assets/images/produtos/${f}`)
};

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function seed(tx) {
  const novo = PRODUCTS.find((p) => p.slug === SLUG);
  const prod = await tx.one('SELECT id, nome, resumo, imagem_url FROM produtos WHERE slug = $1', [SLUG]);
  if (!prod || !novo) return;
  const id = prod.id;

  // Textos principais: só se nome e resumo ainda forem os do exemplo.
  if (prod.nome === OLD.nome && prod.resumo === OLD.resumo) {
    await tx.query(
      `UPDATE produtos SET nome = $2, resumo = $3, descricao = $4, problema_resolvido = $5, publico_alvo = $6, requisitos_tecnicos = $7,
              dados_demonstrativos = false, seo_title = $8, seo_description = $9, atualizado_em = now()
        WHERE id = $1`,
      [id, novo.nome, novo.resumo, novo.descricao, novo.problema, novo.publico, novo.requisitos,
        `${novo.nome} — ${novo.resumo.split(',')[0].slice(0, 50)}`.slice(0, 70), novo.resumo.slice(0, 170)]);
  }

  if (prod.imagem_url === OLD.capa) {
    await tx.query('UPDATE produtos SET imagem_url = $2 WHERE id = $1', [id, `/assets/images/produtos/${novo.capa}`]);
  }

  const titulos = async (tipo) => (await tx.query('SELECT titulo FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = $2 ORDER BY ordem, id', [id, tipo])).rows.map((r) => r.titulo);
  if (sameList(await titulos('funcionalidade'), OLD.funcionalidades)) {
    await tx.query("DELETE FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = 'funcionalidade'", [id]);
    for (const [i, it] of novo.funcionalidades.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, icone, ordem) VALUES ($1,'funcionalidade',$2,$3,$4,$5)", [id, it.titulo, it.descricao, it.icone, i]);
    }
  }
  if (sameList(await titulos('beneficio'), OLD.beneficios)) {
    await tx.query("DELETE FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = 'beneficio'", [id]);
    for (const [i, it] of novo.beneficios.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, ordem) VALUES ($1,'beneficio',$2,$3,$4)", [id, it.titulo, it.descricao, i]);
    }
  }

  const perguntas = (await tx.query('SELECT pergunta FROM produto_faqs WHERE produto_id = $1 ORDER BY ordem, id', [id])).rows.map((r) => r.pergunta);
  if (sameList(perguntas, OLD.faqs)) {
    await tx.query('DELETE FROM produto_faqs WHERE produto_id = $1', [id]);
    for (const [i, [pergunta, resposta]] of novo.faqs.entries()) {
      await tx.query('INSERT INTO produto_faqs (produto_id, pergunta, resposta, ordem) VALUES ($1,$2,$3,$4)', [id, pergunta, resposta, i]);
    }
  }

  // Galeria: remove só as ilustrações SVG do exemplo e acrescenta as capturas que ainda não estão lá.
  // Imagens enviadas pelo painel continuam, depois das capturas.
  const removidas = await tx.query('DELETE FROM produto_imagens WHERE produto_id = $1 AND url_estatica = ANY($2) RETURNING id', [id, OLD.imagens]);
  if (removidas.rowCount) {
    const existentes = new Set((await tx.query('SELECT url_estatica FROM produto_imagens WHERE produto_id = $1 AND url_estatica IS NOT NULL', [id])).rows.map((r) => r.url_estatica));
    await tx.query('UPDATE produto_imagens SET ordem = ordem + $2 WHERE produto_id = $1', [id, novo.imagens.length]);
    for (const [i, [file, legenda]] of novo.imagens.entries()) {
      const url = `/assets/images/produtos/${file}`;
      if (!existentes.has(url)) await tx.query('INSERT INTO produto_imagens (produto_id, url_estatica, legenda, ordem) VALUES ($1,$2,$3,$4)', [id, url, legenda, i]);
    }
  }
}
