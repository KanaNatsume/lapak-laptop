import db from '../db.js';

export function getSettings(_request, response) {
  response.json(db.prepare('SELECT * FROM store_settings WHERE id = 1').get());
}

export function updateSettings(request, response) {
  const { store_name, store_address = '', store_phone = '', receipt_footer_text = '', receipt_closing_text = '', paper_size_preference = '58mm', opening_time = '09:00', closing_time = '21:00' } = request.body;
  if (!store_name || !['58mm', '80mm', 'A4'].includes(paper_size_preference)) return response.status(400).json({ error: 'Nama toko dan ukuran kertas wajib valid' });
  db.prepare(`UPDATE store_settings SET store_name = ?, store_address = ?, store_phone = ?, receipt_footer_text = ?, receipt_closing_text = ?, paper_size_preference = ?, opening_time = ?, closing_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(store_name, store_address, store_phone, receipt_footer_text, receipt_closing_text, paper_size_preference, opening_time, closing_time);
  response.json(db.prepare('SELECT * FROM store_settings WHERE id = 1').get());
}