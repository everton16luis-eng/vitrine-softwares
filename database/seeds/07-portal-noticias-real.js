// Troca o produto de exemplo "Portal de Notícias" pelo sistema real (Portal Regional de Notícias),
// com capturas das telas em funcionamento. Para bancos já instalados: em instalações novas o seed 03
// já grava os dados atuais e nada muda aqui. Regras de preservação em lib/trocar-exemplo.js.
import { PRODUCTS } from './03-catalogo.js';
import { trocarExemplo } from './lib/trocar-exemplo.js';

const OLD = {
  nome: 'Portal de Notícias',
  resumo: 'Portal regional de notícias com coleta automatizada de fontes autorizadas, sugestões editoriais por IA, revisão humana obrigatória, publicidade e redes sociais.',
  capa: 'portal-de-noticias-capa.svg',
  funcionalidades: ['Coleta automatizada', 'Deduplicação', 'Sugestões por IA', 'Revisão humana obrigatória', 'Modelos de matéria', 'SEO técnico',
    'Crédito de fonte e autor', 'Publicidade', 'Redes sociais', 'Painel completo'],
  beneficios: ['Menos trabalho manual', 'Controle editorial', 'Receita com anúncios', 'Mais alcance'],
  faqs: ['A IA publica notícias sozinha?', 'Os dados da demonstração são reais?'],
  imagens: ['portal-de-noticias-revisao.svg', 'portal-de-noticias-fontes.svg', 'portal-de-noticias-publicidade.svg']
};

export async function seed(tx) {
  await trocarExemplo(tx, PRODUCTS.find((p) => p.slug === 'portal-de-noticias'), OLD);
}
