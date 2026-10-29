import { Router } from 'express';
import { authorize } from '../auth.js';
import { createCashEntry, deleteCashEntry, listCashEntries, updateCashEntry } from '../controllers/cashController.js';
import { getCashAdvances, postCashAdvance, postCashAdvanceReimbursement } from '../controllers/cashAdvanceController.js';

const router = Router();
router.get('/cash-entries', authorize('admin', 'kasir'), listCashEntries);
router.post('/cash-entries', authorize('admin', 'kasir'), createCashEntry);
router.put('/cash-entries/:id', authorize('admin', 'kasir'), updateCashEntry);
router.delete('/cash-entries/:id', authorize('admin', 'kasir'), deleteCashEntry);
router.get('/cash-advances', authorize('admin', 'kasir'), getCashAdvances);
router.post('/cash-advances', authorize('admin', 'kasir'), postCashAdvance);
router.post('/cash-advances/:id/reimbursements', authorize('admin', 'kasir'), postCashAdvanceReimbursement);
export default router;