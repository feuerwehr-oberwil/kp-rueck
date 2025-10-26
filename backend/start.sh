#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, DATABASE_URL=${DATABASE_URL:0:30}..."

# Set up photo storage directory
PHOTOS_DIR="${PHOTOS_DIR:-data/photos}"
echo "Photo storage directory: ${PHOTOS_DIR}"

# Create photos directory if it doesn't exist
if [ ! -d "${PHOTOS_DIR}" ]; then
    echo "Creating photos directory: ${PHOTOS_DIR}"
    mkdir -p "${PHOTOS_DIR}"
fi

# Verify directory is writable
if [ ! -w "${PHOTOS_DIR}" ]; then
    echo "ERROR: Photos directory is not writable: ${PHOTOS_DIR}"
    exit 1
fi

echo "Photos directory ready: ${PHOTOS_DIR}"

# Run Alembic migrations
echo "Running database migrations..."
uv run alembic upgrade head

# Seed the database (will skip if already seeded)
echo "Seeding database..."
uv run python -m app.seed

# Start the application
echo "Starting Uvicorn server on 0.0.0.0:${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "0.0.0.0" --port "${PORT:-8000}"
