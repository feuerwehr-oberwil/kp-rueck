#!/usr/bin/env bash
# Back up a KP Rück deployment: Postgres dump + photo-volume tarball, with retention.
#
# The two stores belong together – Reko photos are NOT in the database, so a dump restored
# without its photo volume gives you a complete operational record pointing at missing images
# – so this always captures both, back to back.
#
#   scripts/backup.sh [DIR]     take one backup now (default DIR: $BACKUP_DIR or ./backups)
#   scripts/backup.sh --loop    run forever, one backup a day at BACKUP_AT (the compose sidecar)
#   scripts/backup.sh --check   exit 0 only if the last backup succeeded and is recent
#
# Configuration is environment only – no credentials in this repo. The Postgres connection uses
# the standard libpq variables, so the same script works unchanged inside the compose network,
# under `railway run`, or against an SSH tunnel:
#
#   PGHOST     (default db)          PGUSER     (default kprueck / $POSTGRES_USER)
#   PGPORT     (default 5432)        PGDATABASE (default kprueck / $POSTGRES_DB)
#   PGPASSWORD (or $POSTGRES_PASSWORD, or a ~/.pgpass file)
#
#   BACKUP_DIR            where to write                 (default ./backups)
#   BACKUP_KEEP_DAILY     daily copies to keep           (default 14)
#   BACKUP_KEEP_WEEKLY    weekly copies to keep          (default 8)
#   BACKUP_AT             HH:MM for --loop               (default 03:30)
#   BACKUP_ON_START       --loop backs up immediately    (default true)
#   BACKUP_MAX_AGE_HOURS  staleness --check tolerates    (default 26)
#   PHOTOS_DIR            photo store to tar             (default /photos)
#   BACKUP_SKIP_PHOTOS    true = database only, loudly   (default false)
#
# WHY pg_dump + ROTATION AND NOT restic: restic sells encryption, off-site transport and its
# own retention. At this data size (a station's dump is single-digit MB) its dedup buys
# nothing, and `restic check` is replaced here by something stricter and cheaper – every dump
# is read back with `pg_restore --list` before it counts as taken. What restic would really
# buy is *off-site*, and that needs a destination the station has to choose first (NAS, bucket,
# SFTP). Adding the tool before the destination exists would mean one more password whose loss
# makes every backup unreadable, in exchange for nothing. See docs/plans/17 §2.
#
# FAILURE IS LOUD BY DESIGN. A backup script that can quietly do nothing is worse than none, so
# every run either produces a verified pair of files or leaves evidence in four places: a
# non-zero exit, an ERROR line, a `BACKUP-FAILED` marker in the backup directory, and a
# `last-backup.json` naming the stage that failed. `--check` reads that file and is what the
# compose sidecar's healthcheck runs – so a broken backup shows up as `unhealthy` in
# `docker compose ps`, not as a directory whose newest file is quietly nine days old.
#
# Restore: scripts/restore.sh, or docs/DEPLOYMENT.md §6.1 by hand. Do the drill (§6.2) once
# before you depend on any of this. An untested backup is a guess.
#
# Keep SECRET_KEY and AUTH_SECRET_KEY with the backup: restoring a database under different
# secrets logs everyone out and invalidates every issued token.
set -euo pipefail

MODE="once"
case "${1:-}" in
  --loop)    MODE="loop";  shift ;;
  --check)   MODE="check"; shift ;;
  --help|-h) sed -n '2,45p' "$0" | sed 's/^#\ \?//'; exit 0 ;;
esac

DIR="${1:-${BACKUP_DIR:-./backups}}"
# BACKUP_KEEP was the single knob before the daily/weekly split; honour it as the daily count so
# an existing cron line and .env keep meaning what they meant.
KEEP_DAILY="${BACKUP_KEEP_DAILY:-${BACKUP_KEEP:-14}}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
PHOTOS_DIR="${PHOTOS_DIR:-/photos}"
SKIP_PHOTOS="${BACKUP_SKIP_PHOTOS:-false}"

export PGHOST="${PGHOST:-db}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-${POSTGRES_USER:-kprueck}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-kprueck}}"
if [ -n "${POSTGRES_PASSWORD:-}" ] && [ -z "${PGPASSWORD:-}" ]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi

STATUS_FILE="$DIR/last-backup.json"
FAILED_MARKER="$DIR/BACKUP-FAILED"

DB_FILE_REL=""; PHOTOS_FILE_REL=""; DB_BYTES=0; PHOTOS_BYTES=0
SERVER_VERSION=""; CLIENT_VERSION=""

log() { printf '%s  %s\n' "$(date +%FT%T%z)" "$*"; }
err() { printf '%s  ERROR  %s\n' "$(date +%FT%T%z)" "$*" >&2; }

# A libpq error is multi-line and full of quotes; pasted into JSON unescaped it produces a
# status file no parser can read – which is a silent failure inside the failure reporting.
json_safe() { printf '%s' "$*" | tr '\n\t' '  ' | sed 's/[\\"]/ /g' | cut -c1-500; }

# Written on every outcome, good or bad. It is the only thing a human – or §5's operations
# overview later – can look at to answer "did last night work?" without knowing what the file
# names are supposed to look like.
write_status() {
  local status="$1" stage="$2" message="$3"
  [ -d "$DIR" ] && [ -w "$DIR" ] || return 0
  cat > "$STATUS_FILE.tmp" <<EOF
{
  "status": "$status",
  "stage": "$stage",
  "finished_at": "$(date +%FT%T%z)",
  "message": "$(json_safe "$message")",
  "db_file": "$DB_FILE_REL",
  "db_bytes": $DB_BYTES,
  "photos_file": "$PHOTOS_FILE_REL",
  "photos_bytes": $PHOTOS_BYTES,
  "pg_server": "$(json_safe "$SERVER_VERSION")",
  "pg_dump": "$(json_safe "$CLIENT_VERSION")",
  "keep_daily": $KEEP_DAILY,
  "keep_weekly": $KEEP_WEEKLY
}
EOF
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# die <stage> <exit-code> <message…>. Never prunes on the way out: a failed run must not be able
# to delete yesterday's good backup.
die() {
  local stage="$1" code="$2"; shift 2
  err "[$stage] $*"
  write_status failed "$stage" "$*"
  if [ -d "$DIR" ] && [ -w "$DIR" ]; then
    printf '%s  %s: %s\n' "$(date +%FT%T%z)" "$stage" "$*" >> "$FAILED_MARKER"
    err "evidence left in $FAILED_MARKER and $STATUS_FILE"
  fi
  exit "$code"
}

# Keep the newest $3 files matching $2 in $1.
#
# Ordered by NAME, descending – not by mtime. The names are `db-YYYY-MM-DD-HHMMSS.dump` and
# `db-YYYY-Www.dump`, so lexical order is chronological order, and it stays right after a
# `cp -a`, an rsync, or a restore from tape, all of which rewrite mtimes. An earlier version of
# this sorted with `ls -t` and, on busybox, deleted the NEWEST files including the one it had
# just taken. Retention is the one part of a backup script that can destroy data, so it does the
# boring deterministic thing.
#
# Never removes the last remaining file whatever the count says – a mis-set BACKUP_KEEP_DAILY=0
# must not become a way to delete every backup.
prune() {
  local dir="$1" pattern="$2" keep="$3" n=0 f
  [ "$keep" -lt 1 ] && keep=1
  while IFS= read -r f; do
    n=$((n + 1))
    [ "$n" -le "$keep" ] && continue
    rm -f -- "$f" && log "     pruned (retention): $(basename "$f")"
  done < <(find "$dir" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | sort -r)
}

run_backup() {
  DB_FILE_REL=""; PHOTOS_FILE_REL=""; DB_BYTES=0; PHOTOS_BYTES=0
  SERVER_VERSION=""; CLIENT_VERSION=""
  local stamp; stamp="$(date +%F-%H%M%S)"

  # 1. Can we write? Checked before anything expensive, because "disk full" and "wrong owner on
  #    the bind mount" are the two ways this fails on a real station box.
  mkdir -p "$DIR/daily" "$DIR/weekly" 2>/dev/null \
    || die write 2 "cannot create backup directory: $DIR"
  [ -w "$DIR/daily" ] && [ -w "$DIR/weekly" ] \
    || die write 2 "backup directory not writable: $DIR (check ownership/permissions of the mount)"
  if : > "$DIR/.writetest" 2>/dev/null; then
    rm -f "$DIR/.writetest"
  else
    die write 2 "write test in $DIR failed (disk full? mounted read-only?)"
  fi

  # 2. Can we connect? psql, not pg_isready – pg_isready says the port answers, which is not the
  #    same as "these credentials open this database".
  command -v pg_dump >/dev/null 2>&1 || die tooling 3 "pg_dump not found in PATH"
  local probe
  probe="$(psql -Atqc 'SHOW server_version' 2>&1)" \
    || die connect 3 "cannot connect to $PGUSER@$PGHOST:$PGPORT/$PGDATABASE – $probe"
  SERVER_VERSION="${probe%% *}"
  CLIENT_VERSION="$(pg_dump --version | awk '{print $3}')"

  # 3. Client/server major version. pg_dump refuses outright against a NEWER server ("aborting
  #    because of server version mismatch") and the message names two numbers and no remedy.
  #    Catch it here and say what to do. A newer client against an older server is supported, so
  #    only client < server is fatal.
  local cmaj="${CLIENT_VERSION%%.*}" smaj="${SERVER_VERSION%%.*}"
  if [ "$cmaj" -lt "$smaj" ]; then
    die version 4 "pg_dump $CLIENT_VERSION is older than the server $SERVER_VERSION and will refuse to dump it. Run the backup with a client >= $smaj: set BACKUP_PG_IMAGE=postgres:$smaj-alpine for the compose sidecar, or by hand 'docker run --rm postgres:$smaj-alpine pg_dump …'."
  fi
  log "Postgres $SERVER_VERSION, pg_dump $CLIENT_VERSION → $DIR"

  # 4. The dump. -Fc (custom format): compressed, and pg_restore can list it, pull a single table
  #    out of it, and restore in parallel. Plain SQL can do none of that, and the one thing it
  #    buys – reading it with psql alone – is covered by pg_restore, which ships in the same
  #    package as psql. Written to .part first, so an interrupted run cannot leave behind a file
  #    that looks like a backup.
  local db_file="$DIR/daily/db-$stamp.dump"
  log "1/2  pg_dump -Fc"
  pg_dump -Fc --no-owner --no-privileges -f "$db_file.part" \
    || { rm -f "$db_file.part"; die dump 5 "pg_dump failed (see output above)"; }
  mv "$db_file.part" "$db_file"

  DB_BYTES="$(wc -c < "$db_file" | tr -d ' ')"
  [ "$DB_BYTES" -gt 1024 ] \
    || { rm -f "$db_file"; die dump 5 "dump is $DB_BYTES bytes – that is not a database. File discarded."; }

  # 5. Read it back. This is the difference between "bytes were written" and "a backup exists":
  #    pg_restore --list parses the archive's table of contents, so a truncated or corrupted file
  #    fails here instead of in six months.
  local toc_lines
  toc_lines="$(pg_restore --list "$db_file" 2>/dev/null | grep -c ';' || true)"
  [ "${toc_lines:-0}" -gt 0 ] \
    || { rm -f "$db_file"; die verify 6 "pg_restore --list cannot read the dump. File discarded."; }
  DB_FILE_REL="daily/db-$stamp.dump"
  log "     $DB_FILE_REL – $DB_BYTES bytes, $toc_lines archive entries, readable"

  # 6. Photos. Not in the database; a dump without them restores a record pointing at nothing.
  if [ "$SKIP_PHOTOS" = "true" ]; then
    log "2/2  photos skipped (BACKUP_SKIP_PHOTOS=true) – this backup is NOT complete"
  else
    [ -d "$PHOTOS_DIR" ] \
      || die photos 7 "photo directory $PHOTOS_DIR is missing. Is the volume mounted? Database-only on purpose: BACKUP_SKIP_PHOTOS=true."
    local ph_file="$DIR/daily/photos-$stamp.tar.gz"
    log "2/2  photos from $PHOTOS_DIR"
    tar czf "$ph_file.part" -C "$PHOTOS_DIR" . \
      || { rm -f "$ph_file.part"; die photos 7 "photo tarball failed"; }
    mv "$ph_file.part" "$ph_file"
    tar tzf "$ph_file" >/dev/null 2>&1 \
      || { rm -f "$ph_file"; die photos 7 "photo tarball is not readable. File discarded."; }
    PHOTOS_BYTES="$(wc -c < "$ph_file" | tr -d ' ')"
    PHOTOS_FILE_REL="daily/photos-$stamp.tar.gz"
    log "     $PHOTOS_FILE_REL – $PHOTOS_BYTES bytes, readable"
  fi

  # 7. Weekly copy: the first backup of an ISO week is hardlinked into weekly/, so it costs no
  #    disk until the daily beneath it is pruned. Dailies answer "undo last night"; weeklies
  #    answer "someone imported the wrong roster five weeks ago" – a different failure, and the
  #    one dailies cannot cover.
  local week; week="$(date +%G-W%V)"
  if [ ! -e "$DIR/weekly/db-$week.dump" ]; then
    ln "$db_file" "$DIR/weekly/db-$week.dump" 2>/dev/null \
      || cp "$db_file" "$DIR/weekly/db-$week.dump"
    if [ -n "$PHOTOS_FILE_REL" ]; then
      ln "$DIR/$PHOTOS_FILE_REL" "$DIR/weekly/photos-$week.tar.gz" 2>/dev/null \
        || cp "$DIR/$PHOTOS_FILE_REL" "$DIR/weekly/photos-$week.tar.gz"
    fi
    log "     weekly copy $week created"
  fi

  # 8. Retention – only now that a verified backup exists.
  prune "$DIR/daily"  'db-*.dump'       "$KEEP_DAILY"
  prune "$DIR/daily"  'photos-*.tar.gz' "$KEEP_DAILY"
  prune "$DIR/weekly" 'db-*.dump'       "$KEEP_WEEKLY"
  prune "$DIR/weekly" 'photos-*.tar.gz' "$KEEP_WEEKLY"

  rm -f "$FAILED_MARKER"
  write_status ok complete "$KEEP_DAILY daily / $KEEP_WEEKLY weekly"
  log "✓ backup complete: $DIR (keeping $KEEP_DAILY daily, $KEEP_WEEKLY weekly)"
}

run_check() {
  [ -f "$STATUS_FILE" ] || { err "no backup has run yet ($STATUS_FILE missing)"; exit 1; }
  grep -q '"status": "ok"' "$STATUS_FILE" || { err "last backup FAILED – read $STATUS_FILE"; exit 1; }
  [ -n "$(find "$STATUS_FILE" -mmin "-$((MAX_AGE_HOURS * 60))" 2>/dev/null)" ] \
    || { err "last backup is older than $MAX_AGE_HOURS hours"; exit 1; }
  log "ok"
}

# A sleep loop, not cron: the "next backup in …" line is itself evidence that the scheduler is
# alive, which a silent crond only gives you after the fact. A failed backup does NOT stop the
# loop – tomorrow's attempt is worth more than a dead container – but it leaves the marker, the
# status file and the failing healthcheck behind.
run_loop() {
  local at="${BACKUP_AT:-03:30}" now target sleep_for
  log "backup service started – daily at $at, target $DIR"
  if [ "${BACKUP_ON_START:-true}" = "true" ]; then
    log "taking one backup immediately (BACKUP_ON_START), so a broken setup fails now and not at $at"
    run_backup || err "backup failed – service stays up, next attempt at $at"
  fi
  while true; do
    now=$(( 10#$(date +%H) * 3600 + 10#$(date +%M) * 60 + 10#$(date +%S) ))
    target=$(( 10#${at%%:*} * 3600 + 10#${at##*:} * 60 ))
    sleep_for=$(( target - now ))
    [ "$sleep_for" -le 0 ] && sleep_for=$(( sleep_for + 86400 ))
    log "next backup in $(( sleep_for / 3600 ))h $(( sleep_for % 3600 / 60 ))min (at $at)"
    sleep "$sleep_for"
    run_backup || err "backup failed – service stays up, next attempt at $at"
  done
}

case "$MODE" in
  once)  run_backup ;;
  loop)  run_loop ;;
  check) run_check ;;
esac
