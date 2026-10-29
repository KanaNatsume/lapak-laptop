import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createReceiptPdf } from '../frontend/src/components/receiptPdf.js';

const databasePath = path.join(process.cwd(), 'data', 'pos-test.sqlite');
for (const suffix of ['', '-wal', '-shm', '.pin-key']) {
  try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
}
process.env.DATABASE_PATH = databasePath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
process.env.TRUST_CLOUDFLARE_IP_HEADER = 'true';

const { default: db } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');
const { postJournal } = await import('../src/accounting/journalService.js');

let server;
let baseUrl;
const tokens = {};

async function request(pathname, options = {}) {
  const headers = { ...(options.token ? { Cookie: options.token } : {}), ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

before(async () => {
  for (const [name, role] of [['admin', 'admin'], ['cashier', 'kasir'], ['technician', 'teknisi']]) {
    db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)').run(name, name, hashPassword('password-12345'), role);
  }
  db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Test Customer', '0800000000');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const username of ['admin', 'cashier', 'technician']) {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'password-12345' }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.token, undefined);
    const setCookie = result.headers.get('set-cookie');
    assert.match(setCookie || '', /HttpOnly/);
    tokens[username] = setCookie.split(';')[0];
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm', '.pin-key']) {
    try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
  }
});

test('permission: teknisi dapat membaca produk tetapi tidak membuat produk', async () => {
  const read = await request('/api/products', { token: tokens.technician });
  assert.equal(read.status, 200);
  const create = await request('/api/products', { method: 'POST', token: tokens.technician, body: JSON.stringify({ category: 'laptop', name: 'Forbidden', stock: 1 }) });
  assert.equal(create.status, 403);
  const customerDirectory = await request('/api/customers', { token: tokens.technician });
  assert.equal(customerDirectory.status, 403);
});

test('security headers: API sends CSP and same-origin camera permission', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(health.headers.get('permissions-policy') || '', /camera=\(self\)/);
});

test('cash advances create operating expense and payable, then reimburse without duplicating expense', async () => {
  const unauthorized = await request('/api/cash-advances', { method: 'POST', token: tokens.technician, body: JSON.stringify({}) });
  assert.equal(unauthorized.status, 403);

  const invalid = await request('/api/cash-advances', {
    method: 'POST',
    token: tokens.admin,
    body: JSON.stringify({ lenderName: 'Febry', category: 'Pembelian part', description: 'SSD untuk stok jual', amount: 90000, expenseDate: '2026-10-10', expenseAccountCode: '1320', idempotencyKey: 'advance-invalid' })
  });
  assert.equal(invalid.status, 400);

  const payload = {
    lenderName: 'Febry',
    category: 'Makan/minum',
    description: 'Makan malam karyawan',
    amount: 90000,
    expenseDate: '2026-10-10',
    expenseAccountCode: '6200',
    idempotencyKey: 'advance-meal-001'
  };
  const created = await request('/api/cash-advances', { method: 'POST', token: tokens.admin, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  assert.equal(created.body.outstanding_amount, 90000);
  assert.equal(created.body.duplicate, false);
  assert.equal((await request('/api/reports/payables?as_of=2026-10-10', { token: tokens.admin })).body.total, 90000);
  const duplicate = await request('/api/cash-advances', { method: 'POST', token: tokens.admin, body: JSON.stringify(payload) });
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'cash_advance_expense'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cash_entries WHERE category = 'Penggantian talangan'").get().count, 0);

  const firstPayment = {
    amount: 30000,
    paidDate: '2026-10-11',
    cashAccountCode: '1110',
    idempotencyKey: 'advance-payment-001'
  };
  const paid = await request(`/api/cash-advances/${created.body.id}/reimbursements`, { method: 'POST', token: tokens.admin, body: JSON.stringify(firstPayment) });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.expense.outstanding_amount, 60000);
  const duplicatePayment = await request(`/api/cash-advances/${created.body.id}/reimbursements`, { method: 'POST', token: tokens.admin, body: JSON.stringify(firstPayment) });
  assert.equal(duplicatePayment.body.duplicate, true);
  const overpayment = await request(`/api/cash-advances/${created.body.id}/reimbursements`, {
    method: 'POST',
    token: tokens.admin,
    body: JSON.stringify({ amount: 60001, paidDate: '2026-10-11', cashAccountCode: '1110', idempotencyKey: 'advance-payment-over' })
  });
  assert.equal(overpayment.status, 400);
  assert.equal((await request('/api/cash-entries?from=2026-10-10&to=2026-10-11', { token: tokens.admin })).body.summary.pengeluaran, 30000);

  const finalPayment = await request(`/api/cash-advances/${created.body.id}/reimbursements`, {
    method: 'POST',
    token: tokens.admin,
    body: JSON.stringify({ amount: 60000, paidDate: '2026-10-12', cashAccountCode: '1120', idempotencyKey: 'advance-payment-002' })
  });
  assert.equal(finalPayment.body.expense.outstanding_amount, 0);
  const outstanding = await request('/api/cash-advances?from=2026-10-10&to=2026-10-12', { token: tokens.admin });
  assert.equal(outstanding.body.outstanding, 0);
  assert.equal(outstanding.body.expenses[0].reimbursed_amount, 90000);
  assert.equal((await request('/api/reports/payables?as_of=2026-10-12', { token: tokens.admin })).body.total, 0);
  assert.equal((await request('/api/reports/profit-loss?from=2026-10-10&to=2026-10-12', { token: tokens.admin })).body.operating_expenses, 90000);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cash_entries WHERE category = 'Penggantian talangan'").get().count, 2);
  const debtBalance = db.prepare(`SELECT COALESCE(SUM(journal_lines.credit - journal_lines.debit), 0) AS balance
    FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id
    JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
    WHERE accounts.code = '2510' AND journal_entries.status = 'posted'`).get().balance;
  assert.equal(debtBalance, 0);

  const ownerExpense = await request('/api/cash-advances', {
    method: 'POST',
    token: tokens.admin,
    body: JSON.stringify({ lenderName: 'Febry', category: 'Pengeluaran pribadi owner', description: 'Pribadi Kevin', amount: 25000, expenseDate: '2026-10-13', expenseAccountCode: '3120', idempotencyKey: 'advance-owner-001' })
  });
  assert.equal(ownerExpense.status, 201);
  assert.equal((await request('/api/reports/profit-loss?from=2026-10-13&to=2026-10-13', { token: tokens.admin })).body.operating_expenses, 0);
});

test('financial reports use posted journals, period filters, and reconcile balance sheet', async () => {
  const post = (sourceId, lines, date = '2025-01-15') => postJournal(db, {
    entryDate: date, postingDate: date, source: { type: 'report_fixture', id: sourceId, event: 'recognition' },
    idempotencyKey: `report-fixture:${sourceId}`, description: `Fixture ${sourceId}`, createdBy: 1, lines
  });
  post('cash-sale', [{ accountCode: '1110', debit: 5000000, credit: 0 }, { accountCode: '4100', debit: 0, credit: 5000000 }]);
  post('laptop-hpp', [{ accountCode: '5100', debit: 4000000, credit: 0 }, { accountCode: '1310', debit: 0, credit: 4000000 }]);
  post('operating-expense', [{ accountCode: '6200', debit: 100000, credit: 0 }, { accountCode: '1110', debit: 0, credit: 100000 }]);
  post('receivable', [{ accountCode: '1200', debit: 700000, credit: 0 }, { accountCode: '4200', debit: 0, credit: 700000 }]);
  post('supplier-debt', [{ accountCode: '1320', debit: 200000, credit: 0 }, { accountCode: '2100', debit: 0, credit: 200000 }]);
  const draft = db.prepare("INSERT INTO journal_entries (entry_number, entry_date, posting_date, description, request_hash, created_by) VALUES ('JRN-DRAFT-REPORT', '2025-01-15', '2025-01-15', 'Draft', 'draft-report', 1)").run();
  db.prepare("INSERT INTO journal_lines (journal_entry_id, line_number, account_id, debit, credit) VALUES (?, 1, (SELECT id FROM accounts WHERE code = '4100'), 999999, 0)").run(draft.lastInsertRowid);

  const profit = await request('/api/reports/profit-loss?from=2025-01-01&to=2025-01-31', { token: tokens.admin });
  assert.equal(profit.status, 200);
  assert.equal(profit.body.revenue, 5700000);
  assert.equal(profit.body.cogs, 4000000);
  assert.equal(profit.body.operating_expenses, 100000);
  assert.equal(profit.body.net_profit, 1600000);
  const outOfPeriod = await request('/api/reports/profit-loss?from=2025-02-01&to=2025-02-28', { token: tokens.admin });
  assert.equal(outOfPeriod.body.revenue, 0);
  const trial = await request('/api/reports/trial-balance?as_of=2025-01-31', { token: tokens.admin });
  assert.equal(trial.body.balanced, true);
  assert.equal(trial.body.totals.debit, trial.body.totals.credit);
  const balance = await request('/api/reports/balance-sheet?as_of=2025-01-31', { token: tokens.admin });
  assert.equal(balance.body.balanced, true);
  assert.equal(balance.body.difference, 0);
  assert.equal(balance.body.total_assets, balance.body.total_liabilities + balance.body.total_equity);
  const ledger = await request('/api/reports/general-ledger?from=2025-01-01&to=2025-01-31&account_code=4100', { token: tokens.admin });
  assert.equal(ledger.body.lines.length, 1);
  assert.equal(ledger.body.lines[0].running_balance, -5000000);
  const cashFlow = await request('/api/reports/cash-flow?from=2025-01-01&to=2025-01-31', { token: tokens.admin });
  assert.equal(cashFlow.body.net_change, 4900000);
  for (const type of ['inventory', 'unit-profit', 'service-profit', 'stock-aging']) {
    const query = ['inventory', 'stock-aging'].includes(type) ? '?as_of=2025-01-31' : '?from=2025-01-01&to=2025-01-31';
    const report = await request(`/api/reports/${type}${query}`, { token: tokens.admin });
    assert.equal(report.status, 200, `${type}: ${JSON.stringify(report.body)}`);
  }
  assert.equal((await request('/api/reports/payables?as_of=2025-01-31', { token: tokens.admin })).body.total, 200000);
  assert.equal((await request('/api/reports/receivables?as_of=2025-01-31', { token: tokens.admin })).body.total, 700000);
  assert.equal((await request('/api/reports/profit-loss?from=2025-01-01&to=2025-01-31', { token: tokens.cashier })).status, 403);
});

test('reconciliation requires balanced verified opening data and keeps ambiguous cash mappings as drafts', async () => {
  const unbalanced = await request('/api/reconciliation/opening-balances', { method: 'POST', token: tokens.admin, body: JSON.stringify({ effectiveDate: '2026-10-01', sourceSummary: 'Rekening koran fixture' }) });
  assert.equal(unbalanced.status, 200);
  await request(`/api/reconciliation/opening-balances/${unbalanced.body.id}/lines`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ accountCode: '1110', side: 'debit', amount: 100000, sourceType: 'bank_statement', sourceReference: 'BANK-001', verificationStatus: 'verified' }) });
  const rejected = await request(`/api/reconciliation/opening-balances/${unbalanced.body.id}/approve`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /belum seimbang/);

  const balanced = await request('/api/reconciliation/opening-balances', { method: 'POST', token: tokens.admin, body: JSON.stringify({ effectiveDate: '2026-10-02', sourceSummary: 'Kas opname fixture' }) });
  await request(`/api/reconciliation/opening-balances/${balanced.body.id}/lines`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ accountCode: '1110', side: 'debit', amount: 100000, sourceType: 'cash_count', sourceReference: 'OPNAME-001', verificationStatus: 'verified' }) });
  await request(`/api/reconciliation/opening-balances/${balanced.body.id}/lines`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ accountCode: '2100', side: 'credit', amount: 100000, sourceType: 'supplier_statement', sourceReference: 'SUP-001', verificationStatus: 'verified' }) });
  assert.equal((await request(`/api/reconciliation/opening-balances/${balanced.body.id}/approve`, { method: 'POST', token: tokens.admin, body: '{}' })).status, 200);
  const posted = await request(`/api/reconciliation/opening-balances/${balanced.body.id}/post`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(posted.status, 200);
  assert.equal((await request(`/api/reconciliation/opening-balances/${balanced.body.id}/post`, { method: 'POST', token: tokens.admin, body: '{}' })).body.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'opening_balance' AND source_id = ?").get(String(balanced.body.id)).count, 1);

  const cash = db.prepare("INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES ('pengeluaran', 'Lainnya', 'Catatan lama tanpa klasifikasi', 5000, 'manual', '2026-10-03', 1)").run();
  const mapping = await request(`/api/reconciliation/cash-mappings/${cash.lastInsertRowid}`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(mapping.status, 200);
  assert.equal(mapping.body.status, 'ambiguous');
  assert.equal((await request(`/api/reconciliation/cash-mappings/${cash.lastInsertRowid}`, { method: 'POST', token: tokens.admin, body: '{}' })).body.duplicate, true);
  const ambiguousApproval = await request(`/api/reconciliation/cash-mappings/${mapping.body.id}/approve`, { method: 'POST', token: tokens.admin, body: JSON.stringify({}) });
  assert.equal(ambiguousApproval.status, 400);
  assert.equal((await request(`/api/reconciliation/cash-mappings/${mapping.body.id}/post`, { method: 'POST', token: tokens.admin, body: '{}' })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'cash_entry' AND source_id = ?").get(String(cash.lastInsertRowid)).count, 0);

  const purchaseCash = db.prepare("INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES ('pengeluaran', 'Pembelian', 'Pembelian spare part legacy', 7000, 'manual', '2026-10-04', 1)").run();
  const purchaseMapping = await request(`/api/reconciliation/cash-mappings/${purchaseCash.lastInsertRowid}`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(purchaseMapping.body.status, 'draft');
  const approvedMapping = await request(`/api/reconciliation/cash-mappings/${purchaseMapping.body.id}/approve`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ debitAccountCode: '1320', creditAccountCode: '1110', categoryCode: 'pembelian_persediaan' }) });
  assert.equal(approvedMapping.body.status, 'approved');
  const postedMapping = await request(`/api/reconciliation/cash-mappings/${purchaseMapping.body.id}/post`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(postedMapping.body.status, 'posted');
  assert.equal((await request(`/api/reconciliation/cash-mappings/${purchaseMapping.body.id}/post`, { method: 'POST', token: tokens.admin, body: '{}' })).body.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'cash_entry' AND source_id = ?").get(String(purchaseCash.lastInsertRowid)).count, 1);
  const mappingLines = db.prepare('SELECT accounts.code, journal_lines.debit, journal_lines.credit FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entry_id = ? ORDER BY line_number').all(postedMapping.body.journal_entry_id);
  assert.deepEqual(mappingLines, [{ code: '1320', debit: 7000, credit: 0 }, { code: '1110', debit: 0, credit: 7000 }]);

  const legacyProduct = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Reconciliation Legacy Fixture', brand: 'Test', selling_price: 300000, stock: 2 }) });
  const valuation = await request('/api/reconciliation/legacy-valuations', { method: 'POST', token: tokens.admin, body: JSON.stringify({ productId: legacyProduct.body.id, quantity: 2, purchaseCost: 200000, sourceType: 'test_evidence', sourceReference: 'TEST-EVIDENCE-001', verificationNote: 'Synthetic test evidence only' }) });
  assert.equal(valuation.status, 200);
  assert.equal(valuation.body.verification_status, 'pending');
  assert.equal(valuation.body.journal_entry_id, null);
  const verifiedValuation = await request(`/api/reconciliation/legacy-valuations/${valuation.body.id}/verify`, { method: 'POST', token: tokens.admin, body: '{}' });
  assert.equal(verifiedValuation.body.verification_status, 'verified');
  assert.equal(verifiedValuation.body.journal_entry_id, null);
  const valuationAudit = db.prepare("SELECT action, snapshot_json FROM reconciliation_audit_log WHERE entity_type = 'legacy_valuation' AND entity_id = ? ORDER BY id").all(valuation.body.id);
  assert.deepEqual(valuationAudit.map((row) => row.action), ['created', 'verified']);
  assert.match(valuationAudit[1].snapshot_json, /TEST-EVIDENCE-001/);

  assert.throws(() => db.prepare('UPDATE journal_entries SET description = ? WHERE id = ?').run('direct edit', postedMapping.body.journal_entry_id), /tidak dapat diedit/);
  const reportStatus = await request('/api/reports/trial-balance?as_of=2026-10-04', { token: tokens.admin });
  assert.equal(reportStatus.body.is_final, false);
  assert.ok(reportStatus.body.completeness.legacy_stock_units >= 2);
  assert.ok(reportStatus.body.completeness.cash_entries_unreconciled >= 1);
  const blockers = await request('/api/reconciliation/blockers?as_of=2026-10-04', { token: tokens.admin });
  assert.equal(blockers.status, 200);
  const stockBlocker = blockers.body.legacy_stock.find((item) => item.source.product_id === legacyProduct.body.id);
  assert.equal(stockBlocker.source.legacy_stock, 2);
  assert.equal(stockBlocker.source.cost_price, 0);
  assert.equal(stockBlocker.source.individual_unit_count, 0);
  assert.deepEqual(stockBlocker.candidate_classifications, ['store_inventory_verified_cost', 'customer_owned_excluded', 'pending_unvalued']);
  assert.equal(stockBlocker.approval.status, 'review_verified_stock_still_open');
  assert.ok(stockBlocker.audit_history.length >= 2);
  const cashBlocker = blockers.body.ambiguous_cash.find((item) => item.source.id === Number(cash.lastInsertRowid));
  assert.equal(cashBlocker.source.amount, 5000);
  assert.equal(cashBlocker.related_journals.length, 0);
  assert.ok(cashBlocker.candidate_classifications.includes('prive'));
  assert.equal(cashBlocker.approval.status, 'ambiguous');
  assert.ok(cashBlocker.audit_history.some((entry) => entry.action === 'created'));
});

test('receipt branding, customer phone, social details, and PDF are included', async () => {
  const settings = await request('/api/settings', { method: 'PUT', token: tokens.admin, body: JSON.stringify({
    store_name: 'Lapak Test',
    store_phone: '0215550100',
    store_logo_data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8o0AAAAASUVORK5CYII=',
    store_instagram: '@lapak.test',
    store_facebook: 'facebook.com/lapak.test',
    store_tiktok: '@lapak.test',
    store_whatsapp: '6281234567890',
    paper_size_preference: '58mm'
  }) });
  assert.equal(settings.status, 200);
  const product = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Receipt Branding Test', selling_price: 100000, stock: 1 }) });
  const transaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: product.body.id, qty: 1 }] }) });
  const receipt = await request(`/api/transactions/${transaction.body.id}/receipt`, { token: tokens.cashier });
  assert.equal(receipt.body.customer_phone, '0800000000');
  assert.equal(receipt.body.store_logo_data_url, settings.body.store_logo_data_url);
  assert.equal(receipt.body.store_instagram, '@lapak.test');
  assert.equal(receipt.body.store_facebook, 'facebook.com/lapak.test');
  assert.equal(receipt.body.store_tiktok, '@lapak.test');
  assert.equal(receipt.body.store_whatsapp, '6281234567890');
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Branded Opening Receipt', issues: 'Branding test' }) });
  const openingReceipt = await request(`/api/services/${service.body.id}/opening-receipt`, { token: tokens.cashier });
  assert.equal(openingReceipt.body.customer_phone, '0800000000');
  assert.equal(openingReceipt.body.store_logo_data_url, settings.body.store_logo_data_url);
  assert.equal(openingReceipt.body.store_whatsapp, '6281234567890');
  const pdf = await createReceiptPdf(receipt.body);
  assert.match(pdf.fileName, /^Nota-INV-/);
  assert.equal(pdf.blob.type, 'application/pdf');
  const signature = Buffer.from(await pdf.blob.arrayBuffer()).subarray(0, 4).toString();
  assert.equal(signature, '%PDF');
});

test('state-changing requests reject an unapproved browser origin', async () => {
  const response = await request('/api/cash-entries', {
    method: 'POST',
    token: tokens.cashier,
    headers: { Origin: 'https://untrusted.example' },
    body: JSON.stringify({ entry_type: 'pemasukan', category: 'Test', description: 'CSRF test', amount: 1 })
  });
  assert.equal(response.status, 403);
});

test('login throttling keys Cloudflare clients separately', async () => {
  const attempt = () => request('/api/auth/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.25' },
    body: JSON.stringify({ username: 'unknown-user', password: 'wrong-password' })
  });
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
  const otherClient = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.26' },
    body: JSON.stringify({ username: 'unknown-user', password: 'wrong-password' })
  });
  assert.equal(otherClient.status, 401);
});

test('product category: Gadget can be created and filtered', async () => {
  const created = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Test Gadget', brand: 'Samsung', selling_price: 5000000, cost_price: 4000000, stock: 2 }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.category, 'gadget');
  const filtered = await request('/api/products?category=gadget&include_out_of_stock=true', { token: tokens.cashier });
  assert.ok(filtered.body.some((product) => product.id === created.body.id));
});

test('product deletion is allowed without transaction history and blocked when referenced', async () => {
  const disposable = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Disposable Gadget', stock: 1 }) });
  const forbidden = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.technician });
  assert.equal(forbidden.status, 403);
  const removed = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(removed.status, 204);
  const missing = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(missing.status, 404);

  const referenced = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Referenced Gadget', selling_price: 1000, stock: 1 }) });
  await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: referenced.body.id, qty: 1 }] }) });
  const blocked = await request(`/api/products/${referenced.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(blocked.status, 409);
});

test('transaction and stock: checkout reduces stock and rejects overselling', async () => {
  const created = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Test Laptop', selling_price: 1000000, stock: 1 }) });
  assert.equal(created.status, 201);
  const payload = { customer_id: 1, transaction_type: 'penjualan', transaction_stage: 'opening', record_cash: false, payment_status: 'bayar_nanti', payment_method: 'cash', items: [{ item_type: 'product', reference_id: created.body.id, qty: 1 }] };
  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.transaction_stage, 'final');
  assert.equal(sale.body.payment_status, 'lunas');
  assert.ok((await request('/api/transactions', { token: tokens.cashier })).body.some((item) => item.id === sale.body.id));
  const inventory = await request('/api/products?include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventory.body.find((item) => item.id === created.body.id).stock, 0);
  const oversell = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(oversell.status, 400);
});

test('trade-in checkout adds the received device to inventory', async () => {
  const soldProduct = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Trade-in Test Sale', selling_price: 5000000, stock: 1 }) });
  const transaction = await request('/api/transactions', {
    method: 'POST',
    token: tokens.cashier,
    body: JSON.stringify({
      customer_id: 1,
      transaction_type: 'tukar_tambah',
      items: [
        { item_type: 'product', reference_id: soldProduct.body.id, qty: 1 },
        { item_type: 'trade_in', name: 'iPad 11 (A16)', category: 'gadget', price: 3000000, selling_price: 4000000, qty: 1 }
      ]
    })
  });

  assert.equal(transaction.status, 201);
  assert.equal(transaction.body.subtotal, 5000000);
  assert.equal(transaction.body.trade_in_total, 3000000);
  assert.equal(transaction.body.grand_total, 2000000);
  const tradeInItem = transaction.body.items.find((item) => item.item_type === 'trade_in');
  assert.equal(tradeInItem.name, 'iPad 11 (A16)');
  const inventory = await request('/api/products?search=iPad%2011%20(A16)', { token: tokens.cashier });
  const receivedProduct = inventory.body.find((product) => product.id === tradeInItem.reference_id);
  assert.ok(receivedProduct);
  assert.equal(receivedProduct.category, 'gadget');
  assert.equal(receivedProduct.stock, 1);
  assert.equal(receivedProduct.cost_price, 3000000);
  assert.equal(receivedProduct.selling_price, 4000000);
  const saleJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(transaction.body.id));
  assert.equal(db.prepare("SELECT SUM(credit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '4100')").get(saleJournal.id).amount, 5000000);
  assert.equal(db.prepare("SELECT SUM(debit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '1330')").get(saleJournal.id).amount, 3000000);
  const refund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Pembatalan tukar tambah' }) });
  assert.equal(refund.status, 201);
  const returnedTradeIn = await request('/api/products?search=iPad%2011%20(A16)&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(returnedTradeIn.body.find((product) => product.id === receivedProduct.id).stock, 0);
  const returnedSale = await request('/api/products?search=Trade-in%20Test%20Sale&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(returnedSale.body[0].stock, 1);
});

test('transaction refund restores inventory and cannot be repeated', async () => {
  const product = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Refund Test Laptop', selling_price: 2500000, stock: 1 }) });
  const transaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: product.body.id, qty: 1 }] }) });
  const refundPayload = JSON.stringify({ reason: 'Barang tidak sesuai pesanan' });
  const forbidden = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.technician, body: refundPayload });
  assert.equal(forbidden.status, 403);

  const refund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: refundPayload });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.refund_amount, transaction.body.paid_amount);
  assert.equal(refund.body.refund_reason, 'Barang tidak sesuai pesanan');
  assert.ok(refund.body.refunded_at);
  const inventory = await request('/api/products?search=Refund%20Test%20Laptop&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventory.body[0].stock, 1);
  const cashRefund = db.prepare("SELECT * FROM cash_entries WHERE source = 'transaction' AND category = 'Refund' AND description LIKE ?").get(`Refund ${transaction.body.invoice_number}:%`);
  assert.equal(cashRefund.amount, transaction.body.paid_amount);
  const cashList = await request(`/api/cash-entries?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { token: tokens.cashier });
  assert.ok(cashList.body.summary.pengeluaran >= cashRefund.amount);
  const editRefund = await request(`/api/cash-entries/${cashRefund.id}`, { method: 'PUT', token: tokens.cashier, body: JSON.stringify({ entry_type: 'pengeluaran', category: 'Refund', description: 'Edit', amount: cashRefund.amount }) });
  assert.equal(editRefund.status, 409);
  const deleteRefund = await request(`/api/cash-entries/${cashRefund.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(deleteRefund.status, 409);

  const duplicateRefund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: refundPayload });
  assert.equal(duplicateRefund.status, 409);
  const settlement = await request(`/api/transactions/${transaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 1000 }) });
  assert.equal(settlement.status, 409);
  const inventoryAfterDuplicate = await request('/api/products?search=Refund%20Test%20Laptop&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventoryAfterDuplicate.body[0].stock, 1);
});

test('purchases, repair costs, FIFO spare parts, unit HPP, double-sale prevention, and refund are journaled atomically', async () => {
  const supplier = await request('/api/suppliers', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ name: 'Unit Test Supplier' }) });
  assert.equal(supplier.status, 201);
  const laptop = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Unit HPP Laptop', selling_price: 3000000, stock: 0 }) });
  const part = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'part_copotan', name: 'Unit HPP SSD', selling_price: 30000, stock: 0 }) });
  assert.equal(laptop.status, 201);
  assert.equal(part.status, 201);
  const purchasePayload = {
    sourceType: 'supplier',
    supplierId: supplier.body.id,
    supplierInvoice: 'SUP-UNIT-HPP-001',
    purchaseDate: '2026-10-01',
    paymentMode: 'credit',
    discountAmount: 30000,
    idempotencyKey: 'purchase-unit-hpp-001',
    items: [
      { productId: laptop.body.id, quantity: 1, unitCost: 2000000, condition: 'B', serialNumbers: ['UNIT-HPP-SN-001'] },
      { productId: part.body.id, quantity: 3, unitCost: 10000 }
    ]
  };
  const purchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify(purchasePayload) });
  assert.equal(purchase.status, 201);
  assert.equal(purchase.body.gross_amount, 2030000);
  assert.equal(purchase.body.discount_amount, 30000);
  assert.equal(purchase.body.total_amount, 2000000);
  assert.equal(purchase.body.units.length, 1);
  assert.equal(purchase.body.units[0].status, 'received');
  assert.equal(purchase.body.units[0].serial_number, 'UNIT-HPP-SN-001');
  assert.equal(purchase.body.units[0].acquisition_cost, 1970443);
  const purchaseDetail = await request(`/api/inventory/purchases/${purchase.body.id}`, { token: tokens.cashier });
  assert.equal(purchaseDetail.status, 200);
  assert.equal(purchaseDetail.body.items[0].net_amount, 1970443);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(part.body.id).stock, 3);
  const secondPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, supplierInvoice: 'SUP-UNIT-HPP-002', purchaseDate: '2026-10-02', paymentMode: 'credit', idempotencyKey: 'purchase-unit-hpp-002', items: [{ productId: laptop.body.id, quantity: 1, unitCost: 2500000, condition: 'A', serialNumbers: ['UNIT-HPP-SN-002'] }] }) });
  assert.equal(secondPurchase.status, 201);
  assert.equal(secondPurchase.body.units[0].acquisition_cost, 2500000);
  const duplicatePurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify(purchasePayload) });
  assert.equal(duplicatePurchase.status, 201);
  assert.equal(duplicatePurchase.body.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inventory_purchases').get().count, 2);
  const purchaseJournal = db.prepare('SELECT id FROM journal_entries WHERE id = ? AND status = ?').get(purchase.body.journal_entry_id, 'posted');
  assert.ok(purchaseJournal);
  const purchaseTotals = db.prepare('SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_lines WHERE journal_entry_id = ?').get(purchaseJournal.id);
  assert.equal(purchaseTotals.debit, 2000000);
  assert.equal(purchaseTotals.credit, 2000000);
  assert.equal(db.prepare('SELECT total_cost FROM part_stock_layers WHERE product_id = ?').get(part.body.id).total_cost, 29557);

  const unit = purchase.body.units[0];
  for (const status of ['inspection', 'repair', 'ready']) {
    const changed = await request(`/api/inventory/units/${unit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: status, reason: `Status ${status}` }) });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
  }
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 1);
  const invalidLegacyEdit = await request(`/api/products/${laptop.body.id}`, { method: 'PUT', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Unit HPP Laptop', brand: '', specs: {}, serial_number: null, grade_condition: 'B', cost_price: 0, selling_price: 3000000, stock: 0, notes: '' }) });
  assert.equal(invalidLegacyEdit.status, 409);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 1);

  const capitalizedRepair = await request(`/api/inventory/units/${unit.id}/repair-costs`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 250000, componentType: 'repair', description: 'Perbaikan board', treatment: 'capitalized', reason: 'Biaya langsung untuk memulihkan unit siap jual', creditAccountCode: '1110', entryDate: '2026-10-02', idempotencyKey: 'repair-unit-hpp-001' }) });
  assert.equal(capitalizedRepair.status, 201);
  const expensedRepair = await request(`/api/inventory/units/${unit.id}/repair-costs`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 50000, componentType: 'repair', description: 'Pemborosan perbaikan', treatment: 'expense', reason: 'Biaya abnormal tidak memenuhi syarat kapitalisasi', creditAccountCode: '2300', entryDate: '2026-10-02', idempotencyKey: 'repair-unit-expense-001' }) });
  assert.equal(expensedRepair.status, 201);
  assert.equal(db.prepare('SELECT acquisition_cost FROM inventory_unit_costs WHERE unit_id = ?').get(unit.id).acquisition_cost, 2220443);
  const expenseJournalLines = db.prepare(`SELECT accounts.code AS code, journal_lines.debit, journal_lines.credit FROM journal_lines
    JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entry_id = ? ORDER BY line_number`).all(expensedRepair.body.journalEntryId);
  assert.deepEqual(expenseJournalLines.map(({ code, debit, credit }) => ({ code, debit, credit })), [
    { code: '6510', debit: 50000, credit: 0 },
    { code: '2300', debit: 0, credit: 50000 }
  ]);
  const partUse = await request(`/api/inventory/units/${unit.id}/spare-parts`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ productId: part.body.id, quantity: 2, description: 'Upgrade SSD unit', treatment: 'capitalized', reason: 'Part terpasang dan menambah kondisi unit siap jual', entryDate: '2026-10-03', idempotencyKey: 'part-unit-hpp-001' }) });
  assert.equal(partUse.status, 201);
  assert.equal(partUse.body.amount, 19704);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(part.body.id).stock, 1);
  assert.equal(db.prepare('SELECT acquisition_cost FROM inventory_unit_costs WHERE unit_id = ?').get(unit.id).acquisition_cost, 2240147);
  const costDecision = db.prepare('SELECT treatment, treatment_reason, journal_entry_id FROM inventory_cost_components WHERE id = ?').get(capitalizedRepair.body.id);
  assert.equal(costDecision.treatment, 'capitalized');
  const unitCostHistory = await request(`/api/inventory/units/${unit.id}/cost-components`, { token: tokens.cashier });
  assert.equal(unitCostHistory.status, 200);
  assert.equal(unitCostHistory.body.length, 3);
  const unitMovements = await request(`/api/inventory/units/${unit.id}/movements`, { token: tokens.admin });
  assert.equal(unitMovements.status, 200);
  assert.deepEqual(unitMovements.body.map((movement) => movement.to_status), ['received', 'inspection', 'repair', 'ready']);
  assert.ok(costDecision.journal_entry_id);

  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: laptop.body.id, qty: 1 }] }) });
  assert.equal(sale.status, 201);
  const saleItem = sale.body.items[0];
  assert.equal(saleItem.allocated_hpp, 2240147);
  assert.equal(saleItem.legacy_stock_qty, 0);
  assert.equal(db.prepare('SELECT status FROM inventory_units WHERE id = ?').get(unit.id).status, 'sold');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 0);
  const hppJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'sale_cogs' AND source_id = ?").get(String(saleItem.id));
  const hppTotals = db.prepare('SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_lines WHERE journal_entry_id = ?').get(hppJournal.id);
  assert.equal(hppTotals.debit, 2240147);
  assert.equal(hppTotals.credit, 2240147);
  assert.equal(db.prepare("SELECT SUM(debit) AS total FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '5100')").get(hppJournal.id).total, 2240147);
  const revenueJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ? AND source_event = 'recognition'").get(String(sale.body.id));
  assert.ok(revenueJournal);
  assert.equal(db.prepare("SELECT SUM(credit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '4100')").get(revenueJournal.id).amount, 3000000);

  const secondSale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: laptop.body.id, qty: 1 }] }) });
  assert.equal(secondSale.status, 400);
  const secondUnit = secondPurchase.body.units[0];
  await request(`/api/inventory/units/${secondUnit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: 'inspection', reason: 'Pemeriksaan unit kedua' }) });
  await request(`/api/inventory/units/${secondUnit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: 'ready', reason: 'QC unit kedua lulus' }) });
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 1);
  const secondUnitSale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: laptop.body.id, qty: 1 }] }) });
  assert.equal(secondUnitSale.status, 201);
  assert.equal(secondUnitSale.body.items[0].allocated_hpp, 2500000);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 0);
  const refund = await request(`/api/transactions/${sale.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Refund unit HPP test' }) });
  assert.equal(refund.status, 201);
  const returnedUnit = db.prepare('SELECT status, returned_to_owner FROM inventory_units WHERE id = ?').get(unit.id);
  assert.equal(returnedUnit.status, 'returned');
  assert.equal(returnedUnit.returned_to_owner, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 0);
  const reversedHpp = db.prepare('SELECT status, reversal_entry_id FROM journal_entries WHERE id = ?').get(hppJournal.id);
  assert.equal(reversedHpp.status, 'reversed');
  assert.ok(reversedHpp.reversal_entry_id);
  const resellAfterRefund = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: laptop.body.id, qty: 1 }] }) });
  assert.equal(resellAfterRefund.status, 400);
  const partStock = await request('/api/products?search=Unit%20HPP%20SSD&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(partStock.body[0].stock, 1);
});

test('one refund safely reverses multiple unit and FIFO layer allocations', async () => {
  const supplier = await request('/api/suppliers', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ name: 'Multi Allocation Supplier' }) });
  const laptop = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Multi Allocation Laptop', selling_price: 1000000, stock: 0 }) });
  const part = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'part_copotan', name: 'Multi Allocation Part', selling_price: 10000, stock: 0 }) });
  const laptopPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-04', paymentMode: 'credit', idempotencyKey: 'multi-unit-purchase', items: [{ productId: laptop.body.id, quantity: 2, unitCost: 700000, serialNumbers: ['MULTI-UNIT-1', 'MULTI-UNIT-2'] }] }) });
  assert.equal(laptopPurchase.status, 201);
  for (const unit of laptopPurchase.body.units) {
    await request(`/api/inventory/units/${unit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: 'inspection', reason: 'Inspeksi awal' }) });
    await request(`/api/inventory/units/${unit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: 'ready', reason: 'QC lulus' }) });
  }
  const firstPartPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-04', paymentMode: 'credit', idempotencyKey: 'multi-part-purchase-1', items: [{ productId: part.body.id, quantity: 1, unitCost: 5000 }] }) });
  const secondPartPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-05', paymentMode: 'credit', idempotencyKey: 'multi-part-purchase-2', items: [{ productId: part.body.id, quantity: 2, unitCost: 8000 }] }) });
  assert.equal(firstPartPurchase.status, 201);
  assert.equal(secondPartPurchase.status, 201);

  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [
    { item_type: 'product', reference_id: laptop.body.id, qty: 2 },
    { item_type: 'product', reference_id: part.body.id, qty: 3 }
  ] }) });
  assert.equal(sale.status, 201);
  const laptopItem = sale.body.items.find((item) => item.reference_id === laptop.body.id);
  const partItem = sale.body.items.find((item) => item.reference_id === part.body.id);
  assert.equal(laptopItem.allocated_hpp, 1400000);
  assert.equal(partItem.allocated_hpp, 21000);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inventory_unit_allocations WHERE transaction_item_id = ? AND status = ?').get(laptopItem.id, 'allocated').count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM part_stock_allocations WHERE transaction_item_id = ? AND status = ?').get(partItem.id, 'allocated').count, 2);

  const refund = await request(`/api/transactions/${sale.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Pembatalan multi unit' }) });
  assert.equal(refund.status, 201);
  const refundId = db.prepare('SELECT id FROM transaction_refunds WHERE transaction_id = ?').get(sale.body.id).id;
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inventory_unit_allocations WHERE refund_id = ? AND status = ?').get(refundId, 'refunded').count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM part_stock_allocations WHERE refund_id = ? AND status = ?').get(refundId, 'refunded').count, 2);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(part.body.id).stock, 3);
});

test('partial settlement posts cash against receivable once and refund reverses sale and payment journals', async () => {
  const product = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Settlement Journal Gadget', selling_price: 100000, stock: 1 }) });
  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, paid_amount: 20000, payment_method: 'cash', items: [{ item_type: 'product', reference_id: product.body.id, qty: 1 }] }) });
  assert.equal(sale.status, 201);
  const saleJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(sale.body.id));
  assert.ok(saleJournal);
  assert.equal(db.prepare("SELECT SUM(credit) AS total FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '4100')").get(saleJournal.id).total, 100000);
  assert.equal(db.prepare("SELECT SUM(debit) AS total FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '1110')").get(saleJournal.id).total, 20000);
  assert.equal(db.prepare("SELECT SUM(debit) AS total FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '1200')").get(saleJournal.id).total, 80000);

  const payload = JSON.stringify({ amount: 30000, payment_method: 'transfer', idempotency_key: 'settlement-gadget-001' });
  const settled = await request(`/api/transactions/${sale.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: payload });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.paid_amount, 50000);
  const replay = await request(`/api/transactions/${sale.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: payload });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.paid_amount, 50000);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transaction_payment_events WHERE transaction_id = ?').get(sale.body.id).count, 1);
  const settlementJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_payment' AND source_id = ?").get(String(sale.body.id));
  assert.ok(settlementJournal);
  assert.equal(db.prepare("SELECT SUM(credit) AS total FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '1200')").get(settlementJournal.id).total, 30000);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(sale.body.id)).count, 1);
  const conflictingReplay = await request(`/api/transactions/${sale.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 30000, payment_method: 'cash', idempotency_key: 'settlement-gadget-001' }) });
  assert.equal(conflictingReplay.status, 409);

  const refund = await request(`/api/transactions/${sale.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Refund setelah DP dan pelunasan sebagian' }) });
  assert.equal(refund.status, 201);
  assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(saleJournal.id).status, 'reversed');
  assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(settlementJournal.id).status, 'reversed');
});

test('service deposit remains a liability until completion, then settlement and refund are journaled', async () => {
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Deposit Journal Service', issues: 'Test DP flow', estimated_cost: 500000, down_payment: 100000, down_payment_payment_method: 'transfer', warranty_days: 30 }) });
  assert.equal(service.status, 201);
  const deposit = db.prepare('SELECT * FROM service_deposit_receipts WHERE service_id = ?').get(service.body.id);
  assert.equal(deposit.amount, 100000);
  const depositLines = db.prepare(`SELECT accounts.code AS code, journal_lines.debit, journal_lines.credit FROM journal_lines
    JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entry_id = ? ORDER BY line_number`).all(deposit.journal_entry_id);
  assert.deepEqual(depositLines.map(({ code, debit, credit }) => ({ code, debit, credit })), [
    { code: '1120', debit: 100000, credit: 0 },
    { code: '2200', debit: 0, credit: 100000 }
  ]);

  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Ganti fan', final_cost: 500000 }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'proses_servis' }) });
  const completion = await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'selesai' }) });
  assert.equal(completion.status, 200);
  const invoice = completion.body.transaction;
  assert.ok(invoice?.id);
  assert.equal(invoice.warranty_note, 'Garansi servis 30 hari');
  const duplicateInvoice = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, transaction_type: 'servis', paid_amount: 100000, payment_method: 'cash', items: [{ item_type: 'service', reference_id: service.body.id, qty: 1 }] }) });
  assert.equal(duplicateInvoice.status, 200);
  assert.equal(duplicateInvoice.body.id, invoice.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_items WHERE item_type = 'service' AND reference_id = ?").get(service.body.id).count, 1);
  const receipt = await request(`/api/transactions/${invoice.id}/receipt`, { token: tokens.cashier });
  assert.equal(receipt.body.warranty_note, 'Garansi servis 30 hari');
  const invoiceJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(invoice.id));
  assert.ok(invoiceJournal);
  const invoiceLines = db.prepare(`SELECT accounts.code AS code, journal_lines.debit, journal_lines.credit FROM journal_lines
    JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entry_id = ? ORDER BY line_number`).all(invoiceJournal.id);
  assert.deepEqual(invoiceLines.map(({ code, debit, credit }) => ({ code, debit, credit })).sort((left, right) => left.code.localeCompare(right.code)), [
    { code: '2200', debit: 100000, credit: 0 },
    { code: '1200', debit: 400000, credit: 0 },
    { code: '4200', debit: 0, credit: 500000 }
  ].sort((left, right) => left.code.localeCompare(right.code)));
  const laterPayment = await request(`/api/transactions/${invoice.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 100000, payment_method: 'qris', idempotency_key: 'service-final-qris-001' }) });
  assert.equal(laterPayment.status, 200);
  const settlementJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_payment' AND source_id = ?").get(String(invoice.id));
  assert.equal(db.prepare("SELECT SUM(debit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '1130')").get(settlementJournal.id).amount, 100000);

  const refund = await request(`/api/transactions/${invoice.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Customer membatalkan layanan' }) });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.refund_amount, 200000);
  for (const journalId of [deposit.journal_entry_id, invoiceJournal.id, settlementJournal.id]) {
    assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(journalId).status, 'reversed');
  }
});

test('customer service consumes FIFO spare parts and external technician bills become HPP and payable', async () => {
  const supplier = await request('/api/suppliers', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ name: 'Service Parts Supplier' }) });
  const part = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'part_copotan', name: 'Service HPP Part', selling_price: 25000, stock: 0 }) });
  const purchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-06', paymentMode: 'credit', idempotencyKey: 'service-parts-purchase', items: [{ productId: part.body.id, quantity: 2, unitCost: 10000 }] }) });
  assert.equal(purchase.status, 201);
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'External Technician Service', issues: 'Replace SSD', estimated_cost: 300000 }) });
  assert.equal(service.status, 201);
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'SSD rusak', final_cost: 300000 }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'proses_servis' }) });

  const usagePayload = JSON.stringify({ productId: part.body.id, quantity: 2, description: 'SSD dipasang ke laptop customer', idempotencyKey: 'service-part-usage-001' });
  const usage = await request(`/api/services/${service.body.id}/part-usages`, { method: 'POST', token: tokens.technician, body: usagePayload });
  assert.equal(usage.status, 201, JSON.stringify(usage.body));
  assert.equal(usage.body.treatment, 'service_hpp');
  assert.equal(usage.body.totalCost, 20000);
  const duplicateUsage = await request(`/api/services/${service.body.id}/part-usages`, { method: 'POST', token: tokens.technician, body: usagePayload });
  assert.equal(duplicateUsage.body.duplicate, true);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(part.body.id).stock, 0);

  const external = await request('/api/external-technicians', { method: 'POST', token: tokens.admin, body: JSON.stringify({ name: 'Teknisi Rekanan', phone: '0800000002' }) });
  const assignment = await request(`/api/services/${service.body.id}/technician-assignments`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ technicianType: 'external', externalTechnicianId: external.body.id }) });
  assert.equal(assignment.status, 201);
  const bill = await request(`/api/service-technician-assignments/${assignment.body.id}/bills`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 50000, treatmentReason: 'Tenaga teknisi eksternal untuk pekerjaan servis', idempotencyKey: 'external-bill-service-001' }) });
  assert.ok(bill.status === 201, `${bill.status}: ${JSON.stringify(bill.body)}`);
  assert.equal(bill.body.treatment, 'service_hpp');
  const billJournal = db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(bill.body.journal_entry_id);
  assert.ok(billJournal);
  assert.equal(db.prepare("SELECT SUM(debit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '5200')").get(billJournal.id).amount, 50000);
  const billPayment = await request(`/api/service-technician-bills/${bill.body.id}/payments`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 50000, cashAccountCode: '1120', idempotencyKey: 'external-bill-pay-001' }) });
  assert.equal(billPayment.status, 201);
  assert.equal(billPayment.body.outstanding, 0);
  const journalsBeforeInternalAssignment = db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count;
  const internalService = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Internal Technician Service', issues: 'Internal assignment test' }) });
  const internalAssignment = await request(`/api/services/${internalService.body.id}/technician-assignments`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ technicianType: 'internal', internalUserId: 3 }) });
  assert.equal(internalAssignment.status, 201);
  assert.equal(internalAssignment.body.technician_type, 'internal');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count, journalsBeforeInternalAssignment);

  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'selesai' }) });
  const invoice = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, transaction_type: 'servis', paid_amount: 0, items: [{ item_type: 'service', reference_id: service.body.id, qty: 1 }] }) });
  assert.equal(invoice.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transaction_items WHERE item_type = 'service' AND reference_id = ?").get(service.body.id).count, 1);
  assert.equal(db.prepare("SELECT SUM(debit) AS amount FROM journal_lines WHERE account_id = (SELECT id FROM accounts WHERE code = '5200')").get().amount, 70000);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_lines WHERE account_id = (SELECT id FROM accounts WHERE code = '6100')").get().count, 0);
  const revenue = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(invoice.body.id));
  assert.ok(revenue);
  assert.equal(db.prepare("SELECT SUM(credit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '4200')").get(revenue.id).amount, 300000);
});

test('store repair work order links part, technician bill, and eligible costs to unit HPP', async () => {
  const supplier = await request('/api/suppliers', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ name: 'Store Repair Supplier' }) });
  const laptop = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Store Repair Unit', selling_price: 2500000, stock: 0 }) });
  const part = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'part_copotan', name: 'Store Repair Part', selling_price: 40000, stock: 0 }) });
  const laptopPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-07', paymentMode: 'credit', idempotencyKey: 'store-repair-laptop-purchase', items: [{ productId: laptop.body.id, quantity: 1, unitCost: 1500000, serialNumbers: ['STORE-REPAIR-001'] }] }) });
  const partPurchase = await request('/api/inventory/purchases', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ sourceType: 'supplier', supplierId: supplier.body.id, purchaseDate: '2026-10-07', paymentMode: 'credit', idempotencyKey: 'store-repair-part-purchase', items: [{ productId: part.body.id, quantity: 1, unitCost: 30000 }] }) });
  assert.equal(laptopPurchase.status, 201);
  assert.equal(partPurchase.status, 201);
  const unit = laptopPurchase.body.units[0];
  const workOrder = await request(`/api/inventory/units/${unit.id}/repair-work-orders`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ diagnosis: 'Keyboard perlu diganti', estimatedCost: 80000 }) });
  assert.equal(workOrder.status, 201);
  assert.equal(workOrder.body.status, 'inspection');
  const inProgress = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'in_progress', diagnosis: 'Keyboard rusak' }) });
  assert.equal(inProgress.status, 200);
  const directRepair = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}/costs`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 50000, componentType: 'repair', description: 'Jasa perbaikan board', treatment: 'capitalized', reason: 'Biaya langsung untuk menyiapkan unit dijual', creditAccountCode: '2300', idempotencyKey: 'store-repair-direct-cost' }) });
  assert.ok(directRepair.status === 201, `${directRepair.status}: ${JSON.stringify(directRepair.body)}`);
  const partUsage = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}/part-usages`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ productId: part.body.id, quantity: 1, description: 'Ganti keyboard', treatment: 'capitalized', treatmentReason: 'Part terpasang pada unit stok', idempotencyKey: 'store-repair-part-use' }) });
  assert.ok(partUsage.status === 201, `${partUsage.status}: ${JSON.stringify(partUsage.body)}`);
  const external = await request('/api/external-technicians', { method: 'POST', token: tokens.admin, body: JSON.stringify({ name: 'Teknisi Reparasi Unit' }) });
  const assignment = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}/technician-assignments`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ technicianType: 'external', externalTechnicianId: external.body.id }) });
  const bill = await request(`/api/service-technician-assignments/${assignment.body.id}/bills`, { method: 'POST', token: tokens.admin, body: JSON.stringify({ amount: 25000, treatment: 'capitalized', treatmentReason: 'Tagihan langsung memperbaiki unit toko', idempotencyKey: 'store-repair-tech-bill' }) });
  assert.ok(bill.status === 201, `${bill.status}: ${JSON.stringify(bill.body)}`);
  assert.equal(db.prepare('SELECT acquisition_cost FROM inventory_unit_costs WHERE unit_id = ?').get(unit.id).acquisition_cost, 1605000);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(part.body.id).stock, 0);

  const qc = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'qc' }) });
  assert.equal(qc.status, 200);
  const ready = await request(`/api/inventory/units/${unit.id}/status`, { method: 'PATCH', token: tokens.admin, body: JSON.stringify({ toStatus: 'ready', reason: 'QC unit toko lulus' }) });
  assert.equal(ready.status, 200);
  const completed = await request(`/api/inventory/repair-work-orders/${workOrder.body.id}`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'completed', finalCost: 75000 }) });
  assert.equal(completed.status, 200);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(laptop.body.id).stock, 1);
});

test('actual freight after packing posts shop expense, prepaid balance, payable, and partial idempotent payments', async () => {
  const product = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Freight Test Gadget', selling_price: 1000000, stock: 1 }) });
  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, shipping_cost: 100000, items: [{ item_type: 'product', reference_id: product.body.id, qty: 1 }] }) });
  assert.equal(sale.status, 201);
  const saleJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(sale.body.id));
  assert.equal(db.prepare("SELECT SUM(credit) AS amount FROM journal_lines WHERE journal_entry_id = ? AND account_id = (SELECT id FROM accounts WHERE code = '4300')").get(saleJournal.id).amount, 100000);

  const topUpPayload = JSON.stringify({ amount: 50000, cashAccountCode: '1110', description: 'Saldo awal ekspedisi test', idempotencyKey: 'freight-topup-test-001' });
  const topUp = await request('/api/freight/prepaid-topups', { method: 'POST', token: tokens.cashier, body: topUpPayload });
  assert.equal(topUp.status, 201);
  assert.equal(topUp.body.balance, 50000);
  const repeatedTopUp = await request('/api/freight/prepaid-topups', { method: 'POST', token: tokens.cashier, body: topUpPayload });
  assert.equal(repeatedTopUp.body.duplicate, true);

  const actualPayload = JSON.stringify({ expedition: 'JNE', trackingNumber: 'JNE-TEST-001', actualCost: 140000, payableAmount: 90000, prepaidAmount: 50000, idempotencyKey: 'freight-actual-test-001' });
  const fulfillment = await request(`/api/transactions/${sale.body.id}/freight/actual`, { method: 'POST', token: tokens.cashier, body: actualPayload });
  assert.equal(fulfillment.status, 201);
  assert.equal(fulfillment.body.customer_charge, 100000);
  assert.equal(fulfillment.body.actual_cost, 140000);
  assert.equal(fulfillment.body.shop_borne_amount, 40000);
  assert.equal(fulfillment.body.payable_amount, 90000);
  assert.equal(fulfillment.body.prepaid_amount, 50000);
  const repeatedActual = await request(`/api/transactions/${sale.body.id}/freight/actual`, { method: 'POST', token: tokens.cashier, body: actualPayload });
  assert.equal(repeatedActual.body.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM freight_fulfillments WHERE transaction_id = ?').get(sale.body.id).count, 1);
  const freightJournal = db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(fulfillment.body.expense_journal_id);
  const freightLines = db.prepare(`SELECT accounts.code AS code, journal_lines.debit, journal_lines.credit FROM journal_lines
    JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entry_id = ? ORDER BY line_number`).all(freightJournal.id);
  assert.deepEqual(freightLines.map(({ code, debit, credit }) => ({ code, debit, credit })).sort((left, right) => left.code.localeCompare(right.code)), [
    { code: '1400', debit: 0, credit: 50000 },
    { code: '2400', debit: 0, credit: 90000 },
    { code: '6400', debit: 140000, credit: 0 }
  ].sort((left, right) => left.code.localeCompare(right.code)));
  assert.equal((await request('/api/freight/prepaid-balance', { token: tokens.cashier })).body.balance, 0);

  const paymentPayload = JSON.stringify({ amount: 20000, cashAccountCode: '1120', idempotencyKey: 'freight-payment-test-001' });
  const firstPayment = await request(`/api/freight/fulfillments/${fulfillment.body.id}/payments`, { method: 'POST', token: tokens.cashier, body: paymentPayload });
  assert.equal(firstPayment.status, 201);
  assert.equal(firstPayment.body.outstanding, 70000);
  const replay = await request(`/api/freight/fulfillments/${fulfillment.body.id}/payments`, { method: 'POST', token: tokens.cashier, body: paymentPayload });
  assert.equal(replay.body.duplicate, true);
  const secondPayment = await request(`/api/freight/fulfillments/${fulfillment.body.id}/payments`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 70000, cashAccountCode: '1110', idempotencyKey: 'freight-payment-test-002' }) });
  assert.equal(secondPayment.status, 201);
  assert.equal(secondPayment.body.outstanding, 0);
  const overpayment = await request(`/api/freight/fulfillments/${fulfillment.body.id}/payments`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 1, cashAccountCode: '1110', idempotencyKey: 'freight-payment-test-003' }) });
  assert.equal(overpayment.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ?").get(String(sale.body.id)).count, 1);
});

test('service status: teknisi can advance service, cashier cannot', async () => {
  const created = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Test Laptop', issues: 'Tidak menyala' }) });
  assert.equal(created.status, 201);
  const technicianUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  assert.equal(technicianUpdate.status, 200);
  const cashierUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.cashier, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Test', final_cost: 500000 }) });
  assert.equal(cashierUpdate.status, 403);
});

test('opening service receipt does not create a sales transaction', async () => {
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Opening Receipt Test', issues: 'Test', estimated_cost: 750000, down_payment: 100000 }) });
  assert.equal(service.status, 201);
  const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
  const receipt = await request(`/api/services/${service.body.id}/opening-receipt`, { token: tokens.cashier });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.grand_total, 750000);
  assert.equal(receipt.body.paid_amount, 100000);
  assert.equal(receipt.body.remaining_amount, 650000);
  assert.equal(receipt.body.change_amount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, transactionCount);
});

test('service PIN is encrypted at rest and only revealed to authorized technicians/admins', async () => {
  const created = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Protected Device', issues: 'Test access control', password_pin: '246810' }) });
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.body, 'password_pin'), false);
  const stored = db.prepare('SELECT password_pin FROM services WHERE id = ?').get(created.body.id).password_pin;
  assert.match(stored, /^enc:v1:/);
  assert.notEqual(stored, '246810');
  const serviceList = await request('/api/services', { token: tokens.technician });
  const listedService = serviceList.body.find((item) => item.id === created.body.id);
  assert.equal(Object.hasOwn(listedService, 'password_pin'), false);
  const technicianRead = await request(`/api/services/${created.body.id}/access`, { token: tokens.technician });
  assert.equal(technicianRead.status, 200);
  assert.equal(technicianRead.body.password_pin, '246810');
  const cashierRead = await request(`/api/services/${created.body.id}/access`, { token: tokens.cashier });
  assert.equal(cashierRead.status, 403);
});

test('login limiter is isolated by Cloudflare client IP', async () => {
  const ipSuffix = Math.floor(Math.random() * 199) + 1;
  const clientIp = `192.0.2.${ipSuffix}`;
  const otherClientIp = `192.0.2.${ipSuffix + 1}`;
  const attempt = (ip) => request('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ username: 'missing', password: 'invalid' }) });
  assert.notEqual(clientIp, otherClientIp);
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt(clientIp)).status, 401);
  assert.equal((await attempt(clientIp)).status, 429);
  assert.equal((await attempt(otherClientIp)).status, 401);
});

test('cash: manual entries require cashier role and service payments record actual cash', async () => {
  const manual = await request('/api/cash-entries', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ entry_type: 'pengeluaran', category: 'Test', description: 'Biaya test', amount: 25000 }) });
  assert.equal(manual.status, 201);
  const forbidden = await request('/api/cash-entries', { method: 'POST', token: tokens.technician, body: JSON.stringify({ entry_type: 'pemasukan', category: 'Test', description: 'Forbidden', amount: 1 }) });
  assert.equal(forbidden.status, 403);
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Service Billing Test', issues: 'Test', estimated_cost: 500000 }) });
  assert.equal(service.status, 201);
  let serviceStatus = await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  assert.equal(serviceStatus.status, 200);
  serviceStatus = await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Test diagnosis', final_cost: 500000 }) });
  assert.equal(serviceStatus.status, 200);
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'proses_servis' }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'selesai' }) });
  const serviceTransaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, transaction_type: 'servis', transaction_stage: 'opening', record_cash: false, payment_status: 'lunas', paid_amount: 0, payment_method: 'cash', items: [{ item_type: 'service', reference_id: service.body.id, name: 'Fake service name', price: 1, qty: 1 }] }) });
  assert.equal(serviceTransaction.status, 200);
  assert.equal(serviceTransaction.body.transaction_stage, 'final');
  assert.equal(serviceTransaction.body.payment_status, 'bayar_nanti');
  assert.equal(serviceTransaction.body.items[0].price, 500000);
  const servicePaymentDescription = `Pembayaran servis ${serviceTransaction.body.invoice_number}`;
  const beforePayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis' AND description = ?").get(servicePaymentDescription).total;
  assert.equal(beforePayment, 0);
  const payment = await request(`/api/transactions/${serviceTransaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 200000, idempotency_key: 'service-payment-1' }) });
  assert.equal(payment.status, 200);
  assert.equal(payment.body.paid_amount, 200000);
  const afterPayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis' AND description = ?").get(servicePaymentDescription).total;
  assert.equal(afterPayment, 200000);
  const overpayment = await request(`/api/transactions/${serviceTransaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 400000, idempotency_key: 'service-payment-2' }) });
  assert.equal(overpayment.status, 200);
  assert.equal(overpayment.body.paid_amount, 500000);
  assert.equal(overpayment.body.change_amount, 100000);
  const retainedCash = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis' AND description = ?").get(servicePaymentDescription).total;
  assert.equal(retainedCash, 500000);
});

test('product import: accepts the simple CSV template and creates products atomically', async () => {
  const form = new FormData();
  form.append('file', new Blob(['category,name,brand,serial_number,cost_price,selling_price,stock,notes,gpu,memory,storage,physical_description,battery_health\nlaptop,Imported Laptop,Lenovo,IMPORT-001,100,200,2,From CSV,RTX 3050,16GB DDR4,512GB SSD NVMe|1TB HDD,Ada lecet ringan,88\n'], { type: 'text/csv' }), 'products.csv');
  const imported = await request('/api/products/import', { method: 'POST', token: tokens.cashier, body: form });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.imported, 1);
  const product = db.prepare('SELECT * FROM products WHERE serial_number = ?').get('IMPORT-001');
  assert.equal(product.name, 'Imported Laptop');
  const specs = JSON.parse(product.specs);
  assert.equal(specs.gpu, 'RTX 3050');
  assert.deepEqual(specs.storage, ['512GB SSD NVMe', '1TB HDD']);
  assert.equal(specs.physical.description, 'Ada lecet ringan');
  assert.equal(specs.battery.health, '88');
});

test('product import: parses Indonesian rupiah-formatted prices', async () => {
  const form = new FormData();
  form.append('file', new Blob(['category,name,brand,serial_number,cost_price,selling_price,stock\nlaptop,Formatted Price Laptop,Lenovo,FORMAT-001,"Rp 5.000.000","Rp 6.500.000",1\n'], { type: 'text/csv' }), 'formatted-prices.csv');
  const imported = await request('/api/products/import', { method: 'POST', token: tokens.cashier, body: form });
  assert.equal(imported.status, 201);
  const product = db.prepare('SELECT cost_price, selling_price FROM products WHERE serial_number = ?').get('FORMAT-001');
  assert.equal(product.cost_price, 5000000);
  assert.equal(product.selling_price, 6500000);
});

test('Aronium customer import maps addresses and safely skips duplicates/non-customers', async () => {
  const csv = [
    'Name,Code,TaxNumber,StreetName,BuildingNumber,AdditionalStreetName,PlotIdentification,PostalCode,City,CitySubdivisionName,CountrySubentity,Country,Email,Phone,IsEnabled,IsCustomer,IsTaxExempt',
    'Aronium Import Test,,,"Jalan Melati, No. 5",,Blok A,,,Bandung,,,,test@example.com,081234567890,1,1,0',
    'Aronium Duplicate,,,"Alamat berbeda",,,,,,,,,,0812-3456-7890,1,1,0',
    'Aronium Disabled,,,,,,,,,,,,,081234567891,0,1,0',
    'Aronium Supplier,,,,,,,,,,,,,081234567892,1,0,0'
  ].join('\n');
  const upload = async () => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'customers.csv');
    return request('/api/customers/import/aronium', { method: 'POST', token: tokens.cashier, body: form });
  };
  const first = await upload();
  assert.equal(first.status, 201);
  assert.equal(first.body.imported, 1);
  assert.equal(first.body.skipped, 1);
  assert.equal(first.body.ignored, 2);
  const importedCustomer = db.prepare('SELECT * FROM customers WHERE phone = ?').get('081234567890');
  assert.equal(importedCustomer.name, 'Aronium Import Test');
  assert.match(importedCustomer.address, /Jalan Melati, No\. 5/);
  const second = await upload();
  assert.equal(second.status, 200);
  assert.equal(second.body.imported, 0);
  assert.equal(second.body.skipped, 2);
});

test('database backup creates a local and mirrored SQLite snapshot', async () => {
  const localDirectory = path.join('data', 'pos-test-backups');
  const mirrorDirectory = path.join('data', 'pos-test-backup-mirror');
  fs.rmSync(localDirectory, { recursive: true, force: true });
  fs.rmSync(mirrorDirectory, { recursive: true, force: true });
  process.env.BACKUP_DIR = localDirectory;
  process.env.BACKUP_MIRROR_DIR = mirrorDirectory;
  const { backupDatabase } = await import(`../src/backup.js?test=${Date.now()}`);
  const snapshot = await backupDatabase();
  assert.equal(fs.existsSync(snapshot), true);
  assert.equal(fs.existsSync(path.join(mirrorDirectory, path.basename(snapshot))), true);
  fs.rmSync(localDirectory, { recursive: true, force: true });
  fs.rmSync(mirrorDirectory, { recursive: true, force: true });
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_MIRROR_DIR;
});
