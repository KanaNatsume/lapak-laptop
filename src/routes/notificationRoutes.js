import { Router } from 'express';
import { listNotifications } from '../controllers/notificationController.js';
import { authorize } from '../auth.js';

const router = Router();
router.get('/notifications', authorize('admin', 'kasir', 'teknisi'), listNotifications);
export default router;
