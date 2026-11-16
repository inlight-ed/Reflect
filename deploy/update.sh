#!/usr/bin/env bash
# Installs a new version: run from the project folder after replacing the code (git pull or unzip).
# A backup is taken first; the schema is updated; then the app restarts (about 10 s offline).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose build app migrate
docker compose exec -T db sh -c 'pg_dump -U reflect -d reflect -Fc' > "backups/before-update-$(date +%Y%m%d-%H%M).dump"
docker compose run --rm migrate
docker compose up -d
docker image prune -f >/dev/null
echo "Updated. Check: docker compose ps && docker compose logs --tail=50 app"
