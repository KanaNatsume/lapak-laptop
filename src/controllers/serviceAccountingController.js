import db from '../db.js';
import { recordDirectUnitCost } from '../inventory/unitCostService.js';
import {
  assignServiceTechnician,
  createExternalTechnician,
  createInventoryRepairWorkOrder,
  createServiceTechnicianBill,
  listExternalTechnicians,
  listInventoryRepairWorkOrders,
  payServiceTechnicianBill,
  recordServicePartUsage,
  updateInventoryRepairWorkOrder
} from '../services/serviceAccountingService.js';

function respondDomainError(error, response) {
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) return response.status(409).json({ error: error.message });
  if (/sudah dipakai|tidak cukup|berubah; transaksi dibatalkan|melebihi saldo|sudah ada|tidak diizinkan/i.test(error.message || '')) return response.status(409).json({ error: error.message });
  if (error instanceof Error) return response.status(400).json({ error: error.message });
  console.error(error);
  return response.status(500).json({ error: 'Workflow servis gagal diproses' });
}

function routeId(value, response, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    response.status(400).json({ error: `${label} tidak valid` });
    return null;
  }
  return id;
}

export function createUnitRepairWorkOrder(request, response) {
  const unitId = routeId(request.params.id, response, 'ID unit');
  if (!unitId) return;
  try { response.status(201).json(createInventoryRepairWorkOrder(db, unitId, { ...request.body, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}

export function listUnitRepairWorkOrders(request, response) {
  const unitId = request.query.unit_id === undefined ? null : routeId(request.query.unit_id, response, 'ID unit');
  if (request.query.unit_id !== undefined && !unitId) return;
  response.json(listInventoryRepairWorkOrders(db, unitId));
}

export function updateUnitRepairWorkOrder(request, response) {
  const workOrderId = routeId(request.params.id, response, 'ID work order');
  if (!workOrderId) return;
  try { response.json(updateInventoryRepairWorkOrder(db, workOrderId, { ...request.body, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}

export function recordUnitRepairWorkOrderCost(request, response) {
  const workOrderId = routeId(request.params.id, response, 'ID work order');
  if (!workOrderId) return;
  const workOrder = db.prepare('SELECT inventory_unit_id FROM inventory_repair_work_orders WHERE id = ?').get(workOrderId);
  if (!workOrder) return response.status(404).json({ error: 'Work order perbaikan tidak ditemukan' });
  try {
    response.status(201).json(recordDirectUnitCost(db, workOrder.inventory_unit_id, { ...request.body, inventoryRepairWorkOrderId: workOrderId, createdBy: request.user.id }));
  } catch (error) { return respondDomainError(error, response); }
}

export function createExternalTechnicianRoute(request, response) {
  try { response.status(201).json(createExternalTechnician(db, request.body, request.user.id)); }
  catch (error) { return respondDomainError(error, response); }
}

export function listExternalTechnicianRoute(_request, response) {
  response.json(listExternalTechnicians(db));
}

export function assignServiceTechnicianRoute(request, response) {
  try { response.status(201).json(assignServiceTechnician(db, { ...request.body, serviceId: request.params.id }, request.user.id)); }
  catch (error) { return respondDomainError(error, response); }
}

export function assignUnitRepairTechnicianRoute(request, response) {
  try { response.status(201).json(assignServiceTechnician(db, { ...request.body, inventoryRepairWorkOrderId: request.params.id }, request.user.id)); }
  catch (error) { return respondDomainError(error, response); }
}

export function recordServicePartUsageRoute(request, response) {
  try { response.status(201).json(recordServicePartUsage(db, { ...request.body, serviceId: request.params.id, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}

export function recordUnitRepairPartUsageRoute(request, response) {
  try { response.status(201).json(recordServicePartUsage(db, { ...request.body, inventoryRepairWorkOrderId: request.params.id, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}

export function listServicePartUsages(request, response) {
  const serviceId = routeId(request.params.id, response, 'ID servis');
  if (!serviceId) return;
  response.json(db.prepare(`SELECT service_part_usages.*, products.name AS product_name, journal_entries.entry_number
    FROM service_part_usages JOIN products ON products.id = service_part_usages.product_id
    JOIN journal_entries ON journal_entries.id = service_part_usages.journal_entry_id
    WHERE service_part_usages.service_id = ? ORDER BY service_part_usages.id`).all(serviceId));
}

export function listServiceTechnicianAssignments(request, response) {
  const serviceId = routeId(request.params.id, response, 'ID servis');
  if (!serviceId) return;
  const assignments = db.prepare(`SELECT service_technician_assignments.*,
      users.name AS internal_technician_name, external_technicians.name AS external_technician_name
    FROM service_technician_assignments
    LEFT JOIN users ON users.id = service_technician_assignments.internal_user_id
    LEFT JOIN external_technicians ON external_technicians.id = service_technician_assignments.external_technician_id
    WHERE service_technician_assignments.service_id = ? ORDER BY service_technician_assignments.id DESC`).all(serviceId);
  response.json(assignments.map((assignment) => ({
    ...assignment,
    bills: db.prepare('SELECT * FROM service_technician_bills WHERE assignment_id = ? ORDER BY id DESC').all(assignment.id)
  })));
}

export function createServiceTechnicianBillRoute(request, response) {
  try { response.status(201).json(createServiceTechnicianBill(db, { ...request.body, assignmentId: request.params.id, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}

export function payServiceTechnicianBillRoute(request, response) {
  const billId = routeId(request.params.id, response, 'ID tagihan teknisi');
  if (!billId) return;
  try { response.status(201).json(payServiceTechnicianBill(db, billId, { ...request.body, createdBy: request.user.id })); }
  catch (error) { return respondDomainError(error, response); }
}
