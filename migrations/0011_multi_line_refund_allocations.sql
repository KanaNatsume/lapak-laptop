DROP TRIGGER inventory_unit_allocations_immutable_update;
DROP TRIGGER inventory_unit_allocations_immutable_delete;
DROP INDEX idx_inventory_unit_allocations_active_unit;
DROP INDEX idx_inventory_unit_allocations_item;
DROP INDEX idx_inventory_unit_allocations_unit_status;
ALTER TABLE inventory_unit_allocations RENAME TO inventory_unit_allocations_old;
CREATE TABLE inventory_unit_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  transaction_item_id INTEGER NOT NULL REFERENCES transaction_items(id) ON DELETE RESTRICT,
  allocated_cost INTEGER NOT NULL CHECK (allocated_cost >= 0),
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'refunded')),
  refund_id INTEGER REFERENCES transaction_refunds(id) ON DELETE RESTRICT,
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

DROP TRIGGER part_stock_allocations_immutable_update;
DROP TRIGGER part_stock_allocations_immutable_delete;
DROP INDEX idx_part_stock_allocations_transaction;
DROP INDEX idx_part_stock_allocations_cost_component;
DROP INDEX idx_part_stock_allocations_refund;
ALTER TABLE part_stock_allocations RENAME TO part_stock_allocations_old;
CREATE TABLE part_stock_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer_id INTEGER NOT NULL REFERENCES part_stock_layers(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  transaction_item_id INTEGER REFERENCES transaction_items(id) ON DELETE RESTRICT,
  cost_component_id INTEGER REFERENCES inventory_cost_components(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'refunded')),
  refund_id INTEGER REFERENCES transaction_refunds(id) ON DELETE RESTRICT,
  refunded_at TEXT,
  CHECK ((transaction_item_id IS NULL) <> (cost_component_id IS NULL)),
  CHECK ((status = 'allocated' AND refund_id IS NULL AND refunded_at IS NULL) OR (status = 'refunded' AND refund_id IS NOT NULL AND refunded_at IS NOT NULL))
);
INSERT INTO part_stock_allocations (id, layer_id, quantity, unit_cost, total_cost, transaction_item_id, cost_component_id, created_at, status, refund_id, refunded_at)
SELECT id, layer_id, quantity, unit_cost, total_cost, transaction_item_id, cost_component_id, created_at, status, refund_id, refunded_at FROM part_stock_allocations_old;
DROP TABLE part_stock_allocations_old;
CREATE INDEX idx_part_stock_allocations_transaction ON part_stock_allocations(transaction_item_id);
CREATE INDEX idx_part_stock_allocations_cost_component ON part_stock_allocations(cost_component_id);
CREATE INDEX idx_part_stock_allocations_refund ON part_stock_allocations(refund_id) WHERE refund_id IS NOT NULL;

CREATE TRIGGER inventory_unit_allocations_immutable_update
BEFORE UPDATE ON inventory_unit_allocations
WHEN NOT (
  OLD.status = 'allocated' AND NEW.status = 'refunded'
  AND NEW.id IS OLD.id AND NEW.unit_id IS OLD.unit_id
  AND NEW.transaction_item_id IS OLD.transaction_item_id
  AND NEW.allocated_cost IS OLD.allocated_cost AND NEW.refund_id IS NOT NULL
  AND NEW.allocated_at IS OLD.allocated_at AND NEW.refunded_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Alokasi HPP unit hanya dapat ditandai retur');
END;
CREATE TRIGGER inventory_unit_allocations_immutable_delete
BEFORE DELETE ON inventory_unit_allocations
BEGIN
  SELECT RAISE(ABORT, 'Alokasi HPP unit tidak dapat dihapus');
END;

CREATE TRIGGER part_stock_allocations_immutable_update
BEFORE UPDATE ON part_stock_allocations
WHEN NOT (
  OLD.status = 'allocated' AND NEW.status = 'refunded'
  AND NEW.id IS OLD.id AND NEW.layer_id IS OLD.layer_id
  AND NEW.quantity IS OLD.quantity AND NEW.unit_cost IS OLD.unit_cost
  AND NEW.total_cost IS OLD.total_cost
  AND NEW.transaction_item_id IS OLD.transaction_item_id
  AND NEW.cost_component_id IS OLD.cost_component_id
  AND NEW.refund_id IS NOT NULL AND NEW.created_at IS OLD.created_at
  AND NEW.refunded_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Alokasi layer hanya dapat ditandai retur');
END;
CREATE TRIGGER part_stock_allocations_immutable_delete
BEFORE DELETE ON part_stock_allocations
BEGIN
  SELECT RAISE(ABORT, 'Alokasi layer tidak dapat dihapus');
END;
