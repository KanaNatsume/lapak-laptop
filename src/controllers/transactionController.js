import db from '../db.js';

function invoiceNumber() { const stamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14); return `INV-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

export function createTransaction(request, response) {
  const { customer_id = null, transaction_type = 'penjualan', transaction_stage = 'final', items = [], direct_discount = 0, shipping_cost = 0, paid_amount = null, payment_method = 'cash', payment_status = 'lunas', notes = '', warranty_note = '', record_cash = true } = request.body;
  if (!items.length) return response.status(400).json({ error: 'Transaksi harus memiliki item' });
  const checkout = db.transaction(() => {
    let subtotal = 0;
    let tradeInTotal = 0;
    for (const item of items) {
      const qty = Number(item.qty || 1);
      if (!['product', 'service', 'trade_in'].includes(item.item_type) || !Number.isInteger(qty) || qty <= 0) throw new Error('Item transaksi tidak valid');
      if (item.item_type === 'trade_in') { tradeInTotal += Number(item.price) * qty; continue; }
      if (item.item_type === 'product') {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.reference_id);
        if (!product || product.stock < Number(item.qty || 1)) throw new Error(`Stok tidak cukup untuk ${item.name || 'produk'}`);
        item.name = product.name;
        item.price = product.selling_price;
        item.serial_number = product.serial_number || '';
      }
      subtotal += Number(item.price) * Number(item.qty || 1);
    }
    const discount = Math.max(0, Number(direct_discount));
    const shipping = Math.max(0, Number(shipping_cost));
    const grandTotal = Math.max(0, subtotal - tradeInTotal - discount + shipping);
    const paid = payment_status === 'bayar_nanti' ? 0 : paid_amount === null ? grandTotal : Math.max(0, Number(paid_amount));
    const change = Math.max(0, paid - grandTotal);
    const invoice = invoiceNumber();
    const transaction = db.prepare(`INSERT INTO transactions (invoice_number, customer_id, transaction_type, transaction_stage, subtotal, trade_in_total, direct_discount, shipping_cost, grand_total, paid_amount, change_amount, payment_method, payment_status, notes, warranty_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(invoice, customer_id, transaction_type, transaction_stage, subtotal, tradeInTotal, discount, shipping, grandTotal, paid, change, payment_method, payment_status, notes, warranty_note);
    const itemStatement = db.prepare('INSERT INTO transaction_items (transaction_id, item_type, reference_id, name, serial_number, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of items) {
      const qty = Number(item.qty || 1); itemStatement.run(transaction.lastInsertRowid, item.item_type, item.reference_id || null, item.name, item.serial_number || '', item.price, qty, Number(item.price) * qty);
      if (item.item_type === 'product') {
        const updated = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, item.reference_id, qty);
        if (updated.changes !== 1) throw new Error(`Stok tidak cukup untuk ${item.name}`);
      }
    }
    if (record_cash && transaction_stage === 'final' && transaction_type === 'servis' && paid > 0) {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, date(?), ?)').run('pemasukan', 'Servis', `Pembayaran servis ${invoice}`, paid, 'transaction', new Date().toISOString(), request.user.id);
    }
    return Number(transaction.lastInsertRowid);
  })();
  response.status(201).json(getTransactionById(checkout));
}

function getTransactionById(id) { const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id); if (!transaction) return null; return { ...transaction, items: db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(id) }; }
export function getTransaction(request, response) { const transaction = getTransactionById(request.params.id); if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' }); response.json(transaction); }
export function listTransactions(_request, response) { response.json(db.prepare("SELECT * FROM transactions WHERE transaction_stage = 'final' ORDER BY created_at DESC LIMIT 50").all()); }
export function payTransaction(request, response) {
  const amount = Number(request.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return response.status(400).json({ error: 'Nominal pembayaran tidak valid' });
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' });
  if (transaction.transaction_stage === 'opening') return response.status(400).json({ error: 'Nota awal servis tidak dapat menerima pelunasan' });
  const paid = transaction.paid_amount + amount;
  const change = Math.max(0, paid - transaction.grand_total);
  const status = paid >= transaction.grand_total ? 'lunas' : 'dp';
  const payment = db.transaction(() => {
    db.prepare('UPDATE transactions SET paid_amount = ?, change_amount = ?, payment_status = ? WHERE id = ?').run(paid, change, status, transaction.id);
    if (transaction.transaction_type === 'servis') {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, date(?), ?)').run('pemasukan', 'Servis', `Pembayaran servis ${transaction.invoice_number}`, amount, 'transaction', new Date().toISOString(), request.user.id);
    }
  });
  payment();
  response.json(getTransactionById(transaction.id));
}