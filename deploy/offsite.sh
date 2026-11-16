#!/bin/sh
# Runs inside the optional "offsite" container (docker compose --profile offsite up -d offsite):
# copies the dumps from /backups to a remote storage kept somewhere else, so losing this server does not
# lose the backups. Nothing happens until BACKUP_REMOTE is set in .env (see DEPLOY.md, section 13).
set -eu
if [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "offsite: BACKUP_REMOTE is not set in .env, nothing to do. See DEPLOY.md, section 13." >&2
  exit 1
fi
echo "offsite: copying /backups to $BACKUP_REMOTE every ${BACKUP_OFFSITE_EVERY_HOURS:-6} h"
while true; do
  # copy, not sync: a dump deleted here by mistake or by retention is never deleted from the remote by this job.
  if rclone copy /backups "$BACKUP_REMOTE" --include "reflect-*.dump" --include "before-update-*.dump" --include "before-delete-*.dump" --min-age 1m; then
    echo "offsite: copied at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  else
    echo "offsite: FAILED, will retry" >&2
  fi
  # The remote has its own, longer retention (BACKUP_REMOTE_KEEP_DAYS, default 60).
  rclone delete "$BACKUP_REMOTE" --min-age "${BACKUP_REMOTE_KEEP_DAYS:-60}d" --include "*.dump" || echo "offsite: cleanup failed" >&2
  sleep $((${BACKUP_OFFSITE_EVERY_HOURS:-6} * 3600))
done
