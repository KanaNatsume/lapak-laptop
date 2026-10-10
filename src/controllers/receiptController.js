import db from '../db.js';

export function getReceipt(request, response) {
  const transaction = db.prepare(`SELECT transactions.*, customers.name AS customer_name, customers.phone AS customer_phone, customers.address AS customer_address, store_settings.store_name, store_settings.store_address, store_settings.store_phone, store_settings.receipt_footer_text, store_settings.receipt_closing_text, store_settings.paper_size_preference FROM transactions LEFT JOIN customers ON customers.id = transactions.customer_id CROSS JOIN store_settings WHERE transactions.id = ? AND store_settings.id = 1`).get(request.params.id);
  if (!transaction) return response.status(404).json({ error: 'Nota tidak ditemukan' });
  const items = db.prepare(`SELECT transaction_items.*, COALESCE(NULLIF(transaction_items.serial_number, ''), products.serial_number, '') AS serial_number FROM transaction_items LEFT JOIN products ON products.id = transaction_items.reference_id WHERE transaction_items.transaction_id = ? ORDER BY transaction_items.id`).all(request.params.id);
  response.json({ ...transaction, remaining_amount: Math.max(0, transaction.grand_total - transaction.paid_amount), items });
}

export function getServiceOpeningReceipt(request, response) {
  const service = db.prepare(`SELECT services.id, services.ticket_number, services.device_name, services.serial_number, services.status, services.estimated_cost, services.down_payment, services.created_at, customers.name AS customer_name, customers.phone AS customer_phone, customers.address AS customer_address, store_settings.store_name, store_settings.store_address, store_settings.store_phone, store_settings.receipt_footer_text, store_settings.receipt_closing_text, store_settings.paper_size_preference FROM services JOIN customers ON customers.id = services.customer_id CROSS JOIN store_settings WHERE services.id = ? AND store_settings.id = 1`).get(request.params.id);
  if (!service) return response.status(404).json({ error: 'Tiket servis tidak ditemukan' });
  const total = Math.max(Number(service.estimated_cost || 0), Number(service.down_payment || 0));
  const paid = Math.min(Number(service.down_payment || 0), total);
  response.json({
    id: `service-opening-${service.id}`,
    invoice_number: service.ticket_number,
    transaction_type: 'servis',
    customer_name: service.customer_name,
    customer_phone: service.customer_phone,
    customer_address: service.customer_address,
    store_name: service.store_name,
    store_address: service.store_address,
    store_phone: service.store_phone,
    receipt_footer_text: service.receipt_footer_text,
    receipt_closing_text: service.receipt_closing_text,
    paper_size_preference: service.paper_size_preference,
    created_at: service.created_at,
    subtotal: total,
    direct_discount: 0,
    shipping_cost: 0,
    grand_total: total,
    paid_amount: paid,
    remaining_amount: Math.max(0, total - paid),
    change_amount: 0,
    payment_status: paid >= total ? 'lunas' : paid > 0 ? 'dp' : 'bayar_nanti',
    items: [{ id: `service-${service.id}`, name: `Servis ${service.device_name}`, serial_number: service.serial_number || '', price: total, qty: 1, subtotal: total }]
  });
}