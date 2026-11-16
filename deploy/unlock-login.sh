#!/usr/bin/env bash
# Lifts the sign-in block of one email address (3 wrong passwords block it for 15 minutes).
#   ./deploy/unlock-login.sh seller@example.kz
set -euo pipefail
cd "$(dirname "$0")/.."
email="$(printf '%s' "${1:?usage: deploy/unlock-login.sh <email>}" | tr '[:upper:]' '[:lower:]' | xargs)"
# Same key as the app: login:<sha256 of the lower-cased email>
key="login:$(printf '%s' "$email" | sha256sum | cut -d' ' -f1)"
removed=$(docker compose exec -T db psql -U reflect -d reflect -At -v ON_ERROR_STOP=1 -v key="$key" <<'SQL'
with gone as (delete from rate_limits where key = :'key' returning 1) select count(*) from gone;
SQL
)
if [ "$removed" = "1" ]; then echo "Unlocked $email."; else echo "$email was not blocked."; fi
