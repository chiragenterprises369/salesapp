#!/usr/bin/env bash
# Backup scheduler (change #20). Default: one backup a day at BACKUP_TIME (HH:MM, container TZ, default 02:30).
# BACKUP_EVERY_HOURS=<n> runs every n hours instead. One-off commands:
#   docker compose ... --profile backup run --rm backup now
#   docker compose ... --profile backup run --rm backup restore <file> [--target-db name] [--yes]
set -euo pipefail

case "${1:-}" in
  now) exec /usr/local/bin/backup.sh ;;
  restore) shift; exec /usr/local/bin/restore.sh "$@" ;;
  list) exec ls -lh /backups ;;
esac

seconds_until() {
  local at="$1" now target
  now="$(date +%s)"
  target="$(date -d "today ${at}" +%s)"
  (( target <= now )) && target="$(date -d "tomorrow ${at}" +%s)"
  echo $(( target - now ))
}

if [[ -n "${BACKUP_EVERY_HOURS:-}" ]]; then
  echo "backup: every ${BACKUP_EVERY_HOURS} h, target ${BACKUP_TARGET:-none}"
  while true; do
    /usr/local/bin/backup.sh || echo "backup: run failed (see above)"
    sleep $(( BACKUP_EVERY_HOURS * 3600 ))
  done
fi

AT="${BACKUP_TIME:-02:30}"
[[ "$AT" =~ ^[0-2][0-9]:[0-5][0-9]$ ]] || { echo "BACKUP_TIME must be HH:MM"; exit 2; }
echo "backup: daily at ${AT} (TZ=${TZ:-UTC}), target ${BACKUP_TARGET:-none}"
while true; do
  sleep "$(seconds_until "$AT")"
  /usr/local/bin/backup.sh || echo "backup: run failed (see above)"
  sleep 60
done
