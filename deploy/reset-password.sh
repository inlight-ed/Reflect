#!/usr/bin/env bash
# Creates a one-time link for setting a new password, for when email is not configured
# (SMTP_URL in .env) or the letter did not arrive. Send the link to the seller yourself.
# It works once, for 1 hour; using it signs the seller out everywhere.
#   ./deploy/reset-password.sh seller@example.kz
set -euo pipefail
cd "$(dirname "$0")/.."
email="$(printf '%s' "${1:?usage: deploy/reset-password.sh <email>}" | tr '[:upper:]' '[:lower:]' | xargs)"
base="$(grep -E '^PUBLIC_URL=' .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
if [ -z "$base" ]; then
  domain="$(grep -E '^DOMAIN=' .env | tail -n1 | cut -d= -f2-)"
  base="https://${domain:?DOMAIN is not set in .env}"
fi
token="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
# The app stores only sha256(token), hex-encoded; the same here.
hash="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
created=$(docker compose exec -T db psql -U reflect -d reflect -At -v ON_ERROR_STOP=1 -v email="$email" -v hash="$hash" <<'SQL'
with target as (select id from users where email = :'email'),
     added as (
       insert into password_resets (token_hash, user_id, expires_at)
       select :'hash', id, now() + interval '1 hour' from target
       returning 1)
select count(*) from added;
SQL
)
if [ "$created" != "1" ]; then
  echo "No account with the email $email." >&2
  exit 1
fi
echo "Link for $email (works once, for 1 hour):"
echo "${base%/}/reset-password?token=$token"
