#!/usr/bin/env bash
# Deletes a seller's account, or only the data they imported. Only the server administrator can do this:
# the app has neither a "delete account" nor a "delete data" button on purpose, so nobody can wipe a
# company's data from a regular login.
#
#   ./deploy/delete-account.sh seller@example.kz              whole account
#   ./deploy/delete-account.sh --data-only seller@example.kz  only imported data; account and connections stay
#
# Whole account: removes the user, sessions, orders, products, ad spend, imports, feedback, card events,
# campaigns, saved integrations (Kaspi / MoySklad / MCP tokens) and sync history.
# --data-only: removes orders, products, ad spend, imports, feedback and card events.
# A backup is taken first in both cases.
# The deleted data remains in older files in ./backups until BACKUP_KEEP_DAYS passes; delete those
# files too if the person asked for complete erasure.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=account
if [ "${1:-}" = "--data-only" ]; then mode=data; shift; fi
email="$(printf '%s' "${1:?usage: deploy/delete-account.sh [--data-only] <email>}" | tr '[:upper:]' '[:lower:]' | xargs)"

psql_db() { docker compose exec -T db psql -U reflect -d reflect -v ON_ERROR_STOP=1 -v email="$email" "$@"; }

found=$(psql_db -At <<'SQL'
select count(*) from users where email = :'email';
SQL
)
[ "$found" = "1" ] || { echo "No account with email $email" >&2; exit 1; }

echo "Account $email contains:"
psql_db <<'SQL'
select
  (select count(*) from orders o join users u on u.id = o.user_id where u.email = :'email') as orders,
  (select count(*) from products p join users u on u.id = p.user_id where u.email = :'email') as products,
  (select count(*) from integrations i join users u on u.id = i.user_id where u.email = :'email') as integrations,
  (select count(*) from external_campaigns c join users u on u.id = c.user_id where u.email = :'email') as campaigns;
SQL

echo
if [ "$mode" = "data" ]; then what="the imported data of $email (the account stays)"; else what="the whole account $email"; fi
read -r -p "About to delete $what. This cannot be undone. Type the email again to continue: " confirm
[ "$confirm" = "$email" ] || { echo "Not confirmed, nothing deleted."; exit 1; }

mkdir -p backups
backup="backups/before-delete-$(date +%Y%m%d-%H%M).dump"
docker compose exec -T db pg_dump -U reflect -d reflect -Fc > "$backup"
echo "Backup saved: $backup"

if [ "$mode" = "data" ]; then
  # One transaction: either everything is removed or nothing is.
  psql_db <<'SQL'
begin;
delete from orders where user_id = (select id from users where email = :'email');
delete from products where user_id = (select id from users where email = :'email');
delete from ad_spend where user_id = (select id from users where email = :'email');
delete from imports where user_id = (select id from users where email = :'email');
delete from feedback where user_id = (select id from users where email = :'email');
delete from card_events where user_id = (select id from users where email = :'email');
commit;
SQL
  echo "Deleted the imported data of $email."
else
  # Every table that holds seller data references users with ON DELETE CASCADE, so one DELETE clears them all.
  psql_db <<'SQL'
delete from users where email = :'email';
SQL
  echo "Deleted account $email."
fi
