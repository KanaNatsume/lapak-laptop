import db from '../db.js';
import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';
import { reverseJournal } from '../accounting/journalService.js';
import { allocateReadyInventoryUnitsForSale, consumeLegacyStockForSale, createInventoryUnit, refundSoldInventoryUnits, restoreLegacyStockForRefund, returnTradeInUnitsToSource } from '../inventory/inventoryUnitService.js';
import { allocateSparePartLayersForSale, restoreSparePartAllocationsForRefund } from '../inventory/partStockService.js';

function invoiceNumber() { const stamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14); return `INV-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

export function createTransaction(request, response) {
  const { customer_id = null, transaction_type = 'penjualan', items = [], direct_discount = 0, shipping_cost = 0, paid_amount = null, payment_method = 'cash', notes = '', warranty_note = '' } = request.body;
  if (!Array.isArray(items) || !items.length) return response.status(400).json({ error: 'Transaksi harus memiliki item' });
  if (!items.some((item) => item.item_type !== 'trade_in')) return response.status(400).json({ error: 'Tukar tambah harus memiliki barang atau servis yang dijual' });
  if (!['penjualan', 'tukar_tambah', 'servis', 'campuran'].includes(transaction_type)) return response.status(400).json({ error: 'Jenis transaksi tidak valid' });
  if (!['cash', 'transfer', 'qris'].includes(payment_method)) return response.status(400).json({ error: 'Metode pembayaran tidak valid' });
  if (transaction_type === 'servis' && items.length === 1 && items[0].item_type === 'service') {
    const existing = db.prepare(`SELECT transactions.id FROM transactions JOIN transaction_items ON transaction_items.transaction_id = transactions.id
      WHERE transactions.transaction_stage = 'final' AND transaction_items.item_type = 'service' AND transaction_items.reference_id = ? LIMIT 1`).get(items[0].reference_id);
    if (existing) return response.status(200).json(getTransactionById(existing.id));
  }
  const checkout = db.transaction(() => {
    let subtotal = 0;
    let tradeInTotal = 0;
    let serviceWarrantyDays = 0;
    const discount = Number(direct_discount);
    const shipping = Number(shipping_cost);
    if (!Number.isSafeInteger(discount) || discount < 0 || !Number.isSafeInteger(shipping) || shipping < 0) throw new Error('Nominal diskon dan ongkir harus angka bulat >= 0');
    for (const item of items) {
      const qty = Number(item.qty || 1);
      if (!['product', 'service', 'trade_in'].includes(item.item_type) || !Number.isInteger(qty) || qty <= 0) throw new Error('Item transaksi tidak valid');
      if (item.item_type === 'trade_in') {
        const tradeInPrice = Number(item.price);
        const tradeInName = String(item.name || '').trim();
        const tradeInCategory = item.category;
        const sellingPrice = Number(item.selling_price);
        if (!tradeInName || !['laptop', 'aksesoris', 'part_copotan', 'gadget'].includes(tradeInCategory)) throw new Error('Nama dan kategori barang tukar tambah wajib diisi');
        if (!Number.isSafeInteger(tradeInPrice) || tradeInPrice < 0) throw new Error('Nominal tukar tambah harus angka bulat >= 0');
        if (!Number.isSafeInteger(sellingPrice) || sellingPrice <= 0) throw new Error('Harga jual barang tukar tambah harus angka bulat lebih besar dari 0');
        tradeInTotal += tradeInPrice * qty;
        item.name = tradeInName;
        item.price = tradeInPrice;
        item.category = tradeInCategory;
        item.selling_price = sellingPrice;
        continue;
      }
      if (item.item_type === 'product') {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.reference_id);
        if (!product || product.stock < Number(item.qty || 1)) throw new Error(`Stok tidak cukup untuk ${item.name || 'produk'}`);
        item.name = product.name;
        item.price = product.selling_price;
        item.serial_number = product.serial_number || '';
        item.product_category = product.category;
      } else if (item.item_type === 'service') {
        const service = db.prepare('SELECT device_name, status, final_cost, warranty_days FROM services WHERE id = ?').get(item.reference_id);
        if (!service || service.status !== 'selesai') throw new Error('Servis belum selesai atau tidak ditemukan');
        if (!Number.isSafeInteger(service.final_cost) || service.final_cost <= 0) throw new Error('Biaya final servis belum ditentukan');
        item.name = `Servis ${service.device_name}`;
        item.price = service.final_cost;
        serviceWarrantyDays = Math.max(serviceWarrantyDays, Number(service.warranty_days || 0));
        item.service_deposit_amount = db.prepare('SELECT amount FROM service_deposit_receipts WHERE service_id = ?').get(item.reference_id)?.amount || 0;
      }
      subtotal += Number(item.price) * qty;
    }
    const grandTotal = Math.max(0, subtotal - tradeInTotal - discount + shipping);
    const tendered = paid_amount === null ? grandTotal : Number(paid_amount);
    if (!Number.isSafeInteger(tendered) || tendered < 0) throw new Error('Nominal pembayaran harus angka bulat >= 0');
    const paid = Math.min(tendered, grandTotal);
    const hasServiceDeposit = items.some((item) => item.item_type === 'service' && item.service_deposit_amount > 0);
    const change = hasServiceDeposit ? 0 : Math.max(0, tendered - grandTotal);
    const paymentStatus = paid >= grandTotal ? 'lunas' : paid > 0 ? 'dp' : 'bayar_nanti';
    const invoice = invoiceNumber();
    const transactionWarrantyNote = serviceWarrantyDays > 0 ? `Garansi servis ${serviceWarrantyDays} hari` : warranty_note;
    const transaction = db.prepare(`INSERT INTO transactions (invoice_number, customer_id, transaction_type, transaction_stage, subtotal, trade_in_total, direct_discount, shipping_cost, grand_total, paid_amount, change_amount, payment_method, payment_status, notes, warranty_note) VALUES (?, ?, ?, 'final', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(invoice, customer_id, transaction_type, subtotal, tradeInTotal, discount, shipping, grandTotal, paid, change, payment_method, paymentStatus, notes, transactionWarrantyNote);
    const itemStatement = db.prepare('INSERT INTO transaction_items (transaction_id, item_type, reference_id, name, serial_number, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of items) {
      const qty = Number(item.qty || 1);
      if (item.item_type === 'trade_in') {
        const isLaptop = item.category === 'laptop';
        const product = db.prepare('INSERT INTO products (category, name, grade_condition, cost_price, selling_price, stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item.category, item.name, 'B', item.price, item.selling_price, isLaptop ? 0 : qty, `Barang masuk dari tukar tambah ${invoice}`);
        item.reference_id = Number(product.lastInsertRowid);
        if (isLaptop) {
          for (let index = 0; index < qty; index += 1) createInventoryUnit(db, { productId: item.reference_id, sourceType: 'trade_in', sourceReference: invoice, sourceLabel: `Tukar tambah ${invoice}`, acquiredAt: new Date().toISOString().slice(0, 10), acquisitionCost: item.price, condition: 'unknown', createdBy: request.user.id });
        }
      }
      const itemRow = itemStatement.run(transaction.lastInsertRowid, item.item_type, item.reference_id || null, item.name, item.serial_number || '', item.price, qty, Number(item.price) * qty);
      if (item.item_type === 'product') {
        let hpp = 0;
        let legacyQuantity = 0;
        if (item.product_category === 'laptop') {
          const allocations = allocateReadyInventoryUnitsForSale(db, { productId: item.reference_id, quantity: qty, transactionItemId: Number(itemRow.lastInsertRowid), createdBy: request.user.id });
          hpp = allocations.reduce((total, allocation) => total + allocation.allocatedCost, 0);
          legacyQuantity = qty - allocations.length;
          if (legacyQuantity > 0) consumeLegacyStockForSale(db, { productId: item.reference_id, quantity: legacyQuantity, transactionItemId: Number(itemRow.lastInsertRowid) });
          db.prepare('UPDATE transaction_items SET allocated_hpp = ? WHERE id = ?').run(hpp, itemRow.lastInsertRowid);
          if (hpp > 0) postJournal(db, {
            entryDate: new Date().toISOString().slice(0, 10),
            reference: invoice,
            source: { type: 'sale_cogs', id: String(itemRow.lastInsertRowid), event: 'recognition' },
            description: `HPP unit laptop ${item.name} · ${invoice}`,
            idempotencyKey: `sale-cogs:${itemRow.lastInsertRowid}`,
            createdBy: request.user.id,
            lines: [{ accountCode: '5100', debit: hpp, credit: 0, memo: item.name }, { accountCode: '1310', debit: 0, credit: hpp, memo: item.name }]
          });
        } else if (item.product_category === 'part_copotan') {
          const allocation = allocateSparePartLayersForSale(db, { productId: item.reference_id, quantity: qty, transactionItemId: Number(itemRow.lastInsertRowid), createdBy: request.user.id });
          hpp = allocation.allocatedCost;
          legacyQuantity = allocation.legacyQuantity;
          db.prepare('UPDATE transaction_items SET allocated_hpp = ?, legacy_stock_qty = ? WHERE id = ?').run(hpp, legacyQuantity, itemRow.lastInsertRowid);
          if (hpp > 0) postJournal(db, {
            entryDate: new Date().toISOString().slice(0, 10),
            reference: invoice,
            source: { type: 'sale_cogs', id: String(itemRow.lastInsertRowid), event: 'recognition' },
            description: `HPP spare part ${item.name} · ${invoice}`,
            idempotencyKey: `sale-cogs:${itemRow.lastInsertRowid}`,
            createdBy: request.user.id,
            lines: [{ accountCode: '5110', debit: hpp, credit: 0, memo: item.name }, { accountCode: '1320', debit: 0, credit: hpp, memo: item.name }]
          });
        } else {
          consumeLegacyStockForSale(db, { productId: item.reference_id, quantity: qty, transactionItemId: Number(itemRow.lastInsertRowid) });
        }
      }
    }
    if (items.some((item) => item.item_type !== 'trade_in')) {
      if (discount > subtotal) throw new Error('Diskon tidak boleh melebihi subtotal penjualan');
      const journalLines = [];
      const serviceAdvanceApplied = Math.min(paid, items.reduce((total, item) => total + Number(item.service_deposit_amount || 0), 0));
      const cashReceivedAtInvoice = paid - serviceAdvanceApplied;
      if (cashReceivedAtInvoice > 0) {
        const cashAccountCode = ({ cash: '1110', transfer: '1120', qris: '1130' })[payment_method];
        journalLines.push({ accountCode: cashAccountCode, debit: cashReceivedAtInvoice, credit: 0, memo: `Pembayaran ${invoice}` });
      }
      const receivable = grandTotal - paid;
      if (receivable > 0) journalLines.push({ accountCode: '1200', debit: receivable, credit: 0, memo: `Piutang ${invoice}` });
      if (serviceAdvanceApplied > 0) journalLines.push({ accountCode: '2200', debit: serviceAdvanceApplied, credit: 0, memo: `Aplikasi DP ${invoice}` });
      for (const item of items.filter((entry) => entry.item_type === 'trade_in')) {
        const accountCode = item.category === 'laptop' ? '1310' : '1330';
        const amount = Number(item.price) * Number(item.qty || 1);
        if (amount > 0) journalLines.push({ accountCode, debit: amount, credit: 0, memo: `Trade-in ${item.name}` });
      }
      if (discount > 0) journalLines.push({ accountCode: '4900', debit: discount, credit: 0, memo: `Diskon ${invoice}` });
      for (const item of items.filter((entry) => entry.item_type !== 'trade_in')) {
        const accountCode = item.item_type === 'service' ? '4200' : '4100';
        const amount = Number(item.price) * Number(item.qty || 1);
        if (amount > 0) journalLines.push({ accountCode, debit: 0, credit: amount, memo: item.name });
      }
      if (shipping > 0) journalLines.push({ accountCode: '4300', debit: 0, credit: shipping, memo: `Ongkir ditagih ${invoice}` });
      if (journalLines.length >= 2) postJournal(db, {
          entryDate: new Date().toISOString().slice(0, 10),
          reference: invoice,
          source: { type: 'transaction_sale', id: String(transaction.lastInsertRowid), event: 'recognition' },
          description: `Pengakuan penjualan ${invoice}`,
          idempotencyKey: `transaction-sale:${transaction.lastInsertRowid}:recognition`,
          createdBy: request.user.id,
          lines: journalLines
        });
    }
    const serviceDepositAlreadyRecorded = transaction_type === 'servis' && items.some((item) => item.item_type === 'service' && db.prepare('SELECT id FROM service_deposit_receipts WHERE service_id = ?').get(item.reference_id));
    if (transaction_type === 'servis' && paid > 0 && !serviceDepositAlreadyRecorded) {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, date(?), ?)').run('pemasukan', 'Servis', `Pembayaran servis ${invoice}`, paid, 'transaction', new Date().toISOString(), request.user.id);
    }
    return Number(transaction.lastInsertRowid);
  })();
  response.status(201).json(getTransactionById(checkout));
}

function getTransactionById(id) { const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id); if (!transaction) return null; const refund = db.prepare('SELECT amount AS refund_amount, reason AS refund_reason, created_at AS refunded_at FROM transaction_refunds WHERE transaction_id = ?').get(id); return { ...transaction, ...refund, refunded_at: refund?.refunded_at || null, items: db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(id) }; }
export function getTransaction(request, response) { const transaction = getTransactionById(request.params.id); if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' }); response.json(transaction); }
export function listTransactions(_request, response) { response.json(db.prepare("SELECT transactions.*, transaction_refunds.amount AS refund_amount, transaction_refunds.created_at AS refunded_at FROM transactions LEFT JOIN transaction_refunds ON transaction_refunds.transaction_id = transactions.id WHERE transactions.transaction_stage = 'final' ORDER BY transactions.created_at DESC").all()); }
export function payTransaction(request, response) {
  const amount = Number(request.body.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return response.status(400).json({ error: 'Nominal pembayaran harus angka bulat lebih besar dari 0' });
  const requestedPaymentMethod = request.body.payment_method ? String(request.body.payment_method) : null;
  if (requestedPaymentMethod && !['cash', 'transfer', 'qris'].includes(requestedPaymentMethod)) return response.status(400).json({ error: 'Metode pembayaran harus cash, transfer, atau qris' });
  const idempotencyKey = String(request.body.idempotency_key || crypto.randomUUID()).trim();
  if (!idempotencyKey || idempotencyKey.length > 160) return response.status(400).json({ error: 'Kunci idempotensi pembayaran wajib diisi maksimal 160 karakter' });
  const payment = db.transaction(() => {
    const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(request.params.id);
    if (!transaction) return { error: 'Transaksi tidak ditemukan', status: 404 };
    const paymentMethod = requestedPaymentMethod || transaction.payment_method;
    const cashAccountCode = ({ cash: '1110', transfer: '1120', qris: '1130' })[paymentMethod];
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ amount, paymentMethod })).digest('hex');
    const existing = db.prepare('SELECT request_hash FROM transaction_payment_events WHERE transaction_id = ? AND idempotency_key = ?').get(transaction.id, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) return { error: 'Kunci pembayaran sudah dipakai untuk nominal atau metode berbeda', status: 409 };
      return { transaction: getTransactionById(transaction.id), duplicate: true };
    }
    if (db.prepare('SELECT id FROM transaction_refunds WHERE transaction_id = ?').get(transaction.id)) return { error: 'Transaksi sudah direfund dan tidak dapat menerima pelunasan', status: 409 };
    if (transaction.transaction_stage === 'opening') return { error: 'Nota awal servis tidak dapat menerima pelunasan', status: 400 };
    const remaining = Math.max(0, transaction.grand_total - transaction.paid_amount);
    if (!remaining) return { error: 'Transaksi sudah lunas', status: 400 };
    const applied = Math.min(amount, remaining);
    const paid = transaction.paid_amount + applied;
    const change = amount - applied;
    const status = paid >= transaction.grand_total ? 'lunas' : 'dp';
    db.prepare('UPDATE transactions SET paid_amount = ?, change_amount = ?, payment_status = ? WHERE id = ?').run(paid, transaction.change_amount + change, status, transaction.id);
    const paymentJournal = postJournal(db, {
      entryDate: new Date().toISOString().slice(0, 10),
      reference: transaction.invoice_number,
      source: { type: 'transaction_payment', id: String(transaction.id), event: idempotencyKey },
      description: `Pembayaran ${transaction.invoice_number}`,
      idempotencyKey: `transaction-payment:${transaction.id}:${idempotencyKey}`,
      createdBy: request.user.id,
      lines: [{ accountCode: cashAccountCode, debit: applied, credit: 0, memo: `Pembayaran ${transaction.invoice_number}` }, { accountCode: '1200', debit: 0, credit: applied, memo: `Pelunasan piutang ${transaction.invoice_number}` }]
    });
    db.prepare(`INSERT INTO transaction_payment_events (
      transaction_id, idempotency_key, request_hash, requested_amount, applied_amount, change_amount,
      payment_method, cash_account_code, journal_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(transaction.id, idempotencyKey, requestHash, amount, applied, change, paymentMethod, cashAccountCode, paymentJournal.id, request.user.id);
    if (transaction.transaction_type === 'servis') {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, date(?), ?)').run('pemasukan', 'Servis', `Pembayaran servis ${transaction.invoice_number}`, applied, 'transaction', new Date().toISOString(), request.user.id);
    }
    return { transaction: getTransactionById(transaction.id), duplicate: false };
  });
  const result = payment.immediate();
  if (result.error) return response.status(result.status).json({ error: result.error });
  response.json(result.transaction);
}

export function refundTransaction(request, response) {
  const reason = String(request.body.reason || '').trim();
  if (!reason || reason.length > 500) return response.status(400).json({ error: 'Alasan refund wajib diisi maksimal 500 karakter' });
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ? AND transaction_stage = 'final'").get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' });
  if (db.prepare('SELECT id FROM transaction_refunds WHERE transaction_id = ?').get(transaction.id)) return response.status(409).json({ error: 'Transaksi sudah direfund' });
  const items = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(transaction.id);
  const depositReceipts = items.filter((item) => item.item_type === 'service').map((item) => db.prepare('SELECT * FROM service_deposit_receipts WHERE service_id = ?').get(item.reference_id)).filter(Boolean);
  const subsequentPayments = db.prepare('SELECT COALESCE(SUM(applied_amount), 0) AS total FROM transaction_payment_events WHERE transaction_id = ?').get(transaction.id).total;
  const initialPaid = Math.max(0, transaction.paid_amount - subsequentPayments);
  const depositApplied = Math.min(initialPaid, depositReceipts.reduce((total, deposit) => total + deposit.amount, 0));
  const extraInitialPayment = initialPaid - depositApplied;
  const refundAmount = depositReceipts.reduce((total, deposit) => total + deposit.amount, 0) + extraInitialPayment + subsequentPayments;
  const applyRefund = db.transaction(() => {
    const refundId = Number(db.prepare('INSERT INTO transaction_refunds (transaction_id, amount, reason, created_by) VALUES (?, ?, ?, ?)').run(transaction.id, refundAmount, reason, request.user.id).lastInsertRowid);
    for (const item of items) {
      if (item.item_type === 'product') {
        if (!db.prepare('SELECT id FROM products WHERE id = ?').get(item.reference_id)) throw new Error(`Produk ${item.name} tidak ditemukan untuk dikembalikan ke stok`);
        const returnedUnits = refundSoldInventoryUnits(db, { transactionItemId: item.id, refundId, createdBy: request.user.id });
        const returnedParts = restoreSparePartAllocationsForRefund(db, { transactionItemId: item.id, refundId, createdBy: request.user.id });
        const legacyQuantity = item.qty - returnedUnits - returnedParts;
        if (legacyQuantity < 0) throw new Error('Jumlah alokasi stok melebihi jumlah item transaksi');
        if (legacyQuantity > 0) restoreLegacyStockForRefund(db, { productId: item.reference_id, quantity: legacyQuantity });

        if (Number(item.allocated_hpp || 0) > 0) {
          const hppJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'sale_cogs' AND source_id = ? AND source_event = 'recognition' AND status = 'posted'").get(String(item.id));
          if (!hppJournal) throw new Error(`Jurnal HPP untuk ${item.name} tidak ditemukan`);
          reverseJournal(db, hppJournal.id, { reason, entryDate: new Date().toISOString().slice(0, 10), createdBy: request.user.id, idempotencyKey: `refund:${transaction.id}:hpp:${item.id}` });
        }
      } else if (item.item_type === 'trade_in') {
        if (!item.reference_id) throw new Error(`Barang trade-in ${item.name} belum tertaut ke inventori`);
        const product = db.prepare('SELECT category FROM products WHERE id = ?').get(item.reference_id);
        if (!product) throw new Error(`Barang trade-in ${item.name} tidak ditemukan`);
        if (product.category === 'laptop' && db.prepare("SELECT id FROM inventory_units WHERE product_id = ? AND source_type = 'trade_in' AND source_reference = ? LIMIT 1").get(item.reference_id, transaction.invoice_number)) {
          returnTradeInUnitsToSource(db, { productId: item.reference_id, sourceReference: transaction.invoice_number, quantity: item.qty, createdBy: request.user.id, refundId });
        } else {
          const control = db.prepare('SELECT legacy_stock FROM inventory_product_controls WHERE product_id = ?').get(item.reference_id);
          if (!control || control.legacy_stock < item.qty) throw new Error('Barang trade-in tidak tersedia di stok untuk dikembalikan ke customer');
          const updated = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(item.qty, item.reference_id, item.qty);
          const legacy = db.prepare('UPDATE inventory_product_controls SET legacy_stock = legacy_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND legacy_stock >= ?').run(item.qty, item.reference_id, item.qty);
          if (updated.changes !== 1 || legacy.changes !== 1) throw new Error('Barang trade-in tidak tersedia di stok untuk dikembalikan ke customer');
        }
      }
    }
    const saleJournal = db.prepare("SELECT id FROM journal_entries WHERE source_type = 'transaction_sale' AND source_id = ? AND source_event = 'recognition' AND status = 'posted'").get(String(transaction.id));
    if (saleJournal) reverseJournal(db, saleJournal.id, { reason, entryDate: new Date().toISOString().slice(0, 10), createdBy: request.user.id, idempotencyKey: `refund:${transaction.id}:sale` });
    const paymentJournals = db.prepare(`SELECT journal_entries.id FROM transaction_payment_events
      JOIN journal_entries ON journal_entries.id = transaction_payment_events.journal_entry_id
      WHERE transaction_payment_events.transaction_id = ? AND journal_entries.status = 'posted' ORDER BY transaction_payment_events.id`).all(transaction.id);
    for (const paymentJournal of paymentJournals) reverseJournal(db, paymentJournal.id, { reason, entryDate: new Date().toISOString().slice(0, 10), createdBy: request.user.id, idempotencyKey: `refund:${transaction.id}:payment:${paymentJournal.id}` });
    for (const deposit of depositReceipts) {
      const journal = db.prepare("SELECT id FROM journal_entries WHERE id = ? AND status = 'posted'").get(deposit.journal_entry_id);
      if (journal) reverseJournal(db, journal.id, { reason, entryDate: new Date().toISOString().slice(0, 10), createdBy: request.user.id, idempotencyKey: `refund:${transaction.id}:service-deposit:${deposit.id}` });
    }
    if (refundAmount > 0) {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run('pengeluaran', 'Refund', `Refund ${transaction.invoice_number}: ${reason}`, refundAmount, 'transaction', new Date().toISOString().slice(0, 10), request.user.id);
    }
    return refundId;
  });
  try {
    applyRefund.immediate();
  } catch (error) {
    if (/tidak ditemukan|tidak tersedia|melebihi jumlah|tidak konsisten|sudah dijual|dihapuskan/.test(error.message || '')) return response.status(409).json({ error: error.message });
    throw error;
  }
  response.status(201).json(getTransactionById(transaction.id));
}