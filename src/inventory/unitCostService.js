import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';

const eligibleCreditAccounts = new Set(['1110', '1120', '1130', '2100', '2300']);
const treatments = new Set(['capitalized', 'expense']);

function validateActorAndTreatment(input) {
  const createdBy = Number(input.createdBy);
  const treatment = String(input.treatment || '');
  const reason = String(input.reason || '').trim();
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) throw new Error('Pembuat biaya unit tidak valid');
  if (!treatments.has(treatment)) throw new Error('Biaya harus diklasifikasikan sebagai kapitalisasi atau beban');
  if (reason.length < 3 || reason.length > 500) throw new Error('Alasan perlakuan biaya wajib diisi 3–500 karakter');
  if (!idempotencyKey || idempotencyKey.length > 160) throw new Error('Kunci idempotensi wajib diisi maksimal 160 karakter');
  return { createdBy, treatment, reason, idempotencyKey };
}

function requestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function existingCost(db, sourceType, sourceId, sourceEvent, hash) {
  const existing = db.prepare(`SELECT inventory_cost_components.*, journal_entries.entry_number
    FROM inventory_cost_components LEFT JOIN journal_entries ON journal_entries.id = inventory_cost_components.journal_entry_id
    WHERE inventory_cost_components.source_type = ? AND inventory_cost_components.source_id = ? AND inventory_cost_components.source_event = ?`).get(sourceType, String(sourceId), sourceEvent);
  if (!existing) return null;
  if (existing.request_hash !== hash) throw new Error('Kunci idempotensi biaya unit sudah dipakai untuk data berbeda');
  return { ...existing, duplicate: true };
}

function postUnitCost(db, { unit, workOrderId, componentType, amount, description, sourceType, sourceId, sourceEvent, hash, actor, creditAccountCode, entryDate }) {
  const component = db.prepare(`INSERT INTO inventory_cost_components (
    unit_id, component_type, amount, description, source_type, source_id, source_event, request_hash,
    treatment, created_by, inventory_repair_work_order_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
    unit.id, componentType, amount, description, sourceType, String(sourceId), sourceEvent, hash, actor.createdBy, workOrderId
  );
  const componentId = Number(component.lastInsertRowid);
  const debitAccount = actor.treatment === 'capitalized' ? '1310' : '6510';
  const journal = postJournal(db, {
    entryDate,
    postingDate: entryDate,
    reference: `${componentType}-${componentId}`,
    source: { type: 'inventory_cost_component', id: String(componentId), event: 'recognition' },
    description: `${actor.treatment === 'capitalized' ? 'Kapitalisasi' : 'Beban'} ${description}`,
    idempotencyKey: `inventory-cost-component:${componentId}`,
    createdBy: actor.createdBy,
    lines: [
      { accountCode: debitAccount, debit: amount, credit: 0, memo: description },
      { accountCode: creditAccountCode, debit: 0, credit: amount, memo: description }
    ]
  });
  db.prepare(`UPDATE inventory_cost_components SET treatment = ?, treatment_reason = ?, approved_by = ?, journal_entry_id = ? WHERE id = ?`).run(actor.treatment, actor.reason, actor.createdBy, journal.id, componentId);
  return { id: componentId, unitId: Number(unit.id), componentType, amount, treatment: actor.treatment, journalEntryId: journal.id, duplicate: false };
}

export function recordDirectUnitCost(db, unitId, input) {
  const actor = validateActorAndTreatment(input);
  const amount = Number(input.amount);
  const componentType = String(input.componentType || 'repair');
  const description = String(input.description || '').trim();
  const creditAccountCode = String(input.creditAccountCode || '1110');
  const entryDate = String(input.entryDate || new Date().toISOString().slice(0, 10));
  const workOrderId = input.inventoryRepairWorkOrderId ? Number(input.inventoryRepairWorkOrderId) : null;
  if (!['repair', 'freight', 'other'].includes(componentType)) throw new Error('Jenis biaya langsung tidak valid');
  if (!Number.isSafeInteger(amount) || amount <= 0 || !description) throw new Error('Nominal dan keterangan biaya wajib diisi');
  if (!eligibleCreditAccounts.has(creditAccountCode)) throw new Error('Akun lawan harus kas/bank, utang supplier, atau utang teknisi');
  const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(unitId);
  if (!unit || unit.status === 'written_off') throw new Error('Unit tidak tersedia untuk pencatatan biaya');
  if (workOrderId) {
    const workOrder = db.prepare('SELECT id, inventory_unit_id, status FROM inventory_repair_work_orders WHERE id = ?').get(workOrderId);
    if (!workOrder || workOrder.inventory_unit_id !== unit.id || !['inspection', 'waiting_approval', 'in_progress', 'qc'].includes(workOrder.status)) throw new Error('Work order aktif tidak cocok dengan unit perbaikan');
  }
  const sourceType = 'unit_direct_cost';
  const sourceId = String(unit.id);
  const hash = requestHash({ unitId: unit.id, workOrderId, amount, componentType, description, creditAccountCode, treatment: actor.treatment, reason: actor.reason, entryDate });
  const existing = existingCost(db, sourceType, sourceId, actor.idempotencyKey, hash);
  if (existing) return existing;
  const record = db.transaction(() => postUnitCost(db, {
    unit, workOrderId, componentType, amount, description, sourceType, sourceId,
    sourceEvent: actor.idempotencyKey, hash, actor, creditAccountCode, entryDate
  }));
  return record.immediate();
}

export function consumeSparePartsForUnit(db, unitId, input) {
  const actor = validateActorAndTreatment(input);
  const productId = Number(input.productId);
  const quantity = Number(input.quantity);
  const description = String(input.description || '').trim();
  const entryDate = String(input.entryDate || new Date().toISOString().slice(0, 10));
  if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !description) throw new Error('Produk, jumlah, dan keterangan pemakaian spare part wajib diisi');
  const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(unitId);
  const partProduct = db.prepare("SELECT id, name FROM products WHERE id = ? AND category = 'part_copotan'").get(productId);
  if (!unit || unit.status === 'written_off') throw new Error('Unit tidak tersedia untuk pencatatan biaya');
  if (!partProduct) throw new Error('Produk yang dipakai bukan kategori spare part');
  const sourceType = 'unit_spare_part';
  const sourceId = String(unit.id);
  const hash = requestHash({ unitId: unit.id, productId, quantity, description, treatment: actor.treatment, reason: actor.reason, entryDate });
  const existing = existingCost(db, sourceType, sourceId, actor.idempotencyKey, hash);
  if (existing) return existing;

  const consume = db.transaction(() => {
    const layers = db.prepare('SELECT id, quantity_remaining, unit_cost, remaining_cost FROM part_stock_layers WHERE product_id = ? AND quantity_remaining > 0 ORDER BY received_at, id').all(productId);
    let remaining = quantity;
    let amount = 0;
    const allocations = [];
    for (const layer of layers) {
      if (!remaining) break;
      const allocatedQuantity = Math.min(remaining, layer.quantity_remaining);
      const lineCost = allocatedQuantity === layer.quantity_remaining
        ? layer.remaining_cost
        : Number(BigInt(layer.remaining_cost) * BigInt(allocatedQuantity) / BigInt(layer.quantity_remaining));
      if (!Number.isSafeInteger(lineCost) || !Number.isSafeInteger(amount + lineCost)) throw new Error('Biaya spare part melebihi batas Rupiah integer');
      allocations.push({ ...layer, quantity: allocatedQuantity, cost: lineCost });
      amount += lineCost;
      remaining -= allocatedQuantity;
    }
    if (remaining > 0) throw new Error('Stok spare part bernilai aktual tidak cukup; stok legacy harus direkonsiliasi lebih dahulu');
    const actorId = actor.createdBy;
    const created = db.prepare(`INSERT INTO inventory_cost_components (
      unit_id, component_type, amount, description, source_type, source_id, source_event, request_hash, treatment, created_by
    ) VALUES (?, 'spare_part', ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
      unit.id, amount, description, sourceType, sourceId, actor.idempotencyKey, hash, actorId
    );
    const componentId = Number(created.lastInsertRowid);
    const debitAccount = actor.treatment === 'capitalized' ? '1310' : '6510';
    const journal = postJournal(db, {
      entryDate,
      postingDate: entryDate,
      reference: `UNIT-COST-${componentId}`,
      source: { type: 'inventory_cost_component', id: String(componentId), event: 'recognition' },
      description: `${actor.treatment === 'capitalized' ? 'Kapitalisasi' : 'Beban'} spare part ${partProduct.name} · ${description}`,
      idempotencyKey: `inventory-cost-component:${componentId}`,
      createdBy: actorId,
      lines: [
        { accountCode: debitAccount, debit: amount, credit: 0, memo: description },
        { accountCode: '1320', debit: 0, credit: amount, memo: `Pemakaian ${partProduct.name}` }
      ]
    });
    const stockUpdate = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(quantity, productId, quantity);
    if (stockUpdate.changes !== 1) throw new Error('Stok spare part katalog tidak cukup');
    const updateLayer = db.prepare('UPDATE part_stock_layers SET quantity_remaining = quantity_remaining - ?, remaining_cost = remaining_cost - ? WHERE id = ? AND quantity_remaining >= ? AND remaining_cost >= ?');
    const insertAllocation = db.prepare('INSERT INTO part_stock_allocations (layer_id, quantity, unit_cost, total_cost, cost_component_id) VALUES (?, ?, ?, ?, ?)');
    const insertMovement = db.prepare(`INSERT INTO part_stock_movements (
      product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
    ) VALUES (?, ?, 'unit_repair', ?, ?, ?, ?, ?, ?, ?)`);
    for (const allocation of allocations) {
      if (updateLayer.run(allocation.quantity, allocation.cost, allocation.id, allocation.quantity, allocation.cost).changes !== 1) throw new Error('Layer spare part berubah; transaksi dibatalkan');
      insertAllocation.run(allocation.id, allocation.quantity, allocation.unit_cost, allocation.cost, componentId);
      insertMovement.run(productId, allocation.id, -allocation.quantity, allocation.unit_cost, sourceType, String(componentId), description, actorId, allocation.cost);
    }
    db.prepare(`UPDATE inventory_cost_components SET treatment = ?, treatment_reason = ?, approved_by = ?, journal_entry_id = ? WHERE id = ?`).run(actor.treatment, actor.reason, actorId, journal.id, componentId);
    return { id: componentId, unitId: Number(unit.id), productId, quantity, amount, treatment: actor.treatment, journalEntryId: journal.id, duplicate: false };
  });
  return consume.immediate();
}
