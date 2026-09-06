#!/usr/bin/env bash
# Synthetic recovery drill. Starts its OWN temporary PostgreSQL cluster on a private Unix
# socket, with TCP disabled. Never reads a deployment .env or contacts an existing database.
# Requires initdb, pg_ctl, psql, pg_dump and pg_restore from the same PostgreSQL installation.
#   PATH=/path/to/postgresql/bin:$PATH bash scripts/check-recovery.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRILL="$(mktemp -d "${TMPDIR:-/tmp}/kp-recovery.XXXXXX")"
cleanup() {
    pg_ctl -D "$DRILL/db" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$DRILL"
}
trap cleanup EXIT
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD POSTGRES_PASSWORD PGPASSFILE
export PGHOST="$DRILL/socket" PGPORT=5432 PGUSER=recovery PGDATABASE=recovery_source
mkdir -p "$PGHOST" "$DRILL/photos" "$DRILL/restored-photos"
initdb -D "$DRILL/db" -U "$PGUSER" --auth=trust --no-locale >/dev/null
pg_ctl -D "$DRILL/db" -l "$DRILL/postgres.log" -o "-k $PGHOST -c listen_addresses=''" -w start >/dev/null
createdb "$PGDATABASE"
createdb recovery_restored

psql -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE alembic_version (version_num varchar(32) NOT NULL);
INSERT INTO alembic_version VALUES ('synthetic_old');
CREATE TABLE recovery_record (id integer PRIMARY KEY, title text NOT NULL);
INSERT INTO recovery_record VALUES (1, 'Before upgrade');
SQL
printf 'synthetic photo bytes\n' > "$DRILL/photos/record.jpg"
PHOTOS_DIR="$DRILL/photos" bash "$ROOT/scripts/backup.sh" "$DRILL/backups"
bash "$ROOT/scripts/backup.sh" --check "$DRILL/backups"

# A newer schema and later writes deliberately cannot be served as the old version.
psql -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER TABLE recovery_record ADD COLUMN newer_field text;
UPDATE alembic_version SET version_num='synthetic_new';
INSERT INTO recovery_record VALUES (2, 'After upgrade', 'new only');
SQL
test "$(psql -Atqc 'SELECT version_num FROM alembic_version')" = synthetic_new
printf 'later photo\n' > "$DRILL/restored-photos/after-upgrade.jpg"

export PGDATABASE=recovery_restored
dump=("$DRILL"/backups/daily/db-*.dump)
photos=("$DRILL"/backups/daily/photos-*.tar.gz)
PHOTOS_DIR="$DRILL/restored-photos" bash "$ROOT/scripts/restore.sh" "${dump[0]}" --photos "${photos[0]}"
test "$(psql -Atqc 'SELECT version_num FROM alembic_version')" = synthetic_old
test "$(psql -Atqc 'SELECT id || '\''|'\'' || title FROM recovery_record')" = '1|Before upgrade'
test "$(psql -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_name='recovery_record' AND column_name='newer_field'")" = 0
diff -r "$DRILL/photos" "$DRILL/restored-photos"
echo 'Recovery verified: old revision, original rows/schema and matching photos restored; later writes absent.'
