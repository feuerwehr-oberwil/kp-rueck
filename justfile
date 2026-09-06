# KP Rück Dashboard - Justfile

# `--list` shows only the LAST comment line before a recipe, so the summary goes last and any
# reasoning goes above a blank line.
#
# --unsorted keeps SOURCE order, which is the whole reason the station operator recipes sit at
# the top of this file: `just` on a fresh station box has to lead with the four commands a fire
# brigade needs, not with `be` and `fmt`.

# Show this list
default:
    @just --list --unsorted

# ============================================
# Station operator
#   Running a board for your own station: these four, and `backup` / `restore` further down.
#   Everything below the Development header is for people working ON KP Rück.
# ============================================

# Unattended, for a runbook or an SSH session that may drop:
#   just init --yes --lan
#   just init --yes --domain kp.example.ch
# Passwords come from ADMIN_SEED_PASSWORD / VIEWER_PASSWORD, or are generated and printed once.
# `just init --help` lists every flag; a re-run reports the configuration instead of overwriting.
# Create .env from three questions – generates the secrets, never overwrites an existing one
init *args:
    ./scripts/init-env.sh {{args}}

# Start the station board (production stack) and wait until it answers
up:
    #!/usr/bin/env bash
    # No `set -e`: the wait loop below probes things that are legitimately not ready yet, and
    # a failed probe must produce a diagnosis, not an unexplained non-zero exit.
    set -uo pipefail
    envval() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }

    if [ ! -f .env ]; then
        echo -e "\033[1;31m✗ No .env – the stack has nothing to start from.\033[0m"
        echo "Run: just init"
        exit 1
    fi

    echo -e "\033[1;34m→ Starting the KP Rück stack...\033[0m"
    docker compose up -d || exit 1

    PORT="$(envval HTTP_PORT)"; PORT="${PORT:-8080}"
    DOMAIN="$(envval DOMAIN)"
    CORS="$(envval CORS_ORIGINS)"
    # Two different addresses, and conflating them is how a correct LAN install gets "fixed"
    # into a broken one. URL is what BROWSERS must use – on a LAN that is CORS_ORIGINS, the
    # station's own address, never localhost. PROBE is what THIS box can reach to check.
    if [ -n "$DOMAIN" ]; then
        URL="https://$DOMAIN"
        # With a domain Caddy answers only for that hostname, so localhost is not a probe.
        PROBE="$URL"
    else
        PROBE="http://localhost:$PORT"
        CORS_FIRST="${CORS%%,*}"
        URL="${CORS_FIRST:-$PROBE}"
    fi

    # The backend runs `alembic upgrade head` and the seed BEFORE its first healthy response –
    # that is what compose's `start_period: 90s` is for. On first boot, on a small station box,
    # image pulls plus migrations comfortably exceed two minutes, so this waits on the
    # CONTAINER's own health status rather than on the public URL: with a DOMAIN set, Caddy
    # answers only for that hostname and a localhost probe would report a false failure while
    # everything is in fact fine.
    echo -e "\033[1;34m→ First boot runs migrations and seeding – this can take 2-3 minutes.\033[0m"
    DEADLINE=$(( $(date +%s) + 240 ))
    LAST=""
    while :; do
        STATE="$(docker inspect -f '{{ "{{" }}.State.Health.Status{{ "}}" }}' kp-rueck-backend-1 2>/dev/null)"
        case "$STATE" in
            healthy) break ;;
            unhealthy)
                echo -e "\033[1;31m✗ The backend started and then failed its health check.\033[0m"
                echo "Look at why:  docker compose logs --tail=50 backend"
                exit 1
                ;;
        esac
        if [ "$(date +%s)" -ge "$DEADLINE" ]; then
            echo -e "\033[1;31m✗ The backend did not come up within 4 minutes.\033[0m"
            echo "Most likely a migration failed or a required value in .env is wrong."
            echo "Look at why:  docker compose logs --tail=50 backend"
            echo "Full report:  just doctor"
            exit 1
        fi
        # One line per state CHANGE, plus a dot per poll: silence for three minutes is
        # indistinguishable from a hang for the person watching it.
        if [ "$STATE" != "$LAST" ]; then
            printf '\n  backend: %s' "${STATE:-starting}"
            LAST="$STATE"
        fi
        printf '.'
        sleep 5
    done
    printf '\n'

    # The stack can be healthy while the ORIGIN is not – wrong HTTP_PORT, a port already taken,
    # a certificate not issued yet. Worth one probe, but never worth failing over.
    REACHED=unknown
    if command -v curl > /dev/null 2>&1; then
        if curl -sfk -m 10 "$PROBE/health" > /dev/null 2>&1; then REACHED=yes; else REACHED=no; fi
    fi

    echo -e "\033[1;32m✓ Board is up: $URL\033[0m"
    # Naming the probe separately keeps the operator from reading a localhost line as "the
    # board lives at localhost" and rewriting a perfectly good CORS_ORIGINS to match it.
    [ "$PROBE" != "$URL" ] && echo "   (probed $PROBE/health from this box)"
    if [ "$REACHED" = no ]; then
        echo -e "\033[1;33m⚠️  The backend is healthy but $PROBE does not answer yet.\033[0m"
        if [ -n "$DOMAIN" ]; then
            echo "With a domain this is usually the certificate: Caddy needs ports 80 and 443"
            echo "reachable from the internet. Watch it:  docker compose logs -f caddy"
        else
            echo "Check that nothing else owns port $PORT:  docker compose logs --tail=30 caddy"
        fi
    fi

    # ── Can anybody actually log in? ──────────────────────────────────────────────────────
    #
    # A green health check with an empty roster is the failure that looks most like success:
    # every container is up, /health answers, and the login screen refuses everyone because the
    # seed never ran (a rejected ADMIN_SEED_PASSWORD is logged and carried past). Health does
    # not ask that question, so this does. Never fatal – the operator has a working stack and
    # one thing to fix, not a failed command. And nothing here reads, prints or logs a password.
    if [ "$REACHED" = yes ]; then
        # A POST with NO body, on purpose. It proves the route exists and that Caddy really
        # forwards /api to the backend, and it leaves nothing behind: FastAPI rejects it at
        # request validation, before the per-username login throttle and before any failed-login
        # audit row. Sending a deliberately wrong password to find out would spend the real
        # admin's lockout budget on a health check.
        LOGIN_CODE="$(curl -sk -o /dev/null -m 10 -w '%{http_code}' -X POST "$PROBE/api/auth/login" 2>/dev/null)"
        # 404 is pulled OUT of the 4xx family on purpose. An empty POST to the real route is a
        # 422 (request validation), so a 404 is not "the endpoint said no" – it is "there is no
        # endpoint here", which is exactly the /api routing failure this probe exists to catch.
        # Folding it into 4* would make the check report green on its own failure case.
        LOGIN_ROUTED=no
        case "$LOGIN_CODE" in
            404) ;;
            2*|4*) LOGIN_ROUTED=yes ;;
        esac
        case "$LOGIN_ROUTED" in
            yes)
                # The roster itself, straight from the database – there is no unauthenticated
                # endpoint that would answer it, and asking the db is what the seed wrote to.
                # psql over the container's local socket needs no password (the postgres image
                # trusts it), so no credential is handled here either.
                PGU="$(envval POSTGRES_USER)"; PGU="${PGU:-kprueck}"
                PGDB="$(envval POSTGRES_DB)"; PGDB="${PGDB:-kprueck}"
                ROSTER="$(docker compose exec -T db psql -U "$PGU" -d "$PGDB" -tAc \
                    "select count(*) filter (where is_active), count(*) filter (where username = 'admin' and is_active) from users" \
                    2>/dev/null | tr -d ' \r')"
                case "$ROSTER" in
                    0\|*)
                        echo -e "\033[1;33m⚠️  The board is up and NOBODY can log in yet – the roster is empty.\033[0m"
                        echo "If ADMIN_SEED_PASSWORD is empty in .env, that is the unclaimed first-run state:"
                        echo "open the board and finish the /setup wizard. If it IS set, seeding was refused,"
                        echo "almost always because it has under 12 characters."
                        echo "Confirm:  docker compose logs backend | grep -i seed"
                        echo "Then re-seed:  docker compose up -d --force-recreate backend"
                        ;;
                    *\|0)
                        echo -e "\033[1;33m⚠️  The login endpoint answers, but there is no active \"admin\" account.\033[0m"
                        echo "On a board whose .env has no ADMIN_SEED_PASSWORD this is the unclaimed first-run"
                        echo "state – the admin account is created in the browser at /setup. Otherwise somebody"
                        echo "may have renamed or disabled it. Look:  docker compose logs backend | grep -i seed"
                        ;;
                    [0-9]*\|[0-9]*)
                        echo -e "\033[1;32m✓ A login is possible: the login endpoint answers and \"admin\" exists (${ROSTER%%|*} active accounts).\033[0m"
                        ;;
                    *)
                        # No answer from psql: the db container is not up, or this is a stack
                        # whose database lives elsewhere. Say so rather than claim either result.
                        echo -e "\033[1;32m✓ The login endpoint answers.\033[0m"
                        echo "   (Could not read the roster from the database – full report: just doctor)"
                        ;;
                esac
                ;;
            no)
                # curl says "000" when nothing answered at all, which is not an HTTP status and
                # reads like one.
                case "$LOGIN_CODE" in ''|000) WHY="no answer" ;; *) WHY="HTTP $LOGIN_CODE" ;; esac
                echo -e "\033[1;33m⚠️  $PROBE/health answers but $PROBE/api/auth/login does not ($WHY).\033[0m"
                echo "The board would load and every sign-in would fail. That is Caddy's /api route:"
                echo "docker compose logs --tail=30 caddy"
                ;;
        esac
    fi

# Stop the station board. Nothing is deleted – data and backups stay.
down:
    #!/usr/bin/env bash
    set -uo pipefail
    if [ ! -f .env ]; then
        # The production compose file's `${VAR:?}` guards fire on ANY subcommand, `down`
        # included, so without an .env this would fail with a confusing message about
        # POSTGRES_PASSWORD rather than "there is nothing here".
        echo -e "\033[1;33m⚠️  No .env – this directory has no station stack to stop.\033[0m"
        exit 0
    fi
    echo -e "\033[1;34m→ Stopping the KP Rück stack (no data is deleted)...\033[0m"
    docker compose down || exit 1
    echo -e "\033[1;32m✓ Stopped. Start it again with: just up\033[0m"

# One-screen health report for this station – run it when something looks wrong
doctor:
    #!/usr/bin/env bash
    # Deliberately NO `set -e`. This recipe exists for the case where things are broken, so
    # every probe below has to run even after the previous one failed. A doctor that aborts on
    # the first bad finding reports the symptom that happens to be alphabetically first.
    set -uo pipefail
    envval() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }
    ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
    bad()  { echo -e "\033[1;31m✗ $*\033[0m"; }
    warn() { echo -e "\033[1;33m⚠️  $*\033[0m"; }
    # Named `section`, not `head`: a shell function called `head` would shadow the head(1) this
    # recipe uses to read the backup status file.
    section() { echo ""; echo -e "\033[1;34m→ $*\033[0m"; }

    NAMEFMT='{{ "{{" }}.Names{{ "}}" }}|{{ "{{" }}.Status{{ "}}" }}'

    # Scheme and path stripped, then the part after the last colon – empty when the origin
    # names no explicit port.
    origin_port() { P="${1#*://}"; P="${P%%/*}"; case "$P" in *:*) printf '%s' "${P##*:}" ;; esac; }

    section "Configuration"
    if [ -f .env ]; then
        ok ".env present"
        PORT="$(envval HTTP_PORT)"; PORT="${PORT:-8080}"
        DOMAIN="$(envval DOMAIN)"
        CORS="$(envval CORS_ORIGINS)"
        BACKUP_DIR="$(envval BACKUP_HOST_DIR)"; BACKUP_DIR="${BACKUP_DIR:-./backups}"
        TAG="$(envval KP_RUECK_TAG)"; TAG="${TAG:-latest}"
        PROFILES="$(envval COMPOSE_PROFILES)"
        # CORS_ORIGINS IS the board's address: it is defined as how browsers reach the board,
        # so on a LAN it is the source of truth here, not something to compare localhost
        # against. Comparing the two warned about the setup guide's most feared variable on
        # every correct LAN install – and "fixing" it to localhost is precisely what breaks
        # the board for every other machine in the Gerätehaus. It may hold a comma-separated
        # list; the first entry is the one to show.
        CORS_FIRST="${CORS%%,*}"
        if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"
        elif [ -n "$CORS_FIRST" ]; then URL="$CORS_FIRST"
        else URL="http://localhost:$PORT"; fi
        echo "  URL:            $URL"
        echo "  CORS_ORIGINS:   ${CORS:-(unset)}"
        if [ -z "$CORS" ]; then
            warn "CORS_ORIGINS is not set – the backend falls back to http://localhost:8080."
            echo "     Anyone reaching the board on another address gets blocked API calls"
            echo "     with no visible error. Set it in .env to the address browsers use,"
            echo "     then: just up"
        else
            # What is left are values that are wrong on their own terms, whatever address the
            # station happens to use.
            HAS_HTTP=no; HAS_HTTPS=no; DOMAIN_SEEN=no
            # Commas to spaces rather than juggling IFS: an origin never contains whitespace,
            # so ordinary word splitting also swallows the spaces people leave after a comma.
            for O in $(printf '%s' "$CORS" | tr ',' ' '); do
                case "$O" in
                    */) warn "CORS_ORIGINS entry $O ends in a slash."
                        echo "     Browsers send an origin without one, so it can never match."
                        echo "     Drop the slash in .env, then: just up" ;;
                esac
                case "$O" in
                    https://*) HAS_HTTPS=yes ;;
                    http://*)  HAS_HTTP=yes ;;
                    *) warn "CORS_ORIGINS entry $O has no http:// or https:// scheme – it can never match." ;;
                esac
                [ -n "$DOMAIN" ] && [ "$O" = "https://$DOMAIN" ] && DOMAIN_SEEN=yes
                if [ -z "$DOMAIN" ]; then
                    OPORT="$(origin_port "$O")"
                    case "$OPORT" in
                        ''|*[!0-9]*) ;;
                        *) [ "$OPORT" != "$PORT" ] && {
                               warn "CORS_ORIGINS names port $OPORT, but the board listens on HTTP_PORT=$PORT."
                               echo "     One of the two is wrong – fix it in .env, then: just up"
                           } ;;
                    esac
                fi
            done
            if [ -n "$DOMAIN" ] && [ "$DOMAIN_SEEN" = no ]; then
                warn "DOMAIN is $DOMAIN but no CORS_ORIGINS entry is https://$DOMAIN."
                echo "     That is the address browsers reach the board on, so it has to be listed."
                echo "     Fix it in .env, then: just up"
            fi
            if [ -z "$DOMAIN" ] && [ "$HAS_HTTPS" = yes ]; then
                warn "CORS_ORIGINS says https:// but DOMAIN is empty – this stack serves plain HTTP."
                echo "     Caddy only fetches a certificate with a DOMAIN set. Either set DOMAIN,"
                echo "     or use http://<address>:$PORT here. Then: just up"
            fi
            if [ "$HAS_HTTP" = yes ] && [ "$HAS_HTTPS" = yes ]; then
                warn "CORS_ORIGINS mixes http:// and https://."
                echo "     One https:// entry anywhere in the list makes the backend send Secure"
                echo "     login cookies, and browsers on the http:// address then fail to sign in"
                echo "     with nothing on screen to explain it. Pick one scheme, then: just up"
            fi
        fi
    else
        bad "No .env – this directory has no station configuration."
        echo "   Create one: just init"
        PORT=8080; DOMAIN=""; URL="http://localhost:8080"
        BACKUP_DIR="./backups"; TAG=""; PROFILES=""
    fi

    # Same split as `just up`: URL is where BROWSERS go, PROBE is what this box can reach from
    # its own console. With a DOMAIN, Caddy answers for that hostname only, so localhost is
    # not a probe; without one, localhost is the only address guaranteed to answer here.
    if [ -n "$DOMAIN" ]; then PROBE="$URL"; else PROBE="http://localhost:$PORT"; fi

    section "Containers (project kp-rueck)"
    # Filtered by NAME, not by the compose project label: a `just dev` container carries the
    # same project label (it inherits the directory name) but is called kprueck-*-dev.
    FOUND="$(docker ps -a --format "$NAMEFMT" 2>/dev/null | grep '^kp-rueck-')"
    if [ -z "$FOUND" ]; then
        bad "No containers of this stack exist."
        echo "   Start it: just up"
    else
        echo "$FOUND" | while IFS='|' read -r NAME STATUS; do
            case "$STATUS" in
                Up*healthy*)   ok  "$(printf '%-26s %s' "$NAME" "$STATUS")" ;;
                Up*unhealthy*) bad "$(printf '%-26s %s' "$NAME" "$STATUS")" ;;
                Up*)           ok  "$(printf '%-26s %s' "$NAME" "$STATUS")" ;;
                *)             bad "$(printf '%-26s %s' "$NAME" "$STATUS")" ;;
            esac
        done
        for SVC in db backend frontend tileserver caddy; do
            echo "$FOUND" | grep -q "^kp-rueck-${SVC}-" || bad "$SVC is missing entirely – run: just up"
        done
        echo "$FOUND" | grep -q '^kp-rueck-.*unhealthy' \
            && echo "   For an unhealthy service:  docker compose logs --tail=50 <service>"
    fi

    section "Release"
    IMAGE="$(docker inspect -f '{{ "{{" }}.Config.Image{{ "}}" }}' kp-rueck-backend-1 2>/dev/null)"
    echo "  KP_RUECK_TAG in .env:  ${TAG:-(no .env)}"
    if [ -n "$IMAGE" ]; then
        echo "  backend image running:  $IMAGE"
        # Only meaningful when there IS a tag to compare against; with no .env the two halves
        # of this comparison come from different places and a mismatch means nothing.
        case "${TAG:+$IMAGE}" in
            "") ;;
            *":$TAG") ;;
            *) warn "The running container is not on the tag in .env – it predates the last change."
               echo "     Apply it:  docker compose pull && just up" ;;
        esac
    else
        warn "No backend container to read a version from."
    fi
    echo "  Release notes: https://github.com/feuerwehr-oberwil/kp-rueck/releases"

    section "Backend health ($PROBE/health)"
    if ! command -v curl > /dev/null 2>&1; then
        warn "curl is not installed – skipping the HTTP probes."
        echo "     Install it (apt install curl) or check by hand: docker compose ps"
    else
        BODY="$(curl -sfk -m 10 "$PROBE/health" 2>/dev/null)"
        if [ -z "$BODY" ] && [ "$PROBE" != "http://localhost:$PORT" ]; then
            # A domain deployment that is not reachable from HERE may still be fine from the
            # internet; try the local port before calling it broken.
            BODY="$(curl -sf -m 10 "http://localhost:$PORT/health" 2>/dev/null)"
        fi
        if [ -z "$BODY" ]; then
            bad "No answer."
            echo "   If the containers above are up, this is Caddy, the port or the certificate:"
            echo "   docker compose logs --tail=50 caddy"
        else
            ok "Backend answers"
            DISK="$(printf '%s' "$BODY" | sed -n 's/.*"disk":{"status":"\([a-z]*\)".*/\1/p')"
            FREE="$(printf '%s' "$BODY" | sed -n 's/.*"free_percent":\([0-9.]*\).*/\1/p')"
            case "$DISK" in
                ok)      ok "Disk ${FREE:-?}% free" ;;
                low)     bad "Disk only ${FREE:-?}% free – Postgres stops writing when it fills."
                         echo "   Prune old backups in $BACKUP_DIR, or move photos to a bigger disk." ;;
                unknown) warn "Disk usage could not be read (see backend logs)." ;;
                *)       warn "This backend reports no disk status – it predates that check." ;;
            esac
        fi
    fi

    section "Offline map tiles"
    # From .env, not from the shell that happens to run `just` – a station on another region
    # sets this in its configuration. An explicit shell value still wins, so the override
    # documented in scripts/download-tiles.sh keeps working.
    TILES_NAME="${TILES_NAME:-$(envval TILES_NAME)}"; TILES_NAME="${TILES_NAME:-basel-landschaft}"
    if ! command -v curl > /dev/null 2>&1; then
        warn "curl is not installed – skipping."
    else
        # /index.json, not /tiles/data/${TILES_NAME}.json – see the same probe in
        # `tiles-status` for why: TileServer GL serves an OpenMapTiles set under the name
        # `v3`, so a path built from the filename 404s on exactly the deployments that DO
        # have offline tiles, and this check reported them as "tile server does not answer".
        TJ="$(curl -sfk -m 10 "$PROBE/tiles/index.json" 2>/dev/null)"
        [ -z "$TJ" ] && TJ="$(curl -sf -m 10 "http://localhost:$PORT/tiles/index.json" 2>/dev/null)"
        if [ -z "$TJ" ] || [ "$TJ" = "[]" ]; then
            warn "The tile server does not answer – the map falls back to online OSM."
            echo "     Offline maps are optional. To look: just tiles-status"
        elif printf '%s' "$TJ" | grep -qi 'Bootstrap MBTiles'; then
            warn "Only the bootstrap tile set (${TILES_NAME}) – there is NO offline map data."
            echo "     The map works while the internet does, and goes blank when it doesn't."
            echo "     Generate the real tiles: just tiles-download"
        else
            ok "Offline tiles present (${TILES_NAME}) – the map survives an internet outage."
        fi
    fi

    section "Backups"
    case ",${PROFILES}," in
        *,backup,*) ;;
        *) bad "The nightly backup is NOT switched on."
           echo "   Set COMPOSE_PROFILES=backup in .env, then: just up" ;;
    esac
    STATUS_FILE="$BACKUP_DIR/last-backup.json"
    if [ ! -f "$STATUS_FILE" ]; then
        bad "No backup has ever completed ($STATUS_FILE is missing)."
        echo "   Take one now: just backup"
    else
        BSTATUS="$(sed -n 's/.*"status": *"\([a-z]*\)".*/\1/p' "$STATUS_FILE" | head -n1)"
        BSTAGE="$(sed -n 's/.*"stage": *"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n1)"
        BWHEN="$(sed -n 's/.*"finished_at": *"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n1)"
        # File mtime, not the timestamp inside: `date -d` (GNU) and `date -j` (BSD) parse
        # differently and a station box may be either. mtime needs no parsing at all.
        MTIME="$(stat -c %Y "$STATUS_FILE" 2>/dev/null || stat -f %m "$STATUS_FILE" 2>/dev/null)"
        AGE_H="?"
        [ -n "$MTIME" ] && AGE_H=$(( ( $(date +%s) - MTIME ) / 3600 ))
        if [ "$BSTATUS" = "ok" ]; then
            if [ "$AGE_H" != "?" ] && [ "$AGE_H" -gt 48 ]; then
                bad "Last backup succeeded but was ${AGE_H}h ago ($BWHEN) – the nightly run has stopped."
                echo "   docker compose logs --tail=50 backup"
            else
                ok "Last backup ok, ${AGE_H}h ago ($BWHEN)"
            fi
        else
            bad "Last backup FAILED at stage '${BSTAGE:-?}' (${AGE_H}h ago, $BWHEN)"
            echo "   $BACKUP_DIR/BACKUP-FAILED has the details; docker compose logs backup has more."
        fi
        echo "  Backups live in: $BACKUP_DIR"
        echo "  An untested backup is a guess – do the restore drill once (docs/DEPLOYMENT.md §6.2)."
    fi
    echo ""

# ============================================
# Development
# ============================================

# Start all services in development mode with hot reload
dev:
    docker compose -f docker-compose.dev.yml up --build

# Run backend locally (requires uv). Database starts in Docker.
be:
    @docker compose -f docker-compose.dev.yml up -d postgres
    @echo "\033[1;34m→ Starting backend on http://localhost:8000\033[0m"
    @echo "\033[1;34m→ Database running in Docker on port 5433\033[0m"
    @echo "\033[1;34m→ Press Ctrl+C to stop backend (database will keep running)\033[0m"
    cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Run frontend locally (requires pnpm). Ensure backend is running.
fe:
    @echo "\033[1;34m→ Starting frontend on http://localhost:3000\033[0m"
    @echo "\033[1;34m→ Ensure backend is running on http://localhost:8000\033[0m"
    @echo "\033[1;34m→ Press Ctrl+C to stop\033[0m"
    cd frontend && pnpm dev

# Named dev-stop, not stop. It takes the PRODUCTION stack down too (the second line), and it
# was sitting in `just --list` describing itself as "Stop all services" – so a station operator
# who only ever installed `just` for `just tiles-download` could take their own board off the
# air with a command that sounds like tidying up. The operator's version is `just down`.
# Stop the DEVELOPMENT stack (and any production stack in this directory)
dev-stop:
    docker compose -f docker-compose.dev.yml down
    @# The production stack's `${VAR:?}` guards fire on ANY compose subcommand, `down`
    @# included, so without an .env this line errors. That must not stop the dev stack
    @# above from having been brought down – which is what someone running `just dev-stop`
    @# after `just dev` actually wants.
    -docker compose down

# Stop everything and DELETE ALL DATA (database, photos) – asks first
dev-clean:
    #!/usr/bin/env bash
    set -euo pipefail
    # `down -v` removes named volumes, and on this stack those are pgdata and photos – i.e.
    # every incident, every roster entry and every Reko photo, dev AND production, with no
    # undo. The old recipe did that on a bare `just dev-clean` with nothing but "removes volumes"
    # in the help text, which reads like tidying up caches. It is not. Backups live on a HOST
    # path (BACKUP_HOST_DIR) precisely so they survive this, but only if they were ever
    # switched on – see COMPOSE_PROFILES in .env.example.
    echo "⚠  This DELETES ALL DATA in this stack – database and photos, dev and production."
    echo "⚠  There is no undo. Restore would need a backup from BACKUP_HOST_DIR."
    read -r -p "Type 'delete' to confirm: " reply
    if [ "$reply" != "delete" ]; then
        echo "Aborted – nothing was removed."
        exit 1
    fi
    docker compose -f docker-compose.dev.yml down -v
    # `|| true`, not just's `-` prefix: this is a shebang recipe, so it runs as ONE script and
    # a leading `-` would be read as a command name. Same intent as `just dev-stop` – the
    # production stack's `${VAR:?}` guards fire on any subcommand, `down` included, so this
    # errors without an .env and must not mask the dev teardown above having succeeded.
    docker compose down -v || true

# Fill the dev stack from a real deployment so a fresh checkout needs zero configuration:
# `just dev`, then `just dev-sync railway` – or any Postgres URL, any provider. `--config`
# brings settings/fleet/roster/material but no Einsätze; `--yes` skips the prompt. The
# replaced dev database is dumped to ./backups/ first, and the dev logins keep working.
# Pull a deployment's database into the dev stack (SOURCE: Postgres URL or 'railway')
dev-sync SOURCE *FLAGS:
    ./scripts/dev-sync.sh {{SOURCE}} {{FLAGS}}

# ============================================
# Database
# ============================================

# Database management: just db [start|shell|seed|migrate|status|history|new|down|up]
db cmd="start" *args:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{cmd}}" in
        start)
            echo -e "\033[1;34m→ Starting PostgreSQL...\033[0m"
            docker compose -f docker-compose.dev.yml up -d postgres
            ;;
        shell)
            docker compose -f docker-compose.dev.yml exec postgres psql -U kprueck -d kprueck
            ;;
        seed)
            docker compose -f docker-compose.dev.yml exec backend uv run python -m app.seed
            ;;
        migrate)
            echo -e "\033[1;34m→ Running database migrations...\033[0m"
            cd backend && uv run alembic upgrade head
            ;;
        up)
            if [ -z "{{args}}" ]; then
                echo "Usage: just db up <revision>"
                exit 1
            fi
            echo -e "\033[1;34m→ Migrating to {{args}}...\033[0m"
            cd backend && uv run alembic upgrade {{args}}
            ;;
        down)
            echo -e "\033[1;34m→ Downgrading by one revision...\033[0m"
            cd backend && uv run alembic downgrade -1
            ;;
        status)
            cd backend && uv run alembic current
            ;;
        history)
            cd backend && uv run alembic history
            ;;
        new)
            if [ -z "{{args}}" ]; then
                echo "Usage: just db new \"migration message\""
                exit 1
            fi
            echo -e "\033[1;34m→ Creating migration: {{args}}\033[0m"
            cd backend && uv run alembic revision --autogenerate -m "{{args}}"
            ;;
        *)
            echo "Usage: just db [start|shell|seed|migrate|status|history|new|down|up]"
            echo ""
            echo "  start    Start PostgreSQL in Docker (default)"
            echo "  shell    Open psql shell"
            echo "  seed     Seed database with initial data"
            echo "  migrate  Run all pending migrations"
            echo "  status   Show current migration revision"
            echo "  history  Show migration history"
            echo "  new MSG  Create new migration: just db new \"add users table\""
            echo "  up REV   Migrate to specific revision: just db up abc123"
            echo "  down     Downgrade by one revision"
            ;;
    esac

# ============================================
# Backups
# ============================================

# One backup NOW, out of band – before an update, before a migration you don't trust.
# The nightly one is already running: .env.example ships COMPOSE_PROFILES=backup, so the
# sidecar is part of the normal stack. This recipe is the manual extra one.
# Runs pg_dump inside the db service's own image, so the client can never be older than the
# server (which is how "pg_dump: aborting because of server version mismatch" happens).
# Back up the database and the Reko photos now (defaults to BACKUP_HOST_DIR from .env)
backup dir="":
    #!/usr/bin/env bash
    set -euo pipefail
    # Default to the station's configured destination rather than ./backups. The old default
    # wrote into the checkout – the same disk as the database, which is a copy and not a
    # backup, and the one thing docs/DEPLOYMENT.md §6 tells you not to do.
    # Same .env reader as `up`, `doctor` and `tiles-status`: a naive grep|cut keeps the
    # trailing \r from a .env edited on Windows and leaves surrounding quotes in the path.
    envval() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }
    DEST="{{dir}}"
    if [ -z "$DEST" ]; then
        DEST="$(envval BACKUP_HOST_DIR)"
        DEST="${DEST:-./backups}"
    fi
    case "$DEST" in
        ./*|backups*)
            echo -e "\033[1;33m⚠  Writing to $DEST – inside this checkout, on the same disk as the database.\033[0m"
            echo -e "\033[1;33m   Fine for a pre-update snapshot you are about to use. Not a backup.\033[0m"
            echo -e "\033[1;33m   Set BACKUP_HOST_DIR in .env, or pass a path: just backup /mnt/backup\033[0m"
            ;;
    esac
    mkdir -p "$DEST"
    docker compose --profile backup run --rm --no-deps \
        -v "$(cd "$DEST" && pwd):/backups" \
        --entrypoint /scripts/backup.sh backup /backups
    echo -e "\033[1;32m✓ Backup written to $(cd "$DEST" && pwd)\033[0m"

# Restore the DATABASE half into an EMPTY database. It refuses to merge into a populated one –
# drop and recreate the database first (docs/DEPLOYMENT.md §6.1). The PHOTOS are a second,
# separate command in §6.1: they go in through the backend container, which is the only service
# that mounts the photo volume writable – the backup sidecar mounts it read-only on purpose, so
# that nothing in the backup path can ever delete a Reko photo.
#   just restore ./backups/daily/db-2026-07-30-033000.dump
# Restore a database dump into an empty database (photos: see DEPLOYMENT.md §6.1)
restore dump:
    #!/usr/bin/env bash
    set -euo pipefail
    src="$(cd "$(dirname "{{dump}}")" && pwd)"
    docker compose --profile backup run --rm --no-deps -v "$src:/restore:ro" \
        --entrypoint /scripts/restore.sh backup "/restore/$(basename "{{dump}}")"

# ============================================
# API contract
# ============================================

# `just --list` shows only the LAST comment line, so the summary goes last.
# Run this in the same change that adds or renames a route.
# Regenerate the committed OpenAPI spec (a pytest fails when docs/openapi.json drifts)
openapi:
    cd backend && uv run python -m app.dump_openapi ../docs/openapi.json

# ============================================
# Offline Maps
# ============================================

# Generate full offline tiles for TILES_REGION (dev or production stack)
tiles-download:
    @echo "\033[1;34m→ Downloading and generating offline map tiles...\033[0m"
    @echo "\033[1;34m→ Downloads ~500 MB OSM data, converts to ~12 MB MBTiles\033[0m"
    @echo "\033[1;34m→ Uses Docker (planetiler) - no local tools needed\033[0m"
    @echo "\033[1;34m→ Takes 5-15 minutes depending on system\033[0m"
    @echo ""
    ./scripts/download-tiles.sh

# Check tile server status and verify tiles are loaded
tiles-status:
    #!/usr/bin/env bash
    set -euo pipefail
    # HTTP_PORT, DOMAIN and TILES_NAME live in .env, not in the shell that runs `just` – the
    # same reader `just doctor` uses. Reading them from the environment meant every domain
    # deployment (where HTTP_PORT is 80) probed 8080, found nothing, and reported a healthy
    # tile server as down – at the exact step docs/SETUP.md uses to confirm a 15-minute tile
    # generation worked. An explicit shell value still wins, per scripts/download-tiles.sh.
    envval() { [ -f .env ] || return 0; sed -n "s/^$1=//p" .env | tail -n1 | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }
    PORT="$(envval HTTP_PORT)"; PORT="${PORT:-8080}"
    DOMAIN="$(envval DOMAIN)"
    TILES_NAME="${TILES_NAME:-$(envval TILES_NAME)}"; TILES_NAME="${TILES_NAME:-basel-landschaft}"

    FMT='{{ "{{" }}.Names{{ "}}" }}'
    echo -e "\033[1;34m→ Checking tile server status...\033[0m"
    # Matches both stacks: kprueck-tileserver-dev and kp-rueck-tileserver-1.
    if docker ps --format "$FMT" | grep -qE '^kp-?rueck[-_].*tileserver'; then
        echo -e "\033[1;32m✓ Tile server container is running\033[0m"
        # Production puts Caddy on HTTP_PORT and proxies /tiles; dev publishes the tileserver
        # directly on 8080. The /tiles probes come FIRST because a production stack left on
        # port 8080 also answers /health – from the BACKEND – which used to set the dev base
        # and made every tile lookup below miss its path. -k so a certificate that is
        # self-signed, or still being issued, does not read as "the tile server is down".
        BASE=""
        if [ -n "$DOMAIN" ] && curl -sfk -m 10 "https://$DOMAIN/tiles/health" > /dev/null 2>&1; then
            BASE="https://$DOMAIN/tiles"
        elif curl -sf -m 10 "http://localhost:$PORT/tiles/health" > /dev/null 2>&1; then
            BASE="http://localhost:$PORT/tiles"
        elif curl -sf -m 10 http://localhost:8080/health > /dev/null 2>&1; then
            BASE="http://localhost:8080"
        fi
        if [ -n "$BASE" ]; then
            echo -e "\033[1;32m✓ Tile server is responding ($BASE)\033[0m"
            # A 200 on /health is not enough: the container generates a placeholder MBTiles on
            # first run, so the endpoint exists even with no map data behind it. Same marker
            # `just doctor` looks for (scripts/init-tileserver.sh writes the name).
            #
            # Asked of /index.json, NOT of /data/${TILES_NAME}.json. TileServer GL renames the
            # data set to `v3` whenever the MBTiles is in OpenMapTiles format – which is every
            # set `just tiles-download` generates – so a path built from the filename exists
            # only for the raster placeholder. The success branch below was therefore
            # unreachable: a finished 15-minute generation reported "no data set called
            # basel-landschaft". /index.json lists whatever is served under whatever name, and
            # is the same source the app reads (frontend/lib/hooks/use-tile-availability.ts).
            # Only ever one MBTiles is served – the container picks a single file – so the
            # bootstrap marker below cannot be shadowed by a second, real data set.
            TJ="$(curl -sfk -m 10 "${BASE}/index.json" 2>/dev/null || true)"
            if [ -z "$TJ" ] || [ "$TJ" = "[]" ]; then
                echo -e "\033[1;33m⚠️  The tile server is serving no data set at all\033[0m"
                echo "Run 'just tiles-download', or look at what is on the volume"
            elif printf '%s' "$TJ" | grep -qi 'Bootstrap MBTiles'; then
                echo -e "\033[1;33m⚠️  Only minimal bootstrap tiles (no offline data)\033[0m"
                echo "Run 'just tiles-download' for full offline capability"
            else
                echo -e "\033[1;32m✓ Offline tiles are loaded (${TILES_NAME})\033[0m"
                echo ""
                echo "Tile endpoints:"
                echo "  - UI:     $BASE"
                echo "  - Raster: ${BASE}/styles/basic-preview/512/{z}/{x}/{y}.png"
                echo "  - Vector: ${BASE}/styles/basic-preview/style.json"
            fi
        else
            echo -e "\033[1;31m✗ Tile server is not responding\033[0m"
            echo "Try: just tiles-restart"
        fi
    else
        echo -e "\033[1;31m✗ Tile server container is not running\033[0m"
        echo "Start the stack: 'just up' (station) or 'just dev' (development)"
    fi

# Restart tile server container
tiles-restart:
    #!/usr/bin/env bash
    set -euo pipefail
    FMT='{{ "{{" }}.Names{{ "}}" }}'
    echo -e "\033[1;34m→ Restarting tile server...\033[0m"
    if docker ps -a --format "$FMT" | grep -qE '^kp-?rueck[-_].*tileserver'; then
        docker restart $(docker ps -a --format "$FMT" | grep -E '^kp-?rueck[-_].*tileserver') > /dev/null
        echo -e "\033[1;32m✓ Tile server restarted\033[0m"
    else
        echo -e "\033[1;31m✗ Tile server container not found.\033[0m"
        echo "Start the stack: 'just up' (station) or 'just dev' (development)"
    fi

# ============================================
# Thermal Printer
# ============================================

# Print agent management: just printer [start|dry|stop|status|logs]
printer cmd="start":
    #!/usr/bin/env bash
    set -euo pipefail
    # The agent refuses to guess a backend – no BACKEND_URL means "no configuration", by
    # design. So the dev wiring belongs here: the local backend, and the token both ends
    # must share (the print endpoints are fail-closed, an unset token is 403, not open).
    # Defaults match docker-compose.dev.yml, so `just dev` + `just printer` just work.
    # These deliberately do NOT read .env, unlike `up` / `doctor` / `backup` / `tiles-status`.
    # This recipe drives the DEVELOPMENT agent; reading the station's .env would point it at
    # the production print queue and it would start claiming and printing real jobs. Pass
    # BACKEND_URL / PRINT_AGENT_TOKEN in the environment if you really mean to aim it
    # elsewhere. The station's own agent runs as the `printing` compose profile instead.
    export BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
    export AGENT_TOKEN="${PRINT_AGENT_TOKEN:-dev-print-token}"
    case "{{cmd}}" in
        start)
            echo -e "\033[1;34m→ Starting thermal print agent...\033[0m"
            echo -e "\033[1;34m→ Backend: $BACKEND_URL (printer config comes from its settings)\033[0m"
            echo -e "\033[1;34m→ Use 'just printer dry' for testing without a printer\033[0m"
            # --extra escpos: python-escpos/pillow are optional (the CUPS path needs neither),
            # so a plain `uv run` reaches the printer and fails on the lazy import instead.
            cd tools/print-agent && uv run --extra escpos python agent.py
            ;;
        dry)
            echo -e "\033[1;34m→ Starting print agent in DRY RUN mode (no printer needed)...\033[0m"
            # No --extra here on purpose: dry run never touches the ESC/POS packages.
            cd tools/print-agent && DRY_RUN=true uv run python agent.py
            ;;
        bg)
            echo -e "\033[1;34m→ Starting thermal print agent in background...\033[0m"
            cd tools/print-agent && nohup uv run --extra escpos python agent.py > /tmp/kprueck-print-agent.log 2>&1 &
            echo -e "\033[1;32m✓ Print agent started in background\033[0m"
            echo -e "\033[1;34m→ Logs: just printer logs\033[0m"
            ;;
        stop)
            echo -e "\033[1;34m→ Stopping print agent...\033[0m"
            pkill -f "python agent.py" 2>/dev/null && echo -e "\033[1;32m✓ Print agent stopped\033[0m" || echo -e "\033[1;33m⚠️  Print agent not running\033[0m"
            ;;
        status)
            echo -e "\033[1;34m→ Checking print agent status...\033[0m"
            if pgrep -f "python agent.py" > /dev/null 2>&1; then
                echo -e "\033[1;32m✓ Print agent is running (PID $(pgrep -f 'python agent.py'))\033[0m"
                tail -5 /tmp/kprueck-print-agent.log 2>/dev/null || true
            else
                echo -e "\033[1;33m⚠️  Print agent is not running\033[0m"
                echo "Start with: just printer"
            fi
            ;;
        logs)
            tail -f /tmp/kprueck-print-agent.log
            ;;
        *)
            echo "Usage: just printer [start|dry|bg|stop|status|logs]"
            echo ""
            echo "  start   Start print agent (foreground, default)"
            echo "  dry     Start in dry-run mode (no printer needed)"
            echo "  bg      Start in background"
            echo "  stop    Stop background agent"
            echo "  status  Check if agent is running"
            echo "  logs    Tail agent logs"
            ;;
    esac

# ============================================
# Testing & Code Quality
# ============================================

# Run all tests (backend + frontend unit + E2E)
test:
    @echo "\033[1;34m→ Running backend tests...\033[0m"
    cd backend && uv run pytest
    @echo ""
    @echo "\033[1;34m→ Running frontend unit tests (Vitest)...\033[0m"
    cd frontend && pnpm test
    @echo ""
    @echo "\033[1;34m→ Running E2E tests...\033[0m"
    @echo "\033[1;34m→ Ensure services are running: just dev\033[0m"
    cd frontend && pnpm test:e2e

# Run E2E tests in interactive UI mode
test-ui:
    @echo "\033[1;34m→ Starting Playwright UI mode...\033[0m"
    cd frontend && pnpm test:e2e:ui

# Lint all code (backend + frontend)
lint:
    @echo "\033[1;34m→ Linting backend...\033[0m"
    cd backend && uv run ruff check .
    @echo ""
    @echo "\033[1;34m→ Linting frontend...\033[0m"
    cd frontend && pnpm lint

# Format all code (backend + frontend)
fmt:
    @echo "\033[1;34m→ Formatting backend...\033[0m"
    cd backend && uv run ruff format .
    @echo ""
    @echo "\033[1;34m→ Formatting frontend...\033[0m"
    cd frontend && pnpm lint --fix

# ============================================
# Releases  (tag a green main commit – see CHANGELOG.md for what the number means)
# ============================================

# A STARTING POINT: curate it into CHANGELOG.md's [Unreleased] section before bumping.
# Needs no install (uvx fetches git-cliff).
# Draft release notes from the commits since the last tag
changelog:
    uvx git-cliff --unreleased

# Same draft, headed with the version you're about to cut.
changelog-for version:
    uvx git-cliff --unreleased --tag v{{version}}

# Bump every version file (all four packages) + open the CHANGELOG section. No git state touched.
release version:
    python3 scripts/release.py {{version}}

# Stages ONLY the release files. Then: git push --follow-tags
#   → CI gate → four GHCR images + GitHub Release.
# Commit the version bump and tag it
release-tag version:
    git add frontend/package.json backend/pyproject.toml backend/uv.lock backend/app/config.py tools/print-agent/pyproject.toml docs/openapi.json CHANGELOG.md
    git commit -m "chore(release): v{{version}}"
    git tag -a v{{version}} -m "v{{version}}"
    @echo "\033[1;32m✓ Tagged v{{version}}. Push with: git push --follow-tags\033[0m"

# Preview the GitHub Release body for a version (what release.yml will publish).
release-notes version:
    python3 scripts/changelog_section.py {{version}}
