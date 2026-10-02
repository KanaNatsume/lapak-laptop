import db from '../db.js';

export function listCustomers(request, response) {
  const search = `%${request.query.search || ''}%`;
  response.json(db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 50').all(search, search));
}

export function createCustomer(request, response) {
  const { name, phone, address = '' } = request.body;
  if (!name || !phone) return response.status(400).json({ error: 'Nama dan nomor telepon wajib diisi' });
  const result = db.prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)').run(name, phone, address);
  response.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
}