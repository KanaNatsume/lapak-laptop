import { Router } from 'express';
import { authorize } from '../auth.js';
import {
  createFreightActual,
  getFreightFulfillmentById,
  getFreightPrepaidBalance,
  listFreightFulfillments,
  payFreightFulfillment,
  topUpFreightBalance
} from '../controllers/freightController.js';

const router = Router();
router.get('/freight/fulfillments', authorize('admin', 'kasir'), listFreightFulfillments);
router.get('/freight/fulfillments/:id', authorize('admin', 'kasir'), getFreightFulfillmentById);
router.post('/transactions/:id/freight/actual', authorize('admin', 'kasir'), createFreightActual);
router.post('/freight/fulfillments/:id/payments', authorize('admin', 'kasir'), payFreightFulfillment);
router.get('/freight/prepaid-balance', authorize('admin', 'kasir'), getFreightPrepaidBalance);
router.post('/freight/prepaid-topups', authorize('admin', 'kasir'), topUpFreightBalance);
export default router;
