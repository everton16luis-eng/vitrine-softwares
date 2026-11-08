// Troca o produto de exemplo "SpaceControl" pelo sistema real (Sistema de Locação de Salas), com capturas
// das telas em funcionamento (salas, clientes e valores fictícios). Slug "spacecontrol" mantido para não
// quebrar links. Para bancos já instalados: em instalações novas o seed 03 já grava os dados atuais.
// Regras de preservação em lib/trocar-exemplo.js.
import { PRODUCTS } from './03-catalogo.js';
import { trocarExemplo } from './lib/trocar-exemplo.js';

const OLD = {
  nome: 'SpaceControl',
  resumo: 'Sistema para controlar reservas de salas e espaços, contratos, checklists de entrega e devolução e o inventário de utensílios.',
  capa: 'spacecontrol-capa.svg',
  funcionalidades: ['Cadastro de espaços', 'Agenda de reservas', 'Cadastro de locatários', 'Gestão de contratos', 'Checklist de entrega e devolução',
    'Inventário de utensílios', 'Danos e avarias', 'Cobranças adicionais', 'Histórico de locações', 'Relatórios financeiros e operacionais'],
  beneficios: ['Agenda sem conflitos', 'Inventário confiável', 'Cobranças justas', 'Contratos padronizados'],
  faqs: ['O sistema emite nota fiscal?'],
  imagens: ['spacecontrol-agenda.svg', 'spacecontrol-checklist.svg', 'spacecontrol-inventario.svg']
};

export async function seed(tx) {
  await trocarExemplo(tx, PRODUCTS.find((p) => p.slug === 'spacecontrol'), OLD);
}
