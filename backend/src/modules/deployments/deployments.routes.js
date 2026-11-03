// Rotas administrativas da Central de Implantação (/api/admin/implantacoes, /receitas, /dominios).
import { Router } from 'express';
import { requirePermission } from '../../middlewares/auth.js';
import { parseId } from '../../utils/validation.js';
import { crudRouter } from '../shared/crud.js';
import { db } from '../../database/pool.js';
import { audit } from '../../services/audit.js';
import { recipesService, setRecipeToken, FIELD_TYPES, FIELD_OWNERS, COMMAND_GROUPS, AUTO_TOKENS } from './recipes.service.js';
import * as deployments from './deployments.service.js';
import * as domains from './domains.service.js';
import { ETAPAS, ETAPA_STATUS, DEPLOYMENT_STATUS, TASK_TYPES, PASSO_ROTULO } from './steps.js';
import { ENV_ORIGINS, TECNOLOGIAS, PORT_MIN, PORT_MAX } from './policy.js';
import { renderDeliveryDocument } from './delivery-document.js';
import { getPublicSettings } from '../settings/settings.service.js';

export const deploymentsRouter = Router();

// ------------------------------------------------------------- referência para a interface
deploymentsRouter.get('/implantacoes-referencia', requirePermission('implantacoes.ver', 'implantacoes.receitas'), (req, res) => {
  res.json({ etapas: ETAPAS, etapa_status: ETAPA_STATUS, status: DEPLOYMENT_STATUS, tarefas: TASK_TYPES, passos: PASSO_ROTULO,
    tipos_campo: FIELD_TYPES, responsaveis_campo: FIELD_OWNERS, grupos_comando: COMMAND_GROUPS, origens_variavel: ENV_ORIGINS,
    tecnologias: TECNOLOGIAS, tokens_automaticos: AUTO_TOKENS, dns: domains.DNS_STATUS, ssl: domains.SSL_STATUS, portas: [PORT_MIN, PORT_MAX] });
});

// ------------------------------------------------------------- receitas
deploymentsRouter.use('/receitas', crudRouter(recipesService, { view: 'implantacoes.ver', edit: 'implantacoes.receitas' }));
deploymentsRouter.put('/receitas/:id/token', requirePermission('implantacoes.receitas'), async (req, res) => {
  res.json(await setRecipeToken(db, parseId(req.params.id), req.body?.token, req, audit));
});

// ------------------------------------------------------------- implantações
deploymentsRouter.get('/implantacoes', requirePermission('implantacoes.ver'), async (req, res) => res.json(await deployments.listDeployments(req.query)));
deploymentsRouter.get('/implantacoes/agente', requirePermission('implantacoes.ver'), async (req, res) => res.json(await deployments.agentStatus()));
deploymentsRouter.post('/implantacoes', requirePermission('implantacoes.editar'), async (req, res) => res.status(201).json(await deployments.createDeployment(req.body, req)));
deploymentsRouter.get('/implantacoes/:id', requirePermission('implantacoes.ver'), async (req, res) => res.json(await deployments.getDeployment(parseId(req.params.id))));
deploymentsRouter.put('/implantacoes/:id', requirePermission('implantacoes.editar'), async (req, res) => res.json(await deployments.updateDeployment(parseId(req.params.id), req.body, req)));
deploymentsRouter.put('/implantacoes/:id/dados-cliente', requirePermission('implantacoes.editar'), async (req, res) => {
  res.json(await deployments.updateClientData(parseId(req.params.id), req.body, req));
});
deploymentsRouter.post('/implantacoes/:id/tarefas', requirePermission('implantacoes.executar'), async (req, res) => res.status(201).json(await deployments.enqueueTask(parseId(req.params.id), req.body, req)));
deploymentsRouter.get('/implantacoes/:id/logs', requirePermission('implantacoes.ver'), async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await deployments.listLogs(parseId(req.params.id), req.query));
});
deploymentsRouter.post('/implantacoes/:id/verificar-dns', requirePermission('implantacoes.ver'), async (req, res) => {
  const id = parseId(req.params.id);
  const d = await db.one('SELECT id FROM dominios WHERE implantacao_id = $1', [id]);
  if (!d) return res.status(404).json({ erro: 'Implantação sem domínio cadastrado.' });
  res.json(await domains.verifyDomainById(d.id, req));
});
deploymentsRouter.post('/implantacoes/:id/entregar', requirePermission('implantacoes.executar'), async (req, res) => res.json(await deployments.deliver(parseId(req.params.id), req.body, req)));
deploymentsRouter.post('/implantacoes/:id/cancelar', requirePermission('implantacoes.editar'), async (req, res) => res.json(await deployments.cancelDeployment(parseId(req.params.id), req.body, req)));
deploymentsRouter.get('/implantacoes/:id/resumo', requirePermission('implantacoes.ver'), async (req, res) => {
  const d = await deployments.getDeployment(parseId(req.params.id));
  if (!d.resumo_entrega) return res.status(409).json({ erro: 'A entrega ainda não foi registrada.' });
  res.set('Cache-Control', 'no-store').type('html').send(renderDeliveryDocument(d, await getPublicSettings()));
});

// ------------------------------------------------------------- domínios
deploymentsRouter.get('/dominios', requirePermission('implantacoes.ver'), async (req, res) => res.json(await domains.listDomains(req.query)));
deploymentsRouter.post('/dominios/:id/verificar', requirePermission('implantacoes.ver'), async (req, res) => res.json(await domains.verifyDomainById(parseId(req.params.id), req)));
deploymentsRouter.get('/dominios/:id/instrucoes', requirePermission('implantacoes.ver'), async (req, res) => {
  const d = await db.one('SELECT nome FROM dominios WHERE id = $1', [parseId(req.params.id)]);
  if (!d) return res.status(404).json({ erro: 'Domínio não encontrado.' });
  res.json({ instrucoes: domains.dnsInstructions(d.nome) });
});
