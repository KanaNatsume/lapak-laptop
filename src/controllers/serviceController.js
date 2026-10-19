import db from '../db.js';
import { decryptServicePin, encryptServicePin } from '../servicePin.js';
import { postJournal } from '../accounting/journalService.js';
import { createTransaction } from './transactionController.js';

const allowedStatuses = ['antrean', 'pengecekan', 'menunggu_persetujuan', 'proses_servis', 'selesai', 'diambil', 'batal_gagal'];
const transitions = { antrean: ['pengecekan', 'batal_gagal'], pengecekan: ['menunggu_persetujuan', 'proses_servis', 'batal_gagal'], menunggu_persetujuan: ['proses_servis', 'batal_gagal'], proses_servis: ['selesai', 'batal_gagal'], selesai: ['diambil'], diambil: [], batal_gagal: [] };

function nextTicket() { const stamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14); return `SRV-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

function omitServicePin(service) {
  if (!service) return service;
  const { password_pin, ...safeService } = service;
  return safeService;
}

db.transaction(() => {
  const oldPins = db.prepare("SELECT id, password_pin FROM services WHERE password_pin <> '' AND password_pin NOT LIKE 'enc:v1:%'").all();
  const updatePin = db.prepare('UPDATE services SET password_pin = ? WHERE id = ?');
  for (const service of oldPins) updatePin.run(encryptServicePin(service.password_pin), service.id);
})();

export function listServices(request, response) {
  const search = `%${request.query.search || ''}%`;
  const status = request.query.status;
  const query = `SELECT services.id, services.ticket_number, services.customer_id, services.device_name, services.specs, services.serial_number, services.issues, services.diagnosis, services.cancellation_reason, services.accessories_included, services.technician_name, services.status, services.estimated_cost, services.down_payment, services.failure_fee, services.final_cost, services.warranty_days, services.created_at, services.finished_at, customers.name AS customer_name, customers.phone FROM services JOIN customers ON customers.id = services.customer_id WHERE ${status && allowedStatuses.includes(status) ? 'services.status = ? AND' : ''} (ticket_number LIKE ? OR device_name LIKE ? OR customers.name LIKE ?) ORDER BY services.created_at DESC`;
  const params = status && allowedStatuses.includes(status) ? [status, search, search, search] : [search, search, search];
  response.json(db.prepare(query).all(...params));
}

export function createService(request, response) {
  const { customer_id, device_name, specs = {}, serial_number = '', issues, accessories_included = '', password_pin = '', technician_name = '', estimated_cost = 0, down_payment = 0, failure_fee = 0, warranty_days = 0 } = request.body;
  if (!customer_id || !device_name || !issues) return response.status(400).json({ error: 'Pelanggan, perangkat, dan keluhan wajib diisi' });
  const amounts = [estimated_cost, down_payment, failure_fee, warranty_days].map(Number);
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) return response.status(400).json({ error: 'Estimasi, DP, biaya gagal, dan garansi harus bilangan bulat >= 0' });
  const paymentMethod = String(request.body.down_payment_payment_method || 'cash');
  if (!['cash', 'transfer', 'qris'].includes(paymentMethod)) return response.status(400).json({ error: 'Metode DP tidak valid' });
  const cashAccountCode = ({ cash: '1110', transfer: '1120', qris: '1130' })[paymentMethod];
  const create = db.transaction(() => {
    const ticketNumber = nextTicket();
    const result = db.prepare(`INSERT INTO services (ticket_number, customer_id, device_name, specs, serial_number, issues, accessories_included, password_pin, technician_name, estimated_cost, down_payment, failure_fee, warranty_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ticketNumber, customer_id, device_name, JSON.stringify(specs), serial_number, issues, accessories_included, encryptServicePin(password_pin), technician_name, ...amounts);
    const serviceId = Number(result.lastInsertRowid);
    if (amounts[1] > 0) {
      const journal = postJournal(db, {
        entryDate: new Date().toISOString().slice(0, 10),
        reference: ticketNumber,
        source: { type: 'service_deposit', id: String(serviceId), event: 'initial' },
        description: `DP servis ${ticketNumber}`,
        idempotencyKey: `service-deposit:${serviceId}:initial`,
        createdBy: request.user.id,
        lines: [
          { accountCode: cashAccountCode, debit: amounts[1], credit: 0, memo: `DP ${ticketNumber}` },
          { accountCode: '2200', debit: 0, credit: amounts[1], memo: `Uang muka pelanggan ${ticketNumber}` }
        ]
      });
      db.prepare(`INSERT INTO service_deposit_receipts (service_id, amount, payment_method, cash_account_code, journal_entry_id, idempotency_key, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(serviceId, amounts[1], paymentMethod, cashAccountCode, journal.id, `service-deposit:${serviceId}:initial`, request.user.id);
      db.prepare(`INSERT INTO cash_entries (entry_type, category, description, amount, source, entry_date, created_by)
        VALUES ('pemasukan', 'Servis', ?, ?, 'transaction', date('now'), ?)`).run(`DP servis ${ticketNumber}`, amounts[1], request.user.id);
    }
    return omitServicePin(db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId));
  });
  response.status(201).json(create.immediate());
}

export function getServiceAccess(request, response) {
  const service = db.prepare('SELECT id, password_pin FROM services WHERE id = ?').get(request.params.id);
  if (!service) return response.status(404).json({ error: 'Tiket servis tidak ditemukan' });
  response.json({ password_pin: decryptServicePin(service.password_pin) });
}

export function updateServiceStatus(request, response) {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(request.params.id);
  const { status, final_cost, failure_fee, diagnosis = '', cancellation_reason = '' } = request.body;
  if (!service || !allowedStatuses.includes(status)) return response.status(400).json({ error: 'Status servis tidak valid' });
  if (service.status !== status && !transitions[service.status].includes(status)) return response.status(409).json({ error: `Perpindahan ${service.status} ke ${status} tidak diizinkan` });
  if (status === 'menunggu_persetujuan' && (!diagnosis.trim() || final_cost === undefined || !Number.isSafeInteger(Number(final_cost)) || Number(final_cost) < 0)) return response.status(400).json({ error: 'Diagnosis dan biaya servis wajib diisi sebelum meminta persetujuan' });
  const finalCostForCompletion = final_cost === undefined ? Number(service.final_cost) : Number(final_cost);
  if (status === 'selesai' && service.down_payment > finalCostForCompletion) return response.status(409).json({ error: 'DP melebihi tagihan akhir; selesaikan kelebihan DP sebelum menutup servis' });
  if (status === 'batal_gagal' && !cancellation_reason.trim()) return response.status(400).json({ error: 'Alasan pembatalan wajib diisi' });
  const finishedAt = ['selesai', 'diambil', 'batal_gagal'].includes(status) ? new Date().toISOString() : service.finished_at;
  const update = db.transaction(() => {
    db.prepare('UPDATE services SET status = ?, diagnosis = COALESCE(NULLIF(?, \'\'), diagnosis), cancellation_reason = COALESCE(NULLIF(?, \'\'), cancellation_reason), final_cost = COALESCE(?, final_cost), failure_fee = COALESCE(?, failure_fee), finished_at = ? WHERE id = ?').run(status, diagnosis, cancellation_reason, final_cost ?? null, failure_fee ?? null, finishedAt, service.id);
    let transaction = null;
    if (status === 'selesai') {
      const deposit = db.prepare('SELECT amount, payment_method FROM service_deposit_receipts WHERE service_id = ?').get(service.id);
      const fakeResponse = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };
      createTransaction({
        body: {
          customer_id: service.customer_id,
          transaction_type: 'servis',
          paid_amount: deposit?.amount || 0,
          payment_method: deposit?.payment_method || 'cash',
          items: [{ item_type: 'service', reference_id: service.id, qty: 1 }]
        },
        user: request.user
      }, fakeResponse);
      if (fakeResponse.statusCode >= 400 || !fakeResponse.body?.id) throw new Error(fakeResponse.body?.error || 'Invoice servis gagal dibuat');
      transaction = fakeResponse.body;
    }
    return { service: omitServicePin(db.prepare('SELECT * FROM services WHERE id = ?').get(service.id)), transaction };
  });
  const result = update.immediate();
  response.json({ ...result.service, ...(result.transaction ? { transaction: result.transaction } : {}) });
}