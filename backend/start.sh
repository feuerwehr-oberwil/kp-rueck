#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Port: ${PORT:-8000}"

# Set up photo storage directory
PHOTOS_DIR="${PHOTOS_DIR:-data/photos}"
echo "Photo storage directory: ${PHOTOS_DIR}"

# Create photos directory if it doesn't exist
if [ ! -d "${PHOTOS_DIR}" ]; then
    echo "Creating photos directory: ${PHOTOS_DIR}"
    mkdir -p "${PHOTOS_DIR}"
fi

# Verify directory is writable
if [ ! -w "${PHOTOS_DIR}" ]; then
    echo "ERROR: Photos directory is not writable: ${PHOTOS_DIR}"
    exit 1
fi

echo "Photos directory ready: ${PHOTOS_DIR}"

# --- Snapshot before migrating ------------------------------------------------------------
# A migration that fails ends this container; `restart: unless-stopped` starts a new one and
# the old one is already gone. Without a dump taken a second earlier there is no way back to
# the schema that worked — and the schema that worked is where the incident record lives.
#
# A nonempty database must have a verified snapshot before its schema changes. A failed
# backup stops this boot, so the previous release can still run against the unchanged DB.
# PREMIGRATION_BACKUP=false is an explicit operator override after arranging another backup.
# This is not the nightly backup: no photos, same host, and only pending migrations trigger it.
PREMIGRATION_DIR="${PREMIGRATION_BACKUP_DIR:-/mnt/data/backups}"
PREMIGRATION_KEEP="${PREMIGRATION_BACKUP_KEEP:-5}"

snapshot_failure() {
    echo "ERROR: pre-migration snapshot failed: $1. Migration NOT started." >&2
    echo "ERROR: fix the backup, or explicitly set PREMIGRATION_BACKUP=false after arranging a verified backup." >&2
    if [ -d "$PREMIGRATION_DIR" ] && [ -w "$PREMIGRATION_DIR" ]; then
        date -Iseconds > "$PREMIGRATION_DIR/SNAPSHOT-FAILED" 2>/dev/null || true
    fi
    return 1
}

snapshot_before_migrate() {
    if [ "${PREMIGRATION_BACKUP:-true}" = "false" ]; then
        echo "Pre-migration snapshot disabled (PREMIGRATION_BACKUP=false)"
        return 0
    fi
    if [ "${PREMIGRATION_BACKUP:-true}" != "true" ]; then
        snapshot_failure "PREMIGRATION_BACKUP must be true or false"
        return 1
    fi

    # Do not hide a failed status query in a pipeline: that can mean an unreachable DB or
    # an older image which cannot read the installed revision. Neither is permission to migrate.
    local current_output heads_output current heads
    if ! current_output="$(uv run alembic current 2>/dev/null)"; then
        snapshot_failure "cannot read the installed Alembic revision (check connectivity and release compatibility)"
        return 1
    fi
    if ! heads_output="$(uv run alembic heads 2>/dev/null)"; then
        snapshot_failure "cannot read this image's Alembic heads"
        return 1
    fi
    # Compare the complete revision sets, including non-hex and multiple revision names.
    current="$(printf '%s\n' "$current_output" | sed -nE 's/^([A-Za-z0-9_.-]+)( \(.*\))?$/\1/p' | sort)"
    heads="$(printf '%s\n' "$heads_output" | sed -nE 's/^([A-Za-z0-9_.-]+)( \(.*\))?$/\1/p' | sort)"
    if [ -z "$heads" ]; then
        snapshot_failure "this image reports no migration head"
        return 1
    fi
    if [ -n "$current" ] && [ "$current" = "$heads" ]; then
        echo "Schema already at head - no pre-migration snapshot needed"
        return 0
    fi

    # pg_dump speaks libpq; SQLAlchemy adds its driver suffix to the URL.
    local dump_url="${DATABASE_URL/+asyncpg/}"
    dump_url="${dump_url/+psycopg2/}"
    local tables
    if ! tables="$(psql "$dump_url" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null)"; then
        snapshot_failure "cannot determine whether the database is empty"
        return 1
    fi
    if [ "$tables" = "0" ]; then
        echo "Fresh empty database - no pre-migration snapshot needed"
        return 0
    fi
    case "$tables" in ''|*[!0-9]*) snapshot_failure "invalid database table count"; return 1 ;; esac

    echo "Pending migration - taking a snapshot first"
    case "$PREMIGRATION_KEEP" in ''|*[!0-9]*) snapshot_failure "PREMIGRATION_BACKUP_KEEP must be a positive integer"; return 1 ;; esac
    if [ "$PREMIGRATION_KEEP" -lt 1 ]; then
        snapshot_failure "PREMIGRATION_BACKUP_KEEP must keep at least one snapshot"
        return 1
    fi
    if ! mkdir -p "$PREMIGRATION_DIR" 2>/dev/null || [ ! -w "$PREMIGRATION_DIR" ]; then
        snapshot_failure "backup directory is not writable"
        return 1
    fi
    if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
        snapshot_failure "pg_dump/pg_restore is missing from this image"
        return 1
    fi

    local server client
    if ! server="$(psql "$dump_url" -Atqc 'SHOW server_version' 2>/dev/null)"; then
        snapshot_failure "cannot read the PostgreSQL server version"
        return 1
    fi
    server="${server%%.*}"
    client="$(pg_dump --version | awk '{print $3}' | cut -d. -f1)"
    case "$server:$client" in *[!0-9:]*|:*|*:) snapshot_failure "invalid PostgreSQL version"; return 1 ;; esac
    if [ "$client" -lt "$server" ]; then
        snapshot_failure "pg_dump $client is older than PostgreSQL $server; install a matching client"
        return 1
    fi

    local target
    target="$PREMIGRATION_DIR/premigration-$(date +%F-%H%M%S)-$$.dump"
    # Private, custom-format archive, checked before it counts as a snapshot.
    if (umask 077; pg_dump -Fc --no-owner --no-privileges -f "$target.part" "$dump_url") \
       && [ -s "$target.part" ] \
       && pg_restore --list "$target.part" >/dev/null 2>&1; then
        mv "$target.part" "$target"
        rm -f "$PREMIGRATION_DIR/SNAPSHOT-FAILED"
        echo "Pre-migration snapshot: $target ($(wc -c < "$target" | tr -d ' ') bytes, verified readable)"
        find "$PREMIGRATION_DIR" -maxdepth 1 -name 'premigration-*.dump' -type f 2>/dev/null \
            | sort -r | tail -n +"$((PREMIGRATION_KEEP + 1))" \
            | while IFS= read -r old; do
                rm -f -- "$old" || echo "WARNING: could not prune old snapshot: $old" >&2
              done
        return 0
    else
        rm -f "$target.part"
        snapshot_failure "dump creation or archive verification failed"
        return 1
    fi
}

snapshot_before_migrate

# Run Alembic migrations
echo "Running database migrations..."
uv run alembic upgrade head

# Seed the database (will skip if already seeded)
echo "Seeding database..."
uv run python -m app.seed

# Ensure shared accounts exist even on an already-seeded DB (no-op unless the
# corresponding env vars are set). Creates/rotates the read-only viewer login.
echo "Ensuring service accounts..."
uv run python -m app.ensure_accounts

# Start the application
echo "Starting Uvicorn server on 0.0.0.0:${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "0.0.0.0" --port "${PORT:-8000}"
