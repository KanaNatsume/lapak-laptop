import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';

const expenseAccounts = new Map([
  ['Makan/minum', '6200'],
  ['Perlengkapan/konsumsi', '6200'],
  ['Operasional toko', '6300'],
  ['Perbaikan abnormal', '6500'],
  ['Pengeluaran pribadi owner', '3120']
]);
const cashAccounts = new Set(['1110', '1120', '1130']);

function domainError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw domainError(`${label} harus YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw domainError(`${label} tidak valid`);
  return value;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw domainError(`${label} tidak valid`);
  return id;
}

function idempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 160) throw domainError('Kunci idempotensi wajib diisi maksimal 160 karakter');
  return key;
}

function requestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function existingByKey(db, table, key, hash) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE idempotency_key = ?`).get(key);
  if (!existing) return null;
  if (existing.request_hash !== hash) throw domainError('Kunci idempotensi sudah dipakai untuk data berbeda');
  return existing;
}

function expenseWithBalance(db, expenseId) {
  return db.prepare(`SELECT cash_advance_expenses.*,
      COALESCE(SUM(cash_advance_reimbursements.amount), 0) AS reimbursed_amount,
      cash_advance_expenses.amount - COALESCE(SUM(cash_advance_reimbursements.amount), 0) AS outstanding_amount
    FROM cash_advance_expenses
    LEFT JOIN cash_advance_reimbursements ON cash_advance_reimbursements.expense_id = cash_advance_expenses.id
    WHERE cash_advance_expenses.id = ?
    GROUP BY cash_advance_expenses.id`).get(expenseId);
}

export function listCashAdvances(db, { from, to }) {
  const start = validDate(from || '1900-01-01', 'Tanggal awal');
  const end = validDate(to || '2999-12-31', 'Tanggal akhir');
  if (start > end) throw domainError('Tanggal awal tidak boleh setelah tanggal akhir');
  const expenses = db.prepare(`SELECT cash_advance_expenses.*,
      COALESCE(SUM(cash_advance_reimbursements.amount), 0) AS reimbursed_amount,
      cash_advance_expenses.amount - COALESCE(SUM(cash_advance_reimbursements.amount), 0) AS outstanding_amount,
      users.name AS created_by_name
    FROM cash_advance_expenses
    LEFT JOIN cash_advance_reimbursements ON cash_advance_reimbursements.expense_id = cash_advance_expenses.id
    LEFT JOIN users ON users.id = cash_advance_expenses.created_by
    WHERE cash_advance_expenses.expense_date BETWEEN ? AND ?
       OR cash_advance_expenses.amount > COALESCE((
         SELECT SUM(reimbursements.amount) FROM cash_advance_reimbursements AS reimbursements
         WHERE reimbursements.expense_id = cash_advance_expenses.id
       ), 0)
    GROUP BY cash_advance_expenses.id
    ORDER BY cash_advance_expenses.expense_date DESC, cash_advance_expenses.id DESC`).all(start, end);
  const outstanding = expenses.reduce((sum, expense) => sum + expense.outstanding_amount, 0);
  return { expenses, outstanding };
}

export function createCashAdvance(db, input) {
  const lenderName = String(input.lenderName || '').trim();
  const category = String(input.category || '').trim();
  const description = String(input.description || '').trim();
  const amount = Number(input.amount);
  const expenseDate = validDate(input.expenseDate || new Date().toISOString().slice(0, 10), 'Tanggal pengeluaran');
  const expenseAccountCode = String(input.expenseAccountCode || '');
  const createdBy = positiveId(input.createdBy, 'Pembuat catatan');
  const key = idempotencyKey(input.idempotencyKey);
  if (!lenderName || lenderName.length > 120) throw domainError('Nama yang menalangi wajib diisi maksimal 120 karakter');
  if (!category || category.length > 100 || !description || description.length > 500) throw domainError('Kategori dan keterangan wajib diisi');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw domainError('Nominal harus Rupiah integer positif');
  if (expenseAccounts.get(category) !== expenseAccountCode) throw domainError('Akun beban tidak sesuai dengan kategori pengeluaran');
  const payload = { lenderName, category, description, amount, expenseDate, expenseAccountCode };
  const hash = requestHash(payload);
  const create = db.transaction(() => {
    const existing = existingByKey(db, 'cash_advance_expenses', key, hash);
    if (existing) return { ...expenseWithBalance(db, existing.id), duplicate: true };
    const sourceId = `ADV-${crypto.randomUUID()}`;
    const journal = postJournal(db, {
      entryDate: expenseDate,
      postingDate: expenseDate,
      source: { type: 'cash_advance_expense', id: sourceId, event: 'recognition' },
      idempotencyKey: `cash-advance-expense:${key}`,
      description: `Pengeluaran toko ditalangi ${lenderName}: ${description}`,
      createdBy,
      lines: [
        { accountCode: expenseAccountCode, debit: amount, credit: 0, memo: `${category} · ${description}` },
        { accountCode: '2510', debit: 0, credit: amount, memo: `Utang talangan kepada ${lenderName}` }
      ]
    });
    const result = db.prepare(`INSERT INTO cash_advance_expenses (
      lender_name, category, description, amount, expense_date, expense_account_code,
      journal_entry_id, idempotency_key, request_hash, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      lenderName, category, description, amount, expenseDate, expenseAccountCode,
      journal.id, key, hash, createdBy
    );
    return { ...expenseWithBalance(db, Number(result.lastInsertRowid)), duplicate: false };
  });
  return create.immediate();
}

export function reimburseCashAdvance(db, expenseId, input) {
  const id = positiveId(expenseId, 'ID talangan');
  const amount = Number(input.amount);
  const paidDate = validDate(input.paidDate || new Date().toISOString().slice(0, 10), 'Tanggal penggantian');
  const cashAccountCode = String(input.cashAccountCode || '');
  const createdBy = positiveId(input.createdBy, 'Pembuat pembayaran');
  const key = idempotencyKey(input.idempotencyKey);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw domainError('Nominal penggantian harus Rupiah integer positif');
  if (!cashAccounts.has(cashAccountCode)) throw domainError('Akun kas, bank, atau QRIS tidak valid');
  const payload = { expenseId: id, amount, paidDate, cashAccountCode };
  const hash = requestHash(payload);
  const pay = db.transaction(() => {
    const existing = existingByKey(db, 'cash_advance_reimbursements', key, hash);
    if (existing) return { ...existing, expense: expenseWithBalance(db, id), duplicate: true };
    const expense = expenseWithBalance(db, id);
    if (!expense) throw domainError('Catatan talangan tidak ditemukan');
    if (amount > expense.outstanding_amount) throw domainError('Penggantian melebihi sisa utang talangan');
    const journal = postJournal(db, {
      entryDate: paidDate,
      postingDate: paidDate,
      source: { type: 'cash_advance_reimbursement', id: String(id), event: key },
      idempotencyKey: `cash-advance-reimbursement:${key}`,
      description: `Penggantian talangan kepada ${expense.lender_name}`,
      createdBy,
      lines: [
        { accountCode: '2510', debit: amount, credit: 0, memo: `Pelunasan talangan ${expense.id}` },
        { accountCode: cashAccountCode, debit: 0, credit: amount, memo: `Pembayaran kepada ${expense.lender_name}` }
      ]
    });
    const cashEntry = db.prepare(`INSERT INTO cash_entries (
      entry_type, category, description, amount, source, entry_date, created_by
    ) VALUES ('pengeluaran', 'Penggantian talangan', ?, ?, 'transaction', ?, ?)`).run(
      `Penggantian talangan kepada ${expense.lender_name} · ${expense.description}`,
      amount, paidDate, createdBy
    );
    const result = db.prepare(`INSERT INTO cash_advance_reimbursements (
      expense_id, amount, paid_date, cash_account_code, idempotency_key, request_hash,
      journal_entry_id, cash_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, amount, paidDate, cashAccountCode, key, hash, journal.id, cashEntry.lastInsertRowid, createdBy
    );
    return {
      ...db.prepare('SELECT * FROM cash_advance_reimbursements WHERE id = ?').get(result.lastInsertRowid),
      expense: expenseWithBalance(db, id),
      duplicate: false
    };
  });
  return pay.immediate();
}
