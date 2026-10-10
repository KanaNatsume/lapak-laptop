CREATE TABLE journal_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('draft_created', 'posted', 'reversed')),
  from_status TEXT CHECK (from_status IN ('draft', 'posted', 'reversed')),
  to_status TEXT NOT NULL CHECK (to_status IN ('draft', 'posted', 'reversed')),
  reason TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_journal_audit_entry_time ON journal_audit_log(journal_entry_id, occurred_at, id);
CREATE INDEX idx_journal_audit_actor_time ON journal_audit_log(actor_id, occurred_at);

CREATE TRIGGER journal_audit_log_immutable_update
BEFORE UPDATE ON journal_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log akuntansi tidak dapat diedit');
END;

CREATE TRIGGER journal_audit_log_immutable_delete
BEFORE DELETE ON journal_audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log akuntansi tidak dapat dihapus');
END;
