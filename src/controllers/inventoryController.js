import db from '../db.js';
import { createInventoryPurchase as postInventoryPurchase, createSupplier, getInventoryPurchase, listSuppliers } from '../inventory/purchaseService.js';
import { consumeSparePartsForUnit, recordDirectUnitCost } from '../inventory/unitCostService.js';
import { transitionInventoryUnit } from '../inventory/inventoryUnitService.js';

function respondError(error, response) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return response.status(409).json({ error: error.message });
  if (/sudah dipakai|duplikat|tidak cukup|berubah; transaksi dibatalkan|stok .* gagal|tidak dapat disesuaikan|tidak dapat lebih kecil/i.test(error.message || '')) return response.status(409).json({ error: error.message });
  if (/wajib|harus|tidak valid|tidak ditemukan|bukan kategori|hanya unit|tidak tersedia|perpindahan|klasifikasikan|diklasifikasikan|kunci idempotensi/i.test(error.message || '')) return response.status(400).json({ error: error.message });
  console.error(error);
  return response.status(500).json({ error: 'Transaksi inventori gagal diproses' });
}

export function listInventoryUnits(request, response) {
  const conditions = [];
  const params = [];
  if (request.query.product_id !== undefined) {
    const productId = Number(request.query.product_id);
    if (!Number.isSafeInteger(productId) || productId <= 0) return response.status(400).json({ error: 'ID produk tidak valid' });
    conditions.push('inventory_units.product_id = ?');
    params.push(productId);
  }
  if (request.query.status !== undefined) {
    const allowed = ['received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off'];
    if (!allowed.includes(request.query.status)) return response.status(400).json({ error: 'Filter status unit tidak valid' });
    conditions.push('inventory_units.status = ?');
    params.push(request.query.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const units = db.prepare(`SELECT inventory_units.*, inventory_unit_costs.acquisition_cost AS total_acquisition_cost, products.name AS product_name, products.category AS product_category
    FROM inventory_units JOIN inventory_unit_costs ON inventory_unit_costs.unit_id = inventory_units.id
    JOIN products ON products.id = inventory_units.product_id ${where}
    ORDER BY inventory_units.acquired_at DESC, inventory_units.id DESC`).all(...params);
  response.json(units);
}

export function listInventoryUnitMovements(request, response) {
  const unitId = Number(request.params.id);
  if (!Number.isSafeInteger(unitId) || unitId <= 0) return response.status(400).json({ error: 'ID unit tidak valid' });
  if (!db.prepare('SELECT id FROM inventory_units WHERE id = ?').get(unitId)) return response.status(404).json({ error: 'Unit persediaan tidak ditemukan' });
  response.json(db.prepare(`SELECT inventory_movements.*, users.name AS created_by_name
    FROM inventory_movements LEFT JOIN users ON users.id = inventory_movements.created_by
    WHERE inventory_movements.unit_id = ? ORDER BY inventory_movements.id`).all(unitId));
}

export function listInventoryUnitCosts(request, response) {
  const unitId = Number(request.params.id);
  if (!Number.isSafeInteger(unitId) || unitId <= 0) return response.status(400).json({ error: 'ID unit tidak valid' });
  if (!db.prepare('SELECT id FROM inventory_units WHERE id = ?').get(unitId)) return response.status(404).json({ error: 'Unit persediaan tidak ditemukan' });
  response.json(db.prepare(`SELECT inventory_cost_components.*, users.name AS created_by_name,
      approver.name AS approved_by_name, journal_entries.entry_number
    FROM inventory_cost_components
    LEFT JOIN users ON users.id = inventory_cost_components.created_by
    LEFT JOIN users AS approver ON approver.id = inventory_cost_components.approved_by
    LEFT JOIN journal_entries ON journal_entries.id = inventory_cost_components.journal_entry_id
    WHERE inventory_cost_components.unit_id = ? ORDER BY inventory_cost_components.id`).all(unitId));
}

export function createInventoryPurchase(request, response) {
  try {
    response.status(201).json(postInventoryPurchase(db, { ...request.body, createdBy: request.user.id }));
  } catch (error) {
    return respondError(error, response);
  }
}

export function listInventoryPurchases(_request, response) {
  const purchases = db.prepare(`SELECT inventory_purchases.*, suppliers.name AS supplier_name
    FROM inventory_purchases LEFT JOIN suppliers ON suppliers.id = inventory_purchases.supplier_id
    ORDER BY purchase_date DESC, id DESC`).all();
  response.json(purchases);
}

export function getInventoryPurchaseById(request, response) {
  const purchaseId = Number(request.params.id);
  if (!Number.isSafeInteger(purchaseId) || purchaseId <= 0) return response.status(400).json({ error: 'ID pembelian tidak valid' });
  const purchase = getInventoryPurchase(db, purchaseId);
  if (!purchase) return response.status(404).json({ error: 'Pembelian tidak ditemukan' });
  response.json(purchase);
}

export function createInventorySupplier(request, response) {
  try {
    response.status(201).json(createSupplier(db, request.body, request.user.id));
  } catch (error) {
    return respondError(error, response);
  }
}

export function listInventorySuppliers(_request, response) {
  response.json(listSuppliers(db));
}

export function updateInventoryUnitStatus(request, response) {
  try {
    const unitId = Number(request.params.id);
    if (!Number.isSafeInteger(unitId) || unitId <= 0) return response.status(400).json({ error: 'ID unit tidak valid' });
    response.json(transitionInventoryUnit(db, unitId, { ...request.body, createdBy: request.user.id }));
  } catch (error) {
    return respondError(error, response);
  }
}

export function recordInventoryUnitRepairCost(request, response) {
  try {
    const unitId = Number(request.params.id);
    if (!Number.isSafeInteger(unitId) || unitId <= 0) return response.status(400).json({ error: 'ID unit tidak valid' });
    response.status(201).json(recordDirectUnitCost(db, unitId, { ...request.body, createdBy: request.user.id }));
  } catch (error) {
    return respondError(error, response);
  }
}

export function consumeInventoryUnitSpareParts(request, response) {
  try {
    const unitId = Number(request.params.id);
    if (!Number.isSafeInteger(unitId) || unitId <= 0) return response.status(400).json({ error: 'ID unit tidak valid' });
    response.status(201).json(consumeSparePartsForUnit(db, unitId, { ...request.body, createdBy: request.user.id }));
  } catch (error) {
    return respondError(error, response);
  }
}
