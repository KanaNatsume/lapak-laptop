import db from '../db.js';
import { createCashAdvance, listCashAdvances, reimburseCashAdvance } from '../services/cashAdvanceService.js';

function respond(error, response) {
  if (error?.statusCode === 400) return response.status(400).json({ error: error.message });
  console.error(error);
  return response.status(500).json({ error: 'Terjadi kesalahan pada server' });
}

export function getCashAdvances(request, response) {
  try { return response.json(listCashAdvances(db, request.query)); }
  catch (error) { return respond(error, response); }
}

export function postCashAdvance(request, response) {
  try { return response.status(201).json(createCashAdvance(db, { ...request.body, createdBy: request.user.id })); }
  catch (error) { return respond(error, response); }
}

export function postCashAdvanceReimbursement(request, response) {
  try { return response.status(201).json(reimburseCashAdvance(db, request.params.id, { ...request.body, createdBy: request.user.id })); }
  catch (error) { return respond(error, response); }
}
