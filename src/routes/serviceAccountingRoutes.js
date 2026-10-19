import { Router } from 'express';
import { authorize } from '../auth.js';
import {
  assignServiceTechnicianRoute,
  assignUnitRepairTechnicianRoute,
  createExternalTechnicianRoute,
  createServiceTechnicianBillRoute,
  createUnitRepairWorkOrder,
  listExternalTechnicianRoute,
  listServicePartUsages,
  listServiceTechnicianAssignments,
  listUnitRepairWorkOrders,
  payServiceTechnicianBillRoute,
  recordUnitRepairWorkOrderCost,
  recordServicePartUsageRoute,
  recordUnitRepairPartUsageRoute,
  updateUnitRepairWorkOrder
} from '../controllers/serviceAccountingController.js';

const router = Router();
router.get('/inventory/repair-work-orders', authorize('admin', 'kasir', 'teknisi'), listUnitRepairWorkOrders);
router.post('/inventory/units/:id/repair-work-orders', authorize('admin', 'teknisi'), createUnitRepairWorkOrder);
router.patch('/inventory/repair-work-orders/:id', authorize('admin', 'teknisi'), updateUnitRepairWorkOrder);
router.post('/inventory/repair-work-orders/:id/costs', authorize('admin'), recordUnitRepairWorkOrderCost);
router.post('/inventory/repair-work-orders/:id/technician-assignments', authorize('admin', 'teknisi'), assignUnitRepairTechnicianRoute);
router.post('/inventory/repair-work-orders/:id/part-usages', authorize('admin'), recordUnitRepairPartUsageRoute);
router.get('/services/:id/part-usages', authorize('admin', 'kasir', 'teknisi'), listServicePartUsages);
router.get('/services/:id/technician-assignments', authorize('admin', 'teknisi'), listServiceTechnicianAssignments);
router.post('/services/:id/technician-assignments', authorize('admin', 'teknisi'), assignServiceTechnicianRoute);
router.post('/services/:id/part-usages', authorize('admin', 'teknisi'), recordServicePartUsageRoute);
router.get('/external-technicians', authorize('admin', 'kasir', 'teknisi'), listExternalTechnicianRoute);
router.post('/external-technicians', authorize('admin'), createExternalTechnicianRoute);
router.post('/service-technician-assignments/:id/bills', authorize('admin'), createServiceTechnicianBillRoute);
router.post('/service-technician-bills/:id/payments', authorize('admin'), payServiceTechnicianBillRoute);
export default router;
