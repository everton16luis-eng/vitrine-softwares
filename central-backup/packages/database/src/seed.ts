// Perfis e permissões padrão. Idempotente: pode rodar a cada atualização.
// O administrador recebe todas as permissões; os demais perfis só recebem as listadas aqui quando
// são criados (ajustes feitos depois pelo administrador são preservados).
import type { Database } from './pool.ts';

type RoleCode = 'infra_engineer' | 'backup_operator' | 'auditor';
const I: RoleCode = 'infra_engineer', O: RoleCode = 'backup_operator', A: RoleCode = 'auditor';

/** [código, descrição, grupo, perfis padrão]. O admin recebe todas. */
export const PERMISSIONS: [code: string, description: string, group: string, defaults: RoleCode[]][] = [
  ['clientes.ver', 'Consultar clientes', 'clientes', [I, O, A]],
  ['clientes.editar', 'Cadastrar e alterar clientes', 'clientes', []],
  ['servidores.ver', 'Consultar servidores e inventários', 'servidores', [I, O, A]],
  ['servidores.editar', 'Cadastrar e alterar servidores; solicitar inventário', 'servidores', [I]],
  ['agentes.ver', 'Consultar agentes, tarefas e logs', 'agentes', [I, O, A]],
  ['agentes.provisionar', 'Gerar códigos de instalação de agentes', 'agentes', [I]],
  ['agentes.revogar', 'Revogar credenciais de agentes', 'agentes', [I]],
  ['agentes.operar', 'Enviar operações de diagnóstico aos agentes', 'agentes', [I]],
  ['tarefas.cancelar', 'Cancelar tarefas pendentes', 'agentes', [I]],
  ['bancos.ver', 'Consultar bancos de dados', 'bancos', [I, O, A]],
  ['bancos.editar', 'Cadastrar bancos, descobrir e testar conexão', 'bancos', [I]],
  ['segredos.gerenciar', 'Definir e substituir credenciais (nunca exibidas)', 'bancos', [I]],
  ['aplicacoes.ver', 'Consultar aplicações', 'aplicacoes', [I, O, A]],
  ['aplicacoes.editar', 'Cadastrar e alterar aplicações', 'aplicacoes', [I]],
  ['armazenamento.ver', 'Consultar destinos de backup e uso', 'armazenamento', [I, O, A]],
  ['armazenamento.editar', 'Cadastrar e testar destinos de backup', 'armazenamento', []],
  ['backups.ver', 'Consultar políticas, execuções e snapshots', 'backups', [I, O, A]],
  ['backups.editar', 'Criar e alterar políticas e jobs de backup', 'backups', [O]],
  ['backups.executar', 'Executar backup manual, verificar snapshot', 'backups', [I, O]],
  ['backups.reter', 'Aplicar e liberar retenção legal de snapshots', 'backups', []],
  ['restauracoes.solicitar', 'Solicitar restauração (ambiente temporário)', 'restauracoes', [I, O]],
  ['restauracoes.aprovar', 'Aprovar restauração solicitada por outra pessoa', 'restauracoes', [I]],
  ['restaurar.producao', 'Restaurar por cima da produção (com aprovação dupla)', 'restauracoes', [I]],
  ['monitoramento.ver', 'Consultar métricas e gráficos', 'monitoramento', [I, O, A]],
  ['alertas.ver', 'Consultar alertas', 'alertas', [I, O, A]],
  ['alertas.gerenciar', 'Reconhecer/resolver alertas, regras e canais', 'alertas', [I]],
  ['dr.ver', 'Consultar planos e execuções de recuperação de desastre', 'dr', [I, A]],
  ['dr.planejar', 'Gerar planos de recuperação de desastre', 'dr', [I]],
  ['dr.executar', 'Executar recuperação de desastre aprovada', 'dr', [I]],
  ['relatorios.ver', 'Gerar relatórios', 'relatorios', [I, O, A]],
  ['usuarios.gerenciar', 'Gerenciar usuários, perfis e escopo de clientes', 'sistema', []],
  ['auditoria.ver', 'Consultar e verificar a auditoria', 'sistema', [A]],
  ['sistema.ver', 'Consultar o backup e a saúde da própria central', 'sistema', [I, A]],
  ['configuracoes.gerenciar', 'Alterar configurações do sistema', 'sistema', []]
];

export const ROLES: { code: string; name: string; description: string }[] = [
  { code: 'admin', name: 'Administrador', description: 'Acesso total.' },
  { code: 'infra_engineer', name: 'Engenheiro de infraestrutura', description: 'Servidores, agentes, monitoramento e recuperação.' },
  { code: 'backup_operator', name: 'Operador de backup', description: 'Políticas, execuções, consultas e restaurações autorizadas.' },
  { code: 'auditor', name: 'Auditor', description: 'Consulta de históricos, relatórios e auditoria.' }
];

export async function seed(db: Database): Promise<void> {
  await db.owner(async (c) => {
    await c.query('BEGIN');
    try {
      for (const role of ROLES) {
        await c.query('INSERT INTO roles (code, name, description, system) VALUES ($1, $2, $3, true) ON CONFLICT (code) DO NOTHING', [role.code, role.name, role.description]);
      }
      for (const [code, description, grp, defaults] of PERMISSIONS) {
        // permissão nova: concedida aos perfis padrão; existente: só atualiza a descrição (ajustes do admin ficam)
        const created = await c.query('INSERT INTO permissions (code, description, grp) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id', [code, description, grp]);
        if (!created.rowCount) await c.query('UPDATE permissions SET description = $2, grp = $3 WHERE code = $1', [code, description, grp]);
        else if (defaults.length) {
          await c.query('INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, $1 FROM roles r WHERE r.code = ANY($2) ON CONFLICT DO NOTHING', [created.rows[0].id, defaults]);
        }
      }
      await c.query("INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin' ON CONFLICT DO NOTHING");
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  });
}
