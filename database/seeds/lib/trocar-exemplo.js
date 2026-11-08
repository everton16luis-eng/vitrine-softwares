// Troca um produto de exemplo do catálogo pelo produto real em bancos já instalados.
// Cada parte só é trocada se ainda estiver EXATAMENTE como o exemplo antigo deixou — textos, itens,
// perguntas, imagens e capa alterados no painel são preservados. Nenhum registro do cliente é apagado:
// só saem as linhas do próprio exemplo (funcionalidades, perguntas e imagens SVG antigas).
// (Esta pasta não é executada pelo seeder: só arquivos "NN-nome.js" na pasta de seeds rodam.)

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const IMG = (f) => `/assets/images/produtos/${f}`;

/**
 * @param tx transação do seeder
 * @param novo produto do catálogo atual (PRODUCTS do seed 03)
 * @param old { nome, resumo, capa, funcionalidades: [títulos], beneficios: [títulos], faqs: [perguntas], imagens: [arquivos] }
 */
export async function trocarExemplo(tx, novo, old) {
  const prod = await tx.one('SELECT id, nome, resumo, imagem_url FROM produtos WHERE slug = $1', [novo.slug]);
  if (!prod) return;
  const { id } = prod;

  // Textos principais (e situação comercial): só se nome e resumo ainda forem os do exemplo.
  if (prod.nome === old.nome && prod.resumo === old.resumo) {
    await tx.query(
      `UPDATE produtos SET nome = $2, resumo = $3, descricao = $4, problema_resolvido = $5, publico_alvo = $6, requisitos_tecnicos = $7,
              dados_demonstrativos = false, status_comercial = $8, seo_title = $9, seo_description = $10, atualizado_em = now()
        WHERE id = $1`,
      [id, novo.nome, novo.resumo, novo.descricao, novo.problema, novo.publico, novo.requisitos, novo.status,
        `${novo.nome} — ${novo.resumo.split(',')[0].slice(0, 50)}`.slice(0, 70), novo.resumo.slice(0, 170)]);
  }

  if (prod.imagem_url === IMG(old.capa)) {
    await tx.query('UPDATE produtos SET imagem_url = $2 WHERE id = $1', [id, IMG(novo.capa)]);
  }

  const titulos = async (tipo) => (await tx.query('SELECT titulo FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = $2 ORDER BY ordem, id', [id, tipo])).rows.map((r) => r.titulo);
  if (sameList(await titulos('funcionalidade'), old.funcionalidades)) {
    await tx.query("DELETE FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = 'funcionalidade'", [id]);
    for (const [i, it] of novo.funcionalidades.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, icone, ordem) VALUES ($1,'funcionalidade',$2,$3,$4,$5)", [id, it.titulo, it.descricao, it.icone, i]);
    }
  }
  if (sameList(await titulos('beneficio'), old.beneficios)) {
    await tx.query("DELETE FROM produto_funcionalidades WHERE produto_id = $1 AND tipo = 'beneficio'", [id]);
    for (const [i, it] of novo.beneficios.entries()) {
      await tx.query("INSERT INTO produto_funcionalidades (produto_id, tipo, titulo, descricao, ordem) VALUES ($1,'beneficio',$2,$3,$4)", [id, it.titulo, it.descricao, i]);
    }
  }

  const perguntas = (await tx.query('SELECT pergunta FROM produto_faqs WHERE produto_id = $1 ORDER BY ordem, id', [id])).rows.map((r) => r.pergunta);
  if (sameList(perguntas, old.faqs)) {
    await tx.query('DELETE FROM produto_faqs WHERE produto_id = $1', [id]);
    for (const [i, [pergunta, resposta]] of novo.faqs.entries()) {
      await tx.query('INSERT INTO produto_faqs (produto_id, pergunta, resposta, ordem) VALUES ($1,$2,$3,$4)', [id, pergunta, resposta, i]);
    }
  }

  // Galeria: remove só as ilustrações do exemplo e acrescenta as capturas que ainda não estão lá.
  // Imagens enviadas pelo painel continuam, depois das capturas.
  const removidas = await tx.query('DELETE FROM produto_imagens WHERE produto_id = $1 AND url_estatica = ANY($2) RETURNING id', [id, old.imagens.map(IMG)]);
  if (removidas.rowCount) {
    const existentes = new Set((await tx.query('SELECT url_estatica FROM produto_imagens WHERE produto_id = $1 AND url_estatica IS NOT NULL', [id])).rows.map((r) => r.url_estatica));
    await tx.query('UPDATE produto_imagens SET ordem = ordem + $2 WHERE produto_id = $1', [id, novo.imagens.length]);
    for (const [i, [file, legenda]] of novo.imagens.entries()) {
      if (!existentes.has(IMG(file))) await tx.query('INSERT INTO produto_imagens (produto_id, url_estatica, legenda, ordem) VALUES ($1,$2,$3,$4)', [id, IMG(file), legenda, i]);
    }
  }
}
