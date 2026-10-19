import { Router } from 'express';
import { authorize } from '../auth.js';
import { getFinancialReport } from '../controllers/reportController.js';

const router = Router();
const reportTypes = ['profit-loss', 'balance-sheet', 'cash-flow', 'trial-balance', 'general-ledger', 'inventory', 'unit-profit', 'service-profit', 'receivables', 'payables', 'stock-aging'];
router.get('/reports/:type', authorize('admin'), (request, response, next) => {
  if (!reportTypes.includes(request.params.type)) return response.status(404).json({ error: 'Jenis laporan tidak tersedia' });
  next();
}, getFinancialReport);
export default router;
