INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable) VALUES
  ('2500', 'Utang talangan', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2000'), 0),
  ('2510', 'Utang penggantian talangan', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2500'), 1);

CREATE TABLE cash_advance_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lender_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL,
  expense_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cash_advance_expenses_date ON cash_advance_expenses(expense_date, id);
CREATE INDEX idx_cash_advance_expenses_lender ON cash_advance_expenses(lender_name, expense_date);

CREATE TABLE cash_advance_reimbursements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES cash_advance_expenses(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_date TEXT NOT NULL,
  cash_account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  cash_entry_id INTEGER NOT NULL UNIQUE REFERENCES cash_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cash_advance_reimbursements_expense ON cash_advance_reimbursements(expense_id, paid_date, id);
