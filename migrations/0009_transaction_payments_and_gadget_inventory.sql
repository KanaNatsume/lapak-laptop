INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable)
VALUES ('1330', 'Persediaan gadget dan aksesori', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1300'), 1);

CREATE TABLE transaction_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
  applied_amount INTEGER NOT NULL CHECK (applied_amount > 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'qris')),
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (transaction_id, idempotency_key)
);
CREATE INDEX idx_transaction_payment_events_transaction ON transaction_payment_events(transaction_id, created_at, id);
