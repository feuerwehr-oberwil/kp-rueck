#!/usr/bin/env bash
# Print a comparable fingerprint of a KP Rück database: an exact row count for every table, a
# few real values, and the schema revision. Two databases that print the same thing hold the
# same data.
#
#   scripts/db-fingerprint.sh > before.txt      # against the source
#   scripts/db-fingerprint.sh > after.txt       # against the restore
#   diff before.txt after.txt
#
# This is what turns "the restore finished without errors" into "the restore is correct" – the
# distinction the drill in docs/DEPLOYMENT.md §6.2 exists for, and the assertion the weekly
# restore-drill CI job makes. Connection comes from the usual libpq variables; an optional first
# argument is a shortcut for PGPORT, which is the only one that usually differs between the two
# databases being compared.
set -euo pipefail

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${1:-${PGPORT:-5432}}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-kprueck}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-kprueck}}"
if [ -n "${POSTGRES_PASSWORD:-}" ] && [ -z "${PGPASSWORD:-}" ]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi

q() { psql -Atq -c "$1"; }

# Counted per table rather than read from pg_stat_user_tables: the statistics view is an
# estimate and is empty on a freshly restored database, which would make any two databases
# "match" for the wrong reason.
COUNTS="$(q "SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I', tablename, tablename), ' UNION ALL ') FROM pg_tables WHERE schemaname='public'")"

echo "### row counts"
q "SELECT t||'='||n FROM ($COUNTS) x ORDER BY 1"
echo "### incidents (first 3 by id)"
q "SELECT id||' | '||title||' | '||status||' | '||coalesce(location_address,'-') FROM incidents ORDER BY id LIMIT 3"
echo "### personnel digest"
q "SELECT coalesce(md5(string_agg(name||coalesce(role,'')||status, '|' ORDER BY id)), 'empty') FROM personnel"
echo "### users"
q "SELECT username||':'||role FROM users ORDER BY username"
echo "### schema revision"
q "SELECT version_num FROM alembic_version"
