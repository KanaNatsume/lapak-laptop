import db from '../db.js';

export function getSettings(_request, response) {
  response.json(db.prepare('SELECT * FROM store_settings WHERE id = 1').get());
}

export function updateSettings(request, response) {
  const { store_name, store_address = '', store_phone = '', receipt_footer_text = '', receipt_closing_text = '', paper_size_preference = '58mm', opening_time = '09:00', closing_time = '21:00', store_logo_data_url = '', store_instagram = '', store_facebook = '', store_tiktok = '', store_whatsapp = '' } = request.body;
  if (!store_name || !['58mm', '80mm', 'A4'].includes(paper_size_preference)) return response.status(400).json({ error: 'Nama toko dan ukuran kertas wajib valid' });
  if (store_logo_data_url && (!/^data:image\/(png|jpeg);base64,[A-Za-z\d+/]+=*$/.test(store_logo_data_url) || store_logo_data_url.length > 300000)) return response.status(400).json({ error: 'Logo harus PNG atau JPEG dan maksimal sekitar 220 KB' });
  for (const value of [store_instagram, store_facebook, store_tiktok, store_whatsapp]) {
    if (typeof value !== 'string' || value.length > 200) return response.status(400).json({ error: 'Nomor WhatsApp dan akun sosial maksimal 200 karakter' });
  }
  db.prepare(`UPDATE store_settings SET store_name = ?, store_address = ?, store_phone = ?, receipt_footer_text = ?, receipt_closing_text = ?, paper_size_preference = ?, opening_time = ?, closing_time = ?, store_logo_data_url = ?, store_instagram = ?, store_facebook = ?, store_tiktok = ?, store_whatsapp = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(store_name.trim(), store_address.trim(), store_phone.trim(), receipt_footer_text, receipt_closing_text, paper_size_preference, opening_time, closing_time, store_logo_data_url, store_instagram.trim(), store_facebook.trim(), store_tiktok.trim(), store_whatsapp.trim());
  response.json(db.prepare('SELECT * FROM store_settings WHERE id = 1').get());
}