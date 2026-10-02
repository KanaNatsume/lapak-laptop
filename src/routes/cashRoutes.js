import { Router } from 'express';
import { authorize } from '../auth.js';
import { createCashEntry, deleteCashEntry, listCashEntries, updateCashEntry } from '../controllers/cashController.js';

const router = Router();
router.use(authorize('admin', 'kasir'));
router.get('/cash-entries', listCashEntries);
router.post('/cash-entries', createCashEntry);
router.put('/cash-entries/:id', updateCashEntry);
router.delete('/cash-entries/:id', deleteCashEntry);
export default router;