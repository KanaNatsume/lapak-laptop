import { Router } from 'express';
import { createCustomer, listCustomers } from '../controllers/customerController.js';
import { authorize } from '../auth.js';
const router = Router();
router.get('/customers', authorize('admin', 'kasir', 'teknisi'), listCustomers);
router.post('/customers', authorize('admin', 'kasir'), createCustomer);
export default router;