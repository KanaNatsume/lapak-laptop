import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(projectRoot, 'schema.sql');
const migrationDirectory = path.join(projectRoot, 'migrations');
const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lapak-cutover-'));
const legacyPath = path.join(workDirectory, 'legacy.sqlite');
const migratedPath = path.join(workDirectory, 'migrated.sqlite');
const restoredPath = path.join(workDirectory, 'restored.sqlite');
const backupDirectory = path.join(workDirectory, 'backups');
const restoreBackupDirectory = path.join(workDirectory, 'restore-backups');

function count(db, table) { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
function metrics(db) {
  const journal = db.prepare("SELECT COUNT(*) AS entries, COALESCE(SUM((SELECT SUM(debit) FROM journal_lines WHERE journal_entry_id = journal_entries.id)), 0) AS debit, COALESCE(SUM((SELECT SUM(credit) FROM journal_lines WHERE journal_entry_id = journal_entries.id)), 0) AS credit FROM journal_entries WHERE status = 'posted'").get();
  return {
    transactions: count(db, 'transactions'),
    journal_entries: count(db, 'journal_entries'),
    journal_lines: count(db, 'journal_lines'),
    cash_entries: count(db, 'cash_entries'),
    products: count(db, 'products'),
    inventory_units: count(db, 'inventory_units'),
    legacy_stock: Number(db.prepare('SELECT COALESCE(SUM(legacy_stock), 0) AS value FROM inventory_product_controls').get().value),
    posted_journal_entries: Number(journal.entries),
    posted_debit: Number(journal.debit),
    posted_credit: Number(journal.credit)
  };
}
function integrity(db) {
  return {
    integrity_check: db.pragma('integrity_check', { simple: true }),
    foreign_key_violations: db.pragma('foreign_key_check').length,
    schema_migrations: count(db, 'schema_migrations'),
    reconciliation_tables: ['opening_balance_batches', 'opening_balance_lines', 'legacy_valuation_reviews', 'cash_entry_reconciliation_mappings', 'reconciliation_audit_log'].every((table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)))
  };
}
function runChild(databasePath) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.env.DATABASE_PATH = ${JSON.stringify(databasePath)};
    process.env.BACKUP_DIR = ${JSON.stringify(restoreBackupDirectory)};
    const { default: db } = await import(${JSON.stringify(pathToFileURL(path.join(projectRoot, 'src', 'db.js')).href)});
    const result = {
      schema_migrations: db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
      journal_entries: db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count,
      journal_lines: db.prepare('SELECT COUNT(*) AS count FROM journal_lines').get().count,
      integrity_check: db.pragma('integrity_check', { simple: true }),
      foreign_key_violations: db.pragma('foreign_key_check').length
    };
    console.log(JSON.stringify(result));
    db.close();
  `], { cwd: projectRoot, env: { ...process.env, DATABASE_PATH: databasePath, BACKUP_DIR: restoreBackupDirectory, DEFAULT_ADMIN_PASSWORD: 'masked-rehearsal-value' }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const line = child.stdout.trim().split(/\r?\n/).at(-1);
  return JSON.parse(line);
}

try {
  const legacyDb = new Database(legacyPath);
  legacyDb.pragma('foreign_keys = ON');
  legacyDb.exec(fs.readFileSync(schemaPath, 'utf8'));
  legacyDb.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)').run('Masked Admin', 'masked-admin', 'masked', 'admin');
  legacyDb.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Masked Customer', '0000000000');
  legacyDb.prepare(`INSERT INTO products (category, name, brand, grade_condition, cost_price, selling_price, stock, notes) VALUES ('laptop', 'Masked Legacy Laptop', 'Masked Brand', 'B', 0, 5000000, 2, 'fixture')`).run();
  legacyDb.prepare(`INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES ('pengeluaran', 'Lainnya', 'Fixture ambiguous cash', 50000, 'manual', '2026-10-01', 1)`).run();
  legacyDb.close();
  fs.copyFileSync(legacyPath, migratedPath);

  process.env.DATABASE_PATH = migratedPath;
  process.env.BACKUP_DIR = backupDirectory;
  process.env.DEFAULT_ADMIN_PASSWORD = 'masked-rehearsal-value';
  const { default: db } = await import(`../src/db.js?cutover=${Date.now()}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 16);
  const { postJournal } = await import('../src/accounting/journalService.js');
  const { createOpeningBatch, addOpeningLine, approveOpeningBatch, postOpeningBatch, createLegacyValuationReview, verifyLegacyValuation, createCashMapping, reconciliationCompleteness } = await import('../src/reconciliation/reconciliationService.js');
  const { inventoryValuation, balanceSheet, trialBalance, cashFlow } = await import('../src/reports/reportService.js');
  const actorRow = db.prepare("SELECT id FROM users WHERE username = 'masked-admin'").get() || db.prepare("SELECT id FROM users LIMIT 1").get();
  const actorId = Number(actorRow?.id || 0);
  if (!actorId) {
    const created = db.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('Masked Admin', 'masked-admin-rehearsal', 'masked', 'admin')").run();
    assert.ok(Number(created.lastInsertRowid) > 0);
  }
  const resolvedActorId = actorId || Number(db.prepare("SELECT id FROM users WHERE username = 'masked-admin-rehearsal'").get().id);

  postJournal(db, { entryDate: '2026-10-01', postingDate: '2026-10-01', reference: 'FIXTURE-SALE', source: { type: 'fixture', id: 'sale-1', event: 'recognition' }, description: 'Masked fixture sale', idempotencyKey: 'fixture-sale-1', createdBy: resolvedActorId, lines: [{ accountCode: '1110', debit: 1000000, credit: 0 }, { accountCode: '4100', debit: 0, credit: 1000000 }] });
  const batch = createOpeningBatch(db, { effectiveDate: '2026-10-01', sourceSummary: 'Masked bank and cash evidence', createdBy: resolvedActorId });
  addOpeningLine(db, batch.id, { accountCode: '1110', side: 'debit', amount: 100000, sourceType: 'bank_statement', sourceReference: 'MASKED-BANK-01', verificationStatus: 'verified', createdBy: resolvedActorId });
  addOpeningLine(db, batch.id, { accountCode: '2100', side: 'credit', amount: 100000, sourceType: 'supplier_statement', sourceReference: 'MASKED-SUP-01', verificationStatus: 'verified', createdBy: resolvedActorId });
  approveOpeningBatch(db, batch.id, resolvedActorId);
  const openingPost = postOpeningBatch(db, batch.id, resolvedActorId);
  assert.equal(openingPost.duplicate, false);
  assert.equal(postOpeningBatch(db, batch.id, resolvedActorId).duplicate, true);

  const productId = db.prepare("SELECT id FROM products WHERE name = 'Masked Legacy Laptop'").get().id;
  const legacySource = db.prepare(`SELECT p.id AS product_id, p.name AS product_name, p.brand, p.category, p.stock AS source_stock,
      c.legacy_stock, p.cost_price, c.verified_at
    FROM products p JOIN inventory_product_controls c ON c.product_id = p.id WHERE p.id = ?`).get(productId);
  const valuation = createLegacyValuationReview(db, { productId, quantity: 2, purchaseCost: 4000000, sourceType: 'supplier_invoice', sourceReference: 'MASKED-INVOICE-01', verificationNote: 'Masked evidence', createdBy: resolvedActorId });
  verifyLegacyValuation(db, valuation.id, resolvedActorId);
  const cashId = db.prepare("SELECT id FROM cash_entries WHERE description = 'Fixture ambiguous cash'").get().id;
  const cashSource = db.prepare(`SELECT c.id, c.entry_type, c.category, c.description, c.amount, c.source, c.entry_date,
      (SELECT COUNT(*) FROM journal_entries j WHERE j.status IN ('posted', 'reversed') AND j.source_type = 'cash_entry' AND j.source_id = CAST(c.id AS TEXT)) AS source_journal_count
    FROM cash_entries c WHERE c.id = ?`).get(cashId);
  const cashMapping = createCashMapping(db, cashId, resolvedActorId);
  assert.equal(cashMapping.status, 'ambiguous');

  const completeness = reconciliationCompleteness(db, '2026-10-01');
  const openingTrial = trialBalance({ as_of: '2026-10-01' });
  const openingBalance = balanceSheet({ as_of: '2026-10-01' });
  const openingCashFlow = cashFlow({ from: '2026-10-01', to: '2026-10-01' });
  const stockReport = inventoryValuation({ as_of: '2026-10-01' });
  const reportSummary = { completeness, trial_balanced: openingTrial.balanced, trial_debit: openingTrial.totals.debit, trial_credit: openingTrial.totals.credit, balance_sheet_balanced: openingBalance.balanced, balance_difference: openingBalance.difference, cash_flow_net_change: openingCashFlow.net_change, valued_unit_total: stockReport.unit_value, legacy_reference_total: stockReport.legacy_value_reference_only };

  const beforeBackup = metrics(db);
  const backupPath = path.join(backupDirectory, 'rehearsal.sqlite');
  fs.mkdirSync(backupDirectory, { recursive: true });
  await db.backup(backupPath);
  assert.ok(fs.statSync(backupPath).size > 0);
  fs.copyFileSync(backupPath, restoredPath);
  const restoredDb = new Database(restoredPath, { readonly: true });
  const afterRestore = metrics(restoredDb);
  const restoreIntegrity = integrity(restoredDb);
  assert.deepEqual(afterRestore, beforeBackup);
  assert.equal(restoreIntegrity.integrity_check, 'ok');
  assert.equal(restoreIntegrity.foreign_key_violations, 0);
  restoredDb.close();
  db.close();

  const repeatStartup = runChild(migratedPath);
  const restoredStartup = runChild(restoredPath);
  assert.equal(repeatStartup.schema_migrations, 16);
  assert.equal(restoredStartup.schema_migrations, 16);
  assert.equal(repeatStartup.journal_entries, beforeBackup.journal_entries);
  assert.equal(restoredStartup.journal_entries, beforeBackup.journal_entries);
  assert.equal(restoredStartup.integrity_check, 'ok');
  assert.equal(restoredStartup.foreign_key_violations, 0);

  console.log(JSON.stringify({ status: 'REHEARSAL_COMPLETE', work_directory: workDirectory, migration_count: 16, backup_path: backupPath, before_backup: beforeBackup, after_restore: afterRestore, restore_integrity: restoreIntegrity, repeat_startup: repeatStartup, restored_startup: restoredStartup, evidence: { legacy_stock_source: legacySource, cash_entry_source: cashSource }, reports: reportSummary }, null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
