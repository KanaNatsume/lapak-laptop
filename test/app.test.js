import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const databasePath = path.join(process.cwd(), 'data', 'pos-test.sqlite');
for (const suffix of ['', '-wal', '-shm', '.pin-key']) {
  try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
}
process.env.DATABASE_PATH = databasePath;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';
process.env.TRUST_CLOUDFLARE_IP_HEADER = 'true';

const { default: db } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth.js');

let server;
let baseUrl;
const tokens = {};

async function request(pathname, options = {}) {
  const headers = { ...(options.token ? { Cookie: options.token } : {}), ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
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
    assert.equal(result.body.token, undefined);
    const setCookie = result.headers.get('set-cookie');
    assert.match(setCookie || '', /HttpOnly/);
    tokens[username] = setCookie.split(';')[0];
  }
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm', '.pin-key']) {
    try { fs.rmSync(`${databasePath}${suffix}`); } catch {}
  }
});

test('permission: teknisi dapat membaca produk tetapi tidak membuat produk', async () => {
  const read = await request('/api/products', { token: tokens.technician });
  assert.equal(read.status, 200);
  const create = await request('/api/products', { method: 'POST', token: tokens.technician, body: JSON.stringify({ category: 'laptop', name: 'Forbidden', stock: 1 }) });
  assert.equal(create.status, 403);
  const customerDirectory = await request('/api/customers', { token: tokens.technician });
  assert.equal(customerDirectory.status, 403);
});

test('security headers: API sends CSP and same-origin camera permission', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(health.headers.get('permissions-policy') || '', /camera=\(self\)/);
});

test('state-changing requests reject an unapproved browser origin', async () => {
  const response = await request('/api/cash-entries', {
    method: 'POST',
    token: tokens.cashier,
    headers: { Origin: 'https://untrusted.example' },
    body: JSON.stringify({ entry_type: 'pemasukan', category: 'Test', description: 'CSRF test', amount: 1 })
  });
  assert.equal(response.status, 403);
});

test('login throttling keys Cloudflare clients separately', async () => {
  const attempt = () => request('/api/auth/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.25' },
    body: JSON.stringify({ username: 'unknown-user', password: 'wrong-password' })
  });
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
  const otherClient = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '198.51.100.26' },
    body: JSON.stringify({ username: 'unknown-user', password: 'wrong-password' })
  });
  assert.equal(otherClient.status, 401);
});

test('product category: Gadget can be created and filtered', async () => {
  const created = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Test Gadget', brand: 'Samsung', selling_price: 5000000, cost_price: 4000000, stock: 2 }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.category, 'gadget');
  const filtered = await request('/api/products?category=gadget&include_out_of_stock=true', { token: tokens.cashier });
  assert.ok(filtered.body.some((product) => product.id === created.body.id));
});

test('product deletion is allowed without transaction history and blocked when referenced', async () => {
  const disposable = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'gadget', name: 'Disposable Gadget', stock: 1 }) });
  const forbidden = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.technician });
  assert.equal(forbidden.status, 403);
  const removed = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(removed.status, 204);
  const missing = await request(`/api/products/${disposable.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(missing.status, 404);

  const referenced = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Referenced Gadget', selling_price: 1000, stock: 1 }) });
  await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: referenced.body.id, qty: 1 }] }) });
  const blocked = await request(`/api/products/${referenced.body.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(blocked.status, 409);
});

test('transaction and stock: checkout reduces stock and rejects overselling', async () => {
  const created = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Test Laptop', selling_price: 1000000, stock: 1 }) });
  assert.equal(created.status, 201);
  const payload = { customer_id: 1, transaction_type: 'penjualan', transaction_stage: 'opening', record_cash: false, payment_status: 'bayar_nanti', payment_method: 'cash', items: [{ item_type: 'product', reference_id: created.body.id, qty: 1 }] };
  const sale = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.transaction_stage, 'final');
  assert.equal(sale.body.payment_status, 'lunas');
  assert.ok((await request('/api/transactions', { token: tokens.cashier })).body.some((item) => item.id === sale.body.id));
  const inventory = await request('/api/products?include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventory.body.find((item) => item.id === created.body.id).stock, 0);
  const oversell = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify(payload) });
  assert.equal(oversell.status, 400);
});

test('trade-in checkout adds the received device to inventory', async () => {
  const soldProduct = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Trade-in Test Sale', selling_price: 5000000, stock: 1 }) });
  const transaction = await request('/api/transactions', {
    method: 'POST',
    token: tokens.cashier,
    body: JSON.stringify({
      customer_id: 1,
      transaction_type: 'tukar_tambah',
      items: [
        { item_type: 'product', reference_id: soldProduct.body.id, qty: 1 },
        { item_type: 'trade_in', name: 'iPad 11 (A16)', category: 'gadget', price: 3000000, selling_price: 4000000, qty: 1 }
      ]
    })
  });

  assert.equal(transaction.status, 201);
  const tradeInItem = transaction.body.items.find((item) => item.item_type === 'trade_in');
  assert.equal(tradeInItem.name, 'iPad 11 (A16)');
  const inventory = await request('/api/products?search=iPad%2011%20(A16)', { token: tokens.cashier });
  const receivedProduct = inventory.body.find((product) => product.id === tradeInItem.reference_id);
  assert.ok(receivedProduct);
  assert.equal(receivedProduct.category, 'gadget');
  assert.equal(receivedProduct.stock, 1);
  assert.equal(receivedProduct.cost_price, 3000000);
  assert.equal(receivedProduct.selling_price, 4000000);
  const refund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ reason: 'Pembatalan tukar tambah' }) });
  assert.equal(refund.status, 201);
  const returnedTradeIn = await request('/api/products?search=iPad%2011%20(A16)&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(returnedTradeIn.body.find((product) => product.id === receivedProduct.id).stock, 0);
  const returnedSale = await request('/api/products?search=Trade-in%20Test%20Sale&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(returnedSale.body[0].stock, 1);
});

test('transaction refund restores inventory and cannot be repeated', async () => {
  const product = await request('/api/products', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ category: 'laptop', name: 'Refund Test Laptop', selling_price: 2500000, stock: 1 }) });
  const transaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, items: [{ item_type: 'product', reference_id: product.body.id, qty: 1 }] }) });
  const refundPayload = JSON.stringify({ reason: 'Barang tidak sesuai pesanan' });
  const forbidden = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.technician, body: refundPayload });
  assert.equal(forbidden.status, 403);

  const refund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: refundPayload });
  assert.equal(refund.status, 201);
  assert.equal(refund.body.refund_amount, transaction.body.paid_amount);
  assert.equal(refund.body.refund_reason, 'Barang tidak sesuai pesanan');
  assert.ok(refund.body.refunded_at);
  const inventory = await request('/api/products?search=Refund%20Test%20Laptop&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventory.body[0].stock, 1);
  const cashRefund = db.prepare("SELECT * FROM cash_entries WHERE source = 'transaction' AND category = 'Refund' AND description LIKE ?").get(`Refund ${transaction.body.invoice_number}:%`);
  assert.equal(cashRefund.amount, transaction.body.paid_amount);
  const cashList = await request(`/api/cash-entries?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, { token: tokens.cashier });
  assert.ok(cashList.body.summary.pengeluaran >= cashRefund.amount);
  const editRefund = await request(`/api/cash-entries/${cashRefund.id}`, { method: 'PUT', token: tokens.cashier, body: JSON.stringify({ entry_type: 'pengeluaran', category: 'Refund', description: 'Edit', amount: cashRefund.amount }) });
  assert.equal(editRefund.status, 409);
  const deleteRefund = await request(`/api/cash-entries/${cashRefund.id}`, { method: 'DELETE', token: tokens.cashier });
  assert.equal(deleteRefund.status, 409);

  const duplicateRefund = await request(`/api/transactions/${transaction.body.id}/refund`, { method: 'POST', token: tokens.cashier, body: refundPayload });
  assert.equal(duplicateRefund.status, 409);
  const settlement = await request(`/api/transactions/${transaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 1000 }) });
  assert.equal(settlement.status, 409);
  const inventoryAfterDuplicate = await request('/api/products?search=Refund%20Test%20Laptop&include_out_of_stock=true', { token: tokens.cashier });
  assert.equal(inventoryAfterDuplicate.body[0].stock, 1);
});

test('service status: teknisi can advance service, cashier cannot', async () => {
  const created = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Test Laptop', issues: 'Tidak menyala' }) });
  assert.equal(created.status, 201);
  const technicianUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  assert.equal(technicianUpdate.status, 200);
  const cashierUpdate = await request(`/api/services/${created.body.id}/status`, { method: 'PATCH', token: tokens.cashier, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Test', final_cost: 500000 }) });
  assert.equal(cashierUpdate.status, 403);
});

test('opening service receipt does not create a sales transaction', async () => {
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Opening Receipt Test', issues: 'Test', estimated_cost: 750000, down_payment: 100000 }) });
  assert.equal(service.status, 201);
  const transactionCount = db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
  const receipt = await request(`/api/services/${service.body.id}/opening-receipt`, { token: tokens.cashier });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.grand_total, 750000);
  assert.equal(receipt.body.paid_amount, 100000);
  assert.equal(receipt.body.remaining_amount, 650000);
  assert.equal(receipt.body.change_amount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, transactionCount);
});

test('service PIN is encrypted at rest and only revealed to authorized technicians/admins', async () => {
  const created = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Protected Device', issues: 'Test access control', password_pin: '246810' }) });
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.body, 'password_pin'), false);
  const stored = db.prepare('SELECT password_pin FROM services WHERE id = ?').get(created.body.id).password_pin;
  assert.match(stored, /^enc:v1:/);
  assert.notEqual(stored, '246810');
  const serviceList = await request('/api/services', { token: tokens.technician });
  const listedService = serviceList.body.find((item) => item.id === created.body.id);
  assert.equal(Object.hasOwn(listedService, 'password_pin'), false);
  const technicianRead = await request(`/api/services/${created.body.id}/access`, { token: tokens.technician });
  assert.equal(technicianRead.status, 200);
  assert.equal(technicianRead.body.password_pin, '246810');
  const cashierRead = await request(`/api/services/${created.body.id}/access`, { token: tokens.cashier });
  assert.equal(cashierRead.status, 403);
});

test('login limiter is isolated by Cloudflare client IP', async () => {
  const ipSuffix = Math.floor(Math.random() * 199) + 1;
  const clientIp = `192.0.2.${ipSuffix}`;
  const otherClientIp = `192.0.2.${ipSuffix + 1}`;
  const attempt = (ip) => request('/api/auth/login', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ username: 'missing', password: 'invalid' }) });
  assert.notEqual(clientIp, otherClientIp);
  for (let index = 0; index < 10; index += 1) assert.equal((await attempt(clientIp)).status, 401);
  assert.equal((await attempt(clientIp)).status, 429);
  assert.equal((await attempt(otherClientIp)).status, 401);
});

test('cash: manual entries require cashier role and service payments record actual cash', async () => {
  const manual = await request('/api/cash-entries', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ entry_type: 'pengeluaran', category: 'Test', description: 'Biaya test', amount: 25000 }) });
  assert.equal(manual.status, 201);
  const forbidden = await request('/api/cash-entries', { method: 'POST', token: tokens.technician, body: JSON.stringify({ entry_type: 'pemasukan', category: 'Test', description: 'Forbidden', amount: 1 }) });
  assert.equal(forbidden.status, 403);
  const service = await request('/api/services', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, device_name: 'Service Billing Test', issues: 'Test', estimated_cost: 500000 }) });
  assert.equal(service.status, 201);
  let serviceStatus = await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'pengecekan' }) });
  assert.equal(serviceStatus.status, 200);
  serviceStatus = await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'menunggu_persetujuan', diagnosis: 'Test diagnosis', final_cost: 500000 }) });
  assert.equal(serviceStatus.status, 200);
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'proses_servis' }) });
  await request(`/api/services/${service.body.id}/status`, { method: 'PATCH', token: tokens.technician, body: JSON.stringify({ status: 'selesai' }) });
  const serviceTransaction = await request('/api/transactions', { method: 'POST', token: tokens.cashier, body: JSON.stringify({ customer_id: 1, transaction_type: 'servis', transaction_stage: 'opening', record_cash: false, payment_status: 'lunas', paid_amount: 0, payment_method: 'cash', items: [{ item_type: 'service', reference_id: service.body.id, name: 'Fake service name', price: 1, qty: 1 }] }) });
  assert.equal(serviceTransaction.status, 201);
  assert.equal(serviceTransaction.body.transaction_stage, 'final');
  assert.equal(serviceTransaction.body.payment_status, 'bayar_nanti');
  assert.equal(serviceTransaction.body.items[0].price, 500000);
  const beforePayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis'").get().total;
  assert.equal(beforePayment, 0);
  const payment = await request(`/api/transactions/${serviceTransaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 200000 }) });
  assert.equal(payment.status, 200);
  assert.equal(payment.body.paid_amount, 200000);
  const afterPayment = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis'").get().total;
  assert.equal(afterPayment, 200000);
  const overpayment = await request(`/api/transactions/${serviceTransaction.body.id}/payment`, { method: 'POST', token: tokens.cashier, body: JSON.stringify({ amount: 400000 }) });
  assert.equal(overpayment.status, 200);
  assert.equal(overpayment.body.paid_amount, 500000);
  assert.equal(overpayment.body.change_amount, 100000);
  const retainedCash = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_entries WHERE category = 'Servis'").get().total;
  assert.equal(retainedCash, 500000);
});

test('product import: accepts the simple CSV template and creates products atomically', async () => {
  const form = new FormData();
  form.append('file', new Blob(['category,name,brand,serial_number,cost_price,selling_price,stock,notes,gpu,memory,storage,physical_description,battery_health\nlaptop,Imported Laptop,Lenovo,IMPORT-001,100,200,2,From CSV,RTX 3050,16GB DDR4,512GB SSD NVMe|1TB HDD,Ada lecet ringan,88\n'], { type: 'text/csv' }), 'products.csv');
  const imported = await request('/api/products/import', { method: 'POST', token: tokens.cashier, body: form });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.imported, 1);
  const product = db.prepare('SELECT * FROM products WHERE serial_number = ?').get('IMPORT-001');
  assert.equal(product.name, 'Imported Laptop');
  const specs = JSON.parse(product.specs);
  assert.equal(specs.gpu, 'RTX 3050');
  assert.deepEqual(specs.storage, ['512GB SSD NVMe', '1TB HDD']);
  assert.equal(specs.physical.description, 'Ada lecet ringan');
  assert.equal(specs.battery.health, '88');
});

test('product import: parses Indonesian rupiah-formatted prices', async () => {
  const form = new FormData();
  form.append('file', new Blob(['category,name,brand,serial_number,cost_price,selling_price,stock\nlaptop,Formatted Price Laptop,Lenovo,FORMAT-001,"Rp 5.000.000","Rp 6.500.000",1\n'], { type: 'text/csv' }), 'formatted-prices.csv');
  const imported = await request('/api/products/import', { method: 'POST', token: tokens.cashier, body: form });
  assert.equal(imported.status, 201);
  const product = db.prepare('SELECT cost_price, selling_price FROM products WHERE serial_number = ?').get('FORMAT-001');
  assert.equal(product.cost_price, 5000000);
  assert.equal(product.selling_price, 6500000);
});

test('Aronium customer import maps addresses and safely skips duplicates/non-customers', async () => {
  const csv = [
    'Name,Code,TaxNumber,StreetName,BuildingNumber,AdditionalStreetName,PlotIdentification,PostalCode,City,CitySubdivisionName,CountrySubentity,Country,Email,Phone,IsEnabled,IsCustomer,IsTaxExempt',
    'Aronium Import Test,,,"Jalan Melati, No. 5",,Blok A,,,Bandung,,,,test@example.com,081234567890,1,1,0',
    'Aronium Duplicate,,,"Alamat berbeda",,,,,,,,,,0812-3456-7890,1,1,0',
    'Aronium Disabled,,,,,,,,,,,,,081234567891,0,1,0',
    'Aronium Supplier,,,,,,,,,,,,,081234567892,1,0,0'
  ].join('\n');
  const upload = async () => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'customers.csv');
    return request('/api/customers/import/aronium', { method: 'POST', token: tokens.cashier, body: form });
  };
  const first = await upload();
  assert.equal(first.status, 201);
  assert.equal(first.body.imported, 1);
  assert.equal(first.body.skipped, 1);
  assert.equal(first.body.ignored, 2);
  const importedCustomer = db.prepare('SELECT * FROM customers WHERE phone = ?').get('081234567890');
  assert.equal(importedCustomer.name, 'Aronium Import Test');
  assert.match(importedCustomer.address, /Jalan Melati, No\. 5/);
  const second = await upload();
  assert.equal(second.status, 200);
  assert.equal(second.body.imported, 0);
  assert.equal(second.body.skipped, 2);
});

test('database backup creates a local and mirrored SQLite snapshot', async () => {
  const localDirectory = path.join('data', 'pos-test-backups');
  const mirrorDirectory = path.join('data', 'pos-test-backup-mirror');
  fs.rmSync(localDirectory, { recursive: true, force: true });
  fs.rmSync(mirrorDirectory, { recursive: true, force: true });
  process.env.BACKUP_DIR = localDirectory;
  process.env.BACKUP_MIRROR_DIR = mirrorDirectory;
  const { backupDatabase } = await import(`../src/backup.js?test=${Date.now()}`);
  const snapshot = await backupDatabase();
  assert.equal(fs.existsSync(snapshot), true);
  assert.equal(fs.existsSync(path.join(mirrorDirectory, path.basename(snapshot))), true);
  fs.rmSync(localDirectory, { recursive: true, force: true });
  fs.rmSync(mirrorDirectory, { recursive: true, force: true });
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_MIRROR_DIR;
});
