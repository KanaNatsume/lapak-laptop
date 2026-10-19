import db from '../db.js';
import { getFreightFulfillment, payFreightPayable, recordFreightActualCost, topUpFreightPrepaid } from '../services/freightService.js';

function respondFreightError(error, response) {
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: error.message });
  if (/sudah dipakai|utang ekspedisi|Saldo ekspedisi prabayar|Kunci idempotensi/i.test(error.message || '')) return response.status(409).json({ error: error.message });
  if (error instanceof Error) return response.status(400).json({ error: error.message });
  console.error(error);
  return response.status(500).json({ error: 'Pencatatan ongkir gagal diproses' });
}

export function createFreightActual(request, response) {
  try {
    const result = recordFreightActualCost(db, request.params.id, { ...request.body, createdBy: request.user.id });
    response.status(201).json(result);
  } catch (error) { return respondFreightError(error, response); }
}

export function listFreightFulfillments(request, response) {
  const transactionId = request.query.transaction_id === undefined ? null : Number(request.query.transaction_id);
  if (transactionId !== null && (!Number.isSafeInteger(transactionId) || transactionId <= 0)) return response.status(400).json({ error: 'ID transaksi tidak valid' });
  const rows = db.prepare(`SELECT freight_fulfillments.*, transactions.invoice_number,
      COALESCE((SELECT SUM(amount) FROM freight_payments WHERE fulfillment_id = freight_fulfillments.id), 0) AS paid_amount
    FROM freight_fulfillments JOIN transactions ON transactions.id = freight_fulfillments.transaction_id
    WHERE (? IS NULL OR freight_fulfillments.transaction_id = ?)
    ORDER BY freight_fulfillments.recorded_at DESC, freight_fulfillments.id DESC`).all(transactionId, transactionId);
  response.json(rows.map((row) => ({ ...row, outstanding: row.payable_amount - row.paid_amount, payment_status: row.paid_amount === 0 ? 'unpaid' : row.paid_amount === row.payable_amount ? 'paid' : 'partial' })));
}

export function getFreightFulfillmentById(request, response) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return response.status(400).json({ error: 'ID fulfillment tidak valid' });
  const fulfillment = getFreightFulfillment(db, id);
  if (!fulfillment) return response.status(404).json({ error: 'Catatan ongkir tidak ditemukan' });
  response.json(fulfillment);
}

export function payFreightFulfillment(request, response) {
  try {
    response.status(201).json(payFreightPayable(db, request.params.id, { ...request.body, createdBy: request.user.id }));
  } catch (error) { return respondFreightError(error, response); }
}

export function topUpFreightBalance(request, response) {
  try {
    response.status(201).json(topUpFreightPrepaid(db, { ...request.body, createdBy: request.user.id }));
  } catch (error) { return respondFreightError(error, response); }
}

export function getFreightPrepaidBalance(_request, response) {
  const balance = Number(db.prepare(`SELECT COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS balance
    FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id
    JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
    WHERE accounts.code = '1400' AND journal_entries.status = 'posted'`).get().balance);
  response.json({ balance });
}
