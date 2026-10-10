import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readMigrations(directory) {
  if (!fs.existsSync(directory)) return [];
  const migrations = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const match = name.match(/^(\d{4})_[a-z\d_]+\.sql$/i);
      if (!match) throw new Error(`Nama migrasi tidak valid: ${name}`);
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      return {
        version: Number(match[1]),
        name,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex')
      };
    });
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].version === migrations[index - 1].version) throw new Error(`Nomor versi migrasi duplikat: ${migrations[index].version}`);
  }
  return migrations;
}

function migrationState(db, migrations) {
  const hasLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
  const hasDomainSchema = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get());
  const applied = hasLedger ? db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() : [];
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
  const availableByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const migration of applied) {
    const current = availableByVersion.get(migration.version);
    if (!current || current.name !== migration.name || current.checksum !== migration.checksum) {
      throw new Error(`Migrasi ${migration.version} berubah atau hilang; pemulihan manual diperlukan`);
    }
  }

  return {
    hasLedger,
    hasDomainSchema,
    migrations,
    pending: migrations.filter((migration) => !appliedByVersion.has(migration.version))
  };
}

export async function backupBeforePendingMigrations(db, { migrationDirectory, backupDirectory }) {
  const state = migrationState(db, readMigrations(migrationDirectory));
  if (!state.hasDomainSchema || state.pending.length === 0) return null;

  fs.mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14);
  const firstVersion = String(state.pending[0].version).padStart(4, '0');
  const backupPath = path.join(backupDirectory, `pos-pre-migration-${firstVersion}-${timestamp}.sqlite`);
  await db.backup(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`Backup pre-migrasi tidak valid: ${backupPath}`);
  }
  console.log(`Backup pre-migrasi dibuat: ${backupPath}`);
  return backupPath;
}

export function applyPendingMigrations(db, migrationDirectory) {
  const migrations = readMigrations(migrationDirectory);
  const createLedger = db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `));
  createLedger.immediate();
  const state = migrationState(db, migrations);
  const record = db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)');

  for (const migration of state.pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, migration.checksum);
    });
    apply.immediate();
  }
  return state.pending.map(({ version, name }) => ({ version, name }));
}
