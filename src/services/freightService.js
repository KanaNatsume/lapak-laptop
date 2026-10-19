import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';

const cashAccounts = new Set(['1110', '1120', '1130']);
function hashPayload(payload) { return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
function actorId(value) { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Pengguna tidak valid'); return id; }
function key(value) { const result = String(value || '').trim(); if (!result || result.length > 160) throw new Error('Kunci idempotensi wajib diisi maksimal 160 karakter'); return result; }

function existingByKey(db, table, idempotencyKey, hash) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE idempotency_key = ?`).get(idempotencyKey);
  if (!existing) return null;
  if (existing.request_hash !== hash) throw new Error('Kunci idempotensi sudah dipakai untuk data berbeda');
  return existing;
}

function prepaidBalance(db) {
  return Number(db.prepare(`SELECT COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS balance
    FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id
    JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
    WHERE accounts.code = '1400' AND journal_entries.status = 'posted'`).get().balance);
}

export function recordFreightActualCost(db, transactionId, input) {
  const actor = actorId(input.createdBy);
  const txId = Number(transactionId);
  const expedition = String(input.expedition || '').trim();
  const trackingNumber = String(input.trackingNumber || '').trim();
  const actualCost = Number(input.actualCost);
  const payableAmount = Number(input.payableAmount || 0);
  const prepaidAmount = Number(input.prepaidAmount || 0);
  const idempotencyKey = key(input.idempotencyKey);
  if (!Number.isSafeInteger(txId) || txId <= 0) throw new Error('Transaksi tidak valid');
  if (!expedition) throw new Error('Nama ekspedisi wajib diisi');
  if (!Number.isSafeInteger(actualCost) || actualCost <= 0) throw new Error('Ongkir aktual harus integer Rupiah positif');
  if (!Number.isSafeInteger(payableAmount) || payableAmount < 0 || !Number.isSafeInteger(prepaidAmount) || prepaidAmount < 0 || payableAmount + prepaidAmount !== actualCost) throw new Error('Pembagian utang dan saldo prabayar harus sama dengan ongkir aktual');
  const transaction = db.prepare("SELECT id, invoice_number, shipping_cost FROM transactions WHERE id = ? AND transaction_stage = 'final'").get(txId);
  if (!transaction) throw new Error('Transaksi penjualan tidak ditemukan');
  const paymentSource = payableAmount > 0 && prepaidAmount > 0 ? 'mixed' : payableAmount > 0 ? 'payable' : 'prepaid';
  const normalized = { transactionId: txId, expedition, trackingNumber, actualCost, payableAmount, prepaidAmount, paymentSource, idempotencyKey };
  const requestHash = hashPayload(normalized);
  const create = db.transaction(() => {
    const existing = existingByKey(db, 'freight_fulfillments', idempotencyKey, requestHash);
    if (existing) return { ...existing, duplicate: true, outstanding: existing.payable_amount };
    if (prepaidAmount > 0 && prepaidBalance(db) < prepaidAmount) throw new Error('Saldo ekspedisi prabayar tidak cukup');
    const fulfillmentNumber = `FRG-${transaction.invoice_number}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const lines = [{ accountCode: '6400', debit: actualCost, credit: 0, memo: `Ongkir aktual ${expedition}` }];
    if (payableAmount > 0) lines.push({ accountCode: '2400', debit: 0, credit: payableAmount, memo: `Utang ekspedisi ${expedition}` });
    if (prepaidAmount > 0) lines.push({ accountCode: '1400', debit: 0, credit: prepaidAmount, memo: `Pemakaian saldo prabayar ${expedition}` });
    const journal = postJournal(db, {
      entryDate: new Date().toISOString().slice(0, 10),
      source: { type: 'freight_fulfillment', id: fulfillmentNumber, event: 'actual_cost' },
      description: `Ongkir aktual ${transaction.invoice_number} · ${expedition}`,
      idempotencyKey: `freight-actual:${idempotencyKey}`,
      createdBy: actor,
      lines
    });
    const result = db.prepare(`INSERT INTO freight_fulfillments (
      transaction_id, expedition, tracking_number, customer_charge, actual_cost, shop_borne_amount,
      payment_source, payable_amount, prepaid_amount, expense_journal_id, idempotency_key, request_hash, recorded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      txId, expedition, trackingNumber, transaction.shipping_cost, actualCost,
      Math.max(actualCost - transaction.shipping_cost, 0), paymentSource, payableAmount,
      prepaidAmount, journal.id, idempotencyKey, requestHash, actor
    );
    const fulfillmentId = Number(result.lastInsertRowid);
    return { ...db.prepare('SELECT * FROM freight_fulfillments WHERE id = ?').get(fulfillmentId), duplicate: false, outstanding: payableAmount };
  });
  return create.immediate();
}

export function payFreightPayable(db, fulfillmentId, input) {
  const id = Number(fulfillmentId);
  const amount = Number(input.amount);
  const cashAccountCode = String(input.cashAccountCode || '1110');
  const actor = actorId(input.createdBy);
  const idempotencyKey = key(input.idempotencyKey);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(amount) || amount <= 0 || !cashAccounts.has(cashAccountCode)) throw new Error('Nominal, fulfillment, atau akun pembayaran tidak valid');
  const normalized = { fulfillmentId: id, amount, cashAccountCode };
  const requestHash = hashPayload(normalized);
  const existing = db.prepare('SELECT * FROM freight_payments WHERE fulfillment_id = ? AND idempotency_key = ?').get(id, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error('Kunci pembayaran ekspedisi sudah dipakai untuk data berbeda');
    return { ...existing, duplicate: true };
  }
  const pay = db.transaction(() => {
    const fulfillment = db.prepare('SELECT * FROM freight_fulfillments WHERE id = ?').get(id);
    if (!fulfillment) throw new Error('Catatan ongkir tidak ditemukan');
    const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM freight_payments WHERE fulfillment_id = ?').get(id).total;
    const outstanding = fulfillment.payable_amount - paid;
    if (amount > outstanding) throw new Error('Pembayaran melebihi utang ekspedisi');
    const journal = postJournal(db, {
      entryDate: new Date().toISOString().slice(0, 10),
      source: { type: 'freight_payment', id: String(id), event: idempotencyKey },
      description: `Pembayaran utang ekspedisi ${fulfillment.expedition}`,
      idempotencyKey: `freight-payment:${id}:${idempotencyKey}`,
      createdBy: actor,
      lines: [{ accountCode: '2400', debit: amount, credit: 0, memo: fulfillment.tracking_number || `Fulfillment ${id}` }, { accountCode: cashAccountCode, debit: 0, credit: amount, memo: fulfillment.expedition }]
    });
    const result = db.prepare(`INSERT INTO freight_payments (
      fulfillment_id, amount, cash_account_code, idempotency_key, request_hash, journal_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, amount, cashAccountCode, idempotencyKey, requestHash, journal.id, actor);
    return { ...db.prepare('SELECT * FROM freight_payments WHERE id = ?').get(result.lastInsertRowid), outstanding: outstanding - amount, duplicate: false };
  });
  return pay.immediate();
}

export function topUpFreightPrepaid(db, input) {
  const amount = Number(input.amount);
  const cashAccountCode = String(input.cashAccountCode || '1110');
  const description = String(input.description || '').trim();
  const actor = actorId(input.createdBy);
  const idempotencyKey = key(input.idempotencyKey);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !cashAccounts.has(cashAccountCode) || !description) throw new Error('Nominal, akun sumber, dan keterangan top-up wajib valid');
  const requestHash = hashPayload({ amount, cashAccountCode, description });
  const existing = existingByKey(db, 'freight_prepaid_topups', idempotencyKey, requestHash);
  if (existing) return { ...existing, duplicate: true };
  const topUp = db.transaction(() => {
    const journal = postJournal(db, {
      entryDate: new Date().toISOString().slice(0, 10),
      source: { type: 'freight_prepaid_topup', id: idempotencyKey, event: 'funding' },
      description: `Top-up saldo ekspedisi: ${description}`,
      idempotencyKey: `freight-prepaid-topup:${idempotencyKey}`,
      createdBy: actor,
      lines: [{ accountCode: '1400', debit: amount, credit: 0, memo: description }, { accountCode: cashAccountCode, debit: 0, credit: amount, memo: description }]
    });
    const result = db.prepare(`INSERT INTO freight_prepaid_topups (
      amount, cash_account_code, description, idempotency_key, request_hash, journal_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(amount, cashAccountCode, description, idempotencyKey, requestHash, journal.id, actor);
    return { ...db.prepare('SELECT * FROM freight_prepaid_topups WHERE id = ?').get(result.lastInsertRowid), balance: prepaidBalance(db), duplicate: false };
  });
  return topUp.immediate();
}

export function getFreightFulfillment(db, id) {
  const fulfillment = db.prepare(`SELECT freight_fulfillments.*, transactions.invoice_number
    FROM freight_fulfillments JOIN transactions ON transactions.id = freight_fulfillments.transaction_id
    WHERE freight_fulfillments.id = ?`).get(id);
  if (!fulfillment) return null;
  const paidAmount = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM freight_payments WHERE fulfillment_id = ?').get(id).total;
  return { ...fulfillment, paid_amount: paidAmount, outstanding: fulfillment.payable_amount - paidAmount, payment_status: paidAmount === 0 ? 'unpaid' : paidAmount === fulfillment.payable_amount ? 'paid' : 'partial' };
}
