import { Router } from 'express';
import { authorize } from '../auth.js';
import {
  consumeInventoryUnitSpareParts,
  createInventoryPurchase,
  createInventorySupplier,
  getInventoryPurchaseById,
  listInventoryPurchases,
  listInventorySuppliers,
  listInventoryUnitCosts,
  listInventoryUnitMovements,
  listInventoryUnits,
  recordInventoryUnitRepairCost,
  updateInventoryUnitStatus
} from '../controllers/inventoryController.js';

const router = Router();
router.get('/inventory/units', authorize('admin', 'kasir', 'teknisi'), listInventoryUnits);
router.get('/inventory/units/:id/movements', authorize('admin', 'kasir', 'teknisi'), listInventoryUnitMovements);
router.get('/inventory/units/:id/cost-components', authorize('admin', 'kasir'), listInventoryUnitCosts);
router.patch('/inventory/units/:id/status', authorize('admin', 'kasir', 'teknisi'), updateInventoryUnitStatus);
router.post('/inventory/units/:id/repair-costs', authorize('admin'), recordInventoryUnitRepairCost);
router.post('/inventory/units/:id/spare-parts', authorize('admin'), consumeInventoryUnitSpareParts);
router.get('/inventory/purchases', authorize('admin', 'kasir'), listInventoryPurchases);
router.get('/inventory/purchases/:id', authorize('admin', 'kasir'), getInventoryPurchaseById);
router.post('/inventory/purchases', authorize('admin', 'kasir'), createInventoryPurchase);
router.get('/suppliers', authorize('admin', 'kasir'), listInventorySuppliers);
router.post('/suppliers', authorize('admin', 'kasir'), createInventorySupplier);
export default router;
