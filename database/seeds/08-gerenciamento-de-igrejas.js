// Troca o produto de exemplo "ChurchFlow" pelo sistema real (Gerenciamento de Igrejas), com capturas
// das telas em funcionamento (igreja, pessoas e logo fictícios). Slug "churchflow" mantido para não
// quebrar links. Para bancos já instalados: em instalações novas o seed 03 já grava os dados atuais.
// Regras de preservação em lib/trocar-exemplo.js.
import { PRODUCTS } from './03-catalogo.js';
import { trocarExemplo } from './lib/trocar-exemplo.js';

const OLD = {
  nome: 'ChurchFlow',
  resumo: 'Plataforma para organizar membros, visitantes, voluntários, eventos, escalas de serviço e relatórios de igrejas e instituições.',
  capa: 'churchflow-capa.svg',
  funcionalidades: ['Membros e visitantes', 'Gestão de voluntários', 'Escalas com confirmação', 'Calendário de eventos', 'Usuários e permissões',
    'Relatórios administrativos', 'Área do voluntário', 'Atividades e equipes'],
  beneficios: ['Menos mensagens', 'Escalas equilibradas', 'Histórico organizado', 'Acesso pelo celular'],
  faqs: ['Os dados da demonstração são reais?', 'O sistema já está disponível para contratação?'],
  imagens: ['churchflow-escalas.svg', 'churchflow-membros.svg', 'churchflow-relatorios.svg']
};

export async function seed(tx) {
  await trocarExemplo(tx, PRODUCTS.find((p) => p.slug === 'churchflow'), OLD);
}
