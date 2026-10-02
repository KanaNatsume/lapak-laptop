#!/usr/bin/env bash
set -eu

DB_PATH="${DATABASE_PATH:-/var/lib/pos-laptop/data/pos.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pos-laptop}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PATH="$BACKUP_DIR/pos-$STAMP.sqlite"

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
find "$BACKUP_DIR" -type f -name 'pos-*.sqlite' -mtime +14 -delete
printf 'Backup created: %s\n' "$BACKUP_PATH"
