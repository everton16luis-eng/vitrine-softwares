import crypto from 'node:crypto';
import { createCrud } from '../shared/crud.js';
import { v } from '../../utils/validation.js';
import { ValidationError } from '../../utils/errors.js';
import { nextDocumentNumber } from '../shared/numbering.js';

async function assertCustomer(tx, clienteId, label = 'cliente_id') {
  if (!clienteId) return;
  const c = await tx.one('SELECT id FROM clientes WHERE id = $1 AND anonimizado_em IS NULL', [clienteId]);
  if (!c) throw new ValidationError({ [label]: 'Cliente inválido.' });
}

async function assertBelongs(tx, table, id, clienteId, field) {
  if (!id) return;
  const row = await tx.one(`SELECT cliente_id FROM ${table} WHERE id = $1`, [id]);
  if (!row) throw new ValidationError({ [field]: 'Registro inexistente.' });
  if (clienteId && row.cliente_id !== clienteId) throw new ValidationError({ [field]: 'O registro pertence a outro cliente.' });
}

function checkDates(value, current = {}) {
  const ini = value.data_inicio ?? current.data_inicio;
  const fim = value.data_fim ?? current.data_fim;
  if (ini && fim && fim < ini) throw new ValidationError({ data_fim: 'A data de término deve ser posterior ao início.' });
}

export const CONTRACT_STATUS = { rascunho: 'Rascunho', vigente: 'Vigente', suspenso: 'Suspenso', encerrado: 'Encerrado', cancelado: 'Cancelado' };

export const contractsService = createCrud({
  table: 'contratos',
  entity: 'contrato',
  label: 'Contrato',
  schema: {
    cliente_id: v.id(),
    pedido_id: v.id({ nullable: true }),
    titulo: v.string({ min: 3, max: 200 }),
    status: v.enum(Object.keys(CONTRACT_STATUS), { default: 'rascunho' }),
    data_inicio: v.date({ nullable: true }),
    data_fim: v.date({ nullable: true }),
    valor: v.money({ nullable: true }),
    moeda: v.currency(),
    observacoes: v.text({ max: 5000, nullable: true })
  },
  search: ['numero', 'titulo'],
  filters: { cliente_id: { column: 'cliente_id', rule: v.id({ optional: true }) }, status: { column: 'status', rule: v.enum(Object.keys(CONTRACT_STATUS), { optional: true }) } },
  orderBy: 't.criado_em DESC',
  select: `SELECT t.*, c.nome AS cliente_nome, p.numero AS pedido_numero, a.nome_original AS arquivo_nome
             FROM contratos t JOIN clientes c ON c.id = t.cliente_id LEFT JOIN pedidos p ON p.id = t.pedido_id LEFT JOIN arquivos a ON a.id = t.arquivo_id`,
  async beforeSave(value, { tx, current }) {
    const clienteId = value.cliente_id ?? current?.cliente_id;
    await assertCustomer(tx, value.cliente_id);
    await assertBelongs(tx, 'pedidos', value.pedido_id, clienteId, 'pedido_id');
    checkDates(value, current);
    if (!current) value.numero = await nextDocumentNumber(tx, 'CTR');
  }
});

export const LICENSE_STATUS = { ativa: 'Ativa', suspensa: 'Suspensa', expirada: 'Expirada', revogada: 'Revogada' };
export const LICENSE_TYPES = { perpetua: 'Perpétua', assinatura: 'Assinatura', avaliacao: 'Avaliação', personalizada: 'Personalizada' };

/** Identificador administrativo legível. Não é uma chave de ativação (não há validação remota). */
export const newLicenseIdentifier = () => `LIC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export const licensesService = createCrud({
  table: 'licencas',
  entity: 'licenca',
  label: 'Licença',
  schema: {
    cliente_id: v.id(),
    produto_id: v.id(),
    contrato_id: v.id({ nullable: true }),
    pedido_id: v.id({ nullable: true }),
    tipo: v.enum(Object.keys(LICENSE_TYPES)),
    status: v.enum(Object.keys(LICENSE_STATUS), { default: 'ativa' }),
    data_inicio: v.date(),
    data_fim: v.date({ nullable: true }),
    limites: v.text({ max: 2000, nullable: true }),
    observacoes: v.text({ max: 5000, nullable: true })
  },
  search: ['identificador'],
  filters: { cliente_id: { column: 'cliente_id', rule: v.id({ optional: true }) }, status: { column: 'status', rule: v.enum(Object.keys(LICENSE_STATUS), { optional: true }) } },
  orderBy: 't.criado_em DESC',
  select: `SELECT t.*, c.nome AS cliente_nome, p.nome AS produto_nome, ct.numero AS contrato_numero
             FROM licencas t JOIN clientes c ON c.id = t.cliente_id JOIN produtos p ON p.id = t.produto_id LEFT JOIN contratos ct ON ct.id = t.contrato_id`,
  async beforeSave(value, { tx, current }) {
    const clienteId = value.cliente_id ?? current?.cliente_id;
    await assertCustomer(tx, value.cliente_id);
    if (value.produto_id && !(await tx.one('SELECT id FROM produtos WHERE id = $1', [value.produto_id]))) throw new ValidationError({ produto_id: 'Produto inválido.' });
    await assertBelongs(tx, 'contratos', value.contrato_id, clienteId, 'contrato_id');
    await assertBelongs(tx, 'pedidos', value.pedido_id, clienteId, 'pedido_id');
    checkDates(value, current);
    const tipo = value.tipo ?? current?.tipo;
    const fim = 'data_fim' in value ? value.data_fim : current?.data_fim;
    if (tipo === 'assinatura' && !fim) throw new ValidationError({ data_fim: 'Licenças por assinatura exigem data de término.' });
    if (!current) value.identificador = newLicenseIdentifier();
  }
});
