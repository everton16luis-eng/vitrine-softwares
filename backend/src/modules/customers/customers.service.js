import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { v, parse } from '../../utils/validation.js';
import { notFound, conflict } from '../../utils/errors.js';
import { pagination, paged, likeTerm, toCsv } from '../../utils/common.js';
import { createAccessToken, accessLink } from '../auth/auth.service.js';
import { revokeAllSessions } from '../auth/session.service.js';
import { sendTemplateSafe, isEmailConfigured } from '../../services/email.js';
import { getSettings } from '../settings/settings.service.js';
import { storeUpload } from '../media/media.service.js';
import { storage } from '../../services/storage/index.js';

export const customerSchema = {
  nome: v.string({ min: 2, max: 160 }),
  email: v.email(),
  telefone: v.phone({ nullable: true }),
  empresa: v.string({ max: 160, nullable: true }),
  documento: v.string({ max: 30, pattern: /^[\d./-]+$/, patternMessage: 'Use apenas números e pontuação.', nullable: true }),
  observacoes: v.text({ max: 5000, nullable: true })
};

function filters(query) {
  const params = [];
  const where = ['c.anonimizado_em IS NULL'];
  if (query.busca) {
    params.push(likeTerm(query.busca));
    where.push(`(c.nome ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.empresa ILIKE $${params.length})`);
  }
  return { params, where: `WHERE ${where.join(' AND ')}` };
}

export async function listCustomers(query = {}) {
  const p = pagination(query);
  const { params, where } = filters(query);
  const { total } = await db.one(`SELECT count(*)::int total FROM clientes c ${where}`, params);
  const rows = await db.many(
    `SELECT c.id, c.nome, c.email, c.telefone, c.empresa, c.origem, c.criado_em,
            (SELECT count(*)::int FROM pedidos p WHERE p.cliente_id = c.id) AS total_pedidos,
            (SELECT count(*)::int FROM orcamentos o WHERE o.cliente_id = c.id) AS total_orcamentos,
            EXISTS (SELECT 1 FROM usuarios u WHERE u.cliente_id = c.id AND u.ativo) AS acesso_ativo
       FROM clientes c ${where} ORDER BY c.criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function getCustomer(id) {
  const c = await db.one('SELECT * FROM clientes WHERE id = $1', [id]);
  if (!c) throw notFound('Cliente');
  const [orcamentos, pedidos, contratos, licencas, arquivos, conta, leads, chamados] = await Promise.all([
    db.many('SELECT id, numero, titulo, status, total, moeda, criado_em FROM orcamentos WHERE cliente_id = $1 ORDER BY criado_em DESC', [id]),
    db.many('SELECT id, numero, status, status_pagamento, total, moeda, data_pedido FROM pedidos WHERE cliente_id = $1 ORDER BY criado_em DESC', [id]),
    db.many('SELECT id, numero, titulo, status, data_inicio, data_fim FROM contratos WHERE cliente_id = $1 ORDER BY criado_em DESC', [id]),
    db.many('SELECT l.id, l.identificador, l.tipo, l.status, l.data_inicio, l.data_fim, p.nome AS produto_nome FROM licencas l JOIN produtos p ON p.id = l.produto_id WHERE l.cliente_id = $1 ORDER BY l.criado_em DESC', [id]),
    db.many('SELECT ca.id, ca.titulo, ca.descricao, ca.criado_em, a.id AS arquivo_id, a.nome_original, a.tamanho FROM cliente_arquivos ca JOIN arquivos a ON a.id = ca.arquivo_id WHERE ca.cliente_id = $1 ORDER BY ca.criado_em DESC', [id]),
    db.one('SELECT id, email, ativo, senha_hash IS NOT NULL AS senha_definida, ultimo_login_em FROM usuarios WHERE cliente_id = $1', [id]),
    db.many('SELECT id, status, origem, criado_em FROM leads WHERE cliente_id = $1 ORDER BY criado_em DESC', [id]),
    db.many('SELECT id, assunto, status, criado_em FROM chamados WHERE cliente_id = $1 ORDER BY criado_em DESC', [id])
  ]);
  return { ...c, orcamentos, pedidos, contratos, licencas, arquivos, conta, leads, chamados };
}

export async function createCustomer(input, req) {
  const value = parse(customerSchema, input);
  const row = await db.one(
    'INSERT INTO clientes (nome, email, telefone, empresa, documento, observacoes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [value.nome, value.email, value.telefone ?? null, value.empresa ?? null, value.documento ?? null, value.observacoes ?? null]);
  await audit(req, 'criar', 'cliente', row.id, { nome: value.nome });
  return row;
}

export async function updateCustomer(id, input, req) {
  const value = parse(customerSchema, input, { partial: true });
  const keys = Object.keys(value);
  return withTransaction(async (tx) => {
    const c = await tx.one('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw notFound('Cliente');
    if (c.anonimizado_em) throw conflict('Cliente anonimizado não pode ser editado.');
    if (!keys.length) return c;
    const row = await tx.one(`UPDATE clientes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => value[k])]);
    if (value.email) await tx.query('UPDATE usuarios SET email = $2 WHERE cliente_id = $1', [id, value.email]);
    await audit(req, 'editar', 'cliente', id, { campos: keys }, tx);
    return row;
  });
}

/** Habilita a área do cliente: cria conta (sem senha) e gera convite de uso único. */
export async function enableAccess(id, req) {
  const result = await withTransaction(async (tx) => {
    const c = await tx.one('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw notFound('Cliente');
    if (c.anonimizado_em) throw conflict('Cliente anonimizado.');
    let user = await tx.one('SELECT * FROM usuarios WHERE cliente_id = $1', [id]);
    if (!user) {
      const clash = await tx.one('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [c.email]);
      if (clash) throw conflict('Já existe um usuário com este e-mail.');
      user = await tx.one("INSERT INTO usuarios (tipo, nome, email, cliente_id) VALUES ('cliente', $1, $2, $3) RETURNING *", [c.nome, c.email, id]);
    } else {
      await tx.query('UPDATE usuarios SET ativo = true WHERE id = $1', [user.id]);
    }
    const token = await createAccessToken(user.id, 'convite', tx);
    await audit(req, 'habilitar_acesso', 'cliente', id, {}, tx);
    return { user, link: accessLink(token, 'convite') };
  });
  const settings = await getSettings();
  const mail = await sendTemplateSafe('convite_cliente', result.user.email, { nome: result.user.nome, link: result.link, empresa_nome: settings.nome_comercial || '', validade: '72 horas' });
  return {
    mensagem: mail.enviado ? 'Convite enviado por e-mail.' : 'Acesso habilitado. O e-mail não foi enviado (provedor não configurado): copie o link e envie ao cliente por um canal seguro.',
    email_enviado: mail.enviado,
    // Exibido uma única vez ao administrador quando o e-mail não pôde ser enviado.
    link_convite: mail.enviado ? null : result.link,
    email_configurado: isEmailConfigured()
  };
}

export async function disableAccess(id, req) {
  const user = await db.one('UPDATE usuarios SET ativo = false WHERE cliente_id = $1 RETURNING id', [id]);
  if (!user) throw notFound('Conta de acesso');
  await revokeAllSessions(user.id);
  await audit(req, 'desabilitar_acesso', 'cliente', id);
  return { ok: true };
}

/**
 * Anonimização (LGPD): remove dados pessoais do cliente, de seus leads e contatos.
 * Registros comerciais (pedidos, contratos) são preservados para cumprimento de
 * obrigações legais, mas deixam de identificar o titular.
 */
export async function anonymizeCustomer(id, req) {
  await withTransaction(async (tx) => {
    const c = await tx.one('SELECT * FROM clientes WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw notFound('Cliente');
    if (c.anonimizado_em) throw conflict('Cliente já anonimizado.');
    const anonEmail = `anonimizado-${id}@anonimizado.invalid`;
    const leadIds = (await tx.many('SELECT id FROM leads WHERE cliente_id = $1 OR lower(email) = lower($2)', [id, c.email])).map((r) => r.id);
    await tx.query(
      `UPDATE clientes SET nome = $2, email = $3, telefone = NULL, empresa = NULL, documento = NULL, observacoes = NULL, anonimizado_em = now() WHERE id = $1`,
      [id, `Titular anonimizado #${id}`, anonEmail]);
    if (leadIds.length) {
      await tx.query(`UPDATE leads SET nome = 'Titular anonimizado', email = 'anonimizado-lead-' || id || '@anonimizado.invalid', telefone = NULL, empresa = NULL, anonimizado_em = now() WHERE id = ANY($1)`, [leadIds]);
      await tx.query(`UPDATE contatos SET nome = 'Titular anonimizado', email = 'anonimizado@anonimizado.invalid', telefone = NULL, empresa = NULL,
                      mensagem = '[conteúdo removido por solicitação do titular]', dados_extras = '{}'::jsonb, ip_hash = NULL WHERE lead_id = ANY($1)`, [leadIds]);
      await tx.query("UPDATE lead_interacoes SET descricao = '[removido]' WHERE lead_id = ANY($1) AND tipo IN ('nota','email','ligacao','reuniao','whatsapp')", [leadIds]);
    }
    const user = await tx.one('SELECT id FROM usuarios WHERE cliente_id = $1', [id]);
    if (user) {
      await tx.query("UPDATE usuarios SET ativo = false, nome = 'Titular anonimizado', email = $2, senha_hash = NULL WHERE id = $1", [user.id, `anonimizado-usuario-${user.id}@anonimizado.invalid`]);
      await revokeAllSessions(user.id, tx);
    }
    await audit(req, 'anonimizar', 'cliente', id, { leads: leadIds.length }, tx);
  });
  return { ok: true };
}

/** Relatório dos dados pessoais mantidos sobre o cliente (atendimento ao direito de acesso/portabilidade). */
export async function exportCustomerData(id, req) {
  const data = await getCustomer(id);
  const contatos = await db.many(
    'SELECT tipo, nome, email, telefone, empresa, assunto, mensagem, dados_extras, consentimento_em, aceita_comunicacoes, criado_em FROM contatos WHERE lead_id = ANY($1)',
    [data.leads.map((l) => l.id)]);
  await audit(req, 'exportar_dados_titular', 'cliente', id);
  return { gerado_em: new Date().toISOString(), cliente: { nome: data.nome, email: data.email, telefone: data.telefone, empresa: data.empresa, documento: data.documento, criado_em: data.criado_em },
    contatos, orcamentos: data.orcamentos, pedidos: data.pedidos, contratos: data.contratos, licencas: data.licencas };
}

export async function exportCustomersCsv(query, req) {
  const { params, where } = filters(query);
  const rows = await db.many(`SELECT c.* FROM clientes c ${where} ORDER BY c.criado_em DESC LIMIT 10000`, params);
  await audit(req, 'exportar', 'clientes', null, { total: rows.length });
  return toCsv([
    { label: 'ID', key: 'id' }, { label: 'Nome', key: 'nome' }, { label: 'E-mail', key: 'email' }, { label: 'Telefone', key: 'telefone' },
    { label: 'Empresa', key: 'empresa' }, { label: 'Cadastro', value: (r) => new Date(r.criado_em).toISOString().slice(0, 10) }
  ], rows);
}

/** Anexa arquivo privado (download autorizado) à área do cliente. */
export async function attachFile(id, file, body, req) {
  const c = await db.one('SELECT id FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [id]);
  if (!c) throw notFound('Cliente');
  const meta = parse({ titulo: v.string({ min: 2, max: 200 }), descricao: v.text({ max: 1000, nullable: true }) }, body);
  const arquivo = await storeUpload(file, {}, req, { privado: true, allowDocuments: true });
  const row = await db.one('INSERT INTO cliente_arquivos (cliente_id, arquivo_id, titulo, descricao) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, arquivo.id, meta.titulo, meta.descricao ?? null]);
  await audit(req, 'anexar_arquivo', 'cliente', id, { arquivo_id: arquivo.id });
  return row;
}

export async function detachFile(customerId, linkId, req) {
  const link = await db.one('DELETE FROM cliente_arquivos WHERE id = $1 AND cliente_id = $2 RETURNING arquivo_id', [linkId, customerId]);
  if (!link) throw notFound('Arquivo');
  const file = await db.one('DELETE FROM arquivos WHERE id = $1 AND privado AND NOT EXISTS (SELECT 1 FROM cliente_arquivos WHERE arquivo_id = $1) AND NOT EXISTS (SELECT 1 FROM contratos WHERE arquivo_id = $1) RETURNING chave', [link.arquivo_id]);
  if (file) await storage().remove(file.chave, { privado: true });
  await audit(req, 'remover_arquivo', 'cliente', customerId, { arquivo_id: link.arquivo_id });
}

export const listCustomersForSelect = () => db.many('SELECT id, nome, email, empresa FROM clientes WHERE anonimizado_em IS NULL ORDER BY nome LIMIT 1000');
