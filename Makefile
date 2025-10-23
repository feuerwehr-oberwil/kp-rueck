# KP Rück Dashboard - Makefile

.PHONY: help dev stop clean init-db seed-db logs

help: ## Show this help message
	@echo "KP Rück Dashboard - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

dev: ## Start all services in development mode with hot reload
	docker-compose -f docker-compose.dev.yml up --build

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

logs: ## Show logs from all services
	docker-compose logs -f
