// Rotas do Levantamento de Requisitos (/api/admin/requisitos/*). Cada rota exige a permissão
// correspondente no servidor; o painel só esconde botões por usabilidade.
import { Router } from 'express';
import { requirePermission } from '../../middlewares/auth.js';
import { parseId } from '../../utils/validation.js';
import { listStaffForSelect } from '../users/users.service.js';
import { pdfStatus } from '../../services/pdf.js';
import * as bank from './bank.service.js';
import * as clients from './clients.service.js';
import * as surveys from './surveys.service.js';
import * as reports from './reports.service.js';

export const requirementsRouter = Router();
const r = requirementsRouter;

const ver = requirePermission('levantamentos.ver');
const criar = requirePermission('levantamentos.criar');
const editar = requirePermission('levantamentos.editar');
const perguntas = requirePermission('levantamentos.perguntas');
const concluir = requirePermission('levantamentos.concluir');
const pdf = requirePermission('levantamentos.pdf');
const verOuPerguntas = requirePermission('levantamentos.ver', 'levantamentos.perguntas');
const id = (req) => parseId(req.params.id);
const versaoParam = (q) => (q.versao === undefined || q.versao === '' ? null : parseId(q.versao, 'Versão'));

// ------------------------------------------------------------------ referência e visão geral
r.get('/referencia', ver, async (req, res) => {
  res.json({ ...surveys.reference(), equipe: await listStaffForSelect(), ...(await clients.clientOptions()), pdf: await pdfStatus() });
});
r.get('/resumo', ver, async (req, res) => res.json(await surveys.overview()));

// ------------------------------------------------------------------ banco de perguntas
r.get('/roteiro', verOuPerguntas, async (req, res) => res.json(await bank.getBank()));
r.get('/roteiro/questionario.docx', verOuPerguntas, async (req, res) => reports.sendDocx(res, await reports.bankQuestionnaire()));
r.post('/etapas', perguntas, async (req, res) => res.status(201).json(await bank.createStage(req.body, req)));
r.put('/etapas/ordem', perguntas, async (req, res) => res.json(await bank.reorder('etapas', req.body, req)));
r.put('/etapas/:id', perguntas, async (req, res) => res.json(await bank.updateStage(id(req), req.body, req)));
r.delete('/etapas/:id', perguntas, async (req, res) => { await bank.deleteStage(id(req), req); res.status(204).end(); });
r.post('/categorias', perguntas, async (req, res) => res.status(201).json(await bank.createCategory(req.body, req)));
r.put('/categorias/ordem', perguntas, async (req, res) => res.json(await bank.reorder('categorias', req.body, req)));
r.put('/categorias/:id', perguntas, async (req, res) => res.json(await bank.updateCategory(id(req), req.body, req)));
r.delete('/categorias/:id', perguntas, async (req, res) => { await bank.deleteCategory(id(req), req); res.status(204).end(); });
r.post('/perguntas', perguntas, async (req, res) => res.status(201).json(await bank.createQuestion(req.body, req)));
r.put('/perguntas/ordem', perguntas, async (req, res) => res.json(await bank.reorder('perguntas', req.body, req)));
r.put('/perguntas/:id', perguntas, async (req, res) => res.json(await bank.updateQuestion(id(req), req.body, req)));
r.post('/perguntas/:id/duplicar', perguntas, async (req, res) => res.status(201).json(await bank.duplicateQuestion(id(req), req)));
r.delete('/perguntas/:id', perguntas, async (req, res) => { await bank.deleteQuestion(id(req), req); res.status(204).end(); });

// ------------------------------------------------------------------ clientes e projetos
r.get('/clientes', ver, async (req, res) => res.json(await clients.listClients(req.query)));
r.get('/clientes/:id', ver, async (req, res) => res.json(await clients.getClient(id(req))));
r.post('/clientes', criar, async (req, res) => res.status(201).json(await clients.createClient(req.body, req)));
r.put('/clientes/:id', editar, async (req, res) => res.json(await clients.updateClient(id(req), req.body, req)));
r.post('/clientes/:id/projetos', criar, async (req, res) => res.status(201).json(await clients.createProject(id(req), req.body, req)));
r.get('/projetos/:id', ver, async (req, res) => res.json(await clients.getProject(id(req))));
r.put('/projetos/:id', editar, async (req, res) => res.json(await clients.updateProject(id(req), req.body, req)));

// ------------------------------------------------------------------ levantamentos
r.get('/levantamentos', ver, async (req, res) => res.json(await surveys.listSurveys(req.query)));
r.get('/levantamentos/comparar', ver, async (req, res) => res.json(await surveys.compare(req.query.a, req.query.b)));
r.post('/levantamentos', criar, async (req, res) => res.status(201).json(await surveys.createSurvey(req.body, req)));
r.get('/levantamentos/:id', ver, async (req, res) => res.json(await surveys.getSurvey(id(req), { versao: versaoParam(req.query) })));
r.put('/levantamentos/:id', editar, async (req, res) => res.json(await surveys.updateHeader(id(req), req.body, req)));
r.put('/levantamentos/:id/posicao', editar, async (req, res) => res.json(await surveys.savePosition(id(req), req.body)));
r.put('/levantamentos/:id/respostas/:perguntaId', editar, async (req, res) => {
  res.json(await surveys.saveAnswer(id(req), parseId(req.params.perguntaId, 'Pergunta'), req.body, req));
});
r.put('/levantamentos/:id/etapas/:etapaId/nota', editar, async (req, res) => {
  res.json(await surveys.saveStageNote(id(req), parseId(req.params.etapaId, 'Etapa'), req.body, req));
});
r.post('/levantamentos/:id/investigacoes', editar, async (req, res) => res.status(201).json(await surveys.createInvestigation(id(req), req.body, req)));
r.put('/levantamentos/:id/investigacoes/:invId', editar, async (req, res) => {
  res.json(await surveys.updateInvestigation(id(req), parseId(req.params.invId, 'Investigação'), req.body, req));
});
r.delete('/levantamentos/:id/investigacoes/:invId', editar, async (req, res) => {
  await surveys.deleteInvestigation(id(req), parseId(req.params.invId, 'Investigação'), req);
  res.status(204).end();
});
r.put('/levantamentos/:id/consolidacao', editar, async (req, res) => res.json(await surveys.saveConsolidation(id(req), req.body, req)));
r.post('/levantamentos/:id/concluir', concluir, async (req, res) => res.json(await surveys.concludeSurvey(id(req), req)));
r.post('/levantamentos/:id/reabrir', concluir, async (req, res) => res.json(await surveys.reopenSurvey(id(req), req.body, req)));
r.post('/levantamentos/:id/arquivar', editar, async (req, res) => res.json(await surveys.archiveSurvey(id(req), req)));
r.post('/levantamentos/:id/desarquivar', editar, async (req, res) => res.json(await surveys.unarchiveSurvey(id(req), req)));
r.post('/levantamentos/:id/duplicar', criar, async (req, res) => res.status(201).json(await surveys.duplicateSurvey(id(req), req.body, req)));
r.get('/levantamentos/:id/historico', ver, async (req, res) => res.json(await surveys.getHistory(id(req), req.query)));

// ------------------------------------------------------------------ relatórios
r.get('/levantamentos/:id/previa', ver, async (req, res) => res.type('html').send(await reports.previewHtml(id(req), versaoParam(req.query))));
r.get('/levantamentos/:id/questionario.docx', ver, async (req, res) => {
  reports.sendDocx(res, await reports.surveyQuestionnaire(id(req), { versao: versaoParam(req.query), comRespostas: req.query.respostas === '1' }, req));
});
r.get('/levantamentos/:id/relatorios', ver, async (req, res) => res.json(await reports.listReports(id(req))));
r.post('/levantamentos/:id/relatorios', pdf, async (req, res) => {
  const versao = req.body?.versao === undefined || req.body?.versao === null ? null : parseId(req.body.versao, 'Versão');
  res.status(201).json(await reports.generateReport(id(req), { versao }, req));
});
r.get('/levantamentos/:id/relatorios/:relId/arquivo', ver, async (req, res) => {
  await reports.streamReport(id(req), parseId(req.params.relId, 'Relatório'), res, { inline: req.query.inline === '1' });
});
