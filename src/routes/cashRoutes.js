import { Router } from 'express';
import { authorize } from '../auth.js';
import { createCashEntry, deleteCashEntry, listCashEntries, updateCashEntry } from '../controllers/cashController.js';

const router = Router();
router.get('/cash-entries', authorize('admin', 'kasir'), listCashEntries);
router.post('/cash-entries', authorize('admin', 'kasir'), createCashEntry);
router.put('/cash-entries/:id', authorize('admin', 'kasir'), updateCashEntry);
router.delete('/cash-entries/:id', authorize('admin', 'kasir'), deleteCashEntry);
export default router;