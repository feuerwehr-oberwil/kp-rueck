# KP Rück Dashboard - Justfile

# Default recipe to display help
default:
    @just --list --unsorted

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

# Stop all services
stop:
    docker compose -f docker-compose.dev.yml down
    @# The production stack's `${VAR:?}` guards fire on ANY compose subcommand, `down`
    @# included, so without an .env this line errors. That must not stop the dev stack
    @# above from having been brought down — which is what someone running `just stop`
    @# after `just dev` actually wants.
    -docker compose down

# Stop all services and remove volumes
clean:
    docker compose -f docker-compose.dev.yml down -v
    -docker compose down -v

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

# Postgres dump + the photo volume, from the same moment, with retention.
# Restore procedure and the drill: docs/DEPLOYMENT.md §6.1 / §6.2
# Back up the database and the Reko photos (default ./backups, BACKUP_KEEP=14)
backup dir="./backups":
    ./scripts/backup.sh {{dir}}

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
    FMT='{{ "{{" }}.Names{{ "}}" }}'
    echo -e "\033[1;34m→ Checking tile server status...\033[0m"
    # Matches both stacks: kprueck-tileserver-dev and kp-rueck-tileserver-1.
    if docker ps --format "$FMT" | grep -qE '^kp-?rueck[-_].*tileserver'; then
        echo -e "\033[1;32m✓ Tile server container is running\033[0m"
        # Dev publishes the tileserver directly on 8080; production puts Caddy on
        # HTTP_PORT and proxies /tiles to it. Try both rather than assuming one.
        BASE=""
        if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
            BASE="http://localhost:8080"
        elif curl -sf "http://localhost:${HTTP_PORT:-8080}/tiles/health" > /dev/null 2>&1; then
            BASE="http://localhost:${HTTP_PORT:-8080}/tiles"
        fi
        if [ -n "$BASE" ]; then
            echo -e "\033[1;32m✓ Tile server is responding ($BASE)\033[0m"
            TILES_NAME="${TILES_NAME:-basel-landschaft}"
            if curl -sf "${BASE}/data/${TILES_NAME}.json" > /dev/null 2>&1; then
                echo -e "\033[1;32m✓ Offline tiles are loaded (${TILES_NAME})\033[0m"
                echo ""
                echo "Tile endpoints:"
                echo "  - UI:    $BASE"
                echo "  - Tiles: ${BASE}/styles/basic-preview/512/{z}/{x}/{y}.png"
            else
                echo -e "\033[1;33m⚠️  Only minimal bootstrap tiles (no offline data)\033[0m"
                echo "Run 'just tiles-download' for full offline capability"
            fi
        else
            echo -e "\033[1;31m✗ Tile server is not responding\033[0m"
            echo "Try: just tiles-restart"
        fi
    else
        echo -e "\033[1;31m✗ Tile server container is not running\033[0m"
        echo "Start the stack: 'docker compose up -d' (production) or 'just dev'"
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
        echo "Start the stack: 'docker compose up -d' (production) or 'just dev'"
    fi

# ============================================
# Thermal Printer
# ============================================

# Print agent management: just printer [start|dry|stop|status|logs]
printer cmd="start":
    #!/usr/bin/env bash
    set -euo pipefail
    # The agent refuses to guess a backend — no BACKEND_URL means "no configuration", by
    # design. So the dev wiring belongs here: the local backend, and the token both ends
    # must share (the print endpoints are fail-closed, an unset token is 403, not open).
    # Defaults match docker-compose.dev.yml, so `just dev` + `just printer` just work.
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
