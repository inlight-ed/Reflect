#!/usr/bin/env bash
# Proves that a backup can be restored: loads it into a temporary database next to the real one, counts
# rows, and removes the temporary database. The real database is not touched.
#   ./deploy/verify-backup.sh                      newest dump in ./backups
#   ./deploy/verify-backup.sh backups/some.dump
# Run it after install and from time to time; a backup nobody has restored is only a hope.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:-$(ls -t backups/reflect-*.dump 2>/dev/null | head -1 || true)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "No backup found. Looked in ./backups" >&2; exit 1; }
echo "Checking $file ($(du -h "$file" | cut -f1), $(date -r "$file" '+%Y-%m-%d %H:%M'))"

db=reflect_verify
psql_db() { docker compose exec -T db psql -U reflect -d "$db" -At -v ON_ERROR_STOP=1 "$@"; }
cleanup() { docker compose exec -T db dropdb -U reflect --if-exists "$db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker compose exec -T db createdb -U reflect "$db"
docker compose exec -T db pg_restore -U reflect -d "$db" --no-owner --no-acl --exit-on-error < "$file"

tables=$(psql_db -c "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$tables" -ge 12 ] || { echo "FAILED: only $tables tables in the backup (expected 12 or more)" >&2; exit 1; }
echo "Tables: $tables"
for table in users orders products integrations; do
  echo "  $table: $(psql_db -c "select count(*) from $table") rows"
done
echo "OK: the backup restores cleanly."
