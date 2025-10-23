#!/bin/bash
set -e

echo "Starting KP Rück Backend..."
echo "Environment: PORT=${PORT}, DATABASE_URL=${DATABASE_URL:0:30}..."

# Run Alembic migrations
echo "Running database migrations..."
uv run alembic upgrade head

# Insert default settings if not present
echo "Ensuring default settings exist..."
uv run python -c "
import asyncio
from sqlalchemy import text
from app.database import async_session_maker

async def ensure_settings():
    async with async_session_maker() as session:
        await session.execute(text(\"\"\"
            INSERT INTO settings (key, value) VALUES
                ('polling_interval_ms', '5000'),
                ('training_mode', 'false'),
                ('auto_archive_timeout_hours', '24'),
                ('notification_enabled', 'false'),
                ('alarm_webhook_secret', 'CHANGE_ME')
            ON CONFLICT (key) DO NOTHING
        \"\"\"))
        await session.commit()

asyncio.run(ensure_settings())
print('Default settings initialized')
"

# Start the application
echo "Starting Uvicorn server on 0.0.0.0:${PORT:-8000}..."
exec uv run uvicorn app.main:app --host "0.0.0.0" --port "${PORT:-8000}"
