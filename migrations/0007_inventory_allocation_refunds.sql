ALTER TABLE part_stock_allocations ADD COLUMN status TEXT NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'refunded'));
ALTER TABLE part_stock_allocations ADD COLUMN refund_id INTEGER REFERENCES transaction_refunds(id) ON DELETE RESTRICT;
ALTER TABLE part_stock_allocations ADD COLUMN refunded_at TEXT;
CREATE INDEX idx_part_stock_allocations_refund ON part_stock_allocations(refund_id) WHERE refund_id IS NOT NULL;

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

CREATE TRIGGER part_stock_movements_immutable_update
BEFORE UPDATE ON part_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'Pergerakan spare part tidak dapat diedit');
END;

CREATE TRIGGER part_stock_movements_immutable_delete
BEFORE DELETE ON part_stock_movements
BEGIN
  SELECT RAISE(ABORT, 'Pergerakan spare part tidak dapat dihapus');
END;

CREATE TRIGGER part_stock_allocations_immutable_update
BEFORE UPDATE ON part_stock_allocations
WHEN NOT (
  OLD.status = 'allocated' AND NEW.status = 'refunded'
  AND NEW.id IS OLD.id
  AND NEW.layer_id IS OLD.layer_id
  AND NEW.quantity IS OLD.quantity
  AND NEW.unit_cost IS OLD.unit_cost
  AND NEW.transaction_item_id IS OLD.transaction_item_id
  AND NEW.cost_component_id IS OLD.cost_component_id
  AND NEW.refund_id IS NOT NULL
  AND NEW.created_at IS OLD.created_at
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
