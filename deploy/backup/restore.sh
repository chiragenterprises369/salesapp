#!/usr/bin/env bash
# Restore a Vistar backup (change #20). Usage inside the backup container:
#   restore.sh <file in /backups | s3 key | bunny object name> [--target-db <name>] [--yes]
# Default target database: vistar_restore (a NEW database next to the live one), so you can check it before
# switching. Restoring over the live database needs --target-db vistar AND --yes, and the API must be stopped.
# Steps: download when needed, verify the sha256, decrypt (BACKUP_ENCRYPTION_PASSPHRASE), create the database,
# pg_restore --no-owner --no-privileges --exit-on-error, ANALYZE.
set -euo pipefail

SRC="${1:?usage: restore.sh <backup file> [--target-db name] [--yes]}"
shift
DB=vistar_restore
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-db) DB="${2:?}"; shift 2 ;;
    --yes) YES=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

log() { echo "$(date -u +%FT%TZ) restore: $*"; }
WORK=/backups/restore-tmp
mkdir -p "$WORK"
NAME="$(basename "$SRC")"

if [[ -f "/backups/$NAME" ]]; then
  cp "/backups/$NAME" "$WORK/$NAME"
  [[ -f "/backups/$NAME.sha256" ]] && cp "/backups/$NAME.sha256" "$WORK/"
elif [[ "${BACKUP_TARGET:-none}" == "s3" ]]; then
  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?}" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?}" AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-ap-south-1}"
  EP=()
  [[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && EP=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  PREFIX="${BACKUP_S3_PREFIX:-vistar/db}"
  aws "${EP[@]}" s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$PREFIX/$NAME" "$WORK/$NAME"
  aws "${EP[@]}" s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$PREFIX/$NAME.sha256" "$WORK/$NAME.sha256" || true
elif [[ "${BACKUP_TARGET:-none}" == "bunny" ]]; then
  HOST="${BACKUP_BUNNY_REGION_HOST:-storage.bunnycdn.com}"
  PREFIX="${BACKUP_BUNNY_PREFIX:-vistar/db}"
  curl -fsS -H "AccessKey: ${BACKUP_BUNNY_PASSWORD:?}" -o "$WORK/$NAME" "https://$HOST/${BACKUP_BUNNY_STORAGE_ZONE:?}/$PREFIX/$NAME"
  curl -fsS -H "AccessKey: ${BACKUP_BUNNY_PASSWORD}" -o "$WORK/$NAME.sha256" "https://$HOST/$BACKUP_BUNNY_STORAGE_ZONE/$PREFIX/$NAME.sha256" || true
else
  echo "backup $NAME not found in /backups and no remote target configured"; exit 1
fi

if [[ -f "$WORK/$NAME.sha256" ]]; then
  ( cd "$WORK" && sha256sum -c "$NAME.sha256" ) || { echo "checksum mismatch"; exit 1; }
  log "checksum ok"
else
  log "no checksum file: skipping verification"
fi

DUMP="$WORK/$NAME"
if [[ "$NAME" == *.enc ]]; then
  : "${BACKUP_ENCRYPTION_PASSPHRASE:?the backup is encrypted: set BACKUP_ENCRYPTION_PASSPHRASE}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$DUMP" -out "${DUMP%.enc}" -pass env:BACKUP_ENCRYPTION_PASSPHRASE
  DUMP="${DUMP%.enc}"
  log "decrypted"
fi

if [[ "$DB" == "${PGDATABASE:-vistar}" && "$YES" != 1 ]]; then
  echo "Refusing to restore over the live database '$DB' without --yes (stop the api and web first)."; exit 1
fi

EXISTS="$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB'")"
if [[ "$EXISTS" == "1" ]]; then
  if [[ "$YES" != 1 ]]; then echo "Database $DB exists: add --yes to drop and recreate it"; exit 1; fi
  psql -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" > /dev/null
  psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$DB\";"
fi
psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\";"
log "restoring into $DB"
pg_restore --dbname="$DB" --no-owner --no-privileges --exit-on-error --jobs=2 "$DUMP"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "ANALYZE;" > /dev/null
rm -rf "$WORK"
log "done: database $DB restored from $NAME"
