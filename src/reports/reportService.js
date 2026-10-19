import db from '../db.js';
import { reconciliationCompleteness } from '../reconciliation/reconciliationService.js';

const cashCodes = ['1110', '1120', '1130'];
const inventoryCodes = ['1310', '1320', '1330'];
const incomeStatementTypes = ['revenue', 'contra_revenue', 'cogs', 'expense'];

function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} harus YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} tidak valid`);
  return value;
}

function period(query, { asOfOnly = false } = {}) {
  const asOf = date(query.as_of || query.to || new Date().toISOString().slice(0, 10), 'Tanggal akhir');
  const from = asOfOnly ? null : date(query.from || `${asOf.slice(0, 8)}01`, 'Tanggal awal');
  if (from && from > asOf) throw new Error('Tanggal awal tidak boleh setelah tanggal akhir');
  return { from, to: asOf };
}

function postedLineWhere({ from, to, cumulative = false }) {
  return cumulative
    ? { sql: "journal_entries.status = 'posted' AND journal_entries.posting_date <= ?", params: [to] }
    : { sql: "journal_entries.status = 'posted' AND journal_entries.posting_date BETWEEN ? AND ?", params: [from, to] };
}

function accountRows({ from, to, cumulative = false, accountCode = null }) {
  const where = postedLineWhere({ from, to, cumulative });
  const code = accountCode ? ' AND accounts.code = ?' : '';
  return db.prepare(`SELECT accounts.id, accounts.code, accounts.name, accounts.type, accounts.normal_side,
      COALESCE(posted.debit, 0) AS debit, COALESCE(posted.credit, 0) AS credit,
      COALESCE(posted.signed_balance, 0) AS signed_balance
    FROM accounts LEFT JOIN (
      SELECT journal_lines.account_id, SUM(journal_lines.debit) AS debit, SUM(journal_lines.credit) AS credit,
        SUM(journal_lines.debit - journal_lines.credit) AS signed_balance
      FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
      WHERE ${where.sql}
      GROUP BY journal_lines.account_id
    ) AS posted ON posted.account_id = accounts.id
    WHERE accounts.is_postable = 1${code}
    ORDER BY accounts.code`).all(...where.params, ...(accountCode ? [accountCode] : []));
}

function allPostedLines({ from, to, cumulative = false, accountCode = null }) {
  const where = postedLineWhere({ from, to, cumulative });
  const code = accountCode ? ' AND accounts.code = ?' : '';
  return db.prepare(`SELECT journal_entries.id AS journal_entry_id, journal_entries.entry_number, journal_entries.entry_date,
      journal_entries.posting_date, journal_entries.reference, journal_entries.source_type, journal_entries.source_id,
      journal_entries.source_event, journal_entries.description, journal_lines.line_number, accounts.code AS account_code,
      accounts.name AS account_name, accounts.type AS account_type, journal_lines.debit, journal_lines.credit, journal_lines.memo
    FROM journal_entries JOIN journal_lines ON journal_lines.journal_entry_id = journal_entries.id
    JOIN accounts ON accounts.id = journal_lines.account_id
    WHERE ${where.sql}${code} ORDER BY journal_entries.posting_date, journal_entries.entry_number, journal_lines.line_number`).all(...where.params, ...(accountCode ? [accountCode] : []));
}

export function trialBalance(query) {
  const dates = period(query, { asOfOnly: true });
  const accounts = accountRows({ ...dates, cumulative: true }).map((account) => {
    const debitBalance = Math.max(account.signed_balance, 0);
    const creditBalance = Math.max(-account.signed_balance, 0);
    return { ...account, debit_balance: debitBalance, credit_balance: creditBalance };
  });
  const totals = accounts.reduce((result, account) => ({ debit: result.debit + account.debit_balance, credit: result.credit + account.credit_balance }), { debit: 0, credit: 0 });
  return { as_of: dates.to, accounts, totals, balanced: totals.debit === totals.credit };
}

export function generalLedger(query) {
  const dates = period(query);
  const lines = allPostedLines({ ...dates, accountCode: query.account_code || null });
  const balances = new Map();
  return {
    from: dates.from,
    to: dates.to,
    account_code: query.account_code || null,
    lines: lines.map((line) => {
      const previous = balances.get(line.account_code) || 0;
      const balance = previous + line.debit - line.credit;
      balances.set(line.account_code, balance);
      return { ...line, running_balance: balance };
    })
  };
}

export function profitLoss(query) {
  const dates = period(query);
  const accounts = accountRows({ ...dates }).filter((account) => incomeStatementTypes.includes(account.type));
  const rows = accounts.map((account) => {
    const amount = account.type === 'revenue' ? account.credit - account.debit : account.debit - account.credit;
    return { ...account, amount };
  });
  const total = (types) => rows.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row.amount, 0);
  const revenue = total(['revenue']);
  const contraRevenue = total(['contra_revenue']);
  const cogs = total(['cogs']);
  const expenses = total(['expense']);
  return {
    from: dates.from,
    to: dates.to,
    rows,
    revenue,
    contra_revenue: contraRevenue,
    net_revenue: revenue - contraRevenue,
    cogs,
    gross_profit: revenue - contraRevenue - cogs,
    operating_expenses: expenses,
    net_profit: revenue - contraRevenue - cogs - expenses
  };
}

export function balanceSheet(query) {
  const dates = period(query, { asOfOnly: true });
  const accounts = accountRows({ ...dates, cumulative: true });
  const assets = accounts.filter((account) => account.type === 'asset').map((account) => ({ ...account, amount: account.signed_balance }));
  const liabilities = accounts.filter((account) => account.type === 'liability').map((account) => ({ ...account, amount: -account.signed_balance }));
  const equityAccounts = accounts.filter((account) => account.type === 'equity').map((account) => ({ ...account, amount: -account.signed_balance }));
  const revenue = accounts.filter((account) => account.type === 'revenue').reduce((sum, account) => sum + account.credit - account.debit, 0);
  const contraRevenue = accounts.filter((account) => account.type === 'contra_revenue').reduce((sum, account) => sum + account.debit - account.credit, 0);
  const cogs = accounts.filter((account) => account.type === 'cogs').reduce((sum, account) => sum + account.debit - account.credit, 0);
  const expenses = accounts.filter((account) => account.type === 'expense').reduce((sum, account) => sum + account.debit - account.credit, 0);
  const currentEarnings = revenue - contraRevenue - cogs - expenses;
  const totalAssets = assets.reduce((sum, account) => sum + account.amount, 0);
  const totalLiabilities = liabilities.reduce((sum, account) => sum + account.amount, 0);
  const totalEquity = equityAccounts.reduce((sum, account) => sum + account.amount, 0) + currentEarnings;
  return { as_of: dates.to, assets, liabilities, equity: equityAccounts, current_earnings: currentEarnings, total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity, difference: totalAssets - totalLiabilities - totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

export function cashFlow(query) {
  const dates = period(query);
  const lines = allPostedLines({ ...dates }).filter((line) => cashCodes.includes(line.account_code));
  const classified = lines.map((line) => {
    const source = line.source_type || '';
    const activity = source.includes('purchase') || source.includes('transaction') || source.includes('service') || source.includes('freight') || source.includes('cost') ? 'operating' : source.includes('asset') ? 'investing' : source.includes('capital') || source.includes('loan') ? 'financing' : 'operating';
    return { ...line, activity, amount: line.debit - line.credit };
  });
  const total = (activity) => classified.filter((line) => line.activity === activity).reduce((sum, line) => sum + line.amount, 0);
  return { from: dates.from, to: dates.to, operating: total('operating'), investing: total('investing'), financing: total('financing'), net_change: classified.reduce((sum, line) => sum + line.amount, 0), lines: classified, limitation: 'Transfer antar rekening internal memerlukan source_type transfer eksplisit agar dapat dikeluarkan dari arus kas bersih.' };
}

export function inventoryValuation(query) {
  const dates = period(query, { asOfOnly: true });
  const units = db.prepare(`SELECT inventory_units.unit_code, inventory_units.serial_number, inventory_units.acquired_at, inventory_units.status,
      inventory_units.location, products.name AS product_name, products.brand, inventory_unit_costs.acquisition_cost AS value,
      CAST(julianday(?) - julianday(inventory_units.acquired_at) AS INTEGER) AS age_days
    FROM inventory_units JOIN products ON products.id = inventory_units.product_id
    JOIN inventory_unit_costs ON inventory_unit_costs.unit_id = inventory_units.id
    WHERE inventory_units.acquired_at <= ? AND inventory_units.status NOT IN ('sold', 'written_off') AND inventory_units.returned_to_owner = 0
    ORDER BY inventory_units.acquired_at, inventory_units.id`).all(dates.to, dates.to);
  const parts = db.prepare(`SELECT part_stock_layers.id AS layer_id, products.name AS product_name, products.brand,
      part_stock_layers.quantity_remaining AS quantity, part_stock_layers.remaining_cost AS value,
      CAST(julianday(?) - julianday(part_stock_layers.received_at) AS INTEGER) AS age_days
    FROM part_stock_layers JOIN products ON products.id = part_stock_layers.product_id
    WHERE part_stock_layers.quantity_remaining > 0 AND date(part_stock_layers.received_at) <= ?
    ORDER BY part_stock_layers.received_at, part_stock_layers.id`).all(dates.to, dates.to);
  const legacy = db.prepare(`SELECT inventory_product_controls.product_id, products.name AS product_name,
      inventory_product_controls.legacy_stock AS quantity, products.cost_price, inventory_product_controls.legacy_stock * products.cost_price AS value
    FROM inventory_product_controls JOIN products ON products.id = inventory_product_controls.product_id
    WHERE inventory_product_controls.legacy_stock > 0`).all();
  return { as_of: dates.to, units, parts, legacy_unvalued: legacy, unit_value: units.reduce((sum, row) => sum + row.value, 0), part_value: parts.reduce((sum, row) => sum + row.value, 0), legacy_value_reference_only: legacy.reduce((sum, row) => sum + row.value, 0), limitation: 'Stok legacy belum mempunyai biaya per unit terverifikasi; nilai cost_price ditampilkan sebagai referensi, bukan HPP resmi.' };
}

function ageBucket(days) { return days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'; }
export function stockAging(query) {
  const report = inventoryValuation(query);
  const rows = [...report.units.map((row) => ({ ...row, kind: 'laptop_unit' })), ...report.parts.map((row) => ({ ...row, kind: 'spare_part' }))];
  const buckets = rows.reduce((result, row) => { const bucket = ageBucket(Math.max(0, row.age_days || 0)); result[bucket] = (result[bucket] || 0) + Number(row.value || 0); return result; }, {});
  return { as_of: report.as_of, buckets, rows };
}

export function unitProfit(query) {
  const dates = period(query);
  const rows = db.prepare(`SELECT inventory_unit_allocations.unit_id, inventory_units.unit_code, inventory_units.serial_number,
      products.name AS product_name, transactions.invoice_number, transactions.created_at,
      transaction_items.subtotal, transactions.direct_discount, inventory_unit_allocations.allocated_cost AS hpp
    FROM inventory_unit_allocations JOIN inventory_units ON inventory_units.id = inventory_unit_allocations.unit_id
    JOIN transaction_items ON transaction_items.id = inventory_unit_allocations.transaction_item_id
    JOIN transactions ON transactions.id = transaction_items.transaction_id
    JOIN products ON products.id = inventory_units.product_id
    WHERE inventory_unit_allocations.status = 'allocated' AND date(transactions.created_at) BETWEEN ? AND ?
    ORDER BY transactions.created_at, inventory_unit_allocations.id`).all(dates.from, dates.to).map((row) => {
      const sale = Number(row.subtotal || 0);
      const discount = sale ? Math.floor(Number(row.direct_discount || 0) * sale / Math.max(sale, 1)) : 0;
      return { ...row, net_sales: sale - discount, gross_profit: sale - discount - row.hpp };
    });
  return { from: dates.from, to: dates.to, rows, total_sales: rows.reduce((sum, row) => sum + row.net_sales, 0), total_hpp: rows.reduce((sum, row) => sum + row.hpp, 0), total_profit: rows.reduce((sum, row) => sum + row.gross_profit, 0) };
}

export function serviceProfit(query) {
  const dates = period(query);
  const revenue = db.prepare(`SELECT COALESCE(SUM(journal_lines.credit - journal_lines.debit), 0) AS amount FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entries.status = 'posted' AND journal_entries.posting_date BETWEEN ? AND ? AND accounts.code = '4200'`).get(dates.from, dates.to).amount;
  const hpp = db.prepare(`SELECT COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS amount FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id JOIN accounts ON accounts.id = journal_lines.account_id WHERE journal_entries.status = 'posted' AND journal_entries.posting_date BETWEEN ? AND ? AND accounts.code = '5200'`).get(dates.from, dates.to).amount;
  return { from: dates.from, to: dates.to, revenue, hpp, gross_profit: revenue - hpp };
}

function receivableRows(to) {
  return db.prepare(`SELECT transactions.id, transactions.invoice_number, transactions.created_at, customers.name AS customer_name,
      COALESCE((SELECT SUM(journal_lines.debit - journal_lines.credit) FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id WHERE journal_entries.status = 'posted' AND journal_entries.source_type = 'transaction_sale' AND journal_entries.source_id = CAST(transactions.id AS TEXT) AND journal_lines.account_id = (SELECT id FROM accounts WHERE code = '1200')), 0)
      - COALESCE((SELECT SUM(journal_lines.credit - journal_lines.debit) FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id WHERE journal_entries.status = 'posted' AND journal_entries.source_type = 'transaction_payment' AND journal_entries.source_id = CAST(transactions.id AS TEXT) AND journal_lines.account_id = (SELECT id FROM accounts WHERE code = '1200')), 0) AS balance
    FROM transactions LEFT JOIN customers ON customers.id = transactions.customer_id
    WHERE date(transactions.created_at) <= ? ORDER BY transactions.created_at`).all(to).filter((row) => Number(row.balance) > 0);
}
export function receivables(query) {
  const dates = period(query, { asOfOnly: true });
  const rows = receivableRows(dates.to);
  const accountBalance = Number(db.prepare(`SELECT COALESCE(SUM(journal_lines.debit - journal_lines.credit), 0) AS balance
    FROM journal_lines JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id JOIN accounts ON accounts.id = journal_lines.account_id
    WHERE journal_entries.status = 'posted' AND journal_entries.posting_date <= ? AND accounts.code = '1200'`).get(dates.to).balance);
  const allocated = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  if (accountBalance > allocated) rows.push({ invoice_number: '-', customer_name: 'Piutang belum tertaut', balance: accountBalance - allocated });
  return { as_of: dates.to, rows, total: accountBalance };
}

export function payables(query) {
  const dates = period(query, { asOfOnly: true });
  const rows = db.prepare(`SELECT accounts.code, accounts.name, accounts.type, SUM(journal_lines.credit - journal_lines.debit) AS balance
    FROM accounts JOIN journal_lines ON journal_lines.account_id = accounts.id JOIN journal_entries ON journal_entries.id = journal_lines.journal_entry_id
    WHERE journal_entries.status = 'posted' AND journal_entries.posting_date <= ? AND accounts.code IN ('2100', '2300', '2400') GROUP BY accounts.id HAVING balance > 0`).all(dates.to);
  return { as_of: dates.to, rows, total: rows.reduce((sum, row) => sum + row.balance, 0) };
}

export function reportByType(type, query) {
  const reports = { 'profit-loss': profitLoss, 'balance-sheet': balanceSheet, 'cash-flow': cashFlow, 'trial-balance': trialBalance, 'general-ledger': generalLedger, inventory: inventoryValuation, 'unit-profit': unitProfit, 'service-profit': serviceProfit, receivables, payables, 'stock-aging': stockAging };
  if (!reports[type]) throw new Error('Jenis laporan tidak tersedia');
  const report = reports[type](query);
  const asOf = report.as_of || report.to || query.as_of || query.to || new Date().toISOString().slice(0, 10);
  const completeness = reconciliationCompleteness(db, asOf);
  return { ...report, completeness, is_final: completeness.complete };
}
