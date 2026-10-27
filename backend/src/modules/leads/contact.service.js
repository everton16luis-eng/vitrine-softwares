import { db, withTransaction } from '../../database/pool.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { v, parse } from '../../utils/validation.js';
import { hmac } from '../../utils/common.js';
import { notify } from '../../services/notifications.js';
import { sendTemplateSafe } from '../../services/email.js';
import { getSettings } from '../settings/settings.service.js';
import { nextDocumentNumber } from '../shared/numbering.js';
import { checkFormToken } from './form-token.js';
import { env } from '../../config/env.js';

export const TIPOS_CONTATO = { contato: 'Contato', orcamento: 'Solicitação de orçamento', apresentacao: 'Solicitação de apresentação', personalizado: 'Desenvolvimento personalizado' };

const contactSchema = {
  tipo: v.enum(Object.keys(TIPOS_CONTATO), { default: 'contato' }),
  nome: v.string({ min: 2, max: 160 }),
  email: v.email(),
  telefone: v.phone({ nullable: true }),
  empresa: v.string({ max: 160, nullable: true }),
  produto: v.slug({ nullable: true }),
  servico: v.slug({ nullable: true }),
  assunto: v.string({ max: 200, nullable: true }),
  mensagem: v.text({ min: 10, max: 5000 }),
  consentimento: v.bool(),
  aceita_comunicacoes: v.bool()
};

// Levantamento inicial de requisitos (desenvolvimento personalizado)
const requirementsSchema = {
  segmento: v.string({ max: 120, nullable: true }),
  objetivo: v.text({ max: 2000, nullable: true }),
  usuarios_estimados: v.enum(['ate_10', '11_50', '51_200', 'acima_200', 'nao_sei'], { nullable: true }),
  plataformas: v.array(v.enum(['web', 'mobile', 'desktop', 'api']), { max: 4, optional: true }),
  integracoes: v.text({ max: 1000, nullable: true }),
  prazo: v.enum(['urgente', '1_3_meses', '3_6_meses', 'acima_6_meses', 'flexivel'], { nullable: true }),
  faixa_investimento: v.enum(['ate_10k', '10k_30k', '30k_80k', 'acima_80k', 'a_definir'], { nullable: true }),
  possui_sistema_atual: v.bool()
};

/**
 * Recebe formulário público: valida, aplica proteção anti-spam, grava o contato,
 * vincula/cria o lead e, quando for pedido de orçamento, abre o orçamento.
 */
export async function submitContact(body = {}, { ip } = {}) {
  // Honeypot: campo invisível para humanos. Responde como sucesso sem gravar.
  if (typeof body.website === 'string' && body.website.trim() !== '') return { mensagem: 'Mensagem recebida.', ignorado: true };
  const tokenProblem = checkFormToken(body.form_token);
  if (tokenProblem) {
    const msg = tokenProblem === 'rapido' ? 'Envio muito rápido. Aguarde alguns segundos e tente novamente.' : 'O formulário expirou. Recarregue a página e tente novamente.';
    throw new AppError(msg, { status: 400, code: 'FORM_TOKEN' });
  }

  const input = parse(contactSchema, body);
  if (!input.consentimento) throw new ValidationError({ consentimento: 'É necessário declarar ciência da Política de Privacidade para enviar.' });
  const extras = input.tipo === 'personalizado' ? parse(requirementsSchema, body.requisitos || {}) : {};

  const product = input.produto ? await db.one(
    "SELECT p.id, p.nome FROM produtos p JOIN categorias c ON c.id = p.categoria_id WHERE p.slug = $1 AND p.publicado AND c.ativa", [input.produto]) : null;
  const service = input.servico ? await db.one("SELECT id, nome FROM servicos WHERE slug = $1 AND status = 'publicado'", [input.servico]) : null;
  const ipHash = ip ? hmac(`ip:${ip}`) : null;

  const result = await withTransaction(async (tx) => {
    let lead = await tx.one(
      `SELECT id FROM leads WHERE lower(email) = lower($1) AND status NOT IN ('convertido','encerrado','spam') AND anonimizado_em IS NULL
        ORDER BY criado_em DESC LIMIT 1`, [input.email]);
    if (!lead) {
      const cliente = await tx.one('SELECT id FROM clientes WHERE lower(email) = lower($1) AND anonimizado_em IS NULL', [input.email]);
      lead = await tx.one(
        'INSERT INTO leads (nome, email, telefone, empresa, origem, cliente_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [input.nome, input.email, input.telefone ?? null, input.empresa ?? null, `site:${input.tipo}`, cliente?.id ?? null]);
    } else {
      await tx.query('UPDATE leads SET telefone = coalesce($2, telefone), empresa = coalesce($3, empresa) WHERE id = $1',
        [lead.id, input.telefone ?? null, input.empresa ?? null]);
    }
    const contato = await tx.one(
      `INSERT INTO contatos (lead_id, tipo, nome, email, telefone, empresa, produto_id, servico_id, assunto, mensagem, dados_extras,
                             consentimento_em, aceita_comunicacoes, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12, $13) RETURNING id`,
      [lead.id, input.tipo, input.nome, input.email, input.telefone ?? null, input.empresa ?? null, product?.id ?? null, service?.id ?? null,
        input.assunto ?? null, input.mensagem, JSON.stringify(extras), input.aceita_comunicacoes, ipHash]);
    await tx.query("INSERT INTO lead_interacoes (lead_id, tipo, descricao) VALUES ($1, 'sistema', $2)",
      [lead.id, `${TIPOS_CONTATO[input.tipo]} recebida pelo site${product ? ` (${product.nome})` : ''}${service ? ` (${service.nome})` : ''}.`]);

    let orcamento = null;
    if (input.tipo === 'orcamento' || input.tipo === 'personalizado') {
      const numero = await nextDocumentNumber(tx, 'ORC');
      const cliente = await tx.one('SELECT cliente_id FROM leads WHERE id = $1', [lead.id]);
      const titulo = input.tipo === 'personalizado' ? 'Desenvolvimento personalizado'
        : `Orçamento: ${product?.nome || service?.nome || input.assunto || 'solicitação geral'}`;
      orcamento = await tx.one(
        `INSERT INTO orcamentos (numero, lead_id, cliente_id, contato_id, produto_id, servico_id, titulo, descricao_solicitacao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, numero`,
        [numero, lead.id, cliente?.cliente_id ?? null, contato.id, product?.id ?? null, service?.id ?? null, titulo.slice(0, 200), input.mensagem]);
      await tx.query("INSERT INTO orcamento_historico (orcamento_id, status_novo, descricao) VALUES ($1, 'novo', 'Solicitação recebida pelo site.')", [orcamento.id]);
      await notify({ permissao: 'orcamentos.ver', tipo: 'orcamento', titulo: `Nova solicitação de orçamento ${numero}`, mensagem: `${input.nome} — ${titulo}`, link: `#/orcamentos/${orcamento.id}` }, tx);
    } else {
      await notify({ permissao: 'leads.ver', tipo: 'contato', titulo: `Novo contato: ${input.nome}`, mensagem: input.assunto || TIPOS_CONTATO[input.tipo], link: `#/leads/${lead.id}` }, tx);
    }
    return { leadId: lead.id, contatoId: contato.id, orcamento };
  });

  // E-mails após o commit; falhas de envio não desfazem o registro.
  const settings = await getSettings();
  const vars = { nome: input.nome, empresa_nome: settings.nome_comercial || '', protocolo: result.orcamento?.numero || `CT-${result.contatoId}`,
    assunto: input.assunto || TIPOS_CONTATO[input.tipo], produto: product?.nome || service?.nome || '-', link_admin: `${env.appUrl}/admin` };
  await sendTemplateSafe(result.orcamento ? 'confirmacao_orcamento' : 'confirmacao_contato', input.email, vars);
  if (settings.notificar_email_novos_contatos && settings.email_notificacoes) {
    await sendTemplateSafe(result.orcamento ? 'admin_novo_orcamento' : 'admin_novo_contato', settings.email_notificacoes, { ...vars, email: input.email, mensagem: input.mensagem });
  }
  return {
    mensagem: result.orcamento
      ? `Solicitação registrada com o protocolo ${result.orcamento.numero}. Retornaremos pelo e-mail informado.`
      : 'Mensagem recebida. Retornaremos pelo e-mail informado.',
    protocolo: vars.protocolo
  };
}

const titularSchema = {
  nome: v.string({ min: 2, max: 160 }),
  email: v.email(),
  tipo: v.enum(['acesso', 'correcao', 'exclusao', 'anonimizacao', 'portabilidade', 'revogacao', 'informacao']),
  descricao: v.text({ max: 3000, nullable: true })
};

/** Solicitação de titular de dados (LGPD, art. 18). */
export async function submitDataSubjectRequest(body = {}) {
  if (typeof body.website === 'string' && body.website.trim() !== '') return { mensagem: 'Solicitação recebida.' };
  const tokenProblem = checkFormToken(body.form_token);
  if (tokenProblem) throw new AppError('O formulário expirou ou foi enviado rápido demais. Recarregue e tente novamente.', { status: 400, code: 'FORM_TOKEN' });
  const input = parse(titularSchema, body);
  const row = await db.one('INSERT INTO solicitacoes_titulares (nome, email, tipo, descricao) VALUES ($1,$2,$3,$4) RETURNING id',
    [input.nome, input.email, input.tipo, input.descricao ?? null]);
  await notify({ permissao: 'lgpd.ver', tipo: 'lgpd', titulo: 'Nova solicitação de titular de dados', mensagem: `${input.tipo} — ${input.nome}`, link: '#/lgpd' });
  return { mensagem: `Solicitação registrada (protocolo LGPD-${row.id}). Poderemos solicitar confirmação de identidade antes do atendimento.` };
}
