import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { sendTemplateSafe } from '../../services/email.js';
import { v, parse } from '../../utils/validation.js';
import { conflict, forbidden, notFound, ValidationError } from '../../utils/errors.js';
import { pagination, paged, likeTerm } from '../../utils/common.js';
import { createAccessToken, accessLink } from '../auth/auth.service.js';
import { revokeAllSessions } from '../auth/session.service.js';
import { getSettings } from '../settings/settings.service.js';

/** Permissões que nunca podem ser concedidas a perfis diferentes de "administrador". */
export const ADMIN_ONLY_PERMISSIONS = new Set(['usuarios.ver', 'usuarios.editar', 'configuracoes.editar', 'auditoria.ver']);

export async function listUsers(query = {}) {
  const p = pagination(query, { defaultLimit: 50 });
  const params = [];
  const where = ["u.tipo = 'equipe'"];
  if (query.busca) { params.push(likeTerm(query.busca)); where.push(`(u.nome ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  const w = `WHERE ${where.join(' AND ')}`;
  const { total } = await db.one(`SELECT count(*)::int total FROM usuarios u ${w}`, params);
  const rows = await db.many(
    `SELECT u.id, u.nome, u.email, u.ativo, u.ultimo_login_em, u.criado_em, u.senha_hash IS NOT NULL AS senha_definida,
            (u.bloqueado_ate > now()) AS bloqueado,
            coalesce((SELECT json_agg(json_build_object('id', p.id, 'codigo', p.codigo, 'nome', p.nome)) FROM usuarios_perfis up JOIN perfis p ON p.id = up.perfil_id WHERE up.usuario_id = u.id), '[]') AS perfis
       FROM usuarios u ${w} ORDER BY u.nome LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

const userSchema = {
  nome: v.string({ min: 2, max: 160 }),
  email: v.email(),
  perfis: v.array(v.id(), { min: 1, max: 10 }),
  ativo: v.bool({ default: true })
};

async function assertRoles(tx, ids) {
  const rows = await tx.many('SELECT id FROM perfis WHERE id = ANY($1)', [ids]);
  if (rows.length !== new Set(ids).size) throw new ValidationError({ perfis: 'Perfil inválido.' });
}

async function activeAdminCount(tx, exceptUserId) {
  const { n } = await tx.one(
    `SELECT count(DISTINCT u.id)::int n FROM usuarios u JOIN usuarios_perfis up ON up.usuario_id = u.id JOIN perfis p ON p.id = up.perfil_id
      WHERE p.codigo = 'administrador' AND u.ativo AND u.tipo = 'equipe' AND u.id <> $1`, [exceptUserId]);
  return n;
}

export async function createUser(input, req) {
  const value = parse(userSchema, input);
  const { user, token } = await withTransaction(async (tx) => {
    await assertRoles(tx, value.perfis);
    if (await tx.one('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [value.email])) throw conflict('Já existe um usuário com este e-mail.');
    const u = await tx.one("INSERT INTO usuarios (tipo, nome, email, ativo) VALUES ('equipe', $1, $2, $3) RETURNING id, nome, email", [value.nome, value.email, value.ativo]);
    for (const pid of new Set(value.perfis)) await tx.query('INSERT INTO usuarios_perfis (usuario_id, perfil_id) VALUES ($1,$2)', [u.id, pid]);
    const t = await createAccessToken(u.id, 'convite', tx);
    await audit(req, 'criar', 'usuario', u.id, { email: value.email, perfis: value.perfis }, tx);
    return { user: u, token: t };
  });
  return inviteResult(user, token, 'convite');
}

async function inviteResult(user, token, finalidade) {
  const link = accessLink(token, finalidade);
  const settings = await getSettings();
  const mail = await sendTemplateSafe(finalidade === 'convite' ? 'convite_equipe' : 'recuperacao_senha', user.email,
    { nome: user.nome, link, empresa_nome: settings.nome_comercial || '', validade: finalidade === 'convite' ? '72 horas' : '1 hora' });
  return {
    usuario: { id: user.id, nome: user.nome, email: user.email },
    email_enviado: mail.enviado,
    // Mostrado uma única vez quando não há provedor de e-mail configurado.
    link_acesso: mail.enviado ? null : link,
    mensagem: mail.enviado ? 'Link de acesso enviado por e-mail.' : 'E-mail não configurado: copie o link de acesso e envie ao usuário por um canal seguro. Ele expira e só pode ser usado uma vez.'
  };
}

export async function updateUser(id, input, req) {
  const value = parse(userSchema, input, { partial: true });
  await withTransaction(async (tx) => {
    const u = await tx.one("SELECT * FROM usuarios WHERE id = $1 AND tipo = 'equipe' FOR UPDATE", [id]);
    if (!u) throw notFound('Usuário');
    if (value.perfis) await assertRoles(tx, value.perfis);
    const isSelf = id === req.user.id;
    const adminRole = await tx.one("SELECT id FROM perfis WHERE codigo = 'administrador'");
    const losesAdmin = value.perfis && !value.perfis.includes(adminRole.id);
    if (isSelf && (value.ativo === false || losesAdmin)) throw conflict('Você não pode desativar a sua própria conta nem remover o seu próprio perfil de administrador.');
    const wasAdmin = await tx.one('SELECT 1 FROM usuarios_perfis WHERE usuario_id = $1 AND perfil_id = $2', [id, adminRole.id]);
    if (wasAdmin && (value.ativo === false || losesAdmin) && (await activeAdminCount(tx, id)) === 0) {
      throw conflict('É necessário manter ao menos um administrador ativo.');
    }
    const fields = ['nome', 'email', 'ativo'].filter((k) => k in value);
    if (fields.length) await tx.query(`UPDATE usuarios SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...fields.map((k) => value[k])]);
    if (value.perfis) {
      await tx.query('DELETE FROM usuarios_perfis WHERE usuario_id = $1', [id]);
      for (const pid of new Set(value.perfis)) await tx.query('INSERT INTO usuarios_perfis (usuario_id, perfil_id) VALUES ($1,$2)', [id, pid]);
    }
    if (value.ativo === false || value.perfis || value.email) await revokeAllSessions(id, tx); // força novo login com permissões atualizadas
    await audit(req, value.perfis ? 'alterar_permissoes' : 'editar', 'usuario', id, value, tx);
  });
  return (await listUsers({ busca: '' })).items.find((u) => u.id === id);
}

/** Gera novo link de definição de senha (o administrador nunca vê nem define a senha do usuário). */
export async function resetUserAccess(id, req) {
  const user = await db.one("SELECT id, nome, email, ativo FROM usuarios WHERE id = $1 AND tipo = 'equipe'", [id]);
  if (!user) throw notFound('Usuário');
  if (!user.ativo) throw conflict('Ative o usuário antes de redefinir o acesso.');
  const token = await createAccessToken(id, 'redefinir_senha');
  await db.query('UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1', [id]);
  await revokeAllSessions(id);
  await audit(req, 'redefinir_acesso', 'usuario', id);
  return inviteResult(user, token, 'redefinir_senha');
}

export async function listRoles() {
  const roles = await db.many('SELECT * FROM perfis ORDER BY id');
  const perms = await db.many('SELECT pp.perfil_id, p.codigo FROM perfis_permissoes pp JOIN permissoes p ON p.id = pp.permissao_id');
  const all = await db.many('SELECT codigo, descricao, grupo FROM permissoes ORDER BY grupo, codigo');
  return {
    perfis: roles.map((r) => ({ ...r, permissoes: perms.filter((p) => p.perfil_id === r.id).map((p) => p.codigo) })),
    permissoes: all.map((p) => ({ ...p, somente_admin: ADMIN_ONLY_PERMISSIONS.has(p.codigo) }))
  };
}

export async function setRolePermissions(roleId, codes, req) {
  const list = parse({ permissoes: v.array(v.string({ max: 60 }), { max: 200 }) }, { permissoes: codes }).permissoes;
  await withTransaction(async (tx) => {
    const role = await tx.one('SELECT * FROM perfis WHERE id = $1 FOR UPDATE', [roleId]);
    if (!role) throw notFound('Perfil');
    if (role.codigo === 'administrador') throw forbidden('O perfil Administrador sempre possui acesso integral.');
    const blocked = list.filter((c) => ADMIN_ONLY_PERMISSIONS.has(c));
    if (blocked.length) throw forbidden(`Permissões exclusivas do administrador: ${blocked.join(', ')}.`);
    const perms = await tx.many('SELECT id, codigo FROM permissoes WHERE codigo = ANY($1)', [list]);
    if (perms.length !== new Set(list).size) throw new ValidationError({ permissoes: 'Permissão inexistente.' });
    if (role.codigo === 'consulta' && perms.some((p) => !p.codigo.endsWith('.ver'))) {
      throw new ValidationError({ permissoes: 'O perfil Consulta aceita apenas permissões de leitura (.ver).' });
    }
    await tx.query('DELETE FROM perfis_permissoes WHERE perfil_id = $1', [roleId]);
    for (const p of perms) await tx.query('INSERT INTO perfis_permissoes (perfil_id, permissao_id) VALUES ($1,$2)', [roleId, p.id]);
    await audit(req, 'alterar_permissoes', 'perfil', roleId, { permissoes: list }, tx);
  });
  return listRoles();
}

export const listStaffForSelect = () => db.many("SELECT id, nome FROM usuarios WHERE tipo = 'equipe' AND ativo ORDER BY nome");
