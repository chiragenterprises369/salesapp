#!/usr/bin/env bash
# Vistar database backup (change #20).
#  1. pg_dump --format=custom (compressed, restorable table by table) into /backups/vistar-<UTC timestamp>.dump
#  2. optional AES-256 encryption with BACKUP_ENCRYPTION_PASSPHRASE (openssl, PBKDF2) -> .dump.enc
#  3. sha256 file next to it
#  4. upload to BACKUP_TARGET: s3 (any S3 API: AWS, MinIO, Bunny S3, R2), bunny (Bunny Storage HTTP API) or none
#  5. retention: local files older than BACKUP_KEEP_LOCAL_DAYS, remote objects older than BACKUP_KEEP_REMOTE_DAYS
#  6. optional ping to BACKUP_HEALTHCHECK_URL (healthchecks.io style) on success, <url>/fail on failure
# Exit code non-zero on any failure. Never prints passwords.
set -euo pipefail

DIR=/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="vistar-${STAMP}.dump"
TARGET="${BACKUP_TARGET:-none}"
KEEP_LOCAL="${BACKUP_KEEP_LOCAL_DAYS:-7}"
KEEP_REMOTE="${BACKUP_KEEP_REMOTE_DAYS:-30}"
NAME_RE='^vistar-[0-9]{8}T[0-9]{6}Z\.dump'

log() { echo "$(date -u +%FT%TZ) backup: $*"; }
ping_hc() {
  [[ -n "${BACKUP_HEALTHCHECK_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 "${BACKUP_HEALTHCHECK_URL}${1:-}" > /dev/null || true
}
fail() {
  log "FAILED: $*"
  rm -f "$DIR/$BASE.partial"
  ping_hc /fail
  exit 1
}
older_than_cutoff() { # <object name> <cutoff stamp>
  local ts="${1#vistar-}"
  ts="${ts%%.*}"
  [[ "$ts" < "$2" ]]
}

mkdir -p "$DIR"
log "dumping ${PGDATABASE:-vistar} from ${PGHOST:-postgres}"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$DIR/$BASE.partial" || fail "pg_dump"
mv "$DIR/$BASE.partial" "$DIR/$BASE"
FILE="$BASE"

if [[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$DIR/$BASE" -out "$DIR/$BASE.enc" -pass env:BACKUP_ENCRYPTION_PASSPHRASE || fail "encrypt"
  rm -f "$DIR/$BASE"
  FILE="$BASE.enc"
fi
( cd "$DIR" && sha256sum "$FILE" > "$FILE.sha256" ) || fail "checksum"
log "wrote $FILE ($(du -h "$DIR/$FILE" | cut -f1))"

CUTOFF="$(date -u -d "-${KEEP_REMOTE} days" +%Y%m%dT%H%M%SZ)"
case "$TARGET" in
  s3)
    : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required for BACKUP_TARGET=s3}"
    export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?}" AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?}" AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-ap-south-1}"
    EP=()
    [[ -n "${BACKUP_S3_ENDPOINT:-}" ]] && EP=(--endpoint-url "$BACKUP_S3_ENDPOINT")
    PREFIX="${BACKUP_S3_PREFIX:-vistar/db}"
    aws "${EP[@]}" s3 cp --only-show-errors "$DIR/$FILE" "s3://$BACKUP_S3_BUCKET/$PREFIX/$FILE" || fail "upload"
    aws "${EP[@]}" s3 cp --only-show-errors "$DIR/$FILE.sha256" "s3://$BACKUP_S3_BUCKET/$PREFIX/$FILE.sha256" || fail "upload checksum"
    log "uploaded to s3://$BACKUP_S3_BUCKET/$PREFIX/$FILE"
    KEYS="$(aws "${EP[@]}" s3 ls "s3://$BACKUP_S3_BUCKET/$PREFIX/" | awk '{print $4}' | grep -E "$NAME_RE" || true)"
    for key in $KEYS; do
      if older_than_cutoff "$key" "$CUTOFF"; then
        aws "${EP[@]}" s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$PREFIX/$key" && log "removed remote $key" || log "could not remove remote $key"
      fi
    done
    ;;
  bunny)
    ZONE="${BACKUP_BUNNY_STORAGE_ZONE:?BACKUP_BUNNY_STORAGE_ZONE is required for BACKUP_TARGET=bunny}"
    : "${BACKUP_BUNNY_PASSWORD:?BACKUP_BUNNY_PASSWORD is required for BACKUP_TARGET=bunny}"
    HOST="${BACKUP_BUNNY_REGION_HOST:-storage.bunnycdn.com}"
    PREFIX="${BACKUP_BUNNY_PREFIX:-vistar/db}"
    for f in "$FILE" "$FILE.sha256"; do
      curl -fsS -m 3600 --retry 3 -X PUT -H "AccessKey: ${BACKUP_BUNNY_PASSWORD}" -H 'Content-Type: application/octet-stream' \
        --data-binary "@$DIR/$f" "https://$HOST/$ZONE/$PREFIX/$f" > /dev/null || fail "upload $f"
    done
    log "uploaded to bunny://$ZONE/$PREFIX/$FILE"
    LISTING="$(curl -fsS -m 60 -H "AccessKey: ${BACKUP_BUNNY_PASSWORD}" "https://$HOST/$ZONE/$PREFIX/" || echo '[]')"
    KEYS="$(echo "$LISTING" | jq -r '.[] | select(.IsDirectory == false) | .ObjectName' | grep -E "$NAME_RE" || true)"
    for key in $KEYS; do
      if older_than_cutoff "$key" "$CUTOFF"; then
        curl -fsS -m 60 -X DELETE -H "AccessKey: ${BACKUP_BUNNY_PASSWORD}" "https://$HOST/$ZONE/$PREFIX/$key" > /dev/null && log "removed remote $key" || log "could not remove remote $key"
      fi
    done
    ;;
  none)
    log "BACKUP_TARGET=none: kept on the server only (copy the backups volume off the server)"
    ;;
  *)
    fail "unknown BACKUP_TARGET=$TARGET (s3, bunny or none)"
    ;;
esac

find "$DIR" -maxdepth 1 -type f -name 'vistar-*.dump*' -mtime "+$KEEP_LOCAL" -print -delete 2> /dev/null | sed 's/^/backup: removed local /' || true
ping_hc
log "done"
