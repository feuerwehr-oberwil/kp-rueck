#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, HOST=${HOST}, DATABASE_URL=${DATABASE_URL:0:20}..."

# Initialize database tables
echo "Initializing database..."
if ! uv run python -m app.init_db; then
    echo "ERROR: Database initialization failed!"
    exit 1
fi

# Check if we should seed initial data
if [ "$SEED_DATABASE" = "true" ]; then
    echo "Seeding database with initial data..."
    if ! uv run python -m app.seed; then
        echo "WARNING: Database seeding failed, continuing anyway..."
    fi
fi

# Start the application
echo "Starting Uvicorn server on port ${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
