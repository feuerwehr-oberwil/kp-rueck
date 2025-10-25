# KP Rück Dashboard - Makefile

.PHONY: help dev stop clean init-db seed-db logs db-only backend-local frontend-local backend-dev frontend-dev logs-backend logs-frontend shell-db

help: ## Show this help message
	@echo "KP Rück Dashboard - Available Commands:"
	@echo ""
	@echo "\033[1mFull Stack Development:\033[0m"
	@grep -E '^dev:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mQuick Local Testing:\033[0m"
	@grep -E '^(db-only|backend-local|frontend-local|backend-dev|frontend-dev):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mDatabase Management:\033[0m"
	@grep -E '^(init-db|seed-db|shell-db):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mLogs & Monitoring:\033[0m"
	@grep -E '^(logs|logs-backend|logs-frontend):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "\033[1mCleanup:\033[0m"
	@grep -E '^(stop|clean):.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Start all services in development mode with hot reload
	docker-compose -f docker-compose.dev.yml up --build

db-only: ## Start only PostgreSQL database (for local backend/frontend testing)
	docker-compose -f docker-compose.dev.yml up -d postgres

backend-local: db-only ## Run backend locally (requires uv). Database starts in Docker.
	@echo "\033[1;34m→ Starting backend on http://localhost:8000\033[0m"
	@echo "\033[1;34m→ Database running in Docker on port 5433\033[0m"
	@echo "\033[1;34m→ Press Ctrl+C to stop backend (database will keep running)\033[0m"
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend-local: ## Run frontend locally (requires pnpm). Ensure backend is running.
	@echo "\033[1;34m→ Starting frontend on http://localhost:3000\033[0m"
	@echo "\033[1;34m→ Ensure backend is running on http://localhost:8000\033[0m"
	@echo "\033[1;34m→ Press Ctrl+C to stop\033[0m"
	cd frontend && pnpm dev

backend-dev: backend-local ## Alias for backend-local

frontend-dev: frontend-local ## Alias for frontend-local

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

logs: ## Show logs from all services
	docker-compose -f docker-compose.dev.yml logs -f

logs-backend: ## Show logs from backend only
	docker-compose -f docker-compose.dev.yml logs -f backend

logs-frontend: ## Show logs from frontend only
	docker-compose -f docker-compose.dev.yml logs -f frontend
