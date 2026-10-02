import db from '../db.js';

function parseProduct(row) {
  return row ? { ...row, specs: JSON.parse(row.specs || '{}') } : row;
}

export function listProducts(request, response) {
  const search = `%${request.query.search || ''}%`;
  const category = request.query.category;
  const stockFilter = request.query.include_out_of_stock === 'true' ? '' : 'stock > 0 AND ';
  const rows = category
    ? db.prepare(`SELECT * FROM products WHERE ${stockFilter} category = ? AND (name LIKE ? OR brand LIKE ? OR COALESCE(serial_number, '') LIKE ?) ORDER BY created_at DESC`).all(category, search, search, search)
    : db.prepare(`SELECT * FROM products WHERE ${stockFilter} (name LIKE ? OR brand LIKE ? OR COALESCE(serial_number, '') LIKE ?) ORDER BY created_at DESC`).all(search, search, search);
  response.json(rows.map(parseProduct));
}

export function createProduct(request, response) {
  const { category, name, brand = '', specs = {}, serial_number = null, grade_condition = 'B', cost_price = 0, selling_price = 0, stock = 0, notes = '' } = request.body;
  if (!category || !name || !['laptop', 'aksesoris', 'part_copotan'].includes(category)) return response.status(400).json({ error: 'Kategori dan nama produk wajib diisi' });
  try {
    const result = db.prepare(`INSERT INTO products (category, name, brand, specs, serial_number, grade_condition, cost_price, selling_price, stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(category, name, brand, JSON.stringify(specs), serial_number || null, grade_condition, cost_price, selling_price, stock, notes);
    response.status(201).json(parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid)));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Serial number sudah digunakan' });
    throw error;
  }
}

export function updateProduct(request, response) {
  const { category, name, brand = '', specs = {}, serial_number = null, grade_condition = 'B', cost_price = 0, selling_price = 0, stock = 0, notes = '' } = request.body;
  if (!category || !name || !['laptop', 'aksesoris', 'part_copotan'].includes(category)) return response.status(400).json({ error: 'Kategori dan nama produk wajib diisi' });
  try {
    const result = db.prepare(`UPDATE products SET category = ?, name = ?, brand = ?, specs = ?, serial_number = ?, grade_condition = ?, cost_price = ?, selling_price = ?, stock = ?, notes = ? WHERE id = ?`).run(category, name, brand, JSON.stringify(specs), serial_number || null, grade_condition, cost_price, selling_price, stock, notes, request.params.id);
    if (!result.changes) return response.status(404).json({ error: 'Produk tidak ditemukan' });
    response.json(parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(request.params.id)));
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Serial number sudah digunakan' });
    throw error;
  }
}