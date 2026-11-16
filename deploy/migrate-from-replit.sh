#!/usr/bin/env bash
# Copies the Reflect database from Replit (or any PostgreSQL) to this server.
#
# Option A, the database URL is reachable from here (Replit production database, Neon):
#   SOURCE_DATABASE_URL='postgresql://user:pass@host/db?sslmode=require' ./deploy/migrate-from-replit.sh
#
# Option B, it is not (the Replit development database "helium" is only reachable inside Replit):
#   1. In the Replit Shell run:   pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f reflect.dump
#   2. Download reflect.dump from the Replit file tree and copy it to this server.
#   3. Here run:                   ./deploy/restore.sh reflect.dump
#
# Use the same ENCRYPTION_KEY as on Replit in .env, or saved Kaspi / MoySklad / MCP tokens become
# unreadable and sellers have to enter them again (everything else keeps working).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL to the database you are moving from}"

dump="deploy/replit-$(date +%Y%m%d-%H%M).dump"
docker compose up -d db
echo "Dumping the source database…"
# pg_dump runs inside the postgres container, so nothing needs installing on the server.
docker compose exec -T db pg_dump "$SOURCE_DATABASE_URL" -Fc --no-owner --no-acl > "$dump"
echo "Saved $dump ($(du -h "$dump" | cut -f1))."
./deploy/restore.sh "$dump"
