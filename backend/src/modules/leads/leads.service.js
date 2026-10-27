import { db, withTransaction } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { v, parse } from '../../utils/validation.js';
import { notFound, conflict } from '../../utils/errors.js';
import { pagination, paged, likeTerm, toCsv } from '../../utils/common.js';

export const LEAD_STATUS = {
  novo: 'Novo', em_atendimento: 'Em atendimento', aguardando_cliente: 'Aguardando cliente',
  qualificado: 'Qualificado', convertido: 'Convertido', encerrado: 'Encerrado', spam: 'Spam'
};

function buildFilters(query) {
  const params = [];
  const where = ['l.anonimizado_em IS NULL'];
  if (query.busca) {
    params.push(likeTerm(query.busca));
    where.push(`(l.nome ILIKE $${params.length} OR l.email ILIKE $${params.length} OR l.empresa ILIKE $${params.length})`);
  }
  if (LEAD_STATUS[query.status]) { params.push(query.status); where.push(`l.status = $${params.length}`); }
  if (query.responsavel_id) { params.push(Number(query.responsavel_id) || 0); where.push(`l.responsavel_id = $${params.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.inicio || '')) { params.push(query.inicio); where.push(`l.criado_em >= $${params.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.fim || '')) { params.push(query.fim); where.push(`l.criado_em < $${params.length}::date + 1`); }
  return { params, where: `WHERE ${where.join(' AND ')}` };
}

export async function listLeads(query = {}) {
  const p = pagination(query);
  const { params, where } = buildFilters(query);
  const { total } = await db.one(`SELECT count(*)::int total FROM leads l ${where}`, params);
  const rows = await db.many(
    `SELECT l.*, u.nome AS responsavel_nome,
            (SELECT count(*)::int FROM contatos c WHERE c.lead_id = l.id) AS total_contatos,
            (SELECT max(c.criado_em) FROM contatos c WHERE c.lead_id = l.id) AS ultimo_contato_em
       FROM leads l LEFT JOIN usuarios u ON u.id = l.responsavel_id ${where}
      ORDER BY l.criado_em DESC LIMIT ${p.limit} OFFSET ${p.offset}`, params);
  return paged(rows, total, p);
}

export async function getLead(id) {
  const lead = await db.one('SELECT l.*, u.nome AS responsavel_nome FROM leads l LEFT JOIN usuarios u ON u.id = l.responsavel_id WHERE l.id = $1', [id]);
  if (!lead) throw notFound('Lead');
  const [contatos, interacoes, orcamentos] = await Promise.all([
    db.many(`SELECT c.*, p.nome AS produto_nome, s.nome AS servico_nome FROM contatos c
               LEFT JOIN produtos p ON p.id = c.produto_id LEFT JOIN servicos s ON s.id = c.servico_id
              WHERE c.lead_id = $1 ORDER BY c.criado_em DESC`, [id]),
    db.many('SELECT i.*, u.nome AS usuario_nome FROM lead_interacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE i.lead_id = $1 ORDER BY i.criado_em DESC', [id]),
    db.many('SELECT id, numero, titulo, status, total, moeda, criado_em FROM orcamentos WHERE lead_id = $1 ORDER BY criado_em DESC', [id])
  ]);
  return { ...lead, contatos: contatos.map(({ ip_hash, ...c }) => c), interacoes, orcamentos };
}

const updateSchema = {
  nome: v.string({ min: 2, max: 160 }),
  telefone: v.phone({ nullable: true }),
  empresa: v.string({ max: 160, nullable: true }),
  status: v.enum(Object.keys(LEAD_STATUS).filter((s) => s !== 'convertido')),
  responsavel_id: v.id({ nullable: true })
};

export async function updateLead(id, input, req) {
  const value = parse(updateSchema, input, { partial: true });
  return withTransaction(async (tx) => {
    const lead = await tx.one('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id]);
    if (!lead) throw notFound('Lead');
    if (value.responsavel_id) {
      const u = await tx.one("SELECT id, nome FROM usuarios WHERE id = $1 AND tipo = 'equipe' AND ativo", [value.responsavel_id]);
      if (!u) throw conflict('Responsável inválido.');
      if (u.id !== lead.responsavel_id) {
        await tx.query("INSERT INTO lead_interacoes (lead_id, usuario_id, tipo, descricao) VALUES ($1,$2,'sistema',$3)", [id, req.user.id, `Responsável definido: ${u.nome}.`]);
      }
    }
    if (value.status && value.status !== lead.status) {
      await tx.query("INSERT INTO lead_interacoes (lead_id, usuario_id, tipo, descricao) VALUES ($1,$2,'status',$3)",
        [id, req.user.id, `Status alterado de "${LEAD_STATUS[lead.status]}" para "${LEAD_STATUS[value.status]}".`]);
    }
    const keys = Object.keys(value);
    if (keys.length) {
      await tx.query(`UPDATE leads SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => value[k])]);
    }
    await audit(req, 'editar', 'lead', id, value, tx);
    return tx.one('SELECT * FROM leads WHERE id = $1', [id]);
  });
}

export async function addInteraction(id, input, req) {
  const value = parse({
    tipo: v.enum(['nota', 'email', 'ligacao', 'reuniao', 'whatsapp'], { default: 'nota' }),
    descricao: v.text({ min: 2, max: 5000 })
  }, input);
  const lead = await db.one('SELECT id FROM leads WHERE id = $1', [id]);
  if (!lead) throw notFound('Lead');
  const row = await db.one('INSERT INTO lead_interacoes (lead_id, usuario_id, tipo, descricao) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, req.user.id, value.tipo, value.descricao]);
  await audit(req, 'registrar_interacao', 'lead', id, { tipo: value.tipo });
  return row;
}

/** Converte lead em cliente (reaproveita cliente existente com o mesmo e-mail). */
export async function convertLead(id, req) {
  return withTransaction(async (tx) => {
    const lead = await tx.one('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id]);
    if (!lead) throw notFound('Lead');
    if (lead.anonimizado_em) throw conflict('Lead anonimizado não pode ser convertido.');
    let cliente = lead.cliente_id ? await tx.one('SELECT * FROM clientes WHERE id = $1', [lead.cliente_id]) : null;
    cliente ||= await tx.one('SELECT * FROM clientes WHERE lower(email) = lower($1) AND anonimizado_em IS NULL', [lead.email]);
    if (!cliente) {
      cliente = await tx.one('INSERT INTO clientes (nome, email, telefone, empresa, origem) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [lead.nome, lead.email, lead.telefone, lead.empresa, 'lead']);
    }
    await tx.query("UPDATE leads SET status = 'convertido', cliente_id = $2 WHERE id = $1", [id, cliente.id]);
    await tx.query('UPDATE orcamentos SET cliente_id = $2 WHERE lead_id = $1 AND cliente_id IS NULL', [id, cliente.id]);
    await tx.query("INSERT INTO lead_interacoes (lead_id, usuario_id, tipo, descricao) VALUES ($1,$2,'conversao',$3)",
      [id, req.user.id, `Lead convertido no cliente #${cliente.id}.`]);
    await audit(req, 'converter', 'lead', id, { cliente_id: cliente.id }, tx);
    return { lead_id: id, cliente };
  });
}

export async function exportLeadsCsv(query, req) {
  const { params, where } = buildFilters(query);
  const rows = await db.many(`SELECT l.*, u.nome AS responsavel_nome FROM leads l LEFT JOIN usuarios u ON u.id = l.responsavel_id ${where} ORDER BY l.criado_em DESC LIMIT 10000`, params);
  await audit(req, 'exportar', 'leads', null, { total: rows.length, filtros: query });
  return toCsv([
    { label: 'ID', key: 'id' }, { label: 'Nome', key: 'nome' }, { label: 'E-mail', key: 'email' }, { label: 'Telefone', key: 'telefone' },
    { label: 'Empresa', key: 'empresa' }, { label: 'Status', value: (r) => LEAD_STATUS[r.status] }, { label: 'Origem', key: 'origem' },
    { label: 'Responsável', key: 'responsavel_nome' }, { label: 'Criado em', value: (r) => new Date(r.criado_em).toISOString() }
  ], rows);
}
