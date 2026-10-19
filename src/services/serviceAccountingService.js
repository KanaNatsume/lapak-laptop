import crypto from 'node:crypto';
import { postJournal } from '../accounting/journalService.js';
import { transitionInventoryUnit } from '../inventory/inventoryUnitService.js';

const cashAccounts = new Set(['1110', '1120', '1130']);
const workOrderTransitions = {
  inspection: ['waiting_approval', 'in_progress', 'cancelled'],
  waiting_approval: ['in_progress', 'cancelled'],
  in_progress: ['qc', 'cancelled'],
  qc: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: []
};

function idempotencyHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function requireId(value, message) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(message);
  return id;
}

function requireReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new Error('Alasan perlakuan biaya wajib diisi 3–500 karakter');
  return reason;
}

function allocatePartLayers(db, productId, quantity) {
  const layers = db.prepare(`SELECT id, quantity_remaining, unit_cost, remaining_cost
    FROM part_stock_layers WHERE product_id = ? AND quantity_remaining > 0 ORDER BY received_at, id`).all(productId);
  let remaining = quantity;
  let totalCost = 0;
  const allocations = [];
  for (const layer of layers) {
    if (remaining === 0) break;
    const allocatedQuantity = Math.min(remaining, layer.quantity_remaining);
    const amount = allocatedQuantity === layer.quantity_remaining
      ? layer.remaining_cost
      : Number(BigInt(layer.remaining_cost) * BigInt(allocatedQuantity) / BigInt(layer.quantity_remaining));
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(totalCost + amount)) throw new Error('HPP spare part melebihi batas Rupiah integer');
    allocations.push({ layerId: layer.id, quantity: allocatedQuantity, unitCost: layer.unit_cost, amount });
    totalCost += amount;
    remaining -= allocatedQuantity;
  }
  if (remaining) throw new Error('Stok spare part dengan biaya terverifikasi tidak cukup');
  const stock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(quantity, productId, quantity);
  if (stock.changes !== 1) throw new Error('Stok spare part tidak cukup');
  const updateLayer = db.prepare(`UPDATE part_stock_layers SET quantity_remaining = quantity_remaining - ?, remaining_cost = remaining_cost - ?
    WHERE id = ? AND quantity_remaining >= ? AND remaining_cost >= ?`);
  for (const allocation of allocations) {
    if (updateLayer.run(allocation.quantity, allocation.amount, allocation.layerId, allocation.quantity, allocation.amount).changes !== 1) throw new Error('Layer spare part berubah; transaksi dibatalkan');
  }
  return { allocations, totalCost };
}

function recordPartMovements(db, { productId, usageId, allocations, createdBy }) {
  const insertAllocation = db.prepare('INSERT INTO service_part_allocations (usage_id, layer_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?, ?)');
  const insertMovement = db.prepare(`INSERT INTO part_stock_movements (
    product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
  ) VALUES (?, ?, 'unit_repair', ?, ?, 'service_part_usage', ?, 'Pemakaian part pada work order servis', ?, ?)`);
  for (const allocation of allocations) {
    insertAllocation.run(usageId, allocation.layerId, allocation.quantity, allocation.unitCost, allocation.amount);
    insertMovement.run(productId, allocation.layerId, -allocation.quantity, allocation.unitCost, String(usageId), createdBy, allocation.amount);
  }
}

export function createInventoryRepairWorkOrder(db, unitId, { createdBy, estimatedCost = 0, diagnosis = '' }) {
  const actorId = requireId(createdBy, 'Pembuat work order tidak valid');
  const estimate = Number(estimatedCost);
  if (!Number.isSafeInteger(estimate) || estimate < 0) throw new Error('Estimasi perbaikan harus Rupiah integer >= 0');
  const create = db.transaction(() => {
    const unit = db.prepare('SELECT * FROM inventory_units WHERE id = ?').get(unitId);
    if (!unit || ['sold', 'written_off', 'reserved', 'returned'].includes(unit.status) || unit.returned_to_owner) throw new Error('Unit tidak tersedia untuk work order perbaikan');
    let initialStatus = 'inspection';
    if (unit.status === 'ready') {
      transitionInventoryUnit(db, unit.id, { toStatus: 'repair', reason: 'Perbaikan stok dimulai', createdBy: actorId });
      initialStatus = 'in_progress';
    } else if (unit.status === 'received') transitionInventoryUnit(db, unit.id, { toStatus: 'inspection', reason: 'Pemeriksaan perbaikan stok dimulai', createdBy: actorId });
    else if (unit.status === 'repair') initialStatus = 'in_progress';
    const workOrderNumber = `WOR-${new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const result = db.prepare(`INSERT INTO inventory_repair_work_orders (work_order_number, inventory_unit_id, status, diagnosis, estimated_cost, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run(workOrderNumber, unit.id, initialStatus, String(diagnosis || '').trim(), estimate, actorId);
    return db.prepare('SELECT * FROM inventory_repair_work_orders WHERE id = ?').get(result.lastInsertRowid);
  });
  return create.immediate();
}

export function listInventoryRepairWorkOrders(db, unitId) {
  return db.prepare(`SELECT inventory_repair_work_orders.*, inventory_units.unit_code, inventory_units.serial_number,
      products.name AS product_name
    FROM inventory_repair_work_orders JOIN inventory_units ON inventory_units.id = inventory_repair_work_orders.inventory_unit_id
    JOIN products ON products.id = inventory_units.product_id
    WHERE (? IS NULL OR inventory_repair_work_orders.inventory_unit_id = ?)
    ORDER BY inventory_repair_work_orders.created_at DESC`).all(unitId || null, unitId || null);
}

export function updateInventoryRepairWorkOrder(db, workOrderId, { status, diagnosis, finalCost, cancellationReason, createdBy }) {
  const actorId = requireId(createdBy, 'Pembuat work order tidak valid');
  const update = db.transaction(() => {
    const workOrder = db.prepare('SELECT * FROM inventory_repair_work_orders WHERE id = ?').get(workOrderId);
    if (!workOrder) throw new Error('Work order perbaikan tidak ditemukan');
    if (!workOrderTransitions[workOrder.status]?.includes(status)) throw new Error(`Perpindahan work order ${workOrder.status} ke ${status} tidak diizinkan`);
    const reason = String(cancellationReason || '').trim();
    if (status === 'cancelled' && reason.length < 3) throw new Error('Alasan pembatalan work order wajib diisi');
    let finalCostValue = workOrder.final_cost;
    if (finalCost !== undefined) {
      finalCostValue = Number(finalCost);
      if (!Number.isSafeInteger(finalCostValue) || finalCostValue < 0) throw new Error('Biaya akhir harus Rupiah integer >= 0');
    }
    if (status === 'completed') {
      const unit = db.prepare('SELECT status FROM inventory_units WHERE id = ?').get(workOrder.inventory_unit_id);
      if (unit.status !== 'ready') throw new Error('Unit harus lulus QC dan siap jual sebelum work order ditutup');
    }
    const unit = db.prepare('SELECT status FROM inventory_units WHERE id = ?').get(workOrder.inventory_unit_id);
    if (status === 'in_progress' && unit.status === 'inspection') transitionInventoryUnit(db, workOrder.inventory_unit_id, { toStatus: 'repair', reason: `Mulai ${workOrder.work_order_number}`, createdBy: actorId });
    if (status === 'qc' && unit.status === 'repair') transitionInventoryUnit(db, workOrder.inventory_unit_id, { toStatus: 'inspection', reason: `QC ${workOrder.work_order_number}`, createdBy: actorId });
    const finishedAt = ['completed', 'cancelled'].includes(status) ? new Date().toISOString() : null;
    db.prepare(`UPDATE inventory_repair_work_orders SET status = ?, diagnosis = COALESCE(NULLIF(?, ''), diagnosis),
      final_cost = ?, cancellation_reason = ?, finished_at = ? WHERE id = ?`).run(status, String(diagnosis || ''), finalCostValue, status === 'cancelled' ? reason : workOrder.cancellation_reason, finishedAt, workOrder.id);
    return db.prepare('SELECT * FROM inventory_repair_work_orders WHERE id = ?').get(workOrder.id);
  });
  return update.immediate();
}

export function createExternalTechnician(db, input, createdBy) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Nama teknisi eksternal wajib diisi');
  const result = db.prepare('INSERT INTO external_technicians (name, phone, notes, created_by) VALUES (?, ?, ?, ?)').run(name, String(input.phone || '').trim(), String(input.notes || '').trim(), requireId(createdBy, 'Pembuat data teknisi tidak valid'));
  return db.prepare('SELECT * FROM external_technicians WHERE id = ?').get(result.lastInsertRowid);
}

export function listExternalTechnicians(db) {
  return db.prepare('SELECT * FROM external_technicians WHERE active = 1 ORDER BY name').all();
}

export function assignServiceTechnician(db, input, assignedBy) {
  const actorId = requireId(assignedBy, 'Pembuat assignment tidak valid');
  const technicianType = String(input.technicianType || '');
  if (!['internal', 'external'].includes(technicianType)) throw new Error('Jenis teknisi tidak valid');
  const serviceId = input.serviceId ? requireId(input.serviceId, 'ID servis tidak valid') : null;
  const workOrderId = input.inventoryRepairWorkOrderId ? requireId(input.inventoryRepairWorkOrderId, 'ID work order tidak valid') : null;
  if (Boolean(serviceId) === Boolean(workOrderId)) throw new Error('Pilih tepat satu servis pelanggan atau work order unit toko');
  let internalUserId = null;
  let externalTechnicianId = null;
  if (technicianType === 'internal') {
    internalUserId = requireId(input.internalUserId, 'User teknisi internal wajib dipilih');
    const user = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'teknisi'").get(internalUserId);
    if (!user) throw new Error('User teknisi internal tidak ditemukan atau tidak aktif');
  } else {
    externalTechnicianId = requireId(input.externalTechnicianId, 'Teknisi eksternal wajib dipilih');
    if (!db.prepare('SELECT id FROM external_technicians WHERE id = ? AND active = 1').get(externalTechnicianId)) throw new Error('Teknisi eksternal tidak ditemukan atau nonaktif');
  }
  const targetExists = serviceId ? db.prepare('SELECT id FROM services WHERE id = ?').get(serviceId) : db.prepare('SELECT id FROM inventory_repair_work_orders WHERE id = ?').get(workOrderId);
  if (!targetExists) throw new Error('Target pekerjaan tidak ditemukan');
  const result = db.prepare(`INSERT INTO service_technician_assignments (
    service_id, inventory_repair_work_order_id, technician_type, internal_user_id, external_technician_id, assigned_by
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(serviceId, workOrderId, technicianType, internalUserId, externalTechnicianId, actorId);
  const name = technicianType === 'internal'
    ? db.prepare('SELECT name FROM users WHERE id = ?').get(internalUserId).name
    : db.prepare('SELECT name FROM external_technicians WHERE id = ?').get(externalTechnicianId).name;
  if (serviceId) db.prepare('UPDATE services SET technician_name = ? WHERE id = ?').run(name, serviceId);
  return db.prepare('SELECT * FROM service_technician_assignments WHERE id = ?').get(result.lastInsertRowid);
}

export function recordServicePartUsage(db, input) {
  const serviceId = input.serviceId ? requireId(input.serviceId, 'ID servis tidak valid') : null;
  const workOrderId = input.inventoryRepairWorkOrderId ? requireId(input.inventoryRepairWorkOrderId, 'ID work order tidak valid') : null;
  if (Boolean(serviceId) === Boolean(workOrderId)) throw new Error('Pemakaian part harus terkait servis pelanggan atau work order unit toko');
  const productId = requireId(input.productId, 'Produk spare part tidak valid');
  const quantity = Number(input.quantity);
  const createdBy = requireId(input.createdBy, 'Pengguna pencatat part tidak valid');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const description = String(input.description || '').trim();
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !description || !idempotencyKey || idempotencyKey.length > 160) throw new Error('Jumlah, keterangan, dan kunci idempotensi wajib valid');
  const part = db.prepare("SELECT id, name FROM products WHERE id = ? AND category = 'part_copotan'").get(productId);
  if (!part) throw new Error('Produk yang dipakai bukan kategori spare part');
  let treatment = 'service_hpp';
  let treatmentReason = 'Spare part dikonsumsi untuk memenuhi pekerjaan servis pelanggan';
  if (serviceId) {
    const service = db.prepare("SELECT status FROM services WHERE id = ?").get(serviceId);
    if (!service || service.status !== 'proses_servis') throw new Error('Spare part pelanggan hanya dapat digunakan saat servis dalam proses');
  } else {
    const workOrder = db.prepare("SELECT status FROM inventory_repair_work_orders WHERE id = ?").get(workOrderId);
    if (!workOrder || workOrder.status !== 'in_progress') throw new Error('Work order unit harus dalam pengerjaan untuk memakai spare part');
    treatment = String(input.treatment || '');
    treatmentReason = requireReason(input.treatmentReason);
    if (!['capitalized', 'expense'].includes(treatment)) throw new Error('Spare part unit toko harus diklasifikasikan sebagai kapitalisasi atau beban');
  }
  const scopeType = serviceId ? 'service' : 'inventory_repair_work_order';
  const scopeId = serviceId || workOrderId;
  const requestHash = idempotencyHash({ scopeType, scopeId, productId, quantity, description, treatment, treatmentReason });
  const uniqueColumn = serviceId ? 'service_id' : 'inventory_repair_work_order_id';
  const existing = db.prepare(`SELECT * FROM service_part_usages WHERE ${uniqueColumn} = ? AND idempotency_key = ?`).get(scopeId, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error('Kunci pemakaian part sudah dipakai untuk data berbeda');
    return { ...existing, duplicate: true };
  }

  const usePart = db.transaction(() => {
    const consumed = allocatePartLayers(db, productId, quantity);
    const usageNumber = `SPU-${crypto.randomUUID().toUpperCase()}`;
    const usageIdempotencyKey = `service-part:${scopeType}:${scopeId}:${idempotencyKey}`;
    const debitAccount = treatment === 'service_hpp' ? '5200' : treatment === 'capitalized' ? '1310' : '6510';
    const journal = postJournal(db, {
      entryDate: new Date().toISOString().slice(0, 10),
      source: { type: 'service_part_usage', id: usageNumber, event: 'recognition' },
      description: `Pemakaian ${part.name} · ${description}`,
      idempotencyKey: usageIdempotencyKey,
      createdBy,
      lines: [{ accountCode: debitAccount, debit: consumed.totalCost, credit: 0, memo: description }, { accountCode: '1320', debit: 0, credit: consumed.totalCost, memo: part.name }]
    });
    const result = db.prepare(`INSERT INTO service_part_usages (
      service_id, inventory_repair_work_order_id, product_id, quantity, total_cost, treatment, treatment_reason,
      journal_entry_id, idempotency_key, request_hash, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(serviceId, workOrderId, productId, quantity, consumed.totalCost, treatment, treatmentReason, journal.id, idempotencyKey, requestHash, createdBy);
    const usageId = Number(result.lastInsertRowid);
    const usageNumberId = usageId;
    const copyAllocations = db.prepare('INSERT INTO service_part_allocations (usage_id, layer_id, quantity, unit_cost, total_cost) VALUES (?, ?, ?, ?, ?)');
    const writeMovement = db.prepare(`INSERT INTO part_stock_movements (
      product_id, layer_id, movement_type, quantity_delta, unit_cost, source_type, source_id, reason, created_by, total_cost
    ) VALUES (?, ?, 'unit_repair', ?, ?, 'service_part_usage', ?, ?, ?, ?)`);
    for (const allocation of consumed.allocations) {
      copyAllocations.run(usageId, allocation.layerId, allocation.quantity, allocation.unitCost, allocation.amount);
      writeMovement.run(productId, allocation.layerId, -allocation.quantity, allocation.unitCost, String(usageNumberId), description, createdBy, allocation.amount);
    }
    if (workOrderId) {
      const cost = db.prepare(`INSERT INTO inventory_cost_components (
        unit_id, component_type, amount, description, source_type, source_id, source_event, request_hash,
        treatment, treatment_reason, approved_by, journal_entry_id, created_by, inventory_repair_work_order_id
      ) SELECT inventory_unit_id, 'spare_part', ?, ?, 'service_part_usage', ?, 'recognition', ?, ?, ?, ?, ?, ?, ?
        FROM inventory_repair_work_orders WHERE id = ?`).run(consumed.totalCost, description, String(usageId), requestHash, treatment, treatmentReason, createdBy, journal.id, createdBy, workOrderId, workOrderId);
      if (cost.changes !== 1) throw new Error('Komponen biaya work order unit gagal disimpan');
    }
    return { id: usageId, scopeType, scopeId, productId, quantity, totalCost: consumed.totalCost, treatment, journalEntryId: journal.id, allocations: consumed.allocations, duplicate: false };
  });
  return usePart.immediate();
}

export function createServiceTechnicianBill(db, input) {
  const assignmentId = requireId(input.assignmentId, 'Assignment teknisi tidak valid');
  const amount = Number(input.amount);
  const createdBy = requireId(input.createdBy, 'Pembuat tagihan teknisi tidak valid');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const treatmentReason = requireReason(input.treatmentReason);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !idempotencyKey || idempotencyKey.length > 160) throw new Error('Nominal dan kunci idempotensi tagihan teknisi wajib valid');
  const requestHash = idempotencyHash({ assignmentId, amount, treatmentReason, treatment: input.treatment || null });
  const existing = db.prepare('SELECT * FROM service_technician_bills WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error('Kunci tagihan teknisi sudah dipakai untuk data berbeda');
    return { ...existing, duplicate: true };
  }
  const create = db.transaction(() => {
    const assignment = db.prepare(`SELECT service_technician_assignments.*, services.status AS service_status,
        inventory_repair_work_orders.status AS work_order_status, inventory_repair_work_orders.inventory_unit_id
      FROM service_technician_assignments
      LEFT JOIN services ON services.id = service_technician_assignments.service_id
      LEFT JOIN inventory_repair_work_orders ON inventory_repair_work_orders.id = service_technician_assignments.inventory_repair_work_order_id
      WHERE service_technician_assignments.id = ? AND service_technician_assignments.technician_type = 'external'`).get(assignmentId);
    if (!assignment || assignment.status === 'cancelled') throw new Error('Assignment teknisi eksternal tidak tersedia');
    const treatment = assignment.service_id ? 'service_hpp' : String(input.treatment || '');
    if (assignment.service_id && treatment !== 'service_hpp') throw new Error('Tagihan teknisi servis pelanggan harus menjadi HPP servis');
    if (!assignment.service_id && !['capitalized', 'expense'].includes(treatment)) throw new Error('Tagihan perbaikan unit harus kapitalisasi atau beban');
    if (assignment.service_id && !['proses_servis', 'selesai'].includes(assignment.service_status)) throw new Error('Servis belum dalam proses atau sudah dibatalkan');
    if (assignment.inventory_repair_work_order_id && !['in_progress', 'qc', 'completed'].includes(assignment.work_order_status)) throw new Error('Work order unit belum dalam pengerjaan atau sudah dibatalkan');
    const billNumber = `TECH-${new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const debitAccount = treatment === 'service_hpp' ? '5200' : treatment === 'capitalized' ? '1310' : '6510';
    const journal = postJournal(db, {
      entryDate: String(input.billDate || new Date().toISOString().slice(0, 10)),
      source: { type: 'service_technician_bill', id: billNumber, event: 'recognition' },
      description: `Tagihan teknisi eksternal ${billNumber}`,
      idempotencyKey: `technician-bill:${idempotencyKey}`,
      createdBy,
      lines: [{ accountCode: debitAccount, debit: amount, credit: 0, memo: treatmentReason }, { accountCode: '2300', debit: 0, credit: amount, memo: billNumber }]
    });
    const bill = db.prepare(`INSERT INTO service_technician_bills (
      bill_number, assignment_id, amount, treatment, treatment_reason, journal_entry_id, idempotency_key, request_hash, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(billNumber, assignmentId, amount, treatment, treatmentReason, journal.id, idempotencyKey, requestHash, createdBy);
    const billId = Number(bill.lastInsertRowid);
    let costComponentId = null;
    if (assignment.inventory_repair_work_order_id) {
      const component = db.prepare(`INSERT INTO inventory_cost_components (
        unit_id, component_type, amount, description, source_type, source_id, source_event, request_hash,
        treatment, treatment_reason, approved_by, journal_entry_id, created_by, inventory_repair_work_order_id
      ) VALUES (?, 'repair', ?, ?, 'service_technician_bill', ?, 'recognition', ?, ?, ?, ?, ?, ?, ?)`).run(
        assignment.inventory_unit_id, amount, `Tagihan teknisi ${billNumber}`, billNumber, requestHash,
        treatment, treatmentReason, createdBy, journal.id, createdBy, assignment.inventory_repair_work_order_id
      );
      costComponentId = Number(component.lastInsertRowid);
      db.prepare('UPDATE service_technician_bills SET inventory_cost_component_id = ? WHERE id = ?').run(costComponentId, billId);
    }
    return { ...db.prepare('SELECT * FROM service_technician_bills WHERE id = ?').get(billId), duplicate: false };
  });
  return create.immediate();
}

export function payServiceTechnicianBill(db, billId, input) {
  const amount = Number(input.amount);
  const cashAccountCode = String(input.cashAccountCode || '1110');
  const createdBy = requireId(input.createdBy, 'Pembayar tagihan teknisi tidak valid');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!Number.isSafeInteger(amount) || amount <= 0 || !cashAccounts.has(cashAccountCode) || !idempotencyKey || idempotencyKey.length > 160) throw new Error('Nominal, akun pembayaran, dan kunci idempotensi wajib valid');
  const requestHash = idempotencyHash({ billId, amount, cashAccountCode });
  const existing = db.prepare('SELECT * FROM service_technician_payments WHERE bill_id = ? AND idempotency_key = ?').get(billId, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error('Kunci pembayaran tagihan teknisi sudah dipakai dengan data berbeda');
    return { ...existing, duplicate: true };
  }
  const pay = db.transaction(() => {
    const bill = db.prepare('SELECT * FROM service_technician_bills WHERE id = ?').get(billId);
    if (!bill) throw new Error('Tagihan teknisi tidak ditemukan');
    const outstanding = bill.amount - bill.paid_amount;
    if (amount > outstanding) throw new Error('Pembayaran melebihi saldo utang teknisi');
    const paymentJournal = postJournal(db, {
      entryDate: String(input.paymentDate || new Date().toISOString().slice(0, 10)),
      source: { type: 'service_technician_payment', id: String(bill.id), event: idempotencyKey },
      description: `Pembayaran tagihan teknisi ${bill.bill_number}`,
      idempotencyKey: `technician-payment:${bill.id}:${idempotencyKey}`,
      createdBy,
      lines: [{ accountCode: '2300', debit: amount, credit: 0, memo: bill.bill_number }, { accountCode: cashAccountCode, debit: 0, credit: amount, memo: bill.bill_number }]
    });
    const payment = db.prepare(`INSERT INTO service_technician_payments (
      bill_id, amount, cash_account_code, idempotency_key, request_hash, journal_entry_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(bill.id, amount, cashAccountCode, idempotencyKey, requestHash, paymentJournal.id, createdBy);
    const newPaidAmount = bill.paid_amount + amount;
    const paymentStatus = newPaidAmount === bill.amount ? 'paid' : 'partial';
    db.prepare('UPDATE service_technician_bills SET paid_amount = ?, payment_status = ? WHERE id = ?').run(newPaidAmount, paymentStatus, bill.id);
    return { ...db.prepare('SELECT * FROM service_technician_payments WHERE id = ?').get(payment.lastInsertRowid), paidAmount: newPaidAmount, outstanding: bill.amount - newPaidAmount, duplicate: false };
  });
  return pay.immediate();
}
