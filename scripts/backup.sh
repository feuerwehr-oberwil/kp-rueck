#!/usr/bin/env bash
# Back up a docker-compose deployment: Postgres dump + photo-volume tarball, with retention.
# The two stores belong together — Reko photos are NOT in the database, so a dump restored
# without its photo volume gives you a complete operational record pointing at missing images
# — so this always captures both, back to back.
#
# Usage:  scripts/backup.sh [backup-dir]     # default ./backups
# Env:    BACKUP_KEEP=14                     # how many of each file to keep (default 14)
#
# Run it from cron on the docker host, e.g. daily at 03:30:
#   30 3 * * * cd /opt/kp-rueck && ./scripts/backup.sh /var/backups/kp-rueck >> /var/log/kp-rueck-backup.log 2>&1
#
# Restore (fresh stack): see docs/DEPLOYMENT.md §6 — and do one restore DRILL before you
# depend on these files. An untested backup is a guess.
#
# Keep SECRET_KEY and AUTH_SECRET_KEY with the backup: restoring a database under different
# secrets logs everyone out and invalidates every issued token.
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%F-%H%M%S)"
mkdir -p "$DIR"

# The frontend container has no shell worth relying on and the backend already mounts the
# photo volume at /mnt/data/photos, so both halves are taken through services that exist in
# every deployment — no `docker run --rm -v` against a volume name that changes with the
# compose project name.
echo "→ 1/2  Postgres dump"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-kprueck}" "${POSTGRES_DB:-kprueck}" \
  | gzip > "$DIR/db-$STAMP.sql.gz"

echo "→ 2/2  photo volume (Reko photos)"
docker compose exec -T backend tar czf - -C /mnt/data/photos . > "$DIR/photos-$STAMP.tar.gz"

# Retention: keep the newest $KEEP of each series.
ls -1t "$DIR"/db-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
ls -1t "$DIR"/photos-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --

echo "✓ Backup complete: $DIR/db-$STAMP.sql.gz + $DIR/photos-$STAMP.tar.gz (keeping $KEEP)"
