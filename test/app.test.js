import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const databasePath = path.join(process.cwd(), 'data', 'pos-test.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
}
process.env.DATABASE_PATH = databasePath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const { default: db } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');

let server;
let baseUrl;
const tokens = {};

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.headers || {}) } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  for (const [name, role] of [['admin', 'admin'], ['cashier', 'kasir'], ['technician', 'teknisi']]) {
    db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)').run(name, name, hashPassword('password-12345'), role);
  }
  db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Test Customer', '0800000000');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const username of ['admin', 'cashier', 'technician']) {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'password-12345' }) });
    assert.equal(result.status, 200);
    tokens[username] = result.body.token;
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
  }
});

test('permission: teknisi dapat membaca produk tetapi tidak membuat produk', async () => {
  const read = await request('/api/products', { token: tokens.technician });
  assert.equal(read.status, 200);
  const create = await request('/api/products', { method: 'POST', token: tokens.technician, body: JSON.stringify({ category: 'laptop', name: 'Forbidden', stock: 1 }) });
  assert.equal(create.status, 403);
});

test('transaction and stock: checkout reduces stock and rejects overselling', async () => {
  const created = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Test Laptop', selling_price: 1000000, stock: 1 }) });
  assert.equal(created.status, 201);
  const payload = { customer_id: 1, transaction_type: 'penjualan', payment_status: 'lunas', payment_method: 'cash', items: [{ item_type: 'product', reference_id: created.body.id, qty: 1 }] };
  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(sale.status, 201);
  const inventory = await request('/api/products?include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventory.body.find((item) => item.id === created.body.id).stock, 0);
  const oversell = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(oversell.status, 400);
});

test('service status: teknisi can advance service, cashier cannot', async () => {
  const created = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Test Laptop', issues: 'Tidak menyala' }) });
  assert.equal(created.status, 201);
  const technicianUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  assert.equal(technicianUpdate.status, 200);
  const cashierUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.cashier, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Test', final_cost: 500000 }) });
  assert.equal(cashierUpdate.status, 403);
});

test('cash: manual entries require cashier role and service payments record actual cash', async () => {
  const manual = await request('/api/cash-entries', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ entry_type: 'pengeluaran', category: 'Test', description: 'Biaya test', amount: 25000 }) });
  assert.equal(manual.status, 201);
  const forbidden = await request('/api/cash-entries', { method: 'POST', token: tokens.technician, body: JSON.stringify({ entry_type: 'pemasukan', category: 'Test', description: 'Forbidden', amount: 1 }) });
  assert.equal(forbidden.status, 403);
  const serviceTransaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, transaction_type: 'servis', payment_status: 'bayar_nanti', payment_method: 'cash', items: [{ item_type: 'service', reference_id: 1, name: 'Servis test', price: 500000, qty: 1 }] }) });
  assert.equal(serviceTransaction.status, 201);
  const beforePayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis'").get().total;
  assert.equal(beforePayment, 0);
  const payment = await request(`/api/transactions/${serviceTransaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 200000 }) });
  assert.equal(payment.status, 200);
  const afterPayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis'").get().total;
  assert.equal(afterPayment, 200000);
});
