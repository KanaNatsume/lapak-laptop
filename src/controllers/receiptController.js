import db from '../db.js';

export function getReceipt(request, response) {
  const transaction = db.prepare(`SELECT transactions.*, customers.name AS customer_name, customers.phone AS customer_phone, customers.address AS customer_address, store_settings.store_name, store_settings.store_address, store_settings.store_phone, store_settings.receipt_footer_text, store_settings.receipt_closing_text, store_settings.paper_size_preference FROM transactions LEFT JOIN customers ON customers.id = transactions.customer_id CROSS JOIN store_settings WHERE transactions.id = ? AND store_settings.id = 1`).get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Nota tidak ditemukan' });
  const items = db.prepare(`SELECT transaction_items.*, COALESCE(NULLIF(transaction_items.serial_number, ''), products.serial_number, '') AS serial_number FROM transaction_items LEFT JOIN products ON products.id = transaction_items.reference_id WHERE transaction_items.transaction_id = ? ORDER BY transaction_items.id`).all(request.params.id);
  response.json({ ...transaction, items });
}