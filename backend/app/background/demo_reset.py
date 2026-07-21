"""Background scheduler for periodic demo database reset."""

import shutil
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.logging_config import get_logger

logger = get_logger(__name__)

# The demo resets once a day at local (Swiss) midnight rather than on a rolling
# interval, so the reset time is predictable for visitors.
DEMO_RESET_TZ = ZoneInfo("Europe/Zurich")

# Global state
scheduler: AsyncIOScheduler | None = None
_next_reset_time: datetime | None = None
_shutting_down: bool = False


def _next_midnight_naive() -> datetime:
    """Next 00:00 Europe/Zurich, expressed as a naive datetime in the server's
    local timezone so it can be compared against ``datetime.now()`` (which the
    demo-status endpoint uses to compute the countdown)."""
    now_local = datetime.now(DEMO_RESET_TZ)
    nxt = (now_local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.astimezone().replace(tzinfo=None)


def get_next_reset_time() -> datetime | None:
    """Get the next scheduled reset time."""
    return _next_reset_time


async def _truncate_all_tables():
    """Truncate all application tables (preserve alembic_version)."""
    # Tables to preserve
    preserve = {"alembic_version"}

    async with engine.begin() as conn:
        # Get all table names
        result = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        tables = [row[0] for row in result if row[0] not in preserve]

        if tables:
            # Truncate all tables in one statement with CASCADE
            table_list = ", ".join(f'"{t}"' for t in tables)
            await conn.execute(text(f"TRUNCATE TABLE {table_list} CASCADE"))
            logger.info(f"Truncated {len(tables)} tables")


def _clear_photos():
    """Clear the photos directory contents (keep the directory itself for volume mounts)."""
    import os

    photos_dir = settings.photos_dir
    if os.path.exists(photos_dir):
        for entry in os.listdir(photos_dir):
            entry_path = os.path.join(photos_dir, entry)
            if os.path.isdir(entry_path):
                shutil.rmtree(entry_path)
            else:
                os.remove(entry_path)
        logger.info(f"Cleared photos directory: {photos_dir}")


async def scheduled_demo_reset():
    """Perform a scheduled demo reset: truncate data, re-seed, broadcast."""
    global _next_reset_time

    if _shutting_down:
        logger.debug("Demo reset skipped: shutdown in progress")
        return

    logger.info("Starting scheduled demo reset...")

    try:
        # 1. Truncate all tables
        await _truncate_all_tables()

        # 2. Clear photos
        _clear_photos()

        # 3. Re-seed demo data
        from app.seed_demo import seed_demo_database

        await seed_demo_database()

        # 4. Update next reset time (next local midnight)
        _next_reset_time = _next_midnight_naive()

        # 5. Broadcast reset message via WebSocket
        try:
            from app.websocket_manager import broadcast_message

            await broadcast_message({"type": "demo_reset"})
            logger.info("Broadcasted demo_reset WebSocket message")
        except Exception as e:
            logger.warning(f"Failed to broadcast demo_reset message: {e}")

        logger.info("Demo reset completed successfully. Next reset at %s", _next_reset_time.isoformat())

    except Exception as e:
        logger.error(f"Demo reset failed: {e}")


def start_demo_reset_scheduler():
    """Start the demo reset scheduler."""
    global scheduler, _next_reset_time

    _next_reset_time = _next_midnight_naive()

    logger.info(
        f"Starting demo reset scheduler (daily at 00:00 {DEMO_RESET_TZ.key}, next reset: {_next_reset_time.isoformat()})"
    )

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        scheduled_demo_reset,
        trigger=CronTrigger(hour=0, minute=0, timezone="Europe/Zurich"),
        id="demo_reset",
        name="Demo database reset",
        replace_existing=True,
    )
    scheduler.start()


def stop_demo_reset_scheduler():
    """Stop the demo reset scheduler."""
    global scheduler, _shutting_down

    _shutting_down = True
    if scheduler and scheduler.running:
        logger.info("Stopping demo reset scheduler...")
        try:
            scheduler.shutdown(wait=False)
            logger.info("Demo reset scheduler stopped")
        except Exception as e:
            logger.warning(f"Demo reset scheduler shutdown error: {e}")
