#!/usr/bin/env bash
# Pull a real deployment's database into the local DEV stack – so a fresh checkout
# needs zero configuration: `just dev`, `just dev-sync <source>`, and the board runs
# with the station's actual settings, fleet, roster and material.
#
#   scripts/dev-sync.sh SOURCE [--config] [--yes]
#
#   SOURCE      a Postgres URL (postgres://user:pass@host:port/db) – any provider,
#               any tunnel. Or the word `railway`: resolves DATABASE_PUBLIC_URL from
#               the linked Railway project (read-only; needs `railway` CLI, linked;
#               the database service is called `Postgres` unless RAILWAY_DB_SERVICE
#               says otherwise).
#   --config    configuration only: settings, users, fleet, roster, material, groups,
#               templates, training locations – but NO Einsätze, no audit trail, no
#               notifications. What "set up like the station" needs without dragging
#               operational history onto a laptop.
#   --yes       skip the confirmation prompt.
#
# DEV ONLY, BY CONSTRUCTION. Everything runs through the kprueck-db-dev container –
# if the dev stack is not up, this script refuses to start, and there is no way to
# point the WRITE side anywhere else. The SOURCE is only ever read (pg_dump).
#
# The current dev database is not thrown away: before the wipe it is dumped to
# ./backups/dev-sync-replaced-<timestamp>.dump. Restore it the same way any backup
# is restored (scripts/restore.sh) if the sync took something you still needed.
#
# What a sync does, in order:
#   1. pg_dump SOURCE from inside the db container (client and server stay in step)
#   2. safety-dump the current dev DB to ./backups/
#   3. drop + recreate the dev database, restore the dump (full, or --config subset)
#   4. alembic upgrade head – a dump from an older release is migrated up
#   5. re-seed the dev logins (admin/editor/viewer + the auth-bypass user), so
#      `just dev` credentials keep working regardless of whose users came along
#   6. restart the dev backend so its connection pool forgets the old database
#
# Photos are NOT synced – Reko photos live in a volume next to the deployment, not
# in Postgres. Cards whose photos stayed behind show broken images; that is honest.
set -euo pipefail

DB_CONTAINER="kprueck-db-dev"
BACKEND_CONTAINER="kprueck-backend-dev"
DEV_DB="kprueck"
DEV_USER="kprueck"

# The --config allowlist: tables that ARE configuration. Data for every other table
# is skipped on restore (the schema always comes over completely). A new config
# table must be added here, or --config will silently leave it empty – the full
# sync needs no such maintenance.
CONFIG_TABLES=(
  # Not configuration, but must ALWAYS come over: without the migration stamp the
  # restored schema claims to be unmigrated and `alembic upgrade head` re-runs
  # every migration into already-existing tables.
  alembic_version
  users
  settings
  vehicles
  personnel
  personnel_external_identities
  material_groups
  materials
  special_function_types
  emergency_templates
  training_locations
  auftrag_templates
  auftrag_template_resources
)

SOURCE="" ; CONFIG_ONLY=false ; ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --config) CONFIG_ONLY=true ;;
    --yes)    ASSUME_YES=true ;;
    --help|-h) sed -n '2,37p' "$0" | sed 's/^#\ \?//'; exit 0 ;;
    -*) echo "unknown flag: $arg" >&2; exit 64 ;;
    *)  SOURCE="$arg" ;;
  esac
done

if [ -z "$SOURCE" ]; then
  sed -n '2,37p' "$0" | sed 's/^#\ \?//'
  exit 64
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "ERROR: $DB_CONTAINER is not running – this tool only fills the dev stack. Start it: just dev" >&2
  exit 1
fi

# `railway` resolves to the linked project's public URL. Read-only: we only ever
# ask Railway what the URL is, and only ever pg_dump it.
if [ "$SOURCE" = "railway" ]; then
  if ! command -v railway >/dev/null; then
    echo "ERROR: railway CLI not installed – pass the Postgres URL directly instead." >&2
    exit 1
  fi
  SOURCE="$(railway variables --json --service "${RAILWAY_DB_SERVICE:-Postgres}" 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("DATABASE_PUBLIC_URL",""))')" || SOURCE=""
  if [ -z "$SOURCE" ]; then
    echo "ERROR: could not read DATABASE_PUBLIC_URL from the linked Railway project." >&2
    echo "       railway link first, set RAILWAY_DB_SERVICE if the DB service is not" >&2
    echo "       called 'Postgres' – or pass the Postgres URL directly." >&2
    exit 1
  fi
  echo "→ Source: DATABASE_PUBLIC_URL of the linked Railway project"
fi

# SQLAlchemy spells the driver into its URLs; libpq does not want it.
SOURCE="${SOURCE/postgresql+asyncpg:\/\//postgresql://}"

if ! $ASSUME_YES; then
  MODE_TEXT="EVERYTHING (settings, inventory, Einsätze, users)"
  $CONFIG_ONLY && MODE_TEXT="configuration only (no Einsätze, no audit trail)"
  echo "This replaces the local dev database '$DEV_DB' with $MODE_TEXT from the source."
  echo "A safety dump of the current dev DB is written to ./backups/ first."
  printf "Continue? [y/N] "
  read -r REPLY
  case "$REPLY" in y|Y|yes) ;; *) echo "Aborted."; exit 1 ;; esac
fi

STAMP="$(date +%Y-%m-%d-%H%M%S)"
DUMP_IN_CONTAINER="/tmp/kp-dev-sync.dump"

echo "→ Dumping source database (read-only) …"
docker exec "$DB_CONTAINER" pg_dump --no-owner --no-privileges -Fc \
  -d "$SOURCE" -f "$DUMP_IN_CONTAINER"

echo "→ Safety dump of the current dev DB → backups/dev-sync-replaced-$STAMP.dump"
mkdir -p backups
docker exec "$DB_CONTAINER" pg_dump --no-owner --no-privileges -Fc \
  -U "$DEV_USER" -d "$DEV_DB" -f "/tmp/kp-dev-sync-safety.dump"
docker cp "$DB_CONTAINER:/tmp/kp-dev-sync-safety.dump" "backups/dev-sync-replaced-$STAMP.dump"
docker exec "$DB_CONTAINER" rm -f /tmp/kp-dev-sync-safety.dump

echo "→ Recreating the dev database …"
docker exec "$DB_CONTAINER" psql -U "$DEV_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DEV_DB WITH (FORCE)" \
  -c "CREATE DATABASE $DEV_DB OWNER $DEV_USER"

if $CONFIG_ONLY; then
  echo "→ Restoring schema + configuration data only …"
  # pg_restore -l lists every item in the dump; we keep everything except TABLE DATA
  # for non-config tables. Schema, constraints and sequences always come over.
  KEEP_REGEX="$(IFS='|'; echo "${CONFIG_TABLES[*]}")"
  docker exec "$DB_CONTAINER" pg_restore -l "$DUMP_IN_CONTAINER" \
    | awk -v keep="^(${KEEP_REGEX})\$" '
        !/ TABLE DATA / { print; next }
        { if ($(NF-1) ~ keep) print }
      ' \
    | docker exec -i "$DB_CONTAINER" bash -c "cat > /tmp/kp-dev-sync.list"
  docker exec "$DB_CONTAINER" pg_restore --no-owner --no-privileges \
    -U "$DEV_USER" -d "$DEV_DB" -L /tmp/kp-dev-sync.list "$DUMP_IN_CONTAINER"
  docker exec "$DB_CONTAINER" rm -f /tmp/kp-dev-sync.list
else
  echo "→ Restoring everything …"
  docker exec "$DB_CONTAINER" pg_restore --no-owner --no-privileges \
    -U "$DEV_USER" -d "$DEV_DB" "$DUMP_IN_CONTAINER"
fi
docker exec "$DB_CONTAINER" rm -f "$DUMP_IN_CONTAINER"

echo "→ Migrating up (a dump from an older release is expected) …"
docker exec "$BACKEND_CONTAINER" uv run alembic upgrade head

echo "→ Re-seeding the dev logins …"
docker exec "$BACKEND_CONTAINER" uv run python -m app.seed --dev-logins

echo "→ Restarting the dev backend …"
docker restart "$BACKEND_CONTAINER" >/dev/null

echo
echo "✓ Done. The dev board now mirrors the source$($CONFIG_ONLY && echo "'s configuration")."
echo "  Logins: admin/\$ADMIN_SEED_PASSWORD (default kp-dev-password), editor/editor, viewer/viewer."
echo "  Photos were not synced (they live in the deployment's volume, not the DB)."
echo "  Your previous dev DB: backups/dev-sync-replaced-$STAMP.dump (restore: scripts/restore.sh)"
