#!/bin/bash
set -e

echo "Starting KP Rück Backend..."

# Initialize database tables
echo "Initializing database..."
uv run python -m app.init_db

# Check if we should seed initial data
if [ "$SEED_DATABASE" = "true" ]; then
    echo "Seeding database with initial data..."
    uv run python -m app.seed
fi

# Start the application
echo "Starting Uvicorn server..."
exec uv run uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}" --no-access-log
