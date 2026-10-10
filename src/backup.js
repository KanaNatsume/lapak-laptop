import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDirectory = path.resolve(projectRoot, process.env.BACKUP_DIR || 'data/backups');
const mirrorDirectory = process.env.BACKUP_MIRROR_DIR ? path.resolve(process.env.BACKUP_MIRROR_DIR) : null;
const intervalMs = Number(process.env.BACKUP_INTERVAL_MS || 24 * 60 * 60 * 1000);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);

function backupName() {
  return `pos-${new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 14)}.sqlite`;
}

function pruneBackups(directory) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith('pos-') || !name.endsWith('.sqlite')) continue;
    const filePath = path.join(directory, name);
    if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath);
  }
}

export async function backupDatabase() {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const destination = path.join(backupDirectory, backupName());
  await db.backup(destination);
  pruneBackups(backupDirectory);
  if (mirrorDirectory && mirrorDirectory !== backupDirectory) {
    fs.mkdirSync(mirrorDirectory, { recursive: true });
    await fs.promises.copyFile(destination, path.join(mirrorDirectory, path.basename(destination)));
    pruneBackups(mirrorDirectory);
  }
  console.log(`Backup database dibuat: ${destination}`);
  return destination;
}

export function scheduleDatabaseBackups() {
  backupDatabase().catch((error) => console.error('Backup database gagal:', error.message));
  const timer = setInterval(() => backupDatabase().catch((error) => console.error('Backup database gagal:', error.message)), intervalMs);
  timer.unref();
}
