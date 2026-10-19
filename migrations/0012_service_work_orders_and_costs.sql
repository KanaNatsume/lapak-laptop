CREATE TABLE service_deposit_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL UNIQUE REFERENCES services(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'qris')),
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_repair_work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_number TEXT NOT NULL UNIQUE,
  inventory_unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'inspection' CHECK (status IN ('inspection', 'waiting_approval', 'in_progress', 'qc', 'completed', 'cancelled')),
  diagnosis TEXT NOT NULL DEFAULT '',
  estimated_cost INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  final_cost INTEGER NOT NULL DEFAULT 0 CHECK (final_cost >= 0),
  cancellation_reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_inventory_repair_work_orders_unit ON inventory_repair_work_orders(inventory_unit_id, status, created_at);
CREATE UNIQUE INDEX idx_inventory_repair_work_orders_active_unit
  ON inventory_repair_work_orders(inventory_unit_id)
  WHERE status IN ('inspection', 'waiting_approval', 'in_progress', 'qc');
ALTER TABLE inventory_cost_components ADD COLUMN inventory_repair_work_order_id INTEGER REFERENCES inventory_repair_work_orders(id) ON DELETE RESTRICT;

CREATE TABLE external_technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_external_technicians_name ON external_technicians(name, active);

CREATE TABLE service_technician_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT,
  inventory_repair_work_order_id INTEGER REFERENCES inventory_repair_work_orders(id) ON DELETE RESTRICT,
  technician_type TEXT NOT NULL CHECK (technician_type IN ('internal', 'external')),
  internal_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  external_technician_id INTEGER REFERENCES external_technicians(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  CHECK ((service_id IS NOT NULL AND inventory_repair_work_order_id IS NULL) OR (service_id IS NULL AND inventory_repair_work_order_id IS NOT NULL)),
  CHECK ((technician_type = 'internal' AND internal_user_id IS NOT NULL AND external_technician_id IS NULL) OR (technician_type = 'external' AND internal_user_id IS NULL AND external_technician_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_service_assignment_one_active
  ON service_technician_assignments(service_id) WHERE service_id IS NOT NULL AND status = 'assigned';
CREATE UNIQUE INDEX idx_inventory_repair_assignment_one_active
  ON service_technician_assignments(inventory_repair_work_order_id) WHERE inventory_repair_work_order_id IS NOT NULL AND status = 'assigned';

CREATE TABLE service_part_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT,
  inventory_repair_work_order_id INTEGER REFERENCES inventory_repair_work_orders(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_cost INTEGER NOT NULL CHECK (total_cost > 0),
  treatment TEXT NOT NULL CHECK (treatment IN ('service_hpp', 'capitalized', 'expense')),
  treatment_reason TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((service_id IS NOT NULL AND inventory_repair_work_order_id IS NULL AND treatment = 'service_hpp') OR (service_id IS NULL AND inventory_repair_work_order_id IS NOT NULL AND treatment IN ('capitalized', 'expense'))),
  UNIQUE (service_id, idempotency_key),
  UNIQUE (inventory_repair_work_order_id, idempotency_key)
);
CREATE INDEX idx_service_part_usages_service ON service_part_usages(service_id, created_at);
CREATE INDEX idx_service_part_usages_work_order ON service_part_usages(inventory_repair_work_order_id, created_at);

CREATE TABLE service_part_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usage_id INTEGER NOT NULL REFERENCES service_part_usages(id) ON DELETE RESTRICT,
  layer_id INTEGER NOT NULL REFERENCES part_stock_layers(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  total_cost INTEGER NOT NULL CHECK (total_cost > 0)
);
CREATE INDEX idx_service_part_allocations_usage ON service_part_allocations(usage_id, id);

CREATE TABLE service_technician_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT NOT NULL UNIQUE,
  assignment_id INTEGER NOT NULL REFERENCES service_technician_assignments(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  treatment TEXT NOT NULL CHECK (treatment IN ('service_hpp', 'capitalized', 'expense')),
  treatment_reason TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((payment_status = 'unpaid' AND paid_amount = 0) OR (payment_status = 'partial' AND paid_amount > 0 AND paid_amount < amount) OR (payment_status = 'paid' AND paid_amount = amount))
);

CREATE TABLE service_technician_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES service_technician_bills(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bill_id, idempotency_key)
);
CREATE INDEX idx_service_technician_payments_bill ON service_technician_payments(bill_id, created_at);
