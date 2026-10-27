// Rotas administrativas de categorias, serviços, planos e biblioteca de mídia.
import { Router } from 'express';
import { requirePermission } from '../middlewares/auth.js';
import { parseId } from '../utils/validation.js';
import { crudRouter, reorder } from './shared/crud.js';
import { categoriesService } from './categories/categories.service.js';
import { servicesService } from './services/services.service.js';
import * as plans from './plans/plans.service.js';
import * as media from './media/media.service.js';

export const categoriesRouter = Router();
categoriesRouter.put('/ordem', requirePermission('categorias.editar'), async (req, res) => {
  await reorder('categorias', req.body?.ids, req, 'categoria');
  res.json({ ok: true });
});
categoriesRouter.use(crudRouter(categoriesService, { view: 'categorias.ver', edit: 'categorias.editar' }));

export const servicesRouter = Router();
servicesRouter.put('/ordem', requirePermission('servicos.editar'), async (req, res) => {
  await reorder('servicos', req.body?.ids, req, 'servico');
  res.json({ ok: true });
});
servicesRouter.use(crudRouter(servicesService, { view: 'servicos.ver', edit: 'servicos.editar' }));

export const plansRouter = Router();
const pv = requirePermission('planos.ver');
const pe = requirePermission('planos.editar');
plansRouter.get('/', pv, async (req, res) => res.json(await plans.listPlans(req.query)));
plansRouter.get('/:id', pv, async (req, res) => res.json(await plans.getPlan(parseId(req.params.id))));
plansRouter.post('/', pe, async (req, res) => res.status(201).json(await plans.createPlan(req.body, req)));
plansRouter.put('/:id', pe, async (req, res) => res.json(await plans.updatePlan(parseId(req.params.id), req.body, req)));
plansRouter.delete('/:id', pe, async (req, res) => res.json(await plans.deletePlan(parseId(req.params.id), req)));

export const mediaRouter = Router();
const mv = requirePermission('midia.ver');
const me = requirePermission('midia.editar');
mediaRouter.get('/', mv, async (req, res) => res.json(await media.listFiles(req.query)));
mediaRouter.get('/:id', mv, async (req, res) => res.json(await media.getFile(parseId(req.params.id))));
mediaRouter.post('/', me, media.uploadMiddleware, async (req, res) => {
  res.status(201).json(await media.storeUpload(req.file, req.body, req));
});
mediaRouter.put('/:id', me, async (req, res) => res.json(await media.updateMetadata(parseId(req.params.id), req.body, req)));
mediaRouter.put('/:id/arquivo', me, media.uploadMiddleware, async (req, res) => {
  res.json(await media.replaceFile(parseId(req.params.id), req.file, req));
});
mediaRouter.delete('/:id', me, async (req, res) => {
  await media.deleteFile(parseId(req.params.id), req);
  res.status(204).end();
});
