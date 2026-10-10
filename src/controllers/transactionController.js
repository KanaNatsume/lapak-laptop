import db from '../db.js';

function invoiceNumber() { const stamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14); return `INV-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

export function createTransaction(request, response) {
  const { customer_id = null, transaction_type = 'penjualan', items = [], direct_discount = 0, shipping_cost = 0, paid_amount = null, payment_method = 'cash', notes = '', warranty_note = '' } = request.body;
  if (!Array.isArray(items) || !items.length) return response.status(400).json({ error: 'Transaksi harus memiliki item' });
  if (!['penjualan', 'tukar_tambah', 'servis', 'campuran'].includes(transaction_type)) return response.status(400).json({ error: 'Jenis transaksi tidak valid' });
  if (!['cash', 'transfer', 'qris'].includes(payment_method)) return response.status(400).json({ error: 'Metode pembayaran tidak valid' });
  const checkout = db.transaction(() => {
    let subtotal = 0;
    let tradeInTotal = 0;
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
      } else if (item.item_type === 'service') {
        const service = db.prepare('SELECT device_name, status, final_cost FROM services WHERE id = ?').get(item.reference_id);
        if (!service || service.status !== 'selesai') throw new Error('Servis belum selesai atau tidak ditemukan');
        if (!Number.isSafeInteger(service.final_cost) || service.final_cost <= 0) throw new Error('Biaya final servis belum ditentukan');
        item.name = `Servis ${service.device_name}`;
        item.price = service.final_cost;
      }
      subtotal += Number(item.price) * qty;
    }
    const grandTotal = Math.max(0, subtotal - tradeInTotal - discount + shipping);
    const tendered = paid_amount === null ? grandTotal : Number(paid_amount);
    if (!Number.isSafeInteger(tendered) || tendered < 0) throw new Error('Nominal pembayaran harus angka bulat >= 0');
    const paid = Math.min(tendered, grandTotal);
    const change = Math.max(0, tendered - grandTotal);
    const paymentStatus = paid >= grandTotal ? 'lunas' : paid > 0 ? 'dp' : 'bayar_nanti';
    const invoice = invoiceNumber();
    const transaction = db.prepare(`INSERT INTO transactions (invoice_number, customer_id, transaction_type, transaction_stage, subtotal, trade_in_total, direct_discount, shipping_cost, grand_total, paid_amount, change_amount, payment_method, payment_status, notes, warranty_note) VALUES (?, ?, ?, 'final', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(invoice, customer_id, transaction_type, subtotal, tradeInTotal, discount, shipping, grandTotal, paid, change, payment_method, paymentStatus, notes, warranty_note);
    const itemStatement = db.prepare('INSERT INTO transaction_items (transaction_id, item_type, reference_id, name, serial_number, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of items) {
      const qty = Number(item.qty || 1);
      if (item.item_type === 'trade_in') {
        const product = db.prepare('INSERT INTO products (category, name, grade_condition, cost_price, selling_price, stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item.category, item.name, 'B', item.price, item.selling_price, qty, `Barang masuk dari tukar tambah ${invoice}`);
        item.reference_id = Number(product.lastInsertRowid);
      }
      itemStatement.run(transaction.lastInsertRowid, item.item_type, item.reference_id || null, item.name, item.serial_number || '', item.price, qty, Number(item.price) * qty);
      if (item.item_type === 'product') {
        const updated = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, item.reference_id, qty);
        if (updated.changes !== 1) throw new Error(`Stok tidak cukup untuk ${item.name}`);
      }
    }
    if (transaction_type === 'servis' && paid > 0) {
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
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' });
  if (db.prepare('SELECT id FROM transaction_refunds WHERE transaction_id = ?').get(transaction.id)) return response.status(409).json({ error: 'Transaksi sudah direfund dan tidak dapat menerima pelunasan' });
  if (transaction.transaction_stage === 'opening') return response.status(400).json({ error: 'Nota awal servis tidak dapat menerima pelunasan' });
  const remaining = Math.max(0, transaction.grand_total - transaction.paid_amount);
  if (!remaining) return response.status(400).json({ error: 'Transaksi sudah lunas' });
  const applied = Math.min(amount, remaining);
  const paid = transaction.paid_amount + applied;
  const change = amount - applied;
  const status = paid >= transaction.grand_total ? 'lunas' : 'dp';
  const payment = db.transaction(() => {
    db.prepare('UPDATE transactions SET paid_amount = ?, change_amount = ?, payment_status = ? WHERE id = ?').run(paid, transaction.change_amount + change, status, transaction.id);
    if (transaction.transaction_type === 'servis') {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, date(?), ?)').run('pemasukan', 'Servis', `Pembayaran servis ${transaction.invoice_number}`, applied, 'transaction', new Date().toISOString(), request.user.id);
    }
  });
  payment();
  response.json(getTransactionById(transaction.id));
}

export function refundTransaction(request, response) {
  const reason = String(request.body.reason || '').trim();
  if (!reason || reason.length > 500) return response.status(400).json({ error: 'Alasan refund wajib diisi maksimal 500 karakter' });
  const transaction = db.prepare("SELECT * FROM transactions WHERE id = ? AND transaction_stage = 'final'").get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' });
  if (db.prepare('SELECT id FROM transaction_refunds WHERE transaction_id = ?').get(transaction.id)) return response.status(409).json({ error: 'Transaksi sudah direfund' });
  const items = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(transaction.id);
  const tradeInQuantities = new Map();
  for (const item of items) {
    if (item.item_type === 'product' && !db.prepare('SELECT id FROM products WHERE id = ?').get(item.reference_id)) return response.status(409).json({ error: `Produk ${item.name} tidak ditemukan untuk dikembalikan ke stok` });
    if (item.item_type === 'trade_in') {
      if (!item.reference_id) return response.status(409).json({ error: `Barang trade-in ${item.name} belum tertaut ke inventori` });
      tradeInQuantities.set(item.reference_id, (tradeInQuantities.get(item.reference_id) || 0) + item.qty);
    }
  }
  for (const [productId, qty] of tradeInQuantities) {
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
    if (!product || product.stock < qty) return response.status(409).json({ error: 'Barang trade-in tidak tersedia di stok untuk dibatalkan' });
  }

  const applyRefund = db.transaction(() => {
    for (const item of items) {
      if (item.item_type === 'product') db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.qty, item.reference_id);
    }
    for (const [productId, qty] of tradeInQuantities) {
      const updated = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, productId, qty);
      if (updated.changes !== 1) throw new Error('Barang trade-in tidak tersedia di stok untuk dibatalkan');
    }
    db.prepare('INSERT INTO transaction_refunds (transaction_id, amount, reason, created_by) VALUES (?, ?, ?, ?)').run(transaction.id, transaction.paid_amount, reason, request.user.id);
    if (transaction.paid_amount > 0) {
      db.prepare('INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run('pengeluaran', 'Refund', `Refund ${transaction.invoice_number}: ${reason}`, transaction.paid_amount, 'transaction', new Date().toISOString().slice(0, 10), request.user.id);
    }
  });
  applyRefund();
  response.status(201).json(getTransactionById(transaction.id));
}