import { Router } from 'express';
import { authorize } from '../auth.js';
import {
  addOpening,
  approveMapping,
  approveOpening,
  getBlockers,
  createMapping,
  createOpening,
  createValuation,
  getCompleteness,
  listMappings,
  listOpenings,
  listValuation,
  listValuationCandidates,
  postMapping,
  postOpening,
  previewOpening,
  verifyValuation
} from '../controllers/reconciliationController.js';

const router = Router();
router.use('/reconciliation', authorize('admin'));
router.get('/reconciliation/completeness', getCompleteness);
router.get('/reconciliation/blockers', getBlockers);
router.get('/reconciliation/opening-balances', listOpenings);
router.post('/reconciliation/opening-balances', createOpening);
router.post('/reconciliation/opening-balances/:id/lines', addOpening);
router.get('/reconciliation/opening-balances/:id/preview', previewOpening);
router.post('/reconciliation/opening-balances/:id/approve', approveOpening);
router.post('/reconciliation/opening-balances/:id/post', postOpening);
router.get('/reconciliation/legacy-valuations', listValuation);
router.get('/reconciliation/legacy-valuations/candidates', listValuationCandidates);
router.post('/reconciliation/legacy-valuations', createValuation);
router.post('/reconciliation/legacy-valuations/:id/verify', verifyValuation);
router.get('/reconciliation/cash-mappings', listMappings);
router.post('/reconciliation/cash-mappings/:cashEntryId', createMapping);
router.post('/reconciliation/cash-mappings/:id/approve', approveMapping);
router.post('/reconciliation/cash-mappings/:id/post', postMapping);
export default router;