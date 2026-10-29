import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { insertPostedJournal, postJournal, reverseJournal } from '../src/accounting/journalService.js';
import { allocateInventoryUnitToSale, createInventoryUnit, recordPendingUnitCost, transitionInventoryUnit } from '../src/inventory/inventoryUnitService.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(projectRoot, 'schema.sql');
const migrationDirectory = path.join(projectRoot, 'migrations');

test('versioned accounting migration backs up legacy data and journal posting is balanced, immutable, and reversible', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lapak-accounting-'));
  const databasePath = path.join(temporaryDirectory, 'legacy.sqlite');
  const backupDirectory = path.join(temporaryDirectory, 'backups');
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousBackupDirectory = process.env.BACKUP_DIR;
  let db;

  try {
    const legacySchema = fs.readFileSync(schemaPath, 'utf8').replace("category IN ('laptop', 'aksesoris', 'part_copotan', 'gadget')", "category IN ('laptop', 'aksesoris', 'part_copotan')");
    assert.notEqual(legacySchema, fs.readFileSync(schemaPath, 'utf8'));
    const legacyDb = new Database(databasePath);
    legacyDb.pragma('foreign_keys = ON');
    legacyDb.exec(legacySchema);
    const userId = Number(legacyDb.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)').run('Audit User', 'audit-user', 'not-used', 'admin').lastInsertRowid);
    legacyDb.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Legacy Customer', '0800000001');
    const legacyProductId = Number(legacyDb.prepare('INSERT INTO products (category, name, grade_condition, cost_price, selling_price, stock) VALUES (?, ?, ?, ?, ?, ?)').run('laptop', 'Legacy ThinkPad', 'B', 2000000, 3000000, 1).lastInsertRowid);
    legacyDb.close();

    process.env.DATABASE_PATH = databasePath;
    process.env.BACKUP_DIR = backupDirectory;
    ({ default: db } = await import(`../src/db.js?legacy-migration-test=${Date.now()}`));

    const backupName = fs.readdirSync(backupDirectory).find((name) => name.startsWith('pos-pre-migration-0001-') && name.endsWith('.sqlite'));
    assert.ok(backupName, 'legacy database backup exists before applying migration');
    const backupDb = new Database(path.join(backupDirectory, backupName), { readonly: true });
    assert.equal(backupDb.prepare('SELECT name FROM products WHERE id = ?').get(legacyProductId).name, 'Legacy ThinkPad');
    backupDb.close();

    const migratedProduct = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(legacyProductId);
    assert.deepEqual(migratedProduct, { id: legacyProductId, name: 'Legacy ThinkPad', stock: 1 });
    assert.equal(db.prepare('SELECT legacy_stock FROM inventory_product_controls WHERE product_id = ?').get(legacyProductId).legacy_stock, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inventory_units WHERE product_id = ?').get(legacyProductId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count, 0);
    assert.equal(db.prepare("SELECT id FROM customers WHERE name = 'Legacy Customer'").get().id > 0, true);
    assert.ok(db.prepare("SELECT id FROM accounts WHERE code = '1310' AND is_postable = 1").get());
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 18);

    const unit = createInventoryUnit(db, { productId: legacyProductId, sourceType: 'supplier', sourceReference: 'SUP-TEST-01', sourceLabel: 'Supplier fixture', acquiredAt: '2026-10-09', acquisitionCost: 2000000, condition: 'B', createdBy: userId });
    assert.equal(unit.status, 'received');
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock, 1);
    transitionInventoryUnit(db, unit.id, { toStatus: 'inspection', createdBy: userId });
    transitionInventoryUnit(db, unit.id, { toStatus: 'repair', reason: 'Diagnosis fixture', createdBy: userId });
    transitionInventoryUnit(db, unit.id, { toStatus: 'ready', reason: 'QC lulus', createdBy: userId });
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock, 2);
    transitionInventoryUnit(db, unit.id, { toStatus: 'reserved', reason: 'Dipesan pelanggan', createdBy: userId });
    transitionInventoryUnit(db, unit.id, { toStatus: 'ready', reason: 'Reservasi dilepas', createdBy: userId });
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock, 2);
    const pendingCost = recordPendingUnitCost(db, unit.id, { componentType: 'spare_part', amount: 150000, description: 'Part pemeriksaan fixture', sourceType: 'test_work_order', sourceId: 'WO-TEST-01', createdBy: userId });
    assert.equal(pendingCost.treatment, 'pending');
    assert.equal(db.prepare('SELECT acquisition_cost FROM inventory_unit_costs WHERE unit_id = ?').get(unit.id).acquisition_cost, 2000000);
    assert.throws(() => db.prepare('UPDATE inventory_movements SET reason = ? WHERE unit_id = ?').run('rewrite', unit.id), /tidak dapat diedit/);

    const saleId = Number(db.prepare('INSERT INTO transactions (invoice_number, transaction_type, payment_method, payment_status, grand_total) VALUES (?, ?, ?, ?, ?)').run('INV-UNIT-TEST', 'penjualan', 'cash', 'lunas', 3000000).lastInsertRowid);
    const itemId = Number(db.prepare('INSERT INTO transaction_items (transaction_id, item_type, reference_id, name, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(saleId, 'product', legacyProductId, 'Legacy ThinkPad', 3000000, 1, 3000000).lastInsertRowid);
    const allocation = allocateInventoryUnitToSale(db, { unitId: unit.id, transactionItemId: itemId, createdBy: userId });
    assert.equal(allocation.allocatedCost, 2000000);
    assert.equal(db.prepare('SELECT status FROM inventory_units WHERE id = ?').get(unit.id).status, 'sold');
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock, 1);

    const journalInput = {
      entryDate: '2026-10-10',
      postingDate: '2026-10-10',
      reference: 'PUR-TEST-001',
      source: { type: 'test_purchase', id: 'PUR-TEST-001', event: 'recognition' },
      description: 'Pembelian persediaan fixture',
      idempotencyKey: 'purchase-recognition-test-001',
      createdBy: userId,
      lines: [
        { accountCode: '1310', debit: 2500000, credit: 0, memo: 'Laptop unit' },
        { accountCode: '2100', debit: 0, credit: 2500000, memo: 'Utang supplier' }
      ]
    };
    const journal = postJournal(db, journalInput);
    assert.equal(journal.duplicate, false);
    assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(journal.id).status, 'posted');
    assert.deepEqual(db.prepare('SELECT action, from_status, to_status, actor_id FROM journal_audit_log WHERE journal_entry_id = ? ORDER BY id').all(journal.id), [
      { action: 'draft_created', from_status: null, to_status: 'draft', actor_id: userId },
      { action: 'posted', from_status: 'draft', to_status: 'posted', actor_id: userId }
    ]);
    assert.equal(postJournal(db, journalInput).duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries WHERE source_id = ?').get('PUR-TEST-001').count, 1);
    assert.throws(() => postJournal(db, { ...journalInput, description: 'Payload berbeda' }), /sudah dipakai/);
    assert.throws(() => postJournal(db, { ...journalInput, idempotencyKey: 'unbalanced-test', source: null, lines: [
      { accountCode: '1310', debit: 100, credit: 0 },
      { accountCode: '2100', debit: 0, credit: 90 }
    ] }), /harus seimbang/);
    assert.throws(() => db.prepare('UPDATE journal_lines SET memo = ? WHERE journal_entry_id = ?').run('ubah posted', journal.id), /tidak dapat diedit/);
    assert.throws(() => db.prepare('DELETE FROM journal_entries WHERE id = ?').run(journal.id), /tidak dapat dihapus/);
    assert.throws(() => db.prepare('UPDATE journal_audit_log SET reason = ? WHERE journal_entry_id = ?').run('ubah audit', journal.id), /Audit log akuntansi tidak dapat diedit/);
    assert.throws(() => db.prepare('DELETE FROM journal_audit_log WHERE journal_entry_id = ?').run(journal.id), /Audit log akuntansi tidak dapat dihapus/);

    const journalCountBeforeRollback = db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count;
    const auditCountBeforeRollback = db.prepare('SELECT COUNT(*) AS count FROM journal_audit_log').get().count;
    const stockBeforeRollback = db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock;
    const businessOperation = db.transaction(() => {
      db.prepare('UPDATE products SET stock = stock + 1 WHERE id = ?').run(legacyProductId);
      insertPostedJournal(db, { ...journalInput, idempotencyKey: 'atomic-rollback-test', source: { type: 'test_purchase', id: 'PUR-ROLLBACK-01', event: 'recognition' } });
      throw new Error('simulated business failure');
    });
    assert.throws(() => businessOperation(), /simulated business failure/);
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(legacyProductId).stock, stockBeforeRollback);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count, journalCountBeforeRollback);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_audit_log').get().count, auditCountBeforeRollback);

    const draftId = Number(db.prepare('INSERT INTO journal_entries (entry_number, entry_date, posting_date, description, request_hash, created_by) VALUES (?, ?, ?, ?, ?, ?)').run('JRN-UNBALANCED-DRAFT', '2026-10-10', '2026-10-10', 'Draft untuk trigger', 'draft-hash', userId).lastInsertRowid);
    db.prepare('INSERT INTO journal_lines (journal_entry_id, line_number, account_id, debit, credit) VALUES (?, 1, (SELECT id FROM accounts WHERE code = ?), ?, 0)').run(draftId, '1310', 100);
    assert.throws(() => db.prepare("UPDATE journal_entries SET status = 'posted', posted_by = ?, posted_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, draftId), /seimbang/);
    assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(draftId).status, 'draft');

    const reversal = reverseJournal(db, journal.id, { reason: 'Koreksi fixture', entryDate: '2026-10-11', createdBy: userId, idempotencyKey: 'reverse-purchase-test-001' });
    assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id = ?').get(journal.id).status, 'reversed');
    const reversalTotals = db.prepare('SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_lines WHERE journal_entry_id = ?').get(reversal.id);
    assert.equal(reversalTotals.debit, 2500000);
    assert.equal(reversalTotals.credit, 2500000);
    const reversalAudit = db.prepare('SELECT action, from_status, to_status, reason FROM journal_audit_log WHERE journal_entry_id = ? ORDER BY id').all(journal.id);
    assert.deepEqual(reversalAudit.at(-1), { action: 'reversed', from_status: 'posted', to_status: 'reversed', reason: 'Koreksi fixture' });
    assert.equal(db.prepare('SELECT debit FROM journal_lines WHERE journal_entry_id = ? AND line_number = 1').get(reversal.id).debit, 0);
    assert.equal(reverseJournal(db, journal.id, { reason: 'Koreksi fixture', createdBy: userId, idempotencyKey: 'ignored-repeat-key' }).id, reversal.id);
    assert.deepEqual(await import('../src/migrationRunner.js').then(({ applyPendingMigrations }) => applyPendingMigrations(db, migrationDirectory)), []);
  } finally {
    if (db) db.close();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousBackupDirectory === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = previousBackupDirectory;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
