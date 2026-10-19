import { consumeLegacyStockForSale, restoreLegacyStockForRefund } from './inventoryUnitService.js';

export function allocateSparePartLayersForSale(db, { productId, quantity, transactionItemId, createdBy }) {
  const qty = Number(quantity);
  const part = db.prepare("SELECT id, name FROM products WHERE id = ? AND category = 'part_copotan'").get(productId);
  if (!part) throw new Error('Produk spare part tidak ditemukan');
  const layers = db.prepare('SELECT id, quantity_remaining, unit_cost, remaining_cost FROM part_stock_layers WHERE product_id = ? AND quantity_remaining > 0 ORDER BY received_at, id').all(productId);
  let remaining = qty;
  let allocatedCost = 0;
  const allocations = [];
  for (const layer of layers) {
    if (!remaining) break;
    const allocatedQuantity = Math.min(remaining, layer.quantity_remaining);
    const cost = allocatedQuantity === layer.quantity_remaining
      ? layer.remaining_cost
      : Number(BigInt(layer.remaining_cost) * BigInt(allocatedQuantity) / BigInt(layer.quantity_remaining));
    if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(allocatedCost + cost)) throw new Error('HPP spare part melebihi batas Rupiah integer');
    allocations.push({ ...layer, quantity: allocatedQuantity, cost });
    allocatedCost += cost;
    remaining -= allocatedQuantity;
  }

  const trackedQuantity = qty - remaining;
  if (trackedQuantity > 0) {
    const stockUpdate = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(trackedQuantity, productId, trackedQuantity);
    if (stockUpdate.changes !== 1) throw new Error('Stok spare part tidak cukup');
  }
  const updateLayer = db.prepare('UPDATE part_stock_layers SET quantity_remaining = quantity_remaining - ?, remaining_cost = remaining_cost - ? WHERE id = ? AND quantity_remaining >= ? AND remaining_cost >= ?');
  const insertAllocation = db.prepare('INSERT INTO part_stock_allocations (layer_id, quantity, unit_cost, total_cost, transaction_item_id) VALUES (?, ?, ?, ?, ?)');
  const insertMovement = db.prepare(`INSERT INTO part_stock_movements (
    product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
  ) VALUES (?, ?, 'sale', ?, ?, 'transaction_item', ?, 'Penjualan spare part FIFO', ?, ?)`);
  for (const allocation of allocations) {
    if (updateLayer.run(allocation.quantity, allocation.cost, allocation.id, allocation.quantity, allocation.cost).changes !== 1) throw new Error('Layer spare part berubah; transaksi dibatalkan');
    insertAllocation.run(allocation.id, allocation.quantity, allocation.unit_cost, allocation.cost, transactionItemId);
    insertMovement.run(productId, allocation.id, -allocation.quantity, allocation.unit_cost, String(transactionItemId), createdBy, allocation.cost);
  }
  if (remaining > 0) consumeLegacyStockForSale(db, { productId, quantity: remaining, transactionItemId });
  return { allocatedCost, trackedQuantity, legacyQuantity: remaining };
}

export function restoreSparePartAllocationsForRefund(db, { transactionItemId, refundId, createdBy }) {
  const allocations = db.prepare(`SELECT part_stock_allocations.*, part_stock_layers.product_id
    FROM part_stock_allocations JOIN part_stock_layers ON part_stock_layers.id = part_stock_allocations.layer_id
    WHERE part_stock_allocations.transaction_item_id = ? AND part_stock_allocations.status = 'allocated'`).all(transactionItemId);
  const updateLayer = db.prepare(`UPDATE part_stock_layers SET quantity_remaining = quantity_remaining + ?, remaining_cost = remaining_cost + ?
    WHERE id = ? AND quantity_remaining + ? <= quantity_received AND remaining_cost + ? <= total_cost`);
  const insertMovement = db.prepare(`INSERT INTO part_stock_movements (
    product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
  ) VALUES (?, ?, 'adjustment', ?, ?, 'transaction_refund', ?, 'Restok refund transaksi', ?, ?)`);
  for (const allocation of allocations) {
    const restored = updateLayer.run(allocation.quantity, allocation.total_cost, allocation.layer_id, allocation.quantity, allocation.total_cost);
    if (restored.changes !== 1) throw new Error('Alokasi spare part sudah pernah direfund');
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(allocation.quantity, allocation.product_id);
    insertMovement.run(allocation.product_id, allocation.layer_id, allocation.quantity, allocation.unit_cost, String(refundId), createdBy, allocation.total_cost);
    db.prepare("UPDATE part_stock_allocations SET status = 'refunded', refund_id = ?, refunded_at = CURRENT_TIMESTAMP WHERE id = ?").run(refundId, allocation.id);
  }
  return allocations.reduce((total, allocation) => total + allocation.quantity, 0);
}

export function restoreLegacyPartStockForRefund(db, { productId, quantity }) {
  return restoreLegacyStockForRefund(db, { productId, quantity });
}
