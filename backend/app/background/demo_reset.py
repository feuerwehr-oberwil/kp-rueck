"""Background scheduler for periodic demo database reset."""

import shutil
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.logging_config import get_logger

logger = get_logger(__name__)

# Global state
scheduler: AsyncIOScheduler | None = None
_next_reset_time: datetime | None = None
_shutting_down: bool = False


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
    """Clear the photos directory."""
    import os

    photos_dir = settings.photos_dir
    if os.path.exists(photos_dir):
        shutil.rmtree(photos_dir)
        os.makedirs(photos_dir, exist_ok=True)
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

        # 4. Update next reset time
        _next_reset_time = datetime.now() + timedelta(hours=settings.demo_reset_hours)

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

    interval_hours = settings.demo_reset_hours
    _next_reset_time = datetime.now() + timedelta(hours=interval_hours)

    logger.info(
        f"Starting demo reset scheduler (interval: {interval_hours}h, next reset: {_next_reset_time.isoformat()})"
    )

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        scheduled_demo_reset,
        trigger=IntervalTrigger(hours=interval_hours),
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
