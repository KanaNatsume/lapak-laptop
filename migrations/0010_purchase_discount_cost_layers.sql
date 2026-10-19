ALTER TABLE inventory_purchases ADD COLUMN gross_amount INTEGER NOT NULL DEFAULT 0 CHECK (gross_amount >= 0);
ALTER TABLE inventory_purchases ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
UPDATE inventory_purchases SET gross_amount = total_amount, discount_amount = 0;

CREATE TABLE inventory_purchase_item_discounts (
  purchase_item_id INTEGER PRIMARY KEY REFERENCES inventory_purchase_items(id) ON DELETE RESTRICT,
  discount_amount INTEGER NOT NULL CHECK (discount_amount >= 0),
  net_amount INTEGER NOT NULL CHECK (net_amount > 0)
);

ALTER TABLE part_stock_layers ADD COLUMN total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0);
ALTER TABLE part_stock_layers ADD COLUMN remaining_cost INTEGER NOT NULL DEFAULT 0 CHECK (remaining_cost >= 0 AND remaining_cost <= total_cost);
UPDATE part_stock_layers SET total_cost = quantity_received * unit_cost, remaining_cost = quantity_remaining * unit_cost;

ALTER TABLE part_stock_movements ADD COLUMN total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0);
UPDATE part_stock_movements SET total_cost = abs(quantity_delta) * unit_cost;

ALTER TABLE part_stock_allocations ADD COLUMN total_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_cost >= 0);
UPDATE part_stock_allocations SET total_cost = quantity * unit_cost;
DROP TRIGGER part_stock_allocations_immutable_update;
CREATE TRIGGER part_stock_allocations_immutable_update
BEFORE UPDATE ON part_stock_allocations
WHEN NOT (
  OLD.status = 'allocated' AND NEW.status = 'refunded'
  AND NEW.id IS OLD.id
  AND NEW.layer_id IS OLD.layer_id
  AND NEW.quantity IS OLD.quantity
  AND NEW.unit_cost IS OLD.unit_cost
  AND NEW.total_cost IS OLD.total_cost
  AND NEW.transaction_item_id IS OLD.transaction_item_id
  AND NEW.cost_component_id IS OLD.cost_component_id
  AND NEW.refund_id IS NOT NULL
  AND NEW.created_at IS OLD.created_at
  AND NEW.refunded_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Alokasi layer hanya dapat ditandai retur');
END;
