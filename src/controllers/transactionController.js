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
        if (!Number.isSafeInteger(tradeInPrice) || tradeInPrice < 0) throw new Error('Nominal tukar tambah harus angka bulat >= 0');
        tradeInTotal += tradeInPrice * qty;
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
      const qty = Number(item.qty || 1); itemStatement.run(transaction.lastInsertRowid, item.item_type, item.reference_id || null, item.name, item.serial_number || '', item.price, qty, Number(item.price) * qty);
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

function getTransactionById(id) { const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id); if (!transaction) return null; return { ...transaction, items: db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(id) }; }
export function getTransaction(request, response) { const transaction = getTransactionById(request.params.id); if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' }); response.json(transaction); }
export function listTransactions(_request, response) { response.json(db.prepare("SELECT * FROM transactions WHERE transaction_stage = 'final' ORDER BY created_at DESC").all()); }
export function payTransaction(request, response) {
  const amount = Number(request.body.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return response.status(400).json({ error: 'Nominal pembayaran harus angka bulat lebih besar dari 0' });
  const transaction = db.prepare('SELECT * FROM transactions WHERE id = ?').get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Transaksi tidak ditemukan' });
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