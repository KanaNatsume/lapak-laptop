ALTER TABLE inventory_purchases ADD COLUMN idempotency_key TEXT;
ALTER TABLE inventory_purchases ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX idx_inventory_purchases_idempotency ON inventory_purchases(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE inventory_cost_components ADD COLUMN source_event TEXT;
ALTER TABLE inventory_cost_components ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX idx_inventory_cost_component_source
  ON inventory_cost_components(source_type, source_id, source_event)
  WHERE source_type IS NOT NULL AND source_event IS NOT NULL;
