import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { authorize } from '../auth.js';

const router = Router();
router.get('/settings', authorize('admin', 'kasir', 'teknisi'), getSettings);
router.put('/settings', authorize('admin'), updateSettings);
export default router;