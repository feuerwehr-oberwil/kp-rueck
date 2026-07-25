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

# Start the application with hot reload.
#
# --reload-dir app, not --reload-exclude '.venv/*': the exclude glob matches
# only DIRECT children, so nested paths like
# .venv/lib/python3.12/site-packages/... sailed straight through it. Any venv
# re-sync then dumped hundreds of "changes detected" into the reloader, which
# killed the worker without respawning (backend stuck at `health 000`).
# Allow-listing the one directory we actually edit is both narrower and
# immune to that whole class of glob bug.
echo "Starting Uvicorn server with hot reload on 0.0.0.0:8000..."
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
