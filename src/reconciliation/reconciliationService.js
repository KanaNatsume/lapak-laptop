import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const categories = new Set(['pendapatan', 'beban_operasional', 'pembelian_persediaan', 'pembayaran_utang', 'pelunasan_piutang', 'prive', 'transfer', 'pengeluaran_aset', 'unidentified']);

function validDate(value, field) {
  if (typeof value !== 'string' || !datePattern.test(value)) throw new Error(`${field} harus tanggal YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} tidak valid`);
  return value;
}

function actor(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Pengguna rekonsiliasi tidak valid');
  return id;
}

function audit(db, entityType, entityId, action, userId) {
  const table = { opening_balance: 'opening_balance_batches', legacy_valuation: 'legacy_valuation_reviews', cash_mapping: 'cash_entry_reconciliation_mappings' }[entityType];
  const snapshot = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId);
  db.prepare('INSERT INTO reconciliation_audit_log (entity_type, entity_id, action, snapshot_json, actor_id) VALUES (?, ?, ?, ?, ?)').run(entityType, entityId, action, JSON.stringify(snapshot || null), userId);
}

function account(db, code) {
  const row = db.prepare('SELECT code, is_active, is_postable FROM accounts WHERE code = ?').get(String(code || '').trim());
  if (!row || !row.is_active || !row.is_postable) throw new Error(`Akun ${code} tidak tersedia untuk posting`);
  return row.code;
}

function auditHistory(db, entityType, entityId) {
  if (!entityId) return [];
  return db.prepare(`SELECT id, action, snapshot_json, actor_id, occurred_at
    FROM reconciliation_audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id`).all(entityType, entityId);
}

export function createOpeningBatch(db, input) {
  const createdBy = actor(input.createdBy);
  const effectiveDate = validDate(input.effectiveDate, 'Tanggal efektif');
  const result = db.prepare('INSERT INTO opening_balance_batches (effective_date, source_summary, notes, created_by) VALUES (?, ?, ?, ?)').run(effectiveDate, String(input.sourceSummary || '').trim(), String(input.notes || '').trim(), createdBy);
  const id = Number(result.lastInsertRowid);
  audit(db, 'opening_balance', id, 'created', createdBy);
  return db.prepare('SELECT * FROM opening_balance_batches WHERE id = ?').get(id);
}

export function addOpeningLine(db, batchId, input) {
  const createdBy = actor(input.createdBy);
  const batch = db.prepare('SELECT * FROM opening_balance_batches WHERE id = ?').get(batchId);
  if (!batch || batch.status !== 'draft') throw new Error('Saldo awal hanya dapat diubah saat berstatus draft');
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Nominal saldo awal harus Rupiah integer positif');
  const side = String(input.side || '');
  if (!['debit', 'credit'].includes(side)) throw new Error('Sisi saldo awal tidak valid');
  account(db, input.accountCode);
  if (!String(input.sourceType || '').trim() || !String(input.sourceReference || '').trim()) throw new Error('Sumber dan referensi bukti wajib diisi');
  const result = db.prepare(`INSERT INTO opening_balance_lines (batch_id, account_code, side, amount, source_type, source_reference, evidence_note, verification_status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(batchId, String(input.accountCode).trim(), side, amount, String(input.sourceType).trim(), String(input.sourceReference).trim(), String(input.evidenceNote || '').trim(), input.verificationStatus === 'verified' ? 'verified' : 'unverified', String(input.note || '').trim());
  audit(db, 'opening_balance', batchId, 'line_added', createdBy);
  return db.prepare('SELECT * FROM opening_balance_lines WHERE id = ?').get(result.lastInsertRowid);
}

export function previewOpeningBatch(db, batchId) {
  const batch = db.prepare('SELECT * FROM opening_balance_batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch saldo awal tidak ditemukan');
  const lines = db.prepare('SELECT opening_balance_lines.*, accounts.name AS account_name, accounts.is_postable FROM opening_balance_lines JOIN accounts ON accounts.code = opening_balance_lines.account_code WHERE batch_id = ? ORDER BY id').all(batchId);
  const debit = lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0);
  const credit = lines.filter((line) => line.side === 'credit').reduce((sum, line) => sum + line.amount, 0);
  return { batch, lines, debit, credit, difference: debit - credit, balanced: debit === credit, complete: lines.length > 0 && lines.every((line) => line.verification_status === 'verified' && line.is_postable) };
}

export function approveOpeningBatch(db, batchId, userId) {
  const approvedBy = actor(userId);
  const preview = previewOpeningBatch(db, batchId);
  if (!preview.balanced) throw new Error(`Saldo awal belum seimbang; selisih ${preview.difference}`);
  if (!preview.complete) throw new Error('Semua baris saldo awal harus memiliki akun postable dan bukti terverifikasi');
  db.prepare("UPDATE opening_balance_batches SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'").run(approvedBy, batchId);
  audit(db, 'opening_balance', batchId, 'approved', approvedBy);
  return previewOpeningBatch(db, batchId);
}

export function postOpeningBatch(db, batchId, userId) {
  const postedBy = actor(userId);
  const post = db.transaction(() => {
    const preview = previewOpeningBatch(db, batchId);
    if (preview.batch.status === 'posted') return { ...preview.batch, duplicate: true };
    if (preview.batch.status !== 'approved') throw new Error('Saldo awal harus disetujui sebelum diposting');
    const journal = postJournal(db, {
      entryDate: preview.batch.effective_date, postingDate: preview.batch.effective_date,
      reference: `OPENING-${preview.batch.id}`, source: { type: 'opening_balance', id: String(preview.batch.id), event: 'posting' },
      description: `Saldo awal ${preview.batch.effective_date}`, idempotencyKey: `opening-balance:${preview.batch.id}`, createdBy: postedBy,
      lines: preview.lines.map((line) => ({ accountCode: line.account_code, debit: line.side === 'debit' ? line.amount : 0, credit: line.side === 'credit' ? line.amount : 0, memo: line.note || line.evidence_note }))
    });
    db.prepare("UPDATE opening_balance_batches SET status = 'posted', journal_entry_id = ?, posted_at = CURRENT_TIMESTAMP WHERE id = ?").run(journal.id, batchId);
    audit(db, 'opening_balance', batchId, 'posted', postedBy);
    return { ...db.prepare('SELECT * FROM opening_balance_batches WHERE id = ?').get(batchId), duplicate: journal.duplicate };
  });
  return post.immediate();
}

export function listLegacyValuationReviews(db, status = null) {
  const filter = status ? 'AND legacy_valuation_reviews.verification_status = ?' : '';
  const params = status ? [status] : [];
  return db.prepare(`SELECT legacy_valuation_reviews.*, products.name AS product_name, products.brand, products.category, inventory_units.unit_code, inventory_units.serial_number, inventory_units.status AS unit_status
    FROM legacy_valuation_reviews JOIN products ON products.id = legacy_valuation_reviews.product_id LEFT JOIN inventory_units ON inventory_units.id = legacy_valuation_reviews.unit_id
    WHERE 1 = 1 ${filter} ORDER BY legacy_valuation_reviews.id`).all(...params);
}

export function createLegacyValuationReview(db, input) {
  const createdBy = actor(input.createdBy);
  const productId = Number(input.productId);
  const product = db.prepare("SELECT id, category FROM products WHERE id = ? AND category IN ('laptop', 'part_copotan')").get(productId);
  if (!product) throw new Error('Produk legacy harus laptop atau spare part');
  const unitId = input.unitId ? Number(input.unitId) : null;
  if (unitId) {
    const unit = db.prepare("SELECT id, product_id, source_type FROM inventory_units WHERE id = ? AND product_id = ?").get(unitId, productId);
    if (!unit || unit.source_type === 'customer') throw new Error('Unit pelanggan tidak boleh dinilai sebagai persediaan toko');
  }
  const quantity = Number(input.quantity);
  const costs = ['purchaseCost', 'capitalizedRepairCost', 'eligibleAdditionalCost'].map((key) => Number(input[key] || 0));
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || costs.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Kuantitas dan biaya valuasi harus Rupiah integer valid');
  const sourceType = String(input.sourceType || '').trim();
  const sourceReference = String(input.sourceReference || '').trim();
  if (!sourceType || !sourceReference) throw new Error('Sumber valuasi dan referensi bukti wajib diisi');
  const total = costs.reduce((sum, value) => sum + value, 0);
  const result = db.prepare(`INSERT INTO legacy_valuation_reviews (product_id, unit_id, ownership_type, quantity, purchase_cost, capitalized_repair_cost, eligible_additional_cost, total_verified_cost, source_type, source_reference, verification_status, verification_note, created_by)
    VALUES (?, ?, 'store', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(productId, unitId, quantity, costs[0], costs[1], costs[2], total, sourceType, sourceReference, String(input.verificationNote || '').trim(), createdBy);
  const id = Number(result.lastInsertRowid);
  audit(db, 'legacy_valuation', id, 'created', createdBy);
  return listLegacyValuationReviews(db).find((row) => row.id === id);
}

export function verifyLegacyValuation(db, id, userId) {
  const approvedBy = actor(userId);
  const review = db.prepare('SELECT * FROM legacy_valuation_reviews WHERE id = ?').get(id);
  if (!review) throw new Error('Review valuasi tidak ditemukan');
  if (review.total_verified_cost <= 0) throw new Error('Biaya terverifikasi harus lebih besar dari 0');
  db.prepare("UPDATE legacy_valuation_reviews SET verification_status = 'verified', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND verification_status = 'pending'").run(approvedBy, id);
  audit(db, 'legacy_valuation', id, 'verified', approvedBy);
  return listLegacyValuationReviews(db).find((row) => row.id === Number(id));
}

function recommendation(entry) {
  const text = `${entry.category} ${entry.description}`.toLowerCase();
  if (entry.source === 'transaction' || /penjualan|servis|ongkir/.test(text)) return { category: text.includes('servis') ? 'pendapatan' : 'pendapatan', debit: '1110', credit: text.includes('servis') ? '4200' : '4100', status: 'draft', reason: 'Terindikasi arus penerimaan transaksi' };
  if (/transfer/.test(text)) return { category: 'transfer', status: 'ambiguous', reason: 'Akun rekening tujuan belum tersedia pada cash_entries lama' };
  if (/prive|sekutu/.test(text)) return { category: 'prive', status: 'ambiguous', reason: 'Akun ekuitas sekutu harus dikonfirmasi pemilik/pembuku' };
  if (/beli|pembelian|stok|persediaan/.test(text)) return { category: 'pembelian_persediaan', debit: '1320', credit: '1110', status: 'draft', reason: 'Terindikasi pembelian persediaan; bukti supplier wajib diperiksa' };
  return { category: 'unidentified', status: 'ambiguous', reason: 'Kategori dan akun lawan tidak dapat ditentukan dari data legacy' };
}

export function listCashMappings(db, status = null) {
  const filter = status ? 'AND m.status = ?' : '';
  return db.prepare(`SELECT m.*, c.entry_type, c.category AS source_category, c.description, c.amount, c.entry_date, c.source FROM cash_entry_reconciliation_mappings m JOIN cash_entries c ON c.id = m.cash_entry_id WHERE 1 = 1 ${filter} ORDER BY c.entry_date, c.id`).all(...(status ? [status] : []));
}

export function createCashMapping(db, cashEntryId, userId) {
  const createdBy = actor(userId);
  const entry = db.prepare('SELECT * FROM cash_entries WHERE id = ?').get(cashEntryId);
  if (!entry) throw new Error('Transaksi cash_entries tidak ditemukan');
  const existing = db.prepare('SELECT * FROM cash_entry_reconciliation_mappings WHERE cash_entry_id = ?').get(cashEntryId);
  if (existing) return { ...existing, duplicate: true };
  const existingJournal = db.prepare(`SELECT journal_entries.id FROM journal_entries JOIN journal_lines ON journal_lines.journal_entry_id = journal_entries.id
    WHERE journal_entries.status IN ('posted', 'reversed') AND ((journal_entries.source_type = 'cash_entry' AND journal_entries.source_id = ?) OR (journal_entries.description = ? AND journal_entries.entry_date = ?))
    GROUP BY journal_entries.id HAVING SUM(journal_lines.debit + journal_lines.credit) = ? LIMIT 1`).get(String(cashEntryId), entry.description, entry.entry_date, Number(entry.amount) * 2);
  const suggestion = recommendation(entry);
  const status = existingJournal ? 'already_journaled' : suggestion.status;
  const result = db.prepare(`INSERT INTO cash_entry_reconciliation_mappings (cash_entry_id, debit_account_code, credit_account_code, category_code, status, existing_journal_entry_id, recommendation_reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(cashEntryId, suggestion.debit || null, suggestion.credit || null, suggestion.category, status, existingJournal?.id || null, suggestion.reason, createdBy);
  const id = Number(result.lastInsertRowid);
  audit(db, 'cash_mapping', id, 'created', createdBy);
  return listCashMappings(db).find((row) => row.id === id);
}

export function approveCashMapping(db, id, input) {
  const reviewedBy = actor(input.reviewedBy);
  const mapping = db.prepare('SELECT m.*, c.entry_date, c.amount, c.entry_type, c.description FROM cash_entry_reconciliation_mappings m JOIN cash_entries c ON c.id = m.cash_entry_id WHERE m.id = ?').get(id);
  if (!mapping) throw new Error('Mapping cash legacy tidak ditemukan');
  const debit = account(db, input.debitAccountCode || mapping.debit_account_code);
  const credit = account(db, input.creditAccountCode || mapping.credit_account_code);
  if (debit === credit) throw new Error('Akun debit dan kredit tidak boleh sama');
  db.prepare("UPDATE cash_entry_reconciliation_mappings SET debit_account_code = ?, credit_account_code = ?, category_code = ?, status = 'approved', verification_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('draft', 'ambiguous')").run(debit, credit, categories.has(input.categoryCode) ? input.categoryCode : 'unidentified', String(input.note || '').trim(), reviewedBy, id);
  audit(db, 'cash_mapping', id, 'approved', reviewedBy);
  return listCashMappings(db).find((row) => row.id === Number(id));
}

export function postCashMapping(db, id, userId) {
  const postedBy = actor(userId);
  const post = db.transaction(() => {
    const mapping = db.prepare(`SELECT m.*, c.entry_date, c.amount, c.entry_type, c.description FROM cash_entry_reconciliation_mappings m JOIN cash_entries c ON c.id = m.cash_entry_id WHERE m.id = ?`).get(id);
    if (!mapping) throw new Error('Mapping cash legacy tidak ditemukan');
    if (mapping.status === 'posted' || mapping.status === 'already_journaled') return { ...mapping, duplicate: true };
    if (mapping.status !== 'approved') throw new Error('Mapping cash harus disetujui sebelum diposting');
    const journal = postJournal(db, { entryDate: validDate(mapping.entry_date, 'Tanggal cash_entries'), postingDate: mapping.entry_date, reference: `CASH-${mapping.cash_entry_id}`, source: { type: 'cash_entry', id: String(mapping.cash_entry_id), event: 'legacy_mapping' }, description: `Rekonsiliasi kas: ${mapping.description}`, idempotencyKey: `cash-entry-reconciliation:${mapping.cash_entry_id}`, createdBy: postedBy, lines: [{ accountCode: mapping.debit_account_code, debit: mapping.amount, credit: 0, memo: mapping.description }, { accountCode: mapping.credit_account_code, debit: 0, credit: mapping.amount, memo: mapping.description }] });
    db.prepare("UPDATE cash_entry_reconciliation_mappings SET status = 'posted', journal_entry_id = ? WHERE id = ?").run(journal.id, id);
    audit(db, 'cash_mapping', id, 'posted', postedBy);
    return { ...db.prepare('SELECT * FROM cash_entry_reconciliation_mappings WHERE id = ?').get(id), duplicate: journal.duplicate };
  });
  return post.immediate();
}

export function reconciliationCompleteness(db, asOf) {
  const dateValue = validDate(asOf, 'Tanggal laporan');
  const legacy = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM legacy_valuation_reviews WHERE verification_status <> 'verified'`).get();
  const legacyStock = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(legacy_stock), 0) AS quantity FROM inventory_product_controls WHERE legacy_stock > 0`).get();
  const cash = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(c.amount), 0) AS amount FROM cash_entries c LEFT JOIN cash_entry_reconciliation_mappings m ON m.cash_entry_id = c.id WHERE date(c.entry_date) <= ? AND c.source = 'manual' AND (m.id IS NULL OR m.status NOT IN ('posted', 'already_journaled'))").get(dateValue);
  const opening = db.prepare("SELECT COUNT(*) AS count FROM opening_balance_batches WHERE effective_date <= ? AND status <> 'posted'").get(dateValue);
  return { as_of: dateValue, legacy_reviews_pending: legacy.count, legacy_stock_units: legacyStock.quantity, cash_entries_unreconciled: cash.count, cash_amount_unreconciled: cash.amount, opening_batches_pending: opening.count, complete: !legacyStock.quantity && !legacy.count && !cash.count && !opening.count };
}

export function blockerReviews(db, asOf) {
  const dateValue = validDate(asOf, 'Tanggal laporan');
  const legacyStock = db.prepare(`SELECT p.id AS product_id, p.name AS product_name, p.brand, p.category,
      p.stock AS source_stock, p.cost_price, c.legacy_stock, c.verified_at, c.verified_by,
      (SELECT COUNT(*) FROM inventory_units u WHERE u.product_id = p.id) AS individual_unit_count
    FROM inventory_product_controls c JOIN products p ON p.id = c.product_id
    WHERE c.legacy_stock > 0 AND p.category IN ('laptop', 'part_copotan') ORDER BY p.id`).all();
  const legacy = legacyStock.map((row) => {
    const reviews = db.prepare(`SELECT id, quantity, purchase_cost, capitalized_repair_cost, eligible_additional_cost,
        total_verified_cost, source_type, source_reference, verification_status, verification_note, approved_by, approved_at, journal_entry_id
      FROM legacy_valuation_reviews WHERE product_id = ? AND unit_id IS NULL ORDER BY id`).all(row.product_id);
    return {
      blocker_type: 'legacy_stock',
      source: row,
      cost_status: row.cost_price > 0 ? 'reference_only' : 'unknown',
      source_evidence: ['products.stock', 'inventory_product_controls.legacy_stock'],
      required_evidence: ['stock opname bertanda tangan', 'bukti biaya per unit atau layer', 'bukti kepemilikan toko/customer', 'bukti biaya perbaikan bila dikapitalisasi'],
      candidate_classifications: ['store_inventory_verified_cost', 'customer_owned_excluded', 'pending_unvalued'],
      financial_impact: { official_cost: null, reference_cost: row.legacy_stock * row.cost_price, affected_reports: ['inventory', 'stock-aging', 'unit-profit', 'profit-loss', 'balance-sheet'], note: 'Harga jual dan estimasi tidak boleh menggantikan biaya perolehan.' },
      approval: { status: reviews.some((review) => review.verification_status === 'verified') ? 'review_verified_stock_still_open' : 'pending_evidence', reviews },
      audit_history: reviews.flatMap((review) => auditHistory(db, 'legacy_valuation', review.id))
    };
  });
  const cash = db.prepare(`SELECT c.id, c.entry_type, c.category, c.description, c.amount, c.source, c.entry_date,
      m.id AS mapping_id, m.status AS mapping_status, m.debit_account_code, m.credit_account_code,
      m.category_code, m.existing_journal_entry_id, m.journal_entry_id, m.recommendation_reason,
      m.verification_note, m.reviewed_by, m.reviewed_at
    FROM cash_entries c LEFT JOIN cash_entry_reconciliation_mappings m ON m.cash_entry_id = c.id
    WHERE date(c.entry_date) <= ? AND c.source = 'manual' AND (m.id IS NULL OR m.status NOT IN ('posted', 'already_journaled'))
    ORDER BY c.entry_date, c.id`).all(dateValue).map((row) => {
    const relatedJournals = db.prepare(`SELECT id, entry_number, status, posting_date, source_type, source_id, source_event, description
      FROM journal_entries WHERE source_type = 'cash_entry' AND source_id = ? ORDER BY id`).all(String(row.id));
    const possibleMatches = db.prepare(`SELECT id, entry_number, status, posting_date, source_type, source_id, source_event, description
      FROM journal_entries WHERE entry_date = ? AND description = ? ORDER BY id`).all(row.entry_date, row.description);
    return {
      blocker_type: 'ambiguous_cash',
      source: { id: row.id, entry_type: row.entry_type, category: row.category, description: row.description, amount: row.amount, source: row.source, entry_date: row.entry_date },
      related_journals: relatedJournals,
      possible_matching_journals: possibleMatches,
      required_evidence: ['nota atau invoice', 'mutasi rekening/kas', 'penerima atau tujuan pembayaran', 'konfirmasi owner bila klasifikasi tetap tidak pasti'],
      candidate_classifications: ['pendapatan', 'beban_operasional', 'pembelian_persediaan', 'pembayaran_utang', 'pelunasan_piutang', 'prive', 'transfer', 'pengeluaran_aset', 'unidentified'],
      financial_impact: { amount: row.amount, affected_reports: ['cash-flow', 'balance-sheet', 'profit-loss', 'inventory', 'payables', 'equity'], note: 'Tidak ada jurnal dibuat selama status belum approved dengan akun dan kategori yang disetujui.' },
      approval: { status: row.mapping_status || 'pending_mapping', mapping_id: row.mapping_id, debit_account_code: row.debit_account_code, credit_account_code: row.credit_account_code, category_code: row.category_code, reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at },
      audit_history: auditHistory(db, 'cash_mapping', row.mapping_id)
    };
  });
  return { as_of: dateValue, legacy_stock: legacy, ambiguous_cash: cash, complete: legacy.length === 0 && cash.length === 0 };
}

export function listOpeningBatches(db) {
  return db.prepare(`SELECT opening_balance_batches.*, COALESCE(SUM(CASE WHEN opening_balance_lines.side = 'debit' THEN opening_balance_lines.amount ELSE 0 END), 0) AS debit,
      COALESCE(SUM(CASE WHEN opening_balance_lines.side = 'credit' THEN opening_balance_lines.amount ELSE 0 END), 0) AS credit
    FROM opening_balance_batches LEFT JOIN opening_balance_lines ON opening_balance_lines.batch_id = opening_balance_batches.id
    GROUP BY opening_balance_batches.id ORDER BY effective_date DESC, id DESC`).all();
}

export function listLegacyValuationCandidates(db) {
  const units = db.prepare(`SELECT 'laptop_unit' AS kind, inventory_units.id AS unit_id, inventory_units.product_id, inventory_units.unit_code, inventory_units.serial_number, inventory_units.status, products.name AS product_name, products.brand, inventory_unit_costs.acquisition_cost
    FROM inventory_units JOIN products ON products.id = inventory_units.product_id JOIN inventory_unit_costs ON inventory_unit_costs.unit_id = inventory_units.id
    WHERE inventory_units.status NOT IN ('sold', 'written_off') AND inventory_units.returned_to_owner = 0 AND inventory_unit_costs.acquisition_cost = 0
    ORDER BY inventory_units.id`).all();
  const stock = db.prepare(`SELECT 'legacy_stock' AS kind, NULL AS unit_id, inventory_product_controls.product_id, NULL AS unit_code, NULL AS serial_number, 'legacy' AS status, products.name AS product_name, products.brand, inventory_product_controls.legacy_stock AS quantity
    FROM inventory_product_controls JOIN products ON products.id = inventory_product_controls.product_id
    WHERE inventory_product_controls.legacy_stock > 0 AND products.category IN ('laptop', 'part_copotan') ORDER BY products.name`).all();
  return [...units, ...stock];
}