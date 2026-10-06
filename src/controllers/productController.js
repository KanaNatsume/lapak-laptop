import db from '../db.js';
import ExcelJS from 'exceljs';

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

function importValue(row, names) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.toLowerCase().trim().replaceAll(' ', '_')));
  return key === undefined ? undefined : row[key];
}

function parseCsv(buffer) {
  const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const split = (line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((value) => value.trim().replace(/^"|"$/g, '').replaceAll('""', '"'));
  const headers = split(lines.shift());
  return lines.map((line) => { const values = split(line); return Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])); });
}

function normalizeCategory(value) {
  const category = String(value || '').trim().toLowerCase().replaceAll(' ', '_');
  return category === 'part' ? 'part_copotan' : category;
}

const specificationTemplateColumns = ['processor', 'gpu', 'memory', 'storage', 'storage_note', 'display', 'display_note', 'port_io', 'port_io_note', 'feature', 'contents', 'unit_source', 'physical_description', 'keyboard_description', 'touchpad', 'touchpad_note', 'battery_cycle_count', 'battery_capacity', 'battery_health', 'benchmark_cinebench_r23', 'benchmark_superposition', 'benchmark_valley', 'charger_voltage', 'charger_ampere', 'audio', 'audio_note', 'camera', 'security', 'lock_status'];
const arraySpecificationColumns = new Set(['storage', 'display', 'port_io', 'feature', 'contents', 'touchpad', 'audio', 'camera', 'security', 'lock_status']);
const singleSpecificationColumns = new Set(['processor', 'gpu', 'memory', 'unit_source']);

function readSpecifications(row) {
  const specs = {};
  for (const column of specificationTemplateColumns) {
    const value = importValue(row, [column]);
    if (value === undefined || String(value).trim() === '') continue;
    if (column.endsWith('_note')) specs[column] = String(value).trim();
    else if (column === 'physical_description') specs.physical = { description: String(value).trim() };
    else if (column === 'keyboard_description') specs.keyboard = { description: String(value).trim() };
    else if (column.startsWith('battery_')) specs.battery = { ...(specs.battery || {}), [column.replace('battery_', '')]: String(value).trim() };
    else if (column.startsWith('benchmark_')) specs.benchmark = { ...(specs.benchmark || {}), [column.replace('benchmark_', '')]: String(value).trim() };
    else if (column.startsWith('charger_')) specs.charger = { ...(specs.charger || {}), [column.replace('charger_', '')]: String(value).trim() };
    else if (singleSpecificationColumns.has(column)) specs[column] = String(value).trim();
    else if (arraySpecificationColumns.has(column)) specs[column] = String(value).split('|').map((item) => item.trim()).filter(Boolean);
  }
  return specs;
}

export async function downloadProductImportTemplate(_request, response) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Produk');
  const headers = ['category', 'name', 'brand', 'serial_number', 'cost_price', 'selling_price', 'stock', 'notes', ...specificationTemplateColumns];
  sheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(16, header.length + 3) }));
  sheet.addRow({ category: 'laptop', name: 'ThinkPad T480', brand: 'Lenovo', cost_price: 5000000, selling_price: 6500000, stock: 1, notes: 'Contoh isi', processor: 'Intel Core i5 10th Gen', gpu: 'Intel HD 530', memory: '16GB DDR4', storage: '512GB SSD NVMe|1TB HDD', display: '14" Full HD IPS|Anti-glare', port_io: 'USB-A 3.0 x2|HDMI', feature: 'Backlit Keyboard|Fingerprint Reader', contents: 'Charger|Tas', unit_source: 'Toko / reseller', physical_description: 'Ada lecet ringan di cover', keyboard_description: 'Tombol lengkap', touchpad: 'Pointer normal', battery_cycle_count: 120, battery_capacity: '45Wh', battery_health: 88, benchmark_cinebench_r23: '5200', benchmark_superposition: '1200', benchmark_valley: '950', charger_voltage: 20, charger_ampere: 3.25, audio: 'Speaker normal|Mic normal', camera: 'Webcam normal', security: 'Fingerprint', lock_status: 'BIOS unlock' });
  sheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B332A' } }; });
  sheet.getRow(2).eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F3D3' } }; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  let columnNumber = headers.length;
  let lastColumn = '';
  while (columnNumber > 0) { const remainder = (columnNumber - 1) % 26; lastColumn = String.fromCharCode(65 + remainder) + lastColumn; columnNumber = Math.floor((columnNumber - 1) / 26); }
  sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` };
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', 'attachment; filename="template-import-produk.xlsx"');
  await workbook.xlsx.write(response);
  response.end();
}

export async function importProducts(request, response) {
  if (!request.file) return response.status(400).json({ error: 'File Excel wajib dipilih' });
  let rows;
  try {
    if (request.file.mimetype === 'text/csv' || request.file.originalname.toLowerCase().endsWith('.csv')) rows = parseCsv(request.file.buffer);
    else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(request.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return response.status(400).json({ error: 'File Excel tidak memiliki sheet' });
      const headers = sheet.getRow(1).values.slice(1).map((header) => String(header || '').trim());
      rows = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values.slice(1);
        if (values.every((value) => value === null || value === undefined || value === '')) return;
        rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
      });
    }
  } catch { return response.status(400).json({ error: 'File Excel tidak dapat dibaca' }); }
  if (!rows.length) return response.status(400).json({ error: 'File Excel tidak memiliki data' });

  const errors = [];
  const products = rows.map((row, index) => {
    const line = index + 2;
    const name = String(importValue(row, ['name', 'nama', 'model']) || '').trim();
    const category = normalizeCategory(importValue(row, ['category', 'kategori']));
    const brand = String(importValue(row, ['brand', 'merek']) || '').trim();
    const serialNumber = String(importValue(row, ['serial_number', 'serial', 'serial_number_produk']) || '').trim() || null;
    const costPrice = Number(importValue(row, ['cost_price', 'harga_modal', 'modal']) || 0);
    const sellingPrice = Number(importValue(row, ['selling_price', 'harga_jual', 'harga']) || 0);
    const stock = Number(importValue(row, ['stock', 'stok', 'jumlah']) || 0);
    const specs = readSpecifications(row);
    if (!name) errors.push(`Baris ${line}: nama produk wajib diisi`);
    if (!['laptop', 'aksesoris', 'part_copotan'].includes(category)) errors.push(`Baris ${line}: kategori harus laptop, aksesoris, atau part_copotan`);
    if (!Number.isInteger(costPrice) || costPrice < 0 || !Number.isInteger(sellingPrice) || sellingPrice < 0) errors.push(`Baris ${line}: harga harus bilangan bulat >= 0`);
    if (!Number.isInteger(stock) || stock < 0) errors.push(`Baris ${line}: stok harus bilangan bulat >= 0`);
    return { line, category, name, brand, serialNumber, specs, costPrice, sellingPrice, stock, notes: String(importValue(row, ['notes', 'catatan']) || '').trim() };
  });
  const serials = new Set();
  for (const product of products) {
    if (!product.serialNumber) continue;
    if (serials.has(product.serialNumber)) errors.push(`Baris ${product.line}: serial number duplikat di file`);
    serials.add(product.serialNumber);
  }
  if (errors.length) return response.status(400).json({ error: 'Import dibatalkan karena ada data tidak valid', errors });
  try {
    const insert = db.transaction(() => {
      const statement = db.prepare('INSERT INTO products (category, name, brand, specs, serial_number, cost_price, selling_price, stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const product of products) statement.run(product.category, product.name, product.brand, JSON.stringify(product.specs), product.serialNumber, product.costPrice, product.sellingPrice, product.stock, product.notes);
    });
    insert();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'Import dibatalkan: ada serial number yang sudah terdaftar' });
    throw error;
  }
  response.status(201).json({ imported: products.length, products: db.prepare(`SELECT * FROM products WHERE id > (SELECT COALESCE(MAX(id), 0) - ? FROM products) ORDER BY id DESC LIMIT ?`).all(products.length, products.length).map(parseProduct) });
}