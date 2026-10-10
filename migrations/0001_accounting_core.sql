CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense')),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  parent_id INTEGER REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_number TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  posting_date TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  source_type TEXT,
  source_id TEXT,
  source_event TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  reversal_of_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  correction_reason TEXT,
  idempotency_key TEXT UNIQUE,
  request_hash TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  posted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at TEXT,
  CHECK ((source_type IS NULL AND source_id IS NULL AND source_event IS NULL) OR (source_type IS NOT NULL AND source_id IS NOT NULL AND source_event IS NOT NULL)),
  CHECK ((status = 'draft' AND posted_at IS NULL) OR (status IN ('posted', 'reversed') AND posted_at IS NOT NULL))
);

CREATE TABLE journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo TEXT NOT NULL DEFAULT '',
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  UNIQUE (journal_entry_id, line_number)
);

CREATE UNIQUE INDEX idx_journal_source_event
  ON journal_entries(source_type, source_id, source_event)
  WHERE source_type IS NOT NULL;
CREATE INDEX idx_journal_entries_dates ON journal_entries(status, posting_date, entry_date);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id, journal_entry_id);

CREATE TRIGGER journal_entries_start_as_draft
BEFORE INSERT ON journal_entries
WHEN NEW.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Jurnal harus dibuat sebagai draft');
END;

CREATE TRIGGER journal_entries_validate_posting
BEFORE UPDATE OF status ON journal_entries
WHEN OLD.status = 'draft' AND NEW.status = 'posted'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM journal_lines WHERE journal_entry_id = NEW.id
  ) THEN RAISE(ABORT, 'Jurnal harus memiliki baris') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE journal_entry_id = NEW.id
  ) <> (
    SELECT COALESCE(SUM(credit), 0) FROM journal_lines WHERE journal_entry_id = NEW.id
  ) THEN RAISE(ABORT, 'Total debit dan kredit jurnal harus seimbang') END;
  SELECT CASE WHEN NEW.posted_at IS NULL OR NEW.posted_by IS NULL
    THEN RAISE(ABORT, 'Waktu dan pembuat posting wajib diisi') END;
END;

CREATE TRIGGER journal_entries_validate_reversal
BEFORE UPDATE OF status ON journal_entries
WHEN OLD.status = 'posted' AND NEW.status = 'reversed'
BEGIN
  SELECT CASE WHEN NEW.reversal_entry_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM journal_entries
    WHERE id = NEW.reversal_entry_id AND status = 'posted' AND reversal_of_entry_id = OLD.id
  ) THEN RAISE(ABORT, 'Jurnal pembalik posted wajib tersedia') END;
  SELECT CASE WHEN NEW.correction_reason IS NULL OR length(trim(NEW.correction_reason)) = 0
    THEN RAISE(ABORT, 'Alasan pembalikan wajib diisi') END;
END;

CREATE TRIGGER journal_entries_immutable_update
BEFORE UPDATE ON journal_entries
WHEN OLD.status <> 'draft' AND NOT (
  OLD.status = 'posted' AND NEW.status = 'reversed'
  AND NEW.id IS OLD.id
  AND NEW.entry_number IS OLD.entry_number
  AND NEW.entry_date IS OLD.entry_date
  AND NEW.posting_date IS OLD.posting_date
  AND NEW.reference IS OLD.reference
  AND NEW.source_type IS OLD.source_type
  AND NEW.source_id IS OLD.source_id
  AND NEW.source_event IS OLD.source_event
  AND NEW.description IS OLD.description
  AND NEW.reversal_of_entry_id IS OLD.reversal_of_entry_id
  AND NEW.idempotency_key IS OLD.idempotency_key
  AND NEW.request_hash IS OLD.request_hash
  AND NEW.created_by IS OLD.created_by
  AND NEW.posted_by IS OLD.posted_by
  AND NEW.created_at IS OLD.created_at
  AND NEW.posted_at IS OLD.posted_at
  AND NEW.reversal_entry_id IS NOT NULL
  AND NEW.correction_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Jurnal posted tidak dapat diedit; buat jurnal koreksi');
END;

CREATE TRIGGER journal_entries_immutable_delete
BEFORE DELETE ON journal_entries
WHEN OLD.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Jurnal posted tidak dapat dihapus');
END;

CREATE TRIGGER journal_lines_insert_draft_only
BEFORE INSERT ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = NEW.journal_entry_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Baris hanya dapat ditambahkan ke jurnal draft');
END;

CREATE TRIGGER journal_lines_update_draft_only
BEFORE UPDATE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = OLD.journal_entry_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Baris jurnal posted tidak dapat diedit');
END;

CREATE TRIGGER journal_lines_delete_draft_only
BEFORE DELETE ON journal_lines
WHEN (SELECT status FROM journal_entries WHERE id = OLD.journal_entry_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Baris jurnal posted tidak dapat dihapus');
END;

INSERT INTO accounts (code, name, type, normal_side, is_postable) VALUES
  ('1000', 'Aset', 'asset', 'debit', 0),
  ('2000', 'Liabilitas', 'liability', 'credit', 0),
  ('3000', 'Ekuitas', 'equity', 'credit', 0),
  ('4000', 'Pendapatan', 'revenue', 'credit', 0),
  ('5000', 'Harga pokok penjualan', 'cogs', 'debit', 0),
  ('6000', 'Beban operasional', 'expense', 'debit', 0);

INSERT INTO accounts (code, name, type, normal_side, parent_id, is_postable) VALUES
  ('1100', 'Kas dan bank (akun aktual perlu dikonfigurasi)', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1000'), 0),
  ('1200', 'Piutang usaha', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1000'), 1),
  ('1300', 'Persediaan', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1000'), 0),
  ('1310', 'Persediaan laptop', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1300'), 1),
  ('1320', 'Persediaan spare part', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1300'), 1),
  ('1400', 'Ongkir prabayar', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1000'), 1),
  ('1500', 'Aset tetap', 'asset', 'debit', (SELECT id FROM accounts WHERE code = '1000'), 1),
  ('1590', 'Akumulasi penyusutan', 'asset', 'credit', (SELECT id FROM accounts WHERE code = '1000'), 1),
  ('2100', 'Utang supplier', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2000'), 1),
  ('2200', 'Uang muka pelanggan', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2000'), 1),
  ('2300', 'Utang teknisi eksternal', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2000'), 1),
  ('2400', 'Utang ekspedisi', 'liability', 'credit', (SELECT id FROM accounts WHERE code = '2000'), 1),
  ('3100', 'Akun ekuitas sekutu (perlu konfigurasi)', 'equity', 'credit', (SELECT id FROM accounts WHERE code = '3000'), 0),
  ('4100', 'Pendapatan penjualan laptop', 'revenue', 'credit', (SELECT id FROM accounts WHERE code = '4000'), 1),
  ('4200', 'Pendapatan servis', 'revenue', 'credit', (SELECT id FROM accounts WHERE code = '4000'), 1),
  ('4300', 'Pendapatan ongkir', 'revenue', 'credit', (SELECT id FROM accounts WHERE code = '4000'), 1),
  ('4900', 'Retur dan potongan penjualan', 'contra_revenue', 'debit', (SELECT id FROM accounts WHERE code = '4000'), 1),
  ('5100', 'HPP laptop', 'cogs', 'debit', (SELECT id FROM accounts WHERE code = '5000'), 1),
  ('5200', 'HPP servis', 'cogs', 'debit', (SELECT id FROM accounts WHERE code = '5000'), 1),
  ('6100', 'Beban gaji', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1),
  ('6200', 'Beban perlengkapan dan konsumsi', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1),
  ('6300', 'Beban utilitas dan operasional', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1),
  ('6400', 'Beban pengiriman', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1),
  ('6500', 'Beban perbaikan abnormal', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1),
  ('6600', 'Beban penyusutan', 'expense', 'debit', (SELECT id FROM accounts WHERE code = '6000'), 1);
