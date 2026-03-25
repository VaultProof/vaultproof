#!/bin/bash
# VaultProof Database Backup
# Usage: ./scripts/backup.sh
#
# Dumps the Supabase PostgreSQL database to a timestamped file.
# Requires pg_dump installed locally.
#
# Set DIRECT_DATABASE_URL in your .env or pass it:
#   DIRECT_DATABASE_URL=postgresql://... ./scripts/backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/vaultproof_$TIMESTAMP.sql.gz"

# Load .env if exists
if [ -f "$SCRIPT_DIR/../.env" ]; then
  export $(grep -E '^DIRECT_DATABASE_URL=' "$SCRIPT_DIR/../.env" | xargs)
fi

if [ -z "$DIRECT_DATABASE_URL" ]; then
  echo "Error: DIRECT_DATABASE_URL not set"
  echo "Set it in .env or pass it: DIRECT_DATABASE_URL=postgresql://... $0"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Backing up VaultProof database..."
pg_dump "$DIRECT_DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup complete: $BACKUP_FILE ($SIZE)"

# Keep only last 10 backups
ls -t "$BACKUP_DIR"/vaultproof_*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null

echo "Done. $(ls "$BACKUP_DIR"/vaultproof_*.sql.gz | wc -l | tr -d ' ') backups retained."
