import db from '../db.js';

function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase().replaceAll(' ', '_'));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function normalizeName(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('62')) digits = `0${digits.slice(2)}`;
  return digits;
}
function flagIsFalse(value) { return ['0', 'false', 'no', 'tidak'].includes(String(value || '').trim().toLowerCase()); }

export function listCustomers(request, response) {
  const search = `%${request.query.search || ''}%`;
  response.json(db.prepare('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR address LIKE ? ORDER BY name').all(search, search, search));
}

export function createCustomer(request, response) {
  const { name, phone, address = '' } = request.body;
  if (!name || !phone) return response.status(400).json({ error: 'Nama dan nomor telepon wajib diisi' });
  const result = db.prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)').run(name, phone, address);
  response.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
}

export function importAroniumCustomers(request, response) {
  if (!request.file) return response.status(400).json({ error: 'File customers.csv wajib dipilih' });
  const rows = parseCsv(request.file.buffer);
  if (!rows.length) return response.status(400).json({ error: 'CSV kosong atau header tidak terbaca' });
  const existing = db.prepare('SELECT name, phone, address FROM customers').all();
  const phoneKeys = new Set(existing.map((item) => normalizePhone(item.phone)).filter((phone) => phone.length >= 8));
  const fallbackKeys = new Set(existing.map((item) => `${normalizeName(item.name)}|${normalizeName(item.address)}`));
  const accepted = [];
  let skipped = 0;
  let ignored = 0;
  for (const row of rows) {
    if (flagIsFalse(row.iscustomer) || flagIsFalse(row.isenabled)) { ignored += 1; continue; }
    const name = String(row.name || '').trim();
    if (!name) { ignored += 1; continue; }
    const address = [row.streetname, row.buildingnumber, row.additionalstreetname, row.plotidentification, row.postalcode, row.city, row.citysubdivisionname, row.countrysubentity, row.country]
      .map((part) => String(part || '').trim()).filter(Boolean).join(', ');
    const phone = String(row.phone || '').trim();
    const phoneKey = normalizePhone(phone);
    const fallbackKey = `${normalizeName(name)}|${normalizeName(address)}`;
    if ((phoneKey.length >= 8 && phoneKeys.has(phoneKey)) || (phoneKey.length < 8 && fallbackKeys.has(fallbackKey))) { skipped += 1; continue; }
    if (phoneKey.length >= 8) phoneKeys.add(phoneKey);
    fallbackKeys.add(fallbackKey);
    accepted.push({ name, phone, address });
  }
  if (!accepted.length) return response.status(200).json({ imported: 0, skipped, ignored, customers: [], message: 'Tidak ada pelanggan baru untuk diimpor' });
  const ids = [];
  const insert = db.transaction(() => {
    const statement = db.prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)');
    for (const customer of accepted) ids.push(Number(statement.run(customer.name, customer.phone, customer.address).lastInsertRowid));
  });
  insert();
  const placeholders = ids.map(() => '?').join(',');
  const customers = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders}) ORDER BY name`).all(...ids);
  response.status(201).json({ imported: customers.length, skipped, ignored, customers });
}