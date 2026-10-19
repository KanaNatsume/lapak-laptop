CREATE TABLE inventory_product_controls (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  legacy_stock INTEGER NOT NULL CHECK (legacy_stock >= 0),
  verified_at TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO inventory_product_controls (product_id, legacy_stock)
SELECT id, stock FROM products;

CREATE TRIGGER products_seed_inventory_control
AFTER INSERT ON products
BEGIN
  INSERT OR IGNORE INTO inventory_product_controls (product_id, legacy_stock) VALUES (NEW.id, NEW.stock);
END;

ALTER TABLE transaction_items ADD COLUMN legacy_stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (legacy_stock_qty >= 0);
ALTER TABLE transaction_items ADD COLUMN allocated_hpp INTEGER NOT NULL DEFAULT 0 CHECK (allocated_hpp >= 0);
ALTER TABLE inventory_units ADD COLUMN purchase_item_id INTEGER REFERENCES inventory_purchase_items(id) ON DELETE RESTRICT;

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_suppliers_name ON suppliers(name, active);

CREATE TABLE inventory_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('supplier', 'individual')),
  source_label TEXT NOT NULL,
  supplier_invoice TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('cash', 'credit')),
  cash_account_code TEXT REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((payment_mode = 'cash' AND cash_account_code IS NOT NULL) OR (payment_mode = 'credit' AND cash_account_code IS NULL)),
  CHECK ((source_type = 'supplier' AND supplier_id IS NOT NULL) OR (source_type = 'individual' AND supplier_id IS NULL))
);
CREATE INDEX idx_inventory_purchases_date ON inventory_purchases(purchase_date, id);

CREATE TABLE inventory_purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES inventory_purchases(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  inventory_type TEXT NOT NULL CHECK (inventory_type IN ('laptop_unit', 'spare_part')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  line_total INTEGER NOT NULL CHECK (line_total > 0),
  CHECK (line_total = quantity * unit_cost)
);
CREATE INDEX idx_inventory_purchase_items_product ON inventory_purchase_items(product_id, purchase_id);

CREATE TABLE part_stock_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  purchase_item_id INTEGER NOT NULL UNIQUE REFERENCES inventory_purchase_items(id) ON DELETE RESTRICT,
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_part_stock_layers_fifo ON part_stock_layers(product_id, received_at, id) WHERE quantity_remaining > 0;

CREATE TABLE part_stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  layer_id INTEGER REFERENCES part_stock_layers(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'unit_repair', 'sale', 'adjustment')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_part_stock_movements_product ON part_stock_movements(product_id, id);
CREATE INDEX idx_part_stock_movements_source ON part_stock_movements(source_type, source_id);

CREATE TABLE part_stock_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer_id INTEGER NOT NULL REFERENCES part_stock_layers(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost > 0),
  transaction_item_id INTEGER REFERENCES transaction_items(id) ON DELETE RESTRICT,
  cost_component_id INTEGER REFERENCES inventory_cost_components(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((transaction_item_id IS NULL) <> (cost_component_id IS NULL))
);
CREATE INDEX idx_part_stock_allocations_transaction ON part_stock_allocations(transaction_item_id);
CREATE INDEX idx_part_stock_allocations_cost_component ON part_stock_allocations(cost_component_id);

INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable) VALUES
  ('1110', 'Kas toko', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1100'), 1),
  ('1120', 'Rekening bank dan transfer', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1100'), 1),
  ('1130', 'QRIS dan dompet digital', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1100'), 1),
  ('5110', 'HPP spare part', 'cogs', 'debit', (SELECT id FROM accounts WHERE code = '5000'), 1);
