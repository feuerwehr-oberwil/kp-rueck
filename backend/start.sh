#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, DATABASE_URL=${DATABASE_URL:0:30}..."

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
# Deliberately BEST-EFFORT, not blocking: a station whose board is down because its backup
# directory is full is worse off than one running on an unsnapshotted migration. So every
# failure here warns loudly, leaves a marker file, and lets the boot continue.
#
# This is not the nightly backup (scripts/backup.sh) and does not replace it: no photos, kept
# on the same host, and it only fires when there is actually a migration to run.
PREMIGRATION_DIR="${PREMIGRATION_BACKUP_DIR:-/mnt/data/backups}"
PREMIGRATION_KEEP="${PREMIGRATION_BACKUP_KEEP:-5}"

snapshot_before_migrate() {
    if [ "${PREMIGRATION_BACKUP:-true}" != "true" ]; then
        echo "Pre-migration snapshot disabled (PREMIGRATION_BACKUP=false)"
        return 0
    fi

    # Nothing to migrate → nothing to snapshot. This is what keeps a plain restart cheap; only
    # a deploy that actually changes the schema pays for a dump.
    local current heads
    current="$(uv run alembic current 2>/dev/null | grep -oE '^[0-9a-f]{6,}' | head -n1 || true)"
    heads="$(uv run alembic heads 2>/dev/null | grep -oE '^[0-9a-f]{6,}' | head -n1 || true)"
    if [ -n "$current" ] && [ "$current" = "$heads" ]; then
        echo "Schema already at head ($current) - no pre-migration snapshot needed"
        return 0
    fi
    echo "Pending migration ($current -> $heads) - taking a snapshot first"

    if ! mkdir -p "$PREMIGRATION_DIR" 2>/dev/null || [ ! -w "$PREMIGRATION_DIR" ]; then
        echo "WARNING: pre-migration snapshot SKIPPED - $PREMIGRATION_DIR is not writable." >&2
        echo "WARNING: the migration below runs with no way back. Fix the volume mount." >&2
        return 0
    fi

    if ! command -v pg_dump >/dev/null 2>&1; then
        echo "WARNING: pre-migration snapshot SKIPPED - pg_dump is not in this image." >&2
        return 0
    fi

    # pg_dump speaks libpq, SQLAlchemy speaks +asyncpg. Strip the driver suffix.
    local dump_url="${DATABASE_URL/+asyncpg/}"
    dump_url="${dump_url/+psycopg2/}"

    # The mismatch that bites in practice: Debian bookworm's `postgresql-client` is 15, and
    # production runs Postgres 17.x, where pg_dump 15 refuses with "server version mismatch".
    # The Dockerfile pins the PGDG client for that reason; check anyway, because the SERVER is
    # the part a station can upgrade without touching this image.
    local server client
    server="$(psql "$dump_url" -Atqc 'SHOW server_version' 2>/dev/null | cut -d. -f1 || true)"
    client="$(pg_dump --version | awk '{print $3}' | cut -d. -f1)"
    if [ -n "$server" ] && [ "$client" -lt "$server" ]; then
        echo "WARNING: pre-migration snapshot SKIPPED - pg_dump $client cannot dump a Postgres $server server." >&2
        echo "WARNING: rebuild the backend image with postgresql-client-$server. Migrating WITHOUT a snapshot." >&2
        return 0
    fi

    local target
    target="$PREMIGRATION_DIR/premigration-$(date +%F-%H%M%S).dump"
    # -Fc so pg_restore can list it and pull single tables out; see scripts/backup.sh.
    if pg_dump -Fc --no-owner --no-privileges -f "$target.part" "$dump_url" \
       && [ -s "$target.part" ] \
       && pg_restore --list "$target.part" >/dev/null 2>&1; then
        mv "$target.part" "$target"
        echo "Pre-migration snapshot: $target ($(wc -c < "$target" | tr -d ' ') bytes, verified readable)"
        # Keep the newest few. These are insurance for the deploy happening right now, not an
        # archive — the archive is scripts/backup.sh. Sorted by NAME (the stamp is in it), for
        # the same reason as scripts/backup.sh's prune(): mtimes lie after a copy.
        find "$PREMIGRATION_DIR" -maxdepth 1 -name 'premigration-*.dump' -type f 2>/dev/null \
            | sort -r | tail -n +"$((PREMIGRATION_KEEP + 1))" \
            | while read -r old; do rm -f -- "$old"; done
    else
        rm -f "$target.part"
        echo "WARNING: pre-migration snapshot FAILED - migrating anyway, with no way back." >&2
        echo "WARNING: check disk space on $PREMIGRATION_DIR and the database credentials." >&2
        date -Iseconds > "$PREMIGRATION_DIR/SNAPSHOT-FAILED" 2>/dev/null || true
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
