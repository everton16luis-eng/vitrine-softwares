import { badge, money } from '../../shared/ui.js';
import { crudPage } from './_crud.js';

export const TIPOS = [['licenca_perpetua', 'Licença perpétua'], ['assinatura_mensal', 'Assinatura mensal'], ['assinatura_anual', 'Assinatura anual'],
  ['implantacao_unica', 'Implantação (pagamento único)'], ['sob_orcamento', 'Desenvolvimento sob orçamento'], ['personalizado', 'Contratação personalizada']];

export async function render(c, ctx) {
  return crudPage(c, ctx, {
    title: 'Planos e preços', singular: 'plano', needsOptions: true, invalidatesOptions: true, loadOne: true,
    description: 'Modelos comerciais associáveis a um ou mais produtos. Planos "sob orçamento" e "personalizado" dispensam preço.',
    endpoint: '/api/admin/planos', editPerm: 'planos.editar', defaults: { ativo: true, moeda: 'BRL', tipo_cobranca: 'sob_orcamento', funcionalidades: [], produtos: [] },
    deleteMessage: (r) => `Excluir o plano "${r.nome}"? Se houver orçamentos ou pedidos com ele, o plano será apenas desativado para preservar o histórico.`,
    columns: [
      { label: 'Plano', key: 'nome' }, { label: 'Cobrança', render: (r) => TIPOS.find(([k]) => k === r.tipo_cobranca)?.[1] },
      { label: 'Preço', render: (r) => (r.preco ? money(r.preco, r.moeda) : '—') },
      { label: 'Produtos', render: (r) => (r.produtos_nomes || []).join(', ') || '—' },
      { label: 'Situação', render: (r) => badge(r.ativo ? 'Ativo' : 'Inativo', r.ativo ? 'success' : 'secondary') }
    ],
    fields: (f) => [
      { name: 'nome', label: 'Nome', required: true, col: 8 },
      { name: 'ordem', label: 'Ordem', type: 'number', col: 4 },
      { name: 'tipo_cobranca', label: 'Tipo de cobrança', type: 'select', options: TIPOS, required: true, col: 6 },
      { name: 'periodicidade', label: 'Periodicidade', type: 'select', options: [['unica', 'Única'], ['mensal', 'Mensal'], ['anual', 'Anual'], ['nao_aplicavel', 'Não se aplica']], col: 6, placeholder: 'Automática pelo tipo' },
      { name: 'preco', label: 'Preço', type: 'money', col: 6 },
      { name: 'moeda', label: 'Moeda', type: 'select', options: [['BRL', 'Real (BRL)'], ['USD', 'Dólar (USD)'], ['EUR', 'Euro (EUR)']], required: true, col: 6 },
      { name: 'descricao', label: 'Descrição', type: 'textarea' },
      { name: 'funcionalidades', label: 'Funcionalidades incluídas (uma por linha)', type: 'lines' },
      { name: 'limites', label: 'Limites de uso', type: 'textarea', rows: 2, placeholder: 'Ex.: até 5 usuários, 1 unidade' },
      { name: 'produtos', label: 'Produtos associados', type: 'checklist', numeric: true, options: () => (f.opcoes.produtos || []).map((p) => [p.id, p.nome]) },
      { name: 'ativo', label: 'Plano ativo', type: 'checkbox' }
    ]
  });
}
