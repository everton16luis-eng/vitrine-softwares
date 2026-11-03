// Rotas administrativas de clientes e parceiros (/api/admin/parceiros).
import { Router } from 'express';
import { requirePermission } from '../../middlewares/auth.js';
import { parseId } from '../../utils/validation.js';
import { crudRouter, reorder } from '../shared/crud.js';
import { uploadMiddleware } from '../media/media.service.js';
import { partnersService, uploadLogo, reprocessLogo, reprocessAll, streamOriginal } from './partners.service.js';

export const partnersRouter = Router();
const edit = requirePermission('parceiros.editar');

partnersRouter.put('/ordem', edit, async (req, res) => {
  await reorder('parceiros', req.body?.ids, req, 'parceiro');
  res.json({ ok: true });
});
partnersRouter.post('/reprocessar', edit, async (req, res) => res.json(await reprocessAll(req)));
partnersRouter.post('/:id/logo', edit, uploadMiddleware, async (req, res) => res.json(await uploadLogo(parseId(req.params.id), req.file, req)));
partnersRouter.post('/:id/logo/reprocessar', edit, async (req, res) => res.json(await reprocessLogo(parseId(req.params.id), req)));
partnersRouter.get('/:id/logo/original', requirePermission('parceiros.ver'), async (req, res) => streamOriginal(parseId(req.params.id), res));
partnersRouter.use(crudRouter(partnersService, { view: 'parceiros.ver', edit: 'parceiros.editar' }));
