#!/usr/bin/env bash
# Restore a KP Rück backup into a FRESH, EMPTY database – the other half of scripts/backup.sh.
#
#   scripts/restore.sh backups/daily/db-2026-07-30-033000.dump
#   scripts/restore.sh backups/weekly/db-2026-W31.dump --photos backups/weekly/photos-2026-W31.tar.gz
#
# Same libpq environment as backup.sh (PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD). It restores
# into $PGDATABASE, which must already exist and must be EMPTY – this script will not drop your
# production database for you, and it refuses to restore over occupied tables. Creating the
# empty target is one line and is in docs/DEPLOYMENT.md §6.1, deliberately typed by a human.
#
# Why a fresh database rather than a volume copy: the named use case for restoring is a laptop
# standing in for the station server – often macOS or WSL, often arm64 against amd64. A
# pg_dump/pg_restore pair crosses that; a copied data directory does not. Do not "optimise"
# this into a volume snapshot.
#
#   RESTORE_JOBS   parallel pg_restore workers (default 2; -Fc is what makes this possible)
#   PHOTOS_DIR     where to unpack the photo tarball (default /photos)
#
# After restoring, start the backend: `alembic upgrade head` runs on boot, so a dump from an
# OLDER release is migrated up automatically. A dump from a NEWER release is not – migrations
# only run forwards. Match or exceed the tag the dump came from.
set -euo pipefail

DUMP="${1:-}"
PHOTOS_TAR=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --photos) PHOTOS_TAR="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [ -z "$DUMP" ]; then
  sed -n '2,25p' "$0" | sed 's/^#\ \?//'
  exit 64
fi

export PGHOST="${PGHOST:-db}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-kprueck}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-kprueck}}"
if [ -n "${POSTGRES_PASSWORD:-}" ] && [ -z "${PGPASSWORD:-}" ]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi
JOBS="${RESTORE_JOBS:-2}"
PHOTOS_DIR="${PHOTOS_DIR:-/photos}"

log()  { printf '%s  %s\n' "$(date +%FT%T%z)" "$*"; }
fail() { printf '%s  ERROR  %s\n' "$(date +%FT%T%z)" "$*" >&2; exit "${2:-1}"; }

[ -f "$DUMP" ] || fail "dump file not found: $DUMP" 2

# 1. Is it a dump at all? Cheaper to find out now than after dropping something.
pg_restore --list "$DUMP" >/dev/null 2>&1 \
  || fail "$DUMP is not a readable pg_dump custom-format archive (was it taken with -Fc?)" 6

# 2. Version guard, the mirror of backup.sh's. pg_restore tolerates more than pg_dump does, but
#    an archive written by a newer major version can still carry constructs an older server does
#    not understand, and the failure arrives halfway through a half-restored database.
SERVER_VERSION="$(psql -Atqc 'SHOW server_version' 2>&1)" \
  || fail "cannot connect to $PGUSER@$PGHOST:$PGPORT/$PGDATABASE – $SERVER_VERSION" 3
SERVER_VERSION="${SERVER_VERSION%% *}"
CLIENT_VERSION="$(pg_restore --version | awk '{print $3}')"
if [ "${CLIENT_VERSION%%.*}" -lt "${SERVER_VERSION%%.*}" ]; then
  fail "pg_restore $CLIENT_VERSION is older than the server $SERVER_VERSION. Use a client >= ${SERVER_VERSION%%.*}, e.g. 'docker run --rm -v \$PWD:/b postgres:${SERVER_VERSION%%.*}-alpine pg_restore …'." 4
fi

# 3. Refuse to merge into a populated database. Restoring on top of existing rows produces a
#    database that looks restored and is actually a collision of two states.
TABLES="$(psql -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" -gt 0 ]; then
  fail "$PGDATABASE already has $TABLES tables in schema public. Restore needs an EMPTY database – drop and recreate it first (docs/DEPLOYMENT.md §6.1), then re-run." 5
fi

log "restoring $DUMP → $PGUSER@$PGHOST:$PGPORT/$PGDATABASE (server $SERVER_VERSION, pg_restore $CLIENT_VERSION)"
pg_restore --dbname "$PGDATABASE" --no-owner --no-privileges --exit-on-error --jobs "$JOBS" "$DUMP" \
  || fail "pg_restore failed – the database is now half-restored. Drop it, recreate it, and try another dump." 7

ROWS="$(psql -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
log "restored: $ROWS tables in schema public"

if [ -n "$PHOTOS_TAR" ]; then
  [ -f "$PHOTOS_TAR" ] || fail "photo tarball not found: $PHOTOS_TAR" 2
  [ -d "$PHOTOS_DIR" ] || fail "photo target $PHOTOS_DIR does not exist (mount the volume first)" 2
  tar tzf "$PHOTOS_TAR" >/dev/null 2>&1 || fail "photo tarball is not readable: $PHOTOS_TAR" 6
  log "unpacking photos into $PHOTOS_DIR (existing contents removed)"
  rm -rf "${PHOTOS_DIR:?}"/*
  tar xzf "$PHOTOS_TAR" -C "$PHOTOS_DIR"
  log "photos restored: $(find "$PHOTOS_DIR" -type f | wc -l | tr -d ' ') files"
else
  log "no --photos given: Reko photos were NOT restored. The record will point at missing images."
fi

log "✓ restore complete. Start the backend (migrations run on boot), then check the board, one incident with photos, and the Einsatztagebuch export."
