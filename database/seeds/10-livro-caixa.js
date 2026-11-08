// Acrescenta o Livro-Caixa Pessoal (sistema real, com capturas das telas e lançamentos fictícios) em
// bancos já instalados. Reaproveita o seed 03, que só insere o que ainda não existe (categoria "Gestão
// financeira" e o produto "livro-caixa"); nada que já está no banco é alterado ou apagado.
// O plano "Implantação sob orçamento" já existente passa a incluir o produto.
import { seed as catalogo } from './03-catalogo.js';

export async function seed(tx) {
  await catalogo(tx);
  await tx.query(
    `INSERT INTO planos_produtos (plano_id, produto_id)
     SELECT pl.id, p.id FROM planos pl, produtos p WHERE pl.nome = 'Implantação sob orçamento' AND p.slug = 'livro-caixa'
     ON CONFLICT DO NOTHING`);
}
