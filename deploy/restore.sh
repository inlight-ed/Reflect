#!/usr/bin/env bash
# Restores a pg_dump file (custom format, e.g. from ./backups or from Replit) into the Reflect database.
#   ./deploy/restore.sh backups/reflect-2026-10-19_0300.dump
# Existing tables are replaced. The app is stopped during the restore.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: deploy/restore.sh <file.dump>}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }

read -r -p "This replaces the current Reflect database with $file. Continue? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || exit 1

docker compose up -d db
docker compose stop app || true
docker compose exec -T db pg_restore -U reflect -d reflect --clean --if-exists --no-owner --no-acl < "$file" || {
  echo "pg_restore reported problems (see above). Messages about objects that did not exist are harmless." >&2
}
docker compose run --rm migrate
docker compose up -d app
echo "Restored $file."
