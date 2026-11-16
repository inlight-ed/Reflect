#!/bin/sh
# Runs inside the "backup" container: one compressed dump a day at 03:00 container time (UTC, which is
# 08:00 in Almaty). Keeps BACKUP_KEEP_DAYS days of daily dumps and BACKUP_KEEP_SAFETY_DAYS days of the
# "before-update" / "before-delete" copies that the other scripts take.
set -eu
mkdir -p /backups
while true; do
  # Seconds until the next 03:00, using only arithmetic (busybox `date -d` is not reliable).
  # (leading zeros are stripped by hand: 08 and 09 are not valid numbers in a plain shell)
  h=$(date +%H); m=$(date +%M); s=$(date +%S)
  h=${h#0}; m=${m#0}; s=${s#0}
  since_midnight=$((${h:-0} * 3600 + ${m:-0} * 60 + ${s:-0}))
  wait=$((3 * 3600 - since_midnight))
  [ "$wait" -le 0 ] && wait=$((wait + 86400))
  # The first dump happens right after start, so a fresh install has a backup at once.
  if [ ! -f /backups/.started ]; then touch /backups/.started; else sleep "$wait"; fi
  file="/backups/reflect-$(date +%Y-%m-%d_%H%M).dump"
  if pg_dump -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup: FAILED" >&2
  fi
  find /backups -name 'reflect-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  find /backups \( -name 'before-update-*.dump' -o -name 'before-delete-*.dump' \) -mtime +"${BACKUP_KEEP_SAFETY_DAYS:-60}" -delete
done
