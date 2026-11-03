// API administrativa: /api/admin/* — exige usuário da equipe; cada rota verifica a permissão no servidor.
import { Router } from 'express';
import { requireStaff, requirePermission } from '../middlewares/auth.js';
import { parseId } from '../utils/validation.js';
import { crudRouter } from '../modules/shared/crud.js';
import { productsRouter } from '../modules/products/products.routes.js';
import { categoriesRouter, servicesRouter, plansRouter, mediaRouter } from '../modules/catalog.routes.js';
import * as leads from '../modules/leads/leads.service.js';
import * as customers from '../modules/customers/customers.service.js';
import * as quotes from '../modules/quotes/quotes.service.js';
import * as orders from '../modules/orders/orders.service.js';
import { contractsService, licensesService, CONTRACT_STATUS, LICENSE_STATUS, LICENSE_TYPES } from '../modules/contracts/contracts.service.js';
import * as support from '../modules/support/support.service.js';
import * as content from '../modules/content/content.service.js';
import * as users from '../modules/users/users.service.js';
import * as reports from '../modules/reports/reports.service.js';
import * as settings from '../modules/settings/settings.service.js';
import * as media from '../modules/media/media.service.js';
import { listForSelect as productOptions } from '../modules/products/products.service.js';
import { listPlans } from '../modules/plans/plans.service.js';
import { db } from '../database/pool.js';
import { audit } from '../services/audit.js';
import { notFound } from '../utils/errors.js';
import { renderQuoteDocument } from '../views/quote-document.js';
import { partnersRouter } from '../modules/partners/partners.routes.js';
import { deploymentsRouter } from '../modules/deployments/deployments.routes.js';
import { listRecipesForSelect } from '../modules/deployments/recipes.service.js';

export const adminApi = Router();
adminApi.use(requireStaff);

const sendCsv = (res, name, csv) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
};

// ------------------------------------------------------------- painel
adminApi.get('/dashboard', requirePermission('dashboard.ver'), async (req, res) => res.json(await reports.dashboard()));
adminApi.get('/notificacoes', async (req, res) => res.json(await reports.listNotifications(req.user)));
adminApi.post('/notificacoes/lidas', async (req, res) => {
  await reports.markNotificationsRead(req.user, req.body?.ids ?? null);
  res.json({ ok: true });
});

/** Opções para selects dos formulários (somente dados que o usuário pode ver). */
adminApi.get('/opcoes', async (req, res) => {
  const out = {
    status: { orcamento: quotes.QUOTE_STATUS, pedido: orders.ORDER_STATUS, pagamento: orders.PAYMENT_STATUS, metodos: orders.PAYMENT_METHODS,
      lead: leads.LEAD_STATUS, contrato: CONTRACT_STATUS, licenca: LICENSE_STATUS, tipos_licenca: LICENSE_TYPES, chamado: support.TICKET_STATUS, lgpd: support.LGPD_STATUS }
  };
  const p = req.user.permissions;
  const admin = req.user.roles.includes('administrador');
  const has = (perm) => admin || p.has(perm);
  if (has('produtos.ver') || has('orcamentos.ver') || has('pedidos.ver')) out.produtos = await productOptions();
  if (has('clientes.ver') || has('orcamentos.ver') || has('pedidos.ver') || has('contratos.ver')) out.clientes = await customers.listCustomersForSelect();
  if (has('leads.ver') || has('implantacoes.ver')) out.equipe = await users.listStaffForSelect();
  if (has('implantacoes.ver')) {
    out.receitas = await listRecipesForSelect(db);
    if (!out.clientes) out.clientes = await customers.listCustomersForSelect();
    if (!out.produtos) out.produtos = await productOptions();
  }
  if (has('categorias.ver') || has('produtos.ver')) out.categorias = await db.many('SELECT id, nome, ativa FROM categorias ORDER BY ordem, nome');
  if (has('servicos.ver') || has('orcamentos.ver')) out.servicos = await db.many("SELECT id, nome FROM servicos WHERE status <> 'arquivado' ORDER BY ordem");
  if (has('planos.ver') || has('produtos.ver')) out.planos = (await listPlans({ limite: 100 })).items.map((pl) => ({ id: pl.id, nome: pl.nome, preco: pl.preco, ativo: pl.ativo }));
  res.json(out);
});

// ------------------------------------------------------------- catálogo e mídia
adminApi.use('/produtos', productsRouter);
adminApi.use('/categorias', categoriesRouter);
adminApi.use('/servicos', servicesRouter);
adminApi.use('/planos', plansRouter);
adminApi.use('/midia', mediaRouter);

// ------------------------------------------------------------- conteúdo
const cv = requirePermission('conteudo.ver');
const ce = requirePermission('conteudo.editar');
adminApi.get('/conteudos', cv, async (req, res) => res.json(await content.listContentBlocks()));
adminApi.put('/conteudos', ce, async (req, res) => res.json(await content.updateContentBlocks(req.body?.itens, req)));
adminApi.use('/parceiros', partnersRouter);
adminApi.use('/paginas', crudRouter(content.pagesService, { view: 'conteudo.ver', edit: 'conteudo.editar' }));
adminApi.use('/faqs', crudRouter(content.faqsService, { view: 'conteudo.ver', edit: 'conteudo.editar' }));

// ------------------------------------------------------------- leads
const lv = requirePermission('leads.ver');
const le = requirePermission('leads.editar');
adminApi.get('/leads', lv, async (req, res) => res.json(await leads.listLeads(req.query)));
adminApi.get('/leads/exportar.csv', requirePermission('leads.exportar'), async (req, res) => sendCsv(res, 'leads', await leads.exportLeadsCsv(req.query, req)));
adminApi.get('/leads/:id', lv, async (req, res) => res.json(await leads.getLead(parseId(req.params.id))));
adminApi.put('/leads/:id', le, async (req, res) => res.json(await leads.updateLead(parseId(req.params.id), req.body, req)));
adminApi.post('/leads/:id/interacoes', le, async (req, res) => res.status(201).json(await leads.addInteraction(parseId(req.params.id), req.body, req)));
adminApi.post('/leads/:id/converter', requirePermission('clientes.editar'), async (req, res) => res.json(await leads.convertLead(parseId(req.params.id), req)));

// ------------------------------------------------------------- clientes
const clv = requirePermission('clientes.ver');
const cle = requirePermission('clientes.editar');
adminApi.get('/clientes', clv, async (req, res) => res.json(await customers.listCustomers(req.query)));
adminApi.get('/clientes/exportar.csv', requirePermission('clientes.exportar'), async (req, res) => sendCsv(res, 'clientes', await customers.exportCustomersCsv(req.query, req)));
adminApi.get('/clientes/:id', clv, async (req, res) => res.json(await customers.getCustomer(parseId(req.params.id))));
adminApi.post('/clientes', cle, async (req, res) => res.status(201).json(await customers.createCustomer(req.body, req)));
adminApi.put('/clientes/:id', cle, async (req, res) => res.json(await customers.updateCustomer(parseId(req.params.id), req.body, req)));
adminApi.post('/clientes/:id/acesso', cle, async (req, res) => res.json(await customers.enableAccess(parseId(req.params.id), req)));
adminApi.delete('/clientes/:id/acesso', cle, async (req, res) => res.json(await customers.disableAccess(parseId(req.params.id), req)));
adminApi.post('/clientes/:id/anonimizar', requirePermission('lgpd.editar'), async (req, res) => res.json(await customers.anonymizeCustomer(parseId(req.params.id), req)));
adminApi.get('/clientes/:id/dados-titular', requirePermission('lgpd.ver'), async (req, res) => {
  const data = await customers.exportCustomerData(parseId(req.params.id), req);
  res.setHeader('Content-Disposition', `attachment; filename="dados-titular-${req.params.id}.json"`);
  res.json(data);
});
adminApi.post('/clientes/:id/arquivos', cle, media.uploadMiddleware, async (req, res) => {
  res.status(201).json(await customers.attachFile(parseId(req.params.id), req.file, req.body, req));
});
adminApi.delete('/clientes/:id/arquivos/:linkId', cle, async (req, res) => {
  await customers.detachFile(parseId(req.params.id), parseId(req.params.linkId), req);
  res.status(204).end();
});
adminApi.get('/arquivos-privados/:id', requirePermission('clientes.ver', 'contratos.ver'), async (req, res) => {
  await media.streamPrivateFile(parseId(req.params.id), res);
});

// ------------------------------------------------------------- orçamentos
const qv = requirePermission('orcamentos.ver');
const qe = requirePermission('orcamentos.editar');
adminApi.get('/orcamentos', qv, async (req, res) => res.json(await quotes.listQuotes(req.query)));
adminApi.get('/orcamentos/:id', qv, async (req, res) => res.json(await quotes.getQuote(parseId(req.params.id))));
adminApi.get('/orcamentos/:id/documento', qv, async (req, res) => {
  const quote = await quotes.getQuote(parseId(req.params.id));
  res.type('html').send(renderQuoteDocument(quote, await settings.getSettings()));
});
adminApi.post('/orcamentos', qe, async (req, res) => res.status(201).json(await quotes.createQuote(req.body, req)));
adminApi.put('/orcamentos/:id', qe, async (req, res) => res.json(await quotes.updateQuote(parseId(req.params.id), req.body, req)));
adminApi.post('/orcamentos/:id/status', qe, async (req, res) => res.json(await quotes.changeQuoteStatus(parseId(req.params.id), req.body, req)));
adminApi.post('/orcamentos/:id/gerar-pedido', requirePermission('pedidos.editar'), async (req, res) => {
  res.status(201).json(await quotes.createOrderFromQuote(parseId(req.params.id), req));
});

// ------------------------------------------------------------- pedidos e pagamentos
const ov = requirePermission('pedidos.ver');
const oe = requirePermission('pedidos.editar');
adminApi.get('/pedidos', ov, async (req, res) => res.json(await orders.listOrders(req.query)));
adminApi.get('/pedidos/:id', ov, async (req, res) => res.json(await orders.getOrder(parseId(req.params.id))));
adminApi.post('/pedidos', oe, async (req, res) => res.status(201).json(await orders.createOrder(req.body, req)));
adminApi.put('/pedidos/:id', oe, async (req, res) => res.json(await orders.updateOrder(parseId(req.params.id), req.body, req)));
adminApi.post('/pedidos/:id/status', oe, async (req, res) => res.json(await orders.changeOrderStatus(parseId(req.params.id), req.body, req)));
adminApi.post('/pedidos/:id/pagamentos', requirePermission('pagamentos.registrar'), async (req, res) => {
  res.status(201).json(await orders.registerPayment(parseId(req.params.id), req.body, req));
});
adminApi.post('/pagamentos/:id/:acao', requirePermission('pagamentos.registrar', 'pagamentos.confirmar'), async (req, res) => {
  res.json(await orders.paymentAction(parseId(req.params.id), req.params.acao, req));
});

// ------------------------------------------------------------- contratos e licenças
adminApi.use('/contratos', crudRouter(contractsService, { view: 'contratos.ver', edit: 'contratos.editar', remove: null }));
adminApi.post('/contratos/:id/arquivo', requirePermission('contratos.editar'), media.uploadMiddleware, async (req, res) => {
  const id = parseId(req.params.id);
  const contract = await contractsService.get(id);
  const file = await media.storeUpload(req.file, {}, req, { privado: true, allowDocuments: true });
  await db.query('UPDATE contratos SET arquivo_id = $2 WHERE id = $1', [id, file.id]);
  await audit(req, 'anexar_arquivo', 'contrato', id, { arquivo_id: file.id, numero: contract.numero });
  res.json(await contractsService.get(id));
});
adminApi.use('/licencas', crudRouter(licensesService, { view: 'contratos.ver', edit: 'contratos.editar', remove: null }));

// ------------------------------------------------------------- central de implantação
adminApi.use(deploymentsRouter);

// ------------------------------------------------------------- suporte e LGPD
adminApi.get('/chamados', requirePermission('suporte.ver'), async (req, res) => res.json(await support.listTickets(req.query)));
adminApi.put('/chamados/:id', requirePermission('suporte.editar'), async (req, res) => res.json(await support.answerTicket(parseId(req.params.id), req.body, req)));
adminApi.get('/lgpd', requirePermission('lgpd.ver'), async (req, res) => res.json(await support.listDataRequests(req.query)));
adminApi.put('/lgpd/:id', requirePermission('lgpd.editar'), async (req, res) => res.json(await support.updateDataRequest(parseId(req.params.id), req.body, req)));

// ------------------------------------------------------------- relatórios e auditoria
adminApi.get('/relatorios', requirePermission('relatorios.ver'), (req, res) => res.json(reports.REPORT_TYPES));
adminApi.get('/relatorios/:tipo.csv', requirePermission('relatorios.ver'), async (req, res) => sendCsv(res, `relatorio-${req.params.tipo}`, await reports.reportCsv(req.params.tipo, req.query, req)));
adminApi.get('/relatorios/:tipo', requirePermission('relatorios.ver'), async (req, res) => res.json(await reports.runReport(req.params.tipo, req.query)));
adminApi.get('/auditoria', requirePermission('auditoria.ver'), async (req, res) => res.json(await reports.listAudit(req.query)));

// ------------------------------------------------------------- usuários e perfis
const uv = requirePermission('usuarios.ver');
const ue = requirePermission('usuarios.editar');
adminApi.get('/usuarios', uv, async (req, res) => res.json(await users.listUsers(req.query)));
adminApi.post('/usuarios', ue, async (req, res) => res.status(201).json(await users.createUser(req.body, req)));
adminApi.put('/usuarios/:id', ue, async (req, res) => res.json(await users.updateUser(parseId(req.params.id), req.body, req)));
adminApi.post('/usuarios/:id/redefinir-acesso', ue, async (req, res) => res.json(await users.resetUserAccess(parseId(req.params.id), req)));
adminApi.get('/perfis', uv, async (req, res) => res.json(await users.listRoles()));
adminApi.put('/perfis/:id/permissoes', ue, async (req, res) => res.json(await users.setRolePermissions(parseId(req.params.id), req.body?.permissoes, req)));

// ------------------------------------------------------------- configurações
adminApi.get('/configuracoes', requirePermission('configuracoes.ver'), async (req, res) => {
  res.json({ valores: await settings.getSettings({ fresh: true }), integracoes: settings.integrationStatus() });
});
adminApi.put('/configuracoes', requirePermission('configuracoes.editar'), async (req, res) => {
  res.json({ valores: await settings.updateSettings(req.body, req), integracoes: settings.integrationStatus() });
});
adminApi.get('/modelos-email', requirePermission('configuracoes.ver'), async (req, res) => res.json({ modelos: await content.listEmailTemplates(), registro: await content.emailLog() }));
adminApi.put('/modelos-email/:chave', requirePermission('configuracoes.editar'), async (req, res) => {
  const chave = String(req.params.chave);
  if (!/^[a-z_]{2,60}$/.test(chave)) throw notFound('Modelo de e-mail');
  res.json(await content.updateEmailTemplate(chave, req.body, req));
});
