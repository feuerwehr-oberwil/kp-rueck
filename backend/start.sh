#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, DATABASE_URL=${DATABASE_URL:0:30}..."

# Run Alembic migrations
echo "Running database migrations..."
uv run alembic upgrade head

# Seed the database (will skip if already seeded)
echo "Seeding database..."
uv run python -m app.seed

# Start the application
echo "Starting Uvicorn server on 0.0.0.0:${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "0.0.0.0" --port "${PORT:-8000}"
