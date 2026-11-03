// Perfis e permissões. Idempotente: permissões novas são adicionadas; as
// associações padrão só são aplicadas quando o perfil é criado pela primeira vez.

export const PERMISSIONS = [
  ['dashboard.ver', 'Ver painel e indicadores', 'painel'],
  ['produtos.ver', 'Consultar produtos', 'catalogo'],
  ['produtos.editar', 'Cadastrar e editar produtos', 'catalogo'],
  ['produtos.publicar', 'Publicar, despublicar e arquivar produtos', 'catalogo'],
  ['categorias.ver', 'Consultar categorias', 'catalogo'],
  ['categorias.editar', 'Gerenciar categorias', 'catalogo'],
  ['servicos.ver', 'Consultar serviços', 'catalogo'],
  ['servicos.editar', 'Gerenciar serviços', 'catalogo'],
  ['planos.ver', 'Consultar planos e preços', 'catalogo'],
  ['planos.editar', 'Gerenciar planos e preços', 'catalogo'],
  ['midia.ver', 'Consultar biblioteca de mídia', 'conteudo'],
  ['midia.editar', 'Enviar e gerenciar arquivos', 'conteudo'],
  ['conteudo.ver', 'Consultar conteúdo do site', 'conteudo'],
  ['conteudo.editar', 'Editar páginas, textos e perguntas', 'conteudo'],
  ['leads.ver', 'Consultar contatos e leads', 'comercial'],
  ['leads.editar', 'Atender e atualizar leads', 'comercial'],
  ['leads.exportar', 'Exportar leads', 'comercial'],
  ['clientes.ver', 'Consultar clientes', 'comercial'],
  ['clientes.editar', 'Gerenciar clientes e acessos', 'comercial'],
  ['clientes.exportar', 'Exportar clientes', 'comercial'],
  ['orcamentos.ver', 'Consultar orçamentos', 'comercial'],
  ['orcamentos.editar', 'Elaborar e atualizar orçamentos', 'comercial'],
  ['pedidos.ver', 'Consultar pedidos', 'comercial'],
  ['pedidos.editar', 'Criar e atualizar pedidos', 'comercial'],
  ['pedidos.autorizar_desconto', 'Autorizar descontos em pedidos', 'comercial'],
  ['pagamentos.registrar', 'Registrar pagamentos manuais', 'comercial'],
  ['pagamentos.confirmar', 'Confirmar e estornar pagamentos', 'comercial'],
  ['contratos.ver', 'Consultar contratos e licenças', 'comercial'],
  ['contratos.editar', 'Gerenciar contratos e licenças', 'comercial'],
  ['suporte.ver', 'Consultar chamados de clientes', 'comercial'],
  ['suporte.editar', 'Responder chamados', 'comercial'],
  ['relatorios.ver', 'Ver e exportar relatórios', 'gestao'],
  ['lgpd.ver', 'Consultar solicitações de titulares', 'gestao'],
  ['lgpd.editar', 'Atender solicitações e anonimizar dados', 'gestao'],
  ['configuracoes.ver', 'Consultar configurações', 'sistema'],
  ['configuracoes.editar', 'Alterar configurações', 'sistema'],
  ['usuarios.ver', 'Consultar usuários e perfis', 'sistema'],
  ['usuarios.editar', 'Gerenciar usuários e permissões', 'sistema'],
  ['auditoria.ver', 'Consultar auditoria', 'sistema'],
  ['implantacoes.ver', 'Consultar implantações, domínios e logs', 'implantacao'],
  ['implantacoes.editar', 'Criar implantações e registrar informações do cliente', 'implantacao'],
  ['implantacoes.executar', 'Iniciar, retomar e testar instalações no servidor', 'implantacao'],
  ['implantacoes.receitas', 'Configurar receitas de implantação dos softwares', 'implantacao'],
  ['implantacoes.segredos', 'Definir credenciais sigilosas das instalações', 'implantacao']
];

const ROLES = [
  { codigo: 'administrador', nome: 'Administrador', descricao: 'Acesso integral ao sistema.', perms: '*' },
  {
    codigo: 'gerente_comercial', nome: 'Gerente comercial', descricao: 'Produtos, clientes, leads, orçamentos, pedidos, contratos e relatórios.',
    perms: ['dashboard.ver', 'produtos.ver', 'produtos.editar', 'produtos.publicar', 'categorias.ver', 'servicos.ver', 'planos.ver', 'planos.editar',
      'midia.ver', 'leads.ver', 'leads.editar', 'leads.exportar', 'clientes.ver', 'clientes.editar', 'clientes.exportar', 'orcamentos.ver',
      'orcamentos.editar', 'pedidos.ver', 'pedidos.editar', 'pedidos.autorizar_desconto', 'pagamentos.registrar', 'pagamentos.confirmar',
      'contratos.ver', 'contratos.editar', 'suporte.ver', 'suporte.editar', 'relatorios.ver', 'lgpd.ver']
  },
  {
    codigo: 'editor_conteudo', nome: 'Editor de conteúdo', descricao: 'Páginas, imagens, categorias, serviços e conteúdo do site.',
    perms: ['dashboard.ver', 'produtos.ver', 'categorias.ver', 'categorias.editar', 'servicos.ver', 'servicos.editar', 'midia.ver', 'midia.editar',
      'conteudo.ver', 'conteudo.editar']
  },
  {
    codigo: 'consulta', nome: 'Consulta', descricao: 'Somente leitura das áreas expressamente autorizadas pelo administrador.',
    perms: ['dashboard.ver', 'produtos.ver', 'categorias.ver', 'servicos.ver']
  }
];

export async function seed(tx) {
  for (const [codigo, descricao, grupo] of PERMISSIONS) {
    await tx.query('INSERT INTO permissoes (codigo, descricao, grupo) VALUES ($1,$2,$3) ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, grupo = EXCLUDED.grupo',
      [codigo, descricao, grupo]);
  }
  for (const role of ROLES) {
    const created = await tx.one(
      'INSERT INTO perfis (codigo, nome, descricao, sistema) VALUES ($1,$2,$3,true) ON CONFLICT (codigo) DO NOTHING RETURNING id', [role.codigo, role.nome, role.descricao]);
    const roleId = created?.id ?? (await tx.one('SELECT id FROM perfis WHERE codigo = $1', [role.codigo])).id;
    // Administrador: sempre recebe todas as permissões (inclusive as novas).
    if (role.perms === '*') {
      await tx.query('INSERT INTO perfis_permissoes (perfil_id, permissao_id) SELECT $1, id FROM permissoes ON CONFLICT DO NOTHING', [roleId]);
    } else if (created) {
      await tx.query('INSERT INTO perfis_permissoes (perfil_id, permissao_id) SELECT $1, id FROM permissoes WHERE codigo = ANY($2) ON CONFLICT DO NOTHING', [roleId, role.perms]);
    }
  }
}
