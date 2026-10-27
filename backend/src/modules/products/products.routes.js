import { Router } from 'express';
import { requirePermission } from '../../middlewares/auth.js';
import { parseId } from '../../utils/validation.js';
import { badRequest } from '../../utils/errors.js';
import { reorder } from '../shared/crud.js';
import * as products from './products.service.js';
import { STATUS_COMERCIAL, MODELOS_CONTRATACAO } from './products.constants.js';

export const productsRouter = Router();
const view = requirePermission('produtos.ver');
const edit = requirePermission('produtos.editar');
const publish = requirePermission('produtos.publicar');
const CHILD_KINDS = ['funcionalidades', 'imagens', 'faqs'];

const kind = (req) => {
  if (!CHILD_KINDS.includes(req.params.kind)) throw badRequest('Tipo de item inválido.');
  return req.params.kind;
};

productsRouter.get('/opcoes', view, async (req, res) => {
  res.json({ status: STATUS_COMERCIAL, modelos: MODELOS_CONTRATACAO, produtos: await products.listForSelect() });
});
productsRouter.get('/', view, async (req, res) => res.json(await products.adminList(req.query)));
productsRouter.put('/ordem', edit, async (req, res) => {
  await reorder('produtos', req.body?.ids, req, 'produto');
  res.json({ ok: true });
});
productsRouter.get('/:id', view, async (req, res) => res.json(await products.getProduct(parseId(req.params.id))));
productsRouter.post('/', edit, async (req, res) => res.status(201).json(await products.createProduct(req.body, req)));
productsRouter.put('/:id', edit, async (req, res) => res.json(await products.updateProduct(parseId(req.params.id), req.body, req)));
productsRouter.delete('/:id', edit, async (req, res) => {
  await products.deleteProduct(parseId(req.params.id), req);
  res.status(204).end();
});
productsRouter.post('/:id/publicar', publish, async (req, res) => res.json(await products.setPublished(parseId(req.params.id), true, req)));
productsRouter.post('/:id/despublicar', publish, async (req, res) => res.json(await products.setPublished(parseId(req.params.id), false, req)));
productsRouter.post('/:id/arquivar', publish, async (req, res) => res.json(await products.archiveProduct(parseId(req.params.id), req)));
productsRouter.post('/:id/restaurar', publish, async (req, res) => res.json(await products.restoreProduct(parseId(req.params.id), req)));
productsRouter.put('/:id/planos', edit, async (req, res) => res.json(await products.setProductPlans(parseId(req.params.id), req.body?.planos, req)));

productsRouter.post('/:id/:kind', edit, async (req, res) => {
  res.status(201).json(await products.addChild(kind(req), parseId(req.params.id), req.body, req));
});
productsRouter.put('/:id/:kind/:childId', edit, async (req, res) => {
  res.json(await products.updateChild(kind(req), parseId(req.params.id), parseId(req.params.childId), req.body, req));
});
productsRouter.delete('/:id/:kind/:childId', edit, async (req, res) => {
  await products.deleteChild(kind(req), parseId(req.params.id), parseId(req.params.childId), req);
  res.status(204).end();
});
