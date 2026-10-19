ALTER TABLE inventory_units ADD COLUMN returned_to_owner INTEGER NOT NULL DEFAULT 0 CHECK (returned_to_owner IN (0, 1));

DROP TRIGGER inventory_unit_allocations_immutable_update;
DROP TRIGGER inventory_unit_allocations_immutable_delete;
ALTER TABLE inventory_unit_allocations RENAME TO inventory_unit_allocations_old;

CREATE TABLE inventory_unit_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  transaction_item_id INTEGER NOT NULL REFERENCES transaction_items(id) ON DELETE RESTRICT,
  allocated_cost INTEGER NOT NULL CHECK (allocated_cost >= 0),
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'refunded')),
  refund_id INTEGER UNIQUE REFERENCES transaction_refunds(id) ON DELETE RESTRICT,
  allocated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refunded_at TEXT,
  CHECK ((status = 'allocated' AND refund_id IS NULL AND refunded_at IS NULL) OR (status = 'refunded' AND refund_id IS NOT NULL AND refunded_at IS NOT NULL))
);
INSERT INTO inventory_unit_allocations (id, unit_id, transaction_item_id, allocated_cost, status, refund_id, allocated_at, refunded_at)
SELECT id, unit_id, transaction_item_id, allocated_cost, status, refund_id, allocated_at, refunded_at FROM inventory_unit_allocations_old;
DROP TABLE inventory_unit_allocations_old;
CREATE UNIQUE INDEX idx_inventory_unit_allocations_active_unit
  ON inventory_unit_allocations(unit_id) WHERE status = 'allocated';
CREATE INDEX idx_inventory_unit_allocations_item ON inventory_unit_allocations(transaction_item_id);
CREATE INDEX idx_inventory_unit_allocations_unit_status ON inventory_unit_allocations(unit_id, status);

CREATE TRIGGER inventory_unit_allocations_immutable_update
BEFORE UPDATE ON inventory_unit_allocations
WHEN NOT (
  OLD.status = 'allocated' AND NEW.status = 'refunded'
  AND NEW.id IS OLD.id
  AND NEW.unit_id IS OLD.unit_id
  AND NEW.transaction_item_id IS OLD.transaction_item_id
  AND NEW.allocated_cost IS OLD.allocated_cost
  AND NEW.refund_id IS NOT NULL
  AND NEW.allocated_at IS OLD.allocated_at
  AND NEW.refunded_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Alokasi HPP unit hanya dapat ditandai retur');
END;

CREATE TRIGGER inventory_unit_allocations_immutable_delete
BEFORE DELETE ON inventory_unit_allocations
BEGIN
  SELECT RAISE(ABORT, 'Alokasi HPP unit tidak dapat dihapus');
END;
