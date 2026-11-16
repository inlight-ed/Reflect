#!/bin/sh
# Runs inside the "backup" container: one compressed dump a day at about 03:00 server time.
set -eu
mkdir -p /backups
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 03:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  # The first dump happens right after start, so a fresh install has a backup at once.
  if [ ! -f /backups/.started ]; then touch /backups/.started; else sleep $((next - now)); fi
  file="/backups/reflect-$(date +%Y-%m-%d_%H%M).dump"
  if pg_dump -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.tmp"
    echo "backup: FAILED" >&2
  fi
  find /backups -name 'reflect-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
done
