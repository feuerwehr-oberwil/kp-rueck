#!/usr/bin/env bash
# Keep a standby box on the exact commit the hosted board runs (docs/STANDBY.md).
#
#   scripts/standby-follow.sh      one check; a timer runs it every few minutes
#
# The hosted board deploys from main, and the box mirrors its database by logical replication,
# which stops as soon as the hosted schema is ahead (a new column has nowhere to go here). So
# the box follows commit for commit, with the images main-images.yml publishes as
# `main-<short sha>`:
#
#   1. read the commit the hosted board runs ($STANDBY_FOLLOW_URL/build-info)
#   2. nothing to do if this box runs it already – or if an Ereignis is taken offline here:
#      an update restarts the board, which must not happen in the middle of an operation
#   3. only forward: a commit that is not a descendant of this checkout is refused (an older
#      image cannot run against a database a newer one migrated)
#   4. pull that commit's images first – not published yet means «try again next time»
#   5. back up, check the commit out, point KP_RUECK_TAG at it, restart; migrations run on boot
#
# Run it from the installation directory's checkout, as a user that may run docker. Reads
# STANDBY_FOLLOW_URL (e.g. https://kp.example.ch) and BACKUP_HOST_DIR from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

envval() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }
log() { printf '%s  %s\n' "$(date +%FT%T%z)" "$*"; }

URL="$(envval STANDBY_FOLLOW_URL)"
[ -n "$URL" ] || { log "STANDBY_FOLLOW_URL is not set in .env – nothing to follow"; exit 1; }

target="$(curl -fsS -m 15 "${URL%/}/build-info" 2>/dev/null | sed -n 's/.*"id":"[^@"]*@\([0-9a-f]\{7,40\}\)@.*/\1/p' || true)"
if [ -z "$target" ]; then
    log "the hosted board does not answer (or has no build-info) – staying as we are"
    exit 0
fi
tag="main-${target:0:7}"
current="$(envval KP_RUECK_TAG)"
[ "$current" = "$tag" ] && exit 0

detached="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM standby.detached_events"' 2>/dev/null | tr -d '[:space:]' || true)"
if [ -n "$detached" ] && [ "$detached" != "0" ]; then
    log "an Ereignis is taken offline on this box – not updating to $tag while it is the board"
    exit 0
fi

git fetch --quiet origin
full="$(git rev-parse --verify --quiet "${target}^{commit}" || true)"
[ -n "$full" ] || { log "commit $target is not in origin yet – next time"; exit 0; }
if ! git merge-base --is-ancestor HEAD "$full"; then
    log "the hosted board runs $target, which is not newer than this box ($(git rev-parse --short HEAD)) – refusing to go back"
    exit 1
fi

log "the hosted board runs $tag, this box ${current:-?} – following"
if ! KP_RUECK_TAG="$tag" docker compose pull --quiet 2>/dev/null; then
    log "images for $tag are not published yet – next time"
    exit 0
fi

DEST="$(envval BACKUP_HOST_DIR)"; DEST="${DEST:-./backups}"
mkdir -p "$DEST"
docker compose --profile backup run --rm --no-deps -v "$(cd "$DEST" && pwd):/backups" \
    --entrypoint /scripts/backup.sh backup /backups

git -c advice.detachedHead=false checkout --quiet --detach "$full"
sed -i "s/^KP_RUECK_TAG=.*/KP_RUECK_TAG=$tag/" .env
KP_RUECK_TAG="$tag" docker compose up -d --pull never --no-build
log "✓ now on $tag – migrations run as the backend starts"
