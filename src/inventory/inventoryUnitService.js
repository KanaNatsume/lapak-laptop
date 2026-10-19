import crypto from 'node:crypto';

const unitStatuses = new Set(['received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off']);
const transitions = {
  received: ['inspection', 'written_off'],
  inspection: ['repair', 'ready', 'written_off'],
  repair: ['inspection', 'ready', 'written_off'],
  ready: ['reserved', 'repair', 'written_off'],
  reserved: ['ready', 'written_off'],
  sold: ['returned'],
  returned: ['inspection', 'written_off'],
  written_off: []
};
const sourceTypes = new Set(['supplier', 'individual', 'trade_in', 'opening']);
const conditions = new Set(['A', 'B', 'C', 'Minus', 'unknown']);
const costTypes = new Set(['purchase_discount', 'spare_part', 'repair', 'freight', 'other']);

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} harus berformat YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} tidak valid`);
  return value;
}

function validateSource(sourceType, sourceReference) {
  const type = String(sourceType || '');
  const reference = String(sourceReference || '').trim();
  if (!sourceTypes.has(type) || !reference) throw new Error('Sumber dan referensi penerimaan unit wajib diisi');
  return { type, reference };
}

function addMovement(db, { unitId, movementType, fromStatus = null, toStatus, sourceType = null, sourceId = null, reason = '', createdBy }) {
  db.prepare(`INSERT INTO inventory_movements (
    unit_id, movement_type, from_status, to_status, source_type, source_id, reason, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(unitId, movementType, fromStatus, toStatus, sourceType, sourceId, reason, createdBy);
}

function adjustCatalogStock(db, productId, delta, legacyDelta = 0) {
  if (!delta) return;
  const updated = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock + ? >= 0').run(delta, productId, delta);
  if (updated.changes !== 1) throw new Error('Stok katalog tidak dapat disesuaikan dengan pergerakan unit');
  const adjusted = db.prepare('UPDATE inventory_product_controls SET legacy_stock = legacy_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND legacy_stock + ? >= 0').run(legacyDelta, productId, legacyDelta);
  if (adjusted.changes !== 1) throw new Error('Stok legacy katalog tidak dapat disesuaikan');
}

function readUnit(db, unitId) {
  return db.prepare(`SELECT inventory_units.*, inventory_unit_costs.acquisition_cost AS total_acquisition_cost
    FROM inventory_units JOIN inventory_unit_costs ON inventory_unit_costs.unit_id = inventory_units.id
    WHERE inventory_units.id = ?`).get(unitId);
}

export function createInventoryUnit(db, input) {
  const productId = Number(input.productId);
  const acquisitionCost = Number(input.acquisitionCost);
  const createdBy = Number(input.createdBy);
  const source = validateSource(input.sourceType, input.sourceReference);
  const acquiredAt = validDate(input.acquiredAt || new Date().toISOString().slice(0, 10), 'Tanggal perolehan');
  const condition = String(input.condition || 'unknown');
  const serialNumber = String(input.serialNumber || '').trim();
  const product = Number.isSafeInteger(productId) && productId > 0 ? db.prepare('SELECT id, category FROM products WHERE id = ?').get(productId) : null;
  if (!product) throw new Error('Produk katalog tidak ditemukan');
  if (product.category !== 'laptop') throw new Error('Pelacakan per unit hanya berlaku untuk laptop');
  if (!Number.isSafeInteger(acquisitionCost) || acquisitionCost < 0) throw new Error('Biaya perolehan harus Rupiah integer >= 0');
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) throw new Error('Pembuat penerimaan unit tidak valid');
  if (!conditions.has(condition)) throw new Error('Kondisi unit tidak valid');

  const receive = db.transaction(() => {
    const unitCode = `UNIT-${crypto.randomUUID().toUpperCase()}`;
    const result = db.prepare(`INSERT INTO inventory_units (
      unit_code, product_id, serial_number, source_type, source_reference, source_label,
      acquired_at, acquisition_cost, condition_grade, status, location, notes, created_by, purchase_item_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`).run(
      unitCode, productId, serialNumber, source.type, source.reference,
      String(input.sourceLabel || '').trim(), acquiredAt, acquisitionCost, condition,
      String(input.location || '').trim(), String(input.notes || '').trim(), createdBy, input.purchaseItemId || null
    );
    const unitId = Number(result.lastInsertRowid);
    addMovement(db, { unitId, movementType: 'received', toStatus: 'received', sourceType: source.type, sourceId: source.reference, reason: 'Unit diterima; menunggu pemeriksaan', createdBy });
    return readUnit(db, unitId);
  });
  return receive.immediate();
}

export function transitionInventoryUnit(db, unitId, { toStatus, reason = '', sourceType = null, sourceId = null, createdBy }) {
  const actorId = Number(createdBy);
  const cleanReason = String(reason || '').trim();
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Pembuat pergerakan unit tidak valid');
  if (!unitStatuses.has(toStatus) || toStatus === 'sold') throw new Error('Status tujuan harus menggunakan alur penjualan untuk status terjual');
  if (toStatus === 'written_off' && !cleanReason) throw new Error('Alasan penghapusan unit wajib diisi');
  if ((sourceType && !sourceId) || (!sourceType && sourceId)) throw new Error('Referensi sumber pergerakan harus lengkap');

  const transition = db.transaction(() => {
    const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(unitId);
    if (!unit) throw new Error('Unit persediaan tidak ditemukan');
    if (unit.returned_to_owner) throw new Error('Unit tukar tambah yang sudah dikembalikan ke pemilik tidak dapat diproses lagi');
    if (!transitions[unit.status].includes(toStatus)) throw new Error(`Perpindahan status ${unit.status} ke ${toStatus} tidak diizinkan`);
    const stockDelta = Number(toStatus === 'ready') - Number(unit.status === 'ready');
    adjustCatalogStock(db, unit.product_id, stockDelta);
    addMovement(db, { unitId: unit.id, movementType: toStatus, fromStatus: unit.status, toStatus, sourceType, sourceId, reason: cleanReason, createdBy: actorId });
    db.prepare('UPDATE inventory_units SET status = ?, written_off_reason = ? WHERE id = ?').run(toStatus, toStatus === 'written_off' ? cleanReason : unit.written_off_reason, unit.id);
    return readUnit(db, unit.id);
  });
  return transition.immediate();
}

export function allocateInventoryUnitToSale(db, { unitId, transactionItemId, createdBy }) {
  const actorId = Number(createdBy);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Pembuat alokasi unit tidak valid');
  const allocate = db.transaction(() => {
    const unit = db.prepare(`SELECT inventory_units.*, inventory_unit_costs.acquisition_cost AS total_acquisition_cost
      FROM inventory_units JOIN inventory_unit_costs ON inventory_unit_costs.unit_id = inventory_units.id
      WHERE inventory_units.id = ?`).get(unitId);
    if (!unit || unit.status !== 'ready') throw new Error('Hanya unit siap jual yang dapat dialokasikan');
    const item = db.prepare("SELECT id, reference_id, item_type FROM transaction_items WHERE id = ?").get(transactionItemId);
    if (!item || item.item_type !== 'product' || Number(item.reference_id) !== Number(unit.product_id)) throw new Error('Unit tidak cocok dengan item transaksi');
    adjustCatalogStock(db, unit.product_id, -1);
    db.prepare('INSERT INTO inventory_unit_allocations (unit_id, transaction_item_id, allocated_cost) VALUES (?, ?, ?)').run(unit.id, item.id, unit.total_acquisition_cost);
    addMovement(db, { unitId: unit.id, movementType: 'sold', fromStatus: unit.status, toStatus: 'sold', sourceType: 'transaction_item', sourceId: String(item.id), reason: 'Dialokasikan ke item penjualan', createdBy: actorId });
    db.prepare("UPDATE inventory_units SET status = 'sold' WHERE id = ?").run(unit.id);
    return { unitId: Number(unit.id), transactionItemId: Number(item.id), allocatedCost: Number(unit.total_acquisition_cost) };
  });
  return allocate.immediate();
}

export function allocateReadyInventoryUnitsForSale(db, { productId, quantity, transactionItemId, createdBy }) {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error('Jumlah unit untuk penjualan tidak valid');
  const units = db.prepare("SELECT id FROM inventory_units WHERE product_id = ? AND status = 'ready' ORDER BY acquired_at, id LIMIT ?").all(productId, qty);
  return units.map((unit) => allocateInventoryUnitToSale(db, { unitId: unit.id, transactionItemId, createdBy }));
}

export function consumeLegacyStockForSale(db, { productId, quantity, transactionItemId }) {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) return 0;
  const control = db.prepare('UPDATE inventory_product_controls SET legacy_stock = legacy_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND legacy_stock >= ?').run(qty, productId, qty);
  if (control.changes !== 1) throw new Error('Stok legacy tidak cukup untuk menyelesaikan transaksi');
  const updated = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, productId, qty);
  if (updated.changes !== 1) throw new Error('Stok produk tidak cukup untuk menyelesaikan transaksi');
  db.prepare('UPDATE transaction_items SET legacy_stock_qty = ? WHERE id = ?').run(qty, transactionItemId);
  return qty;
}

export function restoreLegacyStockForRefund(db, { productId, quantity }) {
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) return 0;
  const control = db.prepare('UPDATE inventory_product_controls SET legacy_stock = legacy_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?').run(qty, productId);
  if (control.changes !== 1) throw new Error('Kontrol kompatibilitas stok tidak ditemukan');
  const updated = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, productId);
  if (updated.changes !== 1) throw new Error('Produk tidak ditemukan untuk pemulihan stok');
  return qty;
}

export function refundSoldInventoryUnits(db, { transactionItemId, refundId, createdBy }) {
  const allocations = db.prepare(`SELECT inventory_unit_allocations.*, inventory_units.product_id, inventory_units.status
    FROM inventory_unit_allocations JOIN inventory_units ON inventory_units.id = inventory_unit_allocations.unit_id
    WHERE inventory_unit_allocations.transaction_item_id = ? AND inventory_unit_allocations.status = 'allocated'`).all(transactionItemId);
  for (const allocation of allocations) {
    if (allocation.status !== 'sold') throw new Error('Status unit penjualan tidak konsisten dengan alokasinya');
    db.prepare("UPDATE inventory_units SET status = 'returned' WHERE id = ?").run(allocation.unit_id);
    db.prepare(`UPDATE inventory_unit_allocations SET status = 'refunded', refund_id = ?, refunded_at = CURRENT_TIMESTAMP WHERE id = ?`).run(refundId, allocation.id);
    addMovement(db, { unitId: allocation.unit_id, movementType: 'returned', fromStatus: 'sold', toStatus: 'returned', sourceType: 'transaction_refund', sourceId: String(refundId), reason: 'Unit dikembalikan dan menunggu pemeriksaan', createdBy });
  }
  return allocations.length;
}

export function returnTradeInUnitsToSource(db, { productId, sourceReference, quantity, createdBy, refundId }) {
  const units = db.prepare(`SELECT * FROM inventory_units WHERE product_id = ? AND source_type = 'trade_in' AND source_reference = ?
    AND status NOT IN ('sold', 'written_off', 'returned') ORDER BY id LIMIT ?`).all(productId, String(sourceReference), quantity);
  if (units.length !== quantity) throw new Error('Unit trade-in sudah dijual, dihapuskan, atau tidak lagi tersedia untuk dibatalkan');
  for (const unit of units) {
    if (unit.status === 'ready') adjustCatalogStock(db, unit.product_id, -1);
    db.prepare("UPDATE inventory_units SET status = 'returned', returned_to_owner = 1 WHERE id = ?").run(unit.id);
    addMovement(db, { unitId: unit.id, movementType: 'returned', fromStatus: unit.status, toStatus: 'returned', sourceType: 'transaction_refund', sourceId: String(refundId), reason: 'Unit trade-in dikembalikan ke customer', createdBy });
  }
  return units.length;
}

export function recordPendingUnitCost(db, unitId, input) {
  const amount = Number(input.amount);
  const createdBy = Number(input.createdBy);
  const componentType = String(input.componentType || '');
  const description = String(input.description || '').trim();
  if (!costTypes.has(componentType)) throw new Error('Jenis komponen biaya unit tidak valid');
  if (!Number.isSafeInteger(amount) || amount === 0 || (componentType === 'purchase_discount' ? amount > 0 : amount < 0)) throw new Error('Nominal komponen biaya tidak valid; diskon pembelian harus negatif');
  if (!description || !Number.isSafeInteger(createdBy) || createdBy <= 0) throw new Error('Keterangan dan pembuat komponen biaya wajib diisi');
  const sourceType = input.sourceType ? String(input.sourceType).trim() : null;
  const sourceId = input.sourceId !== undefined && input.sourceId !== null ? String(input.sourceId) : null;
  if ((sourceType && !sourceId) || (!sourceType && sourceId)) throw new Error('Referensi sumber biaya harus lengkap');

  const record = db.transaction(() => {
    const unit = db.prepare('SELECT id, status FROM inventory_units WHERE id = ?').get(unitId);
    if (!unit || unit.status === 'written_off') throw new Error('Unit tidak tersedia untuk pencatatan biaya');
    const result = db.prepare(`INSERT INTO inventory_cost_components (
      unit_id, component_type, amount, description, source_type, source_id, treatment, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`).run(unit.id, componentType, amount, description, sourceType, sourceId, createdBy);
    return db.prepare('SELECT * FROM inventory_cost_components WHERE id = ?').get(result.lastInsertRowid);
  });
  return record.immediate();
}
