import db from '../db.js';
import {
  addOpeningLine,
  approveCashMapping,
  approveOpeningBatch,
  createCashMapping,
  createLegacyValuationReview,
  createOpeningBatch,
  blockerReviews,
  listCashMappings,
  listOpeningBatches,
  listLegacyValuationReviews,
  listLegacyValuationCandidates,
  postCashMapping,
  postOpeningBatch,
  previewOpeningBatch,
  reconciliationCompleteness,
  verifyLegacyValuation
} from '../reconciliation/reconciliationService.js';

function run(request, response, operation) {
  try { return response.json(operation()); }
  catch (error) {
    if (/wajib|harus|tidak|belum|tidak tersedia|tidak ditemukan|selisih|hanya/.test(error.message || '')) return response.status(400).json({ error: error.message });
    console.error(error);
    return response.status(500).json({ error: 'Operasi rekonsiliasi gagal' });
  }
}

export function getCompleteness(request, response) { return run(request, response, () => reconciliationCompleteness(db, request.query.as_of || new Date().toISOString().slice(0, 10))); }
export function getBlockers(request, response) { return run(request, response, () => blockerReviews(db, request.query.as_of || new Date().toISOString().slice(0, 10))); }
export function listOpenings(request, response) { return run(request, response, () => listOpeningBatches(db)); }
export function createOpening(request, response) { return run(request, response, () => createOpeningBatch(db, { ...request.body, createdBy: request.user.id })); }
export function addOpening(request, response) { return run(request, response, () => addOpeningLine(db, request.params.id, { ...request.body, createdBy: request.user.id })); }
export function previewOpening(request, response) { return run(request, response, () => previewOpeningBatch(db, request.params.id)); }
export function approveOpening(request, response) { return run(request, response, () => approveOpeningBatch(db, request.params.id, request.user.id)); }
export function postOpening(request, response) { return run(request, response, () => postOpeningBatch(db, request.params.id, request.user.id)); }
export function listValuation(request, response) { return run(request, response, () => listLegacyValuationReviews(db, request.query.status || null)); }
export function listValuationCandidates(request, response) { return run(request, response, () => listLegacyValuationCandidates(db)); }
export function createValuation(request, response) { return run(request, response, () => createLegacyValuationReview(db, { ...request.body, createdBy: request.user.id })); }
export function verifyValuation(request, response) { return run(request, response, () => verifyLegacyValuation(db, request.params.id, request.user.id)); }
export function listMappings(request, response) { return run(request, response, () => listCashMappings(db, request.query.status || null)); }
export function createMapping(request, response) { return run(request, response, () => createCashMapping(db, request.params.cashEntryId, request.user.id)); }
export function approveMapping(request, response) { return run(request, response, () => approveCashMapping(db, request.params.id, { ...request.body, reviewedBy: request.user.id })); }
export function postMapping(request, response) { return run(request, response, () => postCashMapping(db, request.params.id, request.user.id)); }