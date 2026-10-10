CREATE TABLE inventory_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  serial_number TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL CHECK (source_type IN ('supplier', 'individual', 'trade_in', 'opening')),
  source_reference TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '',
  acquired_at TEXT NOT NULL,
  acquisition_cost INTEGER NOT NULL CHECK (acquisition_cost >= 0),
  condition_grade TEXT NOT NULL CHECK (condition_grade IN ('A', 'B', 'C', 'Minus', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off')),
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  written_off_reason TEXT,
  CHECK (status <> 'written_off' OR length(trim(COALESCE(written_off_reason, ''))) > 0)
);

CREATE UNIQUE INDEX idx_inventory_units_serial
  ON inventory_units(serial_number) WHERE serial_number <> '';
CREATE INDEX idx_inventory_units_product_status ON inventory_units(product_id, status, acquired_at, id);
CREATE INDEX idx_inventory_units_source ON inventory_units(source_type, source_reference);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off', 'adjustment')),
  from_status TEXT CHECK (from_status IN ('received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off')),
  to_status TEXT NOT NULL CHECK (to_status IN ('received', 'inspection', 'repair', 'ready', 'reserved', 'sold', 'returned', 'written_off')),
  source_type TEXT,
  source_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((source_type IS NULL AND source_id IS NULL) OR (source_type IS NOT NULL AND source_id IS NOT NULL))
);
CREATE INDEX idx_inventory_movements_unit ON inventory_movements(unit_id, id);
CREATE INDEX idx_inventory_movements_source ON inventory_movements(source_type, source_id);

CREATE TABLE inventory_cost_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  component_type TEXT NOT NULL CHECK (component_type IN ('purchase_discount', 'spare_part', 'repair', 'freight', 'other')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  description TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  treatment TEXT NOT NULL DEFAULT 'pending' CHECK (treatment IN ('pending', 'capitalized', 'expense', 'rejected')),
  treatment_reason TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((source_type IS NULL AND source_id IS NULL) OR (source_type IS NOT NULL AND source_id IS NOT NULL)),
  CHECK (treatment = 'pending' OR (length(trim(COALESCE(treatment_reason, ''))) > 0 AND approved_by IS NOT NULL AND journal_entry_id IS NOT NULL))
);
CREATE INDEX idx_inventory_cost_components_unit ON inventory_cost_components(unit_id, treatment);

CREATE TRIGGER inventory_movements_immutable_update
BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'Riwayat pergerakan unit tidak dapat diedit');
END;

CREATE TRIGGER inventory_movements_immutable_delete
BEFORE DELETE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'Riwayat pergerakan unit tidak dapat dihapus');
END;

CREATE TRIGGER inventory_unit_cost_treatment_requires_posted_journal
BEFORE INSERT ON inventory_cost_components
WHEN NEW.treatment <> 'pending' AND NOT EXISTS (
  SELECT 1 FROM journal_entries WHERE id = NEW.journal_entry_id AND status = 'posted'
)
BEGIN
  SELECT RAISE(ABORT, 'Klasifikasi biaya unit harus terkait jurnal posted');
END;

CREATE TRIGGER inventory_unit_cost_treatment_update_requires_posted_journal
BEFORE UPDATE OF treatment, journal_entry_id ON inventory_cost_components
WHEN NEW.treatment <> 'pending' AND NOT EXISTS (
  SELECT 1 FROM journal_entries WHERE id = NEW.journal_entry_id AND status = 'posted'
)
BEGIN
  SELECT RAISE(ABORT, 'Klasifikasi biaya unit harus terkait jurnal posted');
END;

CREATE TABLE inventory_unit_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL UNIQUE REFERENCES inventory_units(id) ON DELETE RESTRICT,
  transaction_item_id INTEGER NOT NULL REFERENCES transaction_items(id) ON DELETE RESTRICT,
  allocated_cost INTEGER NOT NULL CHECK (allocated_cost >= 0),
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'refunded')),
  refund_id INTEGER UNIQUE REFERENCES transaction_refunds(id) ON DELETE RESTRICT,
  allocated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refunded_at TEXT,
  CHECK ((status = 'allocated' AND refund_id IS NULL AND refunded_at IS NULL) OR (status = 'refunded' AND refund_id IS NOT NULL AND refunded_at IS NOT NULL))
);
CREATE INDEX idx_inventory_unit_allocations_item ON inventory_unit_allocations(transaction_item_id);

CREATE VIEW inventory_unit_costs AS
SELECT inventory_units.id AS unit_id,
       inventory_units.acquisition_cost + COALESCE(SUM(CASE WHEN inventory_cost_components.treatment = 'capitalized' THEN inventory_cost_components.amount ELSE 0 END), 0) AS acquisition_cost
FROM inventory_units
LEFT JOIN inventory_cost_components ON inventory_cost_components.unit_id = inventory_units.id
GROUP BY inventory_units.id;
