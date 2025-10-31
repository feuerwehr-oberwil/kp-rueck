# KP Rück Dashboard - Makefile

.PHONY: help dev stop clean init-db seed-db logs db-only backend frontend backend frontend logs-backend logs-frontend shell-db tiles-download tiles-status tiles-help restart-tileserver

help: ## Show this help message
	@echo "KP Rück Dashboard - Available Commands:"
	@echo ""
	@echo "\033[1mFull Stack Development:\033[0m"
	@grep -E '^dev:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mQuick Local Testing:\033[0m"
	@grep -E '^(db-only|backend|frontend):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mDatabase Management:\033[0m"
	@grep -E '^(init-db|seed-db|shell-db):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mOffline Maps:\033[0m"
	@grep -E '^(tiles-download|tiles-status|tiles-help|restart-tileserver):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mCleanup:\033[0m"
	@grep -E '^(stop|clean):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Start all services in development mode with hot reload
	docker-compose -f docker-compose.dev.yml up --build

db-only: ## Start only PostgreSQL database (for local backend/frontend testing)
	docker-compose -f docker-compose.dev.yml up -d postgres

backend: db-only ## Run backend locally (requires uv). Database starts in Docker.
	@echo "\033[1;34m→ Starting backend on http://localhost:8000\033[0m"
	@echo "\033[1;34m→ Database running in Docker on port 5433\033[0m"
	@echo "\033[1;34m→ Press Ctrl+C to stop backend (database will keep running)\033[0m"
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend: ## Run frontend locally (requires pnpm). Ensure backend is running.
	@echo "\033[1;34m→ Starting frontend on http://localhost:3000\033[0m"
	@echo "\033[1;34m→ Ensure backend is running on http://localhost:8000\033[0m"
	@echo "\033[1;34m→ Press Ctrl+C to stop\033[0m"
	cd frontend && pnpm dev

stop: ## Stop all services
	docker-compose down
	docker-compose -f docker-compose.dev.yml down

clean: ## Stop all services and remove volumes
	docker-compose down -v
	docker-compose -f docker-compose.dev.yml down -v

init-db: ## Initialize database (create tables)
	docker-compose exec backend uv run python -m app.init_db

seed-db: ## Seed database with initial data
	docker-compose exec backend uv run python -m app.seed

shell-db: ## Access PostgreSQL shell
	docker-compose -f docker-compose.dev.yml exec postgres psql -U kprueck -d kprueck

tiles-download: ## Generate full offline tiles (~12 MB, local dev only)
	@echo "\033[1;34m→ Downloading and generating offline map tiles...\033[0m"
	@echo "\033[1;34m→ Downloads ~500 MB OSM data, converts to ~12 MB MBTiles\033[0m"
	@echo "\033[1;34m→ Uses Docker (planetiler) - no local tools needed\033[0m"
	@echo "\033[1;34m→ Takes 5-15 minutes depending on system\033[0m"
	@echo ""
	./scripts/download-tiles.sh

tiles-status: ## Check tile server status and verify tiles are loaded
	@echo "\033[1;34m→ Checking tile server status...\033[0m"
	@if docker ps --format '{{.Names}}' | grep -q "kprueck-tileserver"; then \
		echo "\033[1;32m✓ Tile server container is running\033[0m"; \
		if curl -s http://localhost:8080/health > /dev/null 2>&1; then \
			echo "\033[1;32m✓ Tile server is responding (http://localhost:8080)\033[0m"; \
			if curl -s http://localhost:8080/data/basel-landschaft.json > /dev/null 2>&1; then \
				echo "\033[1;32m✓ Basel-Landschaft tiles are loaded\033[0m"; \
				echo ""; \
				echo "Tile endpoints:"; \
				echo "  - UI: http://localhost:8080"; \
				echo "  - Tiles: http://localhost:8080/styles/basic/{z}/{x}/{y}.png"; \
			else \
				echo "\033[1;33m⚠️  Only minimal bootstrap tiles (no offline data)\033[0m"; \
				echo "Run 'make tiles-download' for full offline capability"; \
			fi; \
		else \
			echo "\033[1;31m✗ Tile server is not responding\033[0m"; \
			echo "Try: make restart-tileserver"; \
		fi; \
	else \
		echo "\033[1;31m✗ Tile server container is not running\033[0m"; \
		echo "Run 'make dev' to start all services"; \
	fi

tiles-help: ## Show offline maps documentation
	@echo "\033[1mOffline Maps Setup Guide\033[0m"
	@echo ""
	@echo "\033[1;32m✓ Automatic Setup (Local Dev):\033[0m"
	@echo "  - Minimal tiles auto-created on 'make dev'"
	@echo "  - TileServer GL starts automatically"
	@echo "  - Map uses online OSM by default with offline fallback"
	@echo ""
	@echo "\033[1;33m⚡ Optional Full Offline (Local Dev):\033[0m"
	@echo "  1. Run: make tiles-download (downloads ~500 MB, generates ~12 MB)"
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
	@echo "  make tiles-download  - Generate full offline tiles"
	@echo "  make tiles-status    - Check tile server status"
	@echo "  make tiles-help      - Show this help"
	@echo ""
	@echo "For detailed instructions, see: OFFLINE_MAPS.md"

restart-tileserver: ## Restart tile server container
	@echo "\033[1;34m→ Restarting tile server...\033[0m"
	@if docker ps -a --format '{{.Names}}' | grep -q "kprueck-tileserver"; then \
		docker restart $$(docker ps -a --format '{{.Names}}' | grep kprueck-tileserver) > /dev/null; \
		echo "\033[1;32m✓ Tile server restarted\033[0m"; \
	else \
		echo "\033[1;31m✗ Tile server container not found. Run 'make dev' first.\033[0m"; \
	fi

