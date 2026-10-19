CREATE TABLE opening_balance_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT NOT NULL DEFAULT 'default',
  effective_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'rejected')),
  source_summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  journal_entry_id INTEGER UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status IN ('approved', 'posted') AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status IN ('draft', 'rejected')),
  CHECK ((status = 'posted' AND journal_entry_id IS NOT NULL AND posted_at IS NOT NULL) OR status <> 'posted')
);
CREATE UNIQUE INDEX idx_opening_balance_one_posted
  ON opening_balance_batches(entity_key, effective_date) WHERE status = 'posted';

CREATE TABLE opening_balance_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES opening_balance_batches(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  evidence_note TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_opening_balance_lines_batch ON opening_balance_lines(batch_id, account_code);

CREATE TABLE legacy_valuation_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id INTEGER REFERENCES inventory_units(id) ON DELETE RESTRICT,
  ownership_type TEXT NOT NULL CHECK (ownership_type IN ('store', 'customer')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  purchase_cost INTEGER NOT NULL DEFAULT 0 CHECK (purchase_cost >= 0),
  capitalized_repair_cost INTEGER NOT NULL DEFAULT 0 CHECK (capitalized_repair_cost >= 0),
  eligible_additional_cost INTEGER NOT NULL DEFAULT 0 CHECK (eligible_additional_cost >= 0),
  total_verified_cost INTEGER NOT NULL DEFAULT 0 CHECK (total_verified_cost >= 0),
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verification_note TEXT NOT NULL DEFAULT '',
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  journal_entry_id INTEGER UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (total_verified_cost = purchase_cost + capitalized_repair_cost + eligible_additional_cost),
  CHECK ((verification_status = 'verified' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR verification_status <> 'verified'),
  CHECK (ownership_type = 'store' OR journal_entry_id IS NULL)
);
CREATE INDEX idx_legacy_valuation_status ON legacy_valuation_reviews(verification_status, product_id);
CREATE UNIQUE INDEX idx_legacy_valuation_source ON legacy_valuation_reviews(source_type, source_reference, product_id, COALESCE(unit_id, 0));

CREATE TABLE cash_entry_reconciliation_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_entry_id INTEGER NOT NULL UNIQUE REFERENCES cash_entries(id) ON DELETE RESTRICT,
  debit_account_code TEXT REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  credit_account_code TEXT REFERENCES accounts(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  category_code TEXT NOT NULL DEFAULT 'unidentified',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ambiguous', 'approved', 'posted', 'rejected', 'already_journaled')),
  existing_journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  journal_entry_id INTEGER UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  recommendation_reason TEXT NOT NULL DEFAULT '',
  verification_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status NOT IN ('approved', 'posted') OR (debit_account_code IS NOT NULL AND credit_account_code IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (status <> 'posted' OR journal_entry_id IS NOT NULL)
);
CREATE INDEX idx_cash_reconciliation_status ON cash_entry_reconciliation_mappings(status, cash_entry_id);

CREATE TABLE reconciliation_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opening_balance', 'legacy_valuation', 'cash_mapping')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_reconciliation_audit_entity ON reconciliation_audit_log(entity_type, entity_id, occurred_at, id);
CREATE TRIGGER reconciliation_audit_immutable_update
BEFORE UPDATE ON reconciliation_audit_log
BEGIN SELECT RAISE(ABORT, 'Audit rekonsiliasi tidak dapat diedit'); END;
CREATE TRIGGER reconciliation_audit_immutable_delete
BEFORE DELETE ON reconciliation_audit_log
BEGIN SELECT RAISE(ABORT, 'Audit rekonsiliasi tidak dapat dihapus'); END;