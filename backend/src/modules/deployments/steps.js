// Catálogo das etapas (visão do cliente/equipe) e dos passos técnicos (executados pelo agente).

export const ETAPAS = {
  1: 'Contratação',
  2: 'Informações do cliente',
  3: 'Preparação da infraestrutura',
  4: 'Instalação',
  5: 'Personalização',
  6: 'Testes e validação',
  7: 'Entrega'
};

export const ETAPA_STATUS = {
  pendente: 'Pendente', em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando informações do cliente',
  aguardando_tecnico: 'Aguardando ação técnica', concluida: 'Concluída', falhou: 'Falhou'
};

export const DEPLOYMENT_STATUS = {
  em_preparacao: 'Em preparação', aguardando_cliente: 'Aguardando cliente', pronta_para_instalar: 'Pronta para instalar',
  em_execucao: 'Em execução', aguardando_tecnico: 'Aguardando ação técnica', falhou: 'Falhou', em_validacao: 'Em validação',
  pronta_para_entrega: 'Pronta para entrega', entregue: 'Entregue', cancelada: 'Cancelada'
};

export const TASK_TYPES = { instalar: 'Instalar / continuar', reexecutar: 'Reexecutar passo', personalizar: 'Aplicar personalização', testar: 'Executar testes' };

/**
 * Passos na ordem de execução. `when(receita)` decide se o passo se aplica.
 * Todos são idempotentes: podem ser repetidos com segurança na retomada.
 */
export const PASSOS = [
  { passo: 'verificar_requisitos', etapa: 3, rotulo: 'Verificar requisitos do servidor' },
  { passo: 'criar_usuario', etapa: 3, rotulo: 'Criar usuário isolado da instalação' },
  { passo: 'preparar_diretorios', etapa: 3, rotulo: 'Criar diretórios exclusivos' },
  { passo: 'obter_codigo', etapa: 4, rotulo: 'Obter os arquivos do sistema' },
  { passo: 'criar_banco', etapa: 4, rotulo: 'Criar banco de dados e usuário exclusivo', when: (r) => r.requer_banco },
  { passo: 'gravar_env', etapa: 4, rotulo: 'Configurar variáveis de ambiente' },
  { passo: 'instalar_dependencias', etapa: 4, rotulo: 'Instalar dependências' },
  { passo: 'build', etapa: 4, rotulo: 'Executar build', when: (r) => r.comandos?.build?.length },
  { passo: 'ativar_versao', etapa: 4, rotulo: 'Ativar a versão instalada' },
  { passo: 'backup_banco', etapa: 4, rotulo: 'Backup do banco antes das migrations', when: (r) => r.requer_banco },
  { passo: 'migracoes', etapa: 4, rotulo: 'Executar migrations', when: (r) => r.comandos?.migracoes?.length },
  { passo: 'seed', etapa: 4, rotulo: 'Carregar dados iniciais', when: (r) => r.comandos?.seed?.length },
  { passo: 'instalar_servico', etapa: 4, rotulo: 'Configurar o serviço da aplicação' },
  { passo: 'iniciar_aplicacao', etapa: 4, rotulo: 'Iniciar a aplicação' },
  { passo: 'configurar_nginx', etapa: 4, rotulo: 'Configurar o proxy reverso (Nginx)' },
  { passo: 'verificar_dns', etapa: 4, rotulo: 'Verificar o apontamento do domínio' },
  { passo: 'emitir_ssl', etapa: 4, rotulo: 'Emitir certificado SSL' },
  { passo: 'ativar_https', etapa: 4, rotulo: 'Ativar HTTPS no domínio' },
  { passo: 'personalizar', etapa: 5, rotulo: 'Aplicar dados e identidade do cliente' },
  { passo: 'testes', etapa: 6, rotulo: 'Executar verificações automáticas' }
];

export const PASSO_ROTULO = Object.fromEntries(PASSOS.map((p) => [p.passo, p.rotulo]));

export function stepsFor(receita) {
  return PASSOS.filter((p) => !p.when || p.when(receita)).map((p, i) => ({ ...p, ordem: (i + 1) * 10 }));
}
