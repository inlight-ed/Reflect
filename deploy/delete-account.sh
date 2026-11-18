#!/usr/bin/env bash
# Deletes a seller's account, or only the data they imported. Only the server administrator can do this:
# the app has neither a "delete account" nor a "delete data" button on purpose, so nobody can wipe a
# company's data from a regular login.
#
#   ./deploy/delete-account.sh seller@example.kz              whole account
#   ./deploy/delete-account.sh --data-only seller@example.kz  only imported data; account and connections stay
#
# Data belongs to workspaces (a shop or an agency), not to people. Only workspaces where this person is
# the ONLY member are touched; shared workspaces (an agency with colleagues) keep their data, and the
# person is just taken out of them (if they were its only owner, the next member becomes owner).
# Whole account: removes the user and their sessions, plus their own workspaces with everything in
# them: orders, products, ad spend, imports, feedback, card events, campaigns, clients, media plans,
# saved integrations (Kaspi / MoySklad / MCP tokens) and sync history.
# --data-only: in their own workspaces removes orders, products, ad spend, imports, feedback, card
# events and media plans; the account, workspaces, clients and connections stay.
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

# Workspaces where this person is the only member: these are the ones that get deleted or emptied.
own_sql="select m.workspace_id from workspace_members m join users u on u.id = m.user_id where u.email = :'email'
  and not exists (select 1 from workspace_members o where o.workspace_id = m.workspace_id and o.user_id <> m.user_id)"

echo "Workspaces of $email:"
psql_db <<SQL
select w.name, w.kind, m.role,
  case when w.id in ($own_sql) then 'only member — affected' else 'shared — data stays' end as "what happens",
  (select count(*) from orders o where o.workspace_id = w.id) as orders,
  (select count(*) from products p where p.workspace_id = w.id) as products,
  (select count(*) from media_plans p where p.workspace_id = w.id) as media_plans,
  (select count(*) from integrations i where i.workspace_id = w.id) as integrations
from workspaces w join workspace_members m on m.workspace_id = w.id join users u on u.id = m.user_id
where u.email = :'email';
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
  psql_db <<SQL
begin;
delete from orders where workspace_id in ($own_sql);
delete from products where workspace_id in ($own_sql);
delete from ad_spend where workspace_id in ($own_sql);
delete from imports where workspace_id in ($own_sql);
delete from feedback where workspace_id in ($own_sql);
delete from card_events where workspace_id in ($own_sql);
delete from media_plans where workspace_id in ($own_sql);
commit;
SQL
  echo "Deleted the imported data in the workspaces only $email belongs to."
else
  # Every table that holds data references workspaces with ON DELETE CASCADE, so deleting the
  # person's own workspaces clears their data; deleting the user clears sessions and memberships.
  psql_db <<SQL
begin;
delete from workspaces where id in ($own_sql);
-- A shared workspace whose only owner is leaving gets the longest-standing other member as owner,
-- so nobody is locked out of managing it. An owner always sees every client, so a limit that heir
-- had on agency clients is lifted.
create temp table heirs on commit drop as
  select distinct on (o.workspace_id) o.workspace_id, o.user_id
  from workspace_members o
  join workspace_members gone on gone.workspace_id = o.workspace_id and gone.role = 'OWNER'
  join users u on u.id = gone.user_id and u.email = :'email'
  where o.user_id <> gone.user_id
    and not exists (select 1 from workspace_members x where x.workspace_id = o.workspace_id and x.role = 'OWNER' and x.user_id <> gone.user_id)
  order by o.workspace_id, o.created_at;
update workspace_members m set role = 'OWNER', all_clients = true
from heirs h
where m.workspace_id = h.workspace_id and m.user_id = h.user_id;
delete from workspace_member_clients c using heirs h
where c.workspace_id = h.workspace_id and c.user_id = h.user_id;
delete from users where email = :'email';
commit;
SQL
  echo "Deleted account $email and the workspaces only they belonged to."
fi
