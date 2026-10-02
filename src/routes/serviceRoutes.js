import { Router } from 'express';
import { createService, listServices, updateServiceStatus } from '../controllers/serviceController.js';
import { authorize } from '../auth.js';
const router = Router();
router.get('/services', authorize('admin', 'kasir', 'teknisi'), listServices);
router.post('/services', authorize('admin', 'kasir'), createService);
router.patch('/services/:id/status', authorize('admin', 'teknisi'), updateServiceStatus);
export default router;