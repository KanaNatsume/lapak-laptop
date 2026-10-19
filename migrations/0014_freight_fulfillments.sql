CREATE TABLE freight_fulfillments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  expedition TEXT NOT NULL,
  tracking_number TEXT NOT NULL DEFAULT '',
  customer_charge INTEGER NOT NULL DEFAULT 0 CHECK (customer_charge >= 0),
  actual_cost INTEGER NOT NULL CHECK (actual_cost > 0),
  shop_borne_amount INTEGER NOT NULL CHECK (shop_borne_amount >= 0),
  payment_source TEXT NOT NULL CHECK (payment_source IN ('payable', 'prepaid', 'mixed')),
  payable_amount INTEGER NOT NULL CHECK (payable_amount >= 0),
  prepaid_amount INTEGER NOT NULL CHECK (prepaid_amount >= 0),
  expense_journal_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (payable_amount + prepaid_amount = actual_cost),
  CHECK ((payment_source = 'payable' AND prepaid_amount = 0) OR (payment_source = 'prepaid' AND payable_amount = 0) OR (payment_source = 'mixed' AND payable_amount > 0 AND prepaid_amount > 0))
);
CREATE INDEX idx_freight_fulfillments_transaction ON freight_fulfillments(transaction_id, recorded_at);

CREATE TABLE freight_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fulfillment_id INTEGER NOT NULL REFERENCES freight_fulfillments(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fulfillment_id, idempotency_key)
);
CREATE INDEX idx_freight_payments_fulfillment ON freight_payments(fulfillment_id, created_at);

CREATE TABLE freight_prepaid_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
