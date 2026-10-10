import crypto from 'node:crypto';

function assertDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} harus tanggal YYYY-MM-DD yang valid`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${field} harus tanggal YYYY-MM-DD yang valid`);
  return value;
}

function normalizeJournal(input) {
  const entryDate = assertDate(input.entryDate, 'Tanggal transaksi');
  const postingDate = assertDate(input.postingDate || entryDate, 'Tanggal pembukuan');
  const description = String(input.description || '').trim();
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  const createdBy = Number(input.createdBy);
  if (!description) throw new Error('Deskripsi jurnal wajib diisi');
  if (!idempotencyKey || idempotencyKey.length > 160) throw new Error('Kunci idempotensi jurnal wajib diisi dan maksimal 160 karakter');
  if (!Number.isSafeInteger(createdBy) || createdBy <= 0) throw new Error('Pembuat jurnal tidak valid');

  const sourceType = input.source?.type ? String(input.source.type).trim() : null;
  const sourceId = input.source?.id !== undefined && input.source?.id !== null ? String(input.source.id) : null;
  const sourceEvent = input.source?.event ? String(input.source.event).trim() : null;
  if ([sourceType, sourceId, sourceEvent].some(Boolean) && ![sourceType, sourceId, sourceEvent].every(Boolean)) {
    throw new Error('Referensi sumber jurnal harus berisi jenis, ID, dan peristiwa');
  }

  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new Error('Jurnal harus memiliki minimal dua baris');
  let debitTotal = 0;
  let creditTotal = 0;
  const lines = input.lines.map((line, index) => {
    const accountCode = String(line.accountCode || '').trim();
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (!accountCode) throw new Error(`Kode akun baris ${index + 1} wajib diisi`);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) {
      throw new Error(`Baris ${index + 1} harus memiliki debit atau kredit Rupiah integer positif, bukan keduanya`);
    }
    debitTotal += debit;
    creditTotal += credit;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) throw new Error('Total jurnal melebihi batas integer aman');
    return { accountCode, debit, credit, memo: String(line.memo || '').trim() };
  });
  if (debitTotal <= 0 || debitTotal !== creditTotal) throw new Error('Total debit dan kredit jurnal harus seimbang dan lebih besar dari 0');

  const normalized = {
    entryDate,
    postingDate,
    reference: String(input.reference || '').trim(),
    description,
    source: sourceType ? { type: sourceType, id: sourceId, event: sourceEvent } : null,
    idempotencyKey,
    createdBy,
    reversalOfEntryId: input.reversalOfEntryId ? Number(input.reversalOfEntryId) : null,
    lines
  };
  if (normalized.reversalOfEntryId !== null && (!Number.isSafeInteger(normalized.reversalOfEntryId) || normalized.reversalOfEntryId <= 0)) throw new Error('Referensi jurnal pembalik tidak valid');
  normalized.requestHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return normalized;
}

function existingJournal(db, journal) {
  let existing = db.prepare('SELECT id, entry_number, request_hash FROM journal_entries WHERE idempotency_key = ?').get(journal.idempotencyKey);
  if (!existing && journal.source) {
    existing = db.prepare('SELECT id, entry_number, request_hash FROM journal_entries WHERE source_type = ? AND source_id = ? AND source_event = ?').get(journal.source.type, journal.source.id, journal.source.event);
  }
  if (!existing) return null;
  if (existing.request_hash !== journal.requestHash) throw new Error('Kunci idempotensi atau peristiwa sumber sudah dipakai untuk isi jurnal berbeda');
  return { id: Number(existing.id), entryNumber: existing.entry_number, duplicate: true };
}

function writeAuditLog(db, { entryId, action, fromStatus = null, toStatus, reason = '', actorId }) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  const lines = db.prepare(`SELECT journal_lines.line_number, accounts.code AS account_code,
    journal_lines.debit, journal_lines.credit, journal_lines.memo
    FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id
    WHERE journal_lines.journal_entry_id = ? ORDER BY journal_lines.line_number`).all(entryId);
  db.prepare(`INSERT INTO journal_audit_log (
    journal_entry_id, action, from_status, to_status, reason, snapshot_json, actor_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(entryId, action, fromStatus, toStatus, reason, JSON.stringify({ entry, lines }), actorId);
}

export function insertPostedJournal(db, input) {
  const journal = normalizeJournal(input);
  const existing = existingJournal(db, journal);
  if (existing) return existing;

  const accounts = journal.lines.map((line) => {
    const account = db.prepare('SELECT id, is_active, is_postable FROM accounts WHERE code = ?').get(line.accountCode);
    if (!account || !account.is_active || !account.is_postable) throw new Error(`Akun ${line.accountCode} tidak tersedia untuk posting`);
    return account;
  });
  const entryNumber = `JRN-${journal.entryDate.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const result = db.prepare(`INSERT INTO journal_entries (
    entry_number, entry_date, posting_date, reference, source_type, source_id, source_event,
    description, reversal_of_entry_id, idempotency_key, request_hash, created_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    entryNumber,
    journal.entryDate,
    journal.postingDate,
    journal.reference,
    journal.source?.type || null,
    journal.source?.id || null,
    journal.source?.event || null,
    journal.description,
    journal.reversalOfEntryId,
    journal.idempotencyKey,
    journal.requestHash,
    journal.createdBy
  );
  const entryId = Number(result.lastInsertRowid);
  const insertLine = db.prepare('INSERT INTO journal_lines (journal_entry_id, line_number, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)');
  journal.lines.forEach((line, index) => insertLine.run(entryId, index + 1, accounts[index].id, line.debit, line.credit, line.memo));
  writeAuditLog(db, { entryId, action: 'draft_created', toStatus: 'draft', actorId: journal.createdBy });
  db.prepare("UPDATE journal_entries SET status = 'posted', posted_by = ?, posted_at = CURRENT_TIMESTAMP WHERE id = ?").run(journal.createdBy, entryId);
  writeAuditLog(db, { entryId, action: 'posted', fromStatus: 'draft', toStatus: 'posted', actorId: journal.createdBy });
  return { id: entryId, entryNumber, duplicate: false };
}

export function postJournal(db, input) {
  return db.transaction(() => insertPostedJournal(db, input)).immediate();
}

export function reverseJournal(db, entryId, { reason, entryDate, postingDate, createdBy, idempotencyKey }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason || cleanReason.length > 500) throw new Error('Alasan pembalikan wajib diisi maksimal 500 karakter');
  const reverse = db.transaction(() => {
    const original = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
    if (!original) throw new Error('Jurnal tidak ditemukan');
    if (original.status === 'reversed') return { id: Number(original.reversal_entry_id), duplicate: true };
    if (original.status !== 'posted') throw new Error('Hanya jurnal posted yang dapat dibalik');

    const lines = db.prepare(`SELECT accounts.code AS account_code, journal_lines.debit, journal_lines.credit, journal_lines.memo
      FROM journal_lines JOIN accounts ON accounts.id = journal_lines.account_id
      WHERE journal_lines.journal_entry_id = ? ORDER BY journal_lines.line_number`).all(original.id);
    const reversal = insertPostedJournal(db, {
      entryDate: entryDate || new Date().toISOString().slice(0, 10),
      postingDate: postingDate || entryDate || new Date().toISOString().slice(0, 10),
      reference: original.entry_number,
      source: { type: 'journal_reversal', id: String(original.id), event: 'reversal' },
      description: `Pembalikan ${original.entry_number}: ${cleanReason}`,
      idempotencyKey,
      createdBy,
      reversalOfEntryId: Number(original.id),
      lines: lines.map((line) => ({ accountCode: line.account_code, debit: line.credit, credit: line.debit, memo: line.memo }))
    });
    db.prepare("UPDATE journal_entries SET status = 'reversed', reversal_entry_id = ?, correction_reason = ? WHERE id = ?").run(reversal.id, cleanReason, original.id);
    writeAuditLog(db, { entryId: Number(original.id), action: 'reversed', fromStatus: 'posted', toStatus: 'reversed', reason: cleanReason, actorId: Number(createdBy) });
    return { id: reversal.id, originalId: Number(original.id), duplicate: reversal.duplicate };
  });
  return reverse.immediate();
}
