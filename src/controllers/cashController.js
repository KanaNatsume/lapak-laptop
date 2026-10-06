import db from '../db.js';

const entryTypes = ['pemasukan', 'pengeluaran'];

function validateEntry(body) {
  const { entry_type, category, description, amount, entry_date } = body;
  if (!entryTypes.includes(entry_type)) return 'Jenis catatan tidak valid';
  if (!category?.trim() || !description?.trim()) return 'Kategori dan keterangan wajib diisi';
  if (!Number.isInteger(Number(amount)) || Number(amount) <= 0) return 'Nominal harus lebih besar dari 0';
  if (entry_date && !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return 'Tanggal tidak valid';
  return null;
}

export function listCashEntries(request, response) {
  const from = request.query.from || '1900-01-01';
  const to = request.query.to || '2999-12-31';
  const entries = db.prepare(`SELECT cash_entries.*, users.name AS created_by_name FROM cash_entries LEFT JOIN users ON users.id = cash_entries.created_by WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date DESC, id DESC`).all(from, to);
  const manual = db.prepare(`SELECT entry_type, COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE source = 'manual' AND entry_date BETWEEN ? AND ? GROUP BY entry_type`).all(from, to);
  const sales = db.prepare(`SELECT COALESCE(SUM(paid_amount), 0) AS total FROM transactions WHERE transaction_stage = 'final' AND date(created_at) BETWEEN ? AND ?`).get(from, to);
  response.json({ entries, summary: { pemasukan_manual: manual.find((item) => item.entry_type === 'pemasukan')?.total || 0, pengeluaran: manual.find((item) => item.entry_type === 'pengeluaran')?.total || 0, penjualan: sales.total || 0 } });
}

export function createCashEntry(request, response) {
  const error = validateEntry(request.body);
  if (error) return response.status(400).json({ error });
  const { entry_type, category, description, amount, entry_date = new Date().toISOString().slice(0, 10) } = request.body;
  const result = db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, entry_date, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(entry_type, category.trim(), description.trim(), Number(amount), entry_date, request.user.id);
  response.status(201).json(db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(result.lastInsertRowid));
}

export function updateCashEntry(request, response) {
  const error = validateEntry(request.body);
  if (error) return response.status(400).json({ error });
  const { entry_type, category, description, amount, entry_date = new Date().toISOString().slice(0, 10) } = request.body;
  const result = db.prepare('UPDATE cash_entries SET entry_type = ?, category = ?, description = ?, amount = ?, entry_date = ? WHERE id = ?').run(entry_type, category.trim(), description.trim(), Number(amount), entry_date, request.params.id);
  if (!result.changes) return response.status(404).json({ error: 'Catatan kas tidak ditemukan' });
  response.json(db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(request.params.id));
}

export function deleteCashEntry(request, response) {
  const result = db.prepare('DELETE FROM cash_entries WHERE id = ?').run(request.params.id);
  if (!result.changes) return response.status(404).json({ error: 'Catatan kas tidak ditemukan' });
  response.status(204).end();
}
