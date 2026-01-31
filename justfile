# KP Rück Dashboard - Justfile

# Default recipe to display help
default:
    @just --list --unsorted

# ============================================
# Full Stack Development
# ============================================

# Start all services in development mode with hot reload
dev:
    docker-compose -f docker-compose.dev.yml up --build

# ============================================
# Quick Local Testing
# ============================================

# Start only PostgreSQL database (for local backend/frontend testing)
db-only:
    docker-compose -f docker-compose.dev.yml up -d postgres

# Run backend locally (requires uv). Database starts in Docker.
be: db-only
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

# ============================================
# Database Management
# ============================================

# Initialize database (create tables)
init-db:
    docker-compose exec backend uv run python -m app.init_db

# Seed database with initial data
seed-db:
    docker-compose exec backend uv run python -m app.seed

# Run alembic migrations (upgrade to latest)
migrate:
    @echo "\033[1;34m→ Running database migrations...\033[0m"
    cd backend && uv run alembic upgrade head

# Run alembic upgrade to a specific revision
migrate-to revision:
    @echo "\033[1;34m→ Running database migration to {{revision}}...\033[0m"
    cd backend && uv run alembic upgrade {{revision}}

# Show current alembic revision
migrate-current:
    @echo "\033[1;34m→ Checking current database revision...\033[0m"
    cd backend && uv run alembic current

# Show alembic migration history
migrate-history:
    @echo "\033[1;34m→ Showing migration history...\033[0m"
    cd backend && uv run alembic history

# Create a new alembic migration
migrate-new message:
    @echo "\033[1;34m→ Creating new migration: {{message}}\033[0m"
    cd backend && uv run alembic revision --autogenerate -m "{{message}}"

# Downgrade database by one revision
migrate-down:
    @echo "\033[1;34m→ Downgrading database by one revision...\033[0m"
    cd backend && uv run alembic downgrade -1

# Access PostgreSQL shell
shell-db:
    docker-compose -f docker-compose.dev.yml exec postgres psql -U kprueck -d kprueck

# ============================================
# Offline Maps
# ============================================

# Generate full offline tiles (~12 MB, local dev only)
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
    if docker ps --format "$FMT" | grep -q "kprueck-tileserver"; then
        echo -e "\033[1;32m✓ Tile server container is running\033[0m"
        if curl -s http://localhost:8080/health > /dev/null 2>&1; then
            echo -e "\033[1;32m✓ Tile server is responding (http://localhost:8080)\033[0m"
            if curl -s http://localhost:8080/data/basel-landschaft.json > /dev/null 2>&1; then
                echo -e "\033[1;32m✓ Basel-Landschaft tiles are loaded\033[0m"
                echo ""
                echo "Tile endpoints:"
                echo "  - UI: http://localhost:8080"
                echo "  - Tiles: http://localhost:8080/styles/basic/{z}/{x}/{y}.png"
            else
                echo -e "\033[1;33m⚠️  Only minimal bootstrap tiles (no offline data)\033[0m"
                echo "Run 'just tiles-download' for full offline capability"
            fi
        else
            echo -e "\033[1;31m✗ Tile server is not responding\033[0m"
            echo "Try: just restart-tileserver"
        fi
    else
        echo -e "\033[1;31m✗ Tile server container is not running\033[0m"
        echo "Run 'just dev' to start all services"
    fi

# Show offline maps documentation
tiles-help:
    @echo "\033[1mOffline Maps Setup Guide\033[0m"
    @echo ""
    @echo "\033[1;32m✓ Automatic Setup (Local Dev):\033[0m"
    @echo "  - Minimal tiles auto-created on 'just dev'"
    @echo "  - TileServer GL starts automatically"
    @echo "  - Map uses online OSM by default with offline fallback"
    @echo ""
    @echo "\033[1;33m⚡ Optional Full Offline (Local Dev):\033[0m"
    @echo "  1. Run: just tiles-download (downloads ~500 MB, generates ~12 MB)"
    @echo "  2. Uses planetiler in Docker (no local tools needed)"
    @echo "  3. Takes 5-15 minutes to complete"
    @echo "  4. Tile server auto-restarts with new tiles"
    @echo "  5. Set map mode to 'Offline' in settings"
    @echo ""
    @echo "\033[1;36mℹ Production/Railway:\033[0m"
    @echo "  - No tile server (uses online OSM only)"
    @echo "  - Map mode automatically set to 'online'"
    @echo ""
    @echo "Commands:"
    @echo "  just tiles-download  - Generate full offline tiles"
    @echo "  just tiles-status    - Check tile server status"
    @echo "  just tiles-help      - Show this help"
    @echo ""
    @echo "For detailed instructions, see: OFFLINE_MAPS.md"

# Restart tile server container
restart-tileserver:
    #!/usr/bin/env bash
    set -euo pipefail
    FMT='{{ "{{" }}.Names{{ "}}" }}'
    echo -e "\033[1;34m→ Restarting tile server...\033[0m"
    if docker ps -a --format "$FMT" | grep -q "kprueck-tileserver"; then
        docker restart $(docker ps -a --format "$FMT" | grep kprueck-tileserver) > /dev/null
        echo -e "\033[1;32m✓ Tile server restarted\033[0m"
    else
        echo -e "\033[1;31m✗ Tile server container not found. Run 'just dev' first.\033[0m"
    fi

# ============================================
# Testing
# ============================================

# Run all E2E tests (requires frontend and backend running)
test:
    @echo "\033[1;34m→ Running all E2E tests...\033[0m"
    @echo "\033[1;34m→ Ensure services are running: just dev\033[0m"
    cd frontend && pnpm test

# Run tests in interactive UI mode
test-ui:
    @echo "\033[1;34m→ Starting Playwright UI mode...\033[0m"
    cd frontend && pnpm test:ui

# Run tests in headed mode (visible browser)
test-headed:
    @echo "\033[1;34m→ Running tests with visible browser...\033[0m"
    cd frontend && pnpm exec playwright test --headed

# Show last test report
test-report:
    @echo "\033[1;34m→ Opening last test report...\033[0m"
    cd frontend && pnpm exec playwright show-report

# Run authentication tests only
test-auth:
    @echo "\033[1;34m→ Running authentication tests (7 tests)...\033[0m"
    cd frontend && pnpm test tests/e2e/01-auth/login.spec.ts

# ============================================
# Cleanup
# ============================================

# Stop all services
stop:
    docker-compose down
    docker-compose -f docker-compose.dev.yml down

# Stop all services and remove volumes
clean:
    docker-compose down -v
    docker-compose -f docker-compose.dev.yml down -v

# ============================================
# Code Quality
# ============================================

# Run backend linting
lint-be:
    @echo "\033[1;34m→ Running backend linting...\033[0m"
    cd backend && uv run ruff check .

# Run backend formatting
fmt-be:
    @echo "\033[1;34m→ Formatting backend code...\033[0m"
    cd backend && uv run ruff format .

# Run frontend linting
lint-fe:
    @echo "\033[1;34m→ Running frontend linting...\033[0m"
    cd frontend && pnpm lint

# Run all linting
lint: lint-be lint-fe

# Format all code
fmt: fmt-be
