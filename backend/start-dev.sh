#!/bin/bash
set -e

echo "Starting KP Rück Backend (Development Mode)..."
echo "Environment: DATABASE_URL=${DATABASE_URL:0:30}..."

# Wait a moment for DB to be fully ready
sleep 2

# Run Alembic migrations
echo "Running database migrations..."
uv run alembic upgrade head

# Seed the database (will skip if already seeded)
echo "Seeding database..."
uv run python -m app.seed

# Start the application with hot reload
echo "Starting Uvicorn server with hot reload on 0.0.0.0:8000..."
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude '.venv/*'
