#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, DATABASE_URL=${DATABASE_URL:0:30}..."

# Start the application (database tables will be created by FastAPI lifespan)
echo "Starting Uvicorn server on 0.0.0.0:${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "0.0.0.0" --port "${PORT:-8000}"
