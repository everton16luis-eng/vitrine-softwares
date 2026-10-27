export const STATUS_COMERCIAL = {
  em_planejamento: 'Em planejamento',
  em_desenvolvimento: 'Em desenvolvimento',
  demonstracao_disponivel: 'Demonstração disponível',
  disponivel: 'Disponível para contratação',
  em_manutencao: 'Em manutenção',
  arquivado: 'Arquivado'
};

export const MODELOS_CONTRATACAO = {
  licenca_perpetua: 'Licença perpétua',
  assinatura: 'Assinatura',
  implantacao: 'Implantação com pagamento único',
  sob_orcamento: 'Sob orçamento',
  personalizado: 'Desenvolvimento personalizado'
};

/** Apenas estes status permitem o botão "Contratar". Os demais exibem "Solicitar orçamento" ou "Tenho interesse". */
export const CONTRATAVEL = new Set(['disponivel']);
