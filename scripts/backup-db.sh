#!/bin/sh
# Dump the database to a compressed file you keep, and prune old ones.
#
#   BACKUP_DATABASE_URL='postgresql://...neon.tech/...?sslmode=require' scripts/backup-db.sh
#
# Use Neon's *direct* connection string (not the pooled one). Uses pg_dump when it is installed, else Docker.
# Files go to ./backups (git-ignored, readable only by you); the newest KEEP (default 14) are kept.
# Restore: see docs/DEPLOY.md, "Backups".
set -eu

URL="${BACKUP_DATABASE_URL:-${1:-}}"
if [ -z "$URL" ]; then
  echo "Set BACKUP_DATABASE_URL (or pass the connection string as the first argument)." >&2
  exit 2
fi

DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DIR"
chmod 700 "$DIR"
OUT="$DIR/finwise-$(date +%Y%m%d-%H%M%S).sql.gz"
umask 077

# Plain SQL, no owners or privileges, so it restores into any database you point it at.
DUMP_ARGS="--no-owner --no-privileges --clean --if-exists"

if command -v pg_dump >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  pg_dump $DUMP_ARGS "$URL" | gzip > "$OUT"
elif command -v docker >/dev/null 2>&1; then
  # A host-local database is reached from the container through host.docker.internal.
  DOCKER_URL=$(printf '%s' "$URL" | sed -e 's#@localhost#@host.docker.internal#' -e 's#@127\.0\.0\.1#@host.docker.internal#')
  # shellcheck disable=SC2086
  docker run --rm postgres:17-alpine pg_dump $DUMP_ARGS "$DOCKER_URL" | gzip > "$OUT"
else
  echo "Neither pg_dump nor docker is installed." >&2
  exit 3
fi

# An empty or truncated file is a failed backup, not a backup.
if [ "$(gzip -dc "$OUT" | wc -c)" -lt 200 ]; then
  rm -f "$OUT"
  echo "The dump came out empty; nothing was kept." >&2
  exit 4
fi

# Keep the newest $KEEP.
ls -1t "$DIR"/finwise-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done

echo "Backed up to $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
