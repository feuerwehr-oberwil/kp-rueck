"""Background scheduler for periodic demo database reset."""

import shutil
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import settings
from app.database import engine
from app.logging_config import get_logger
from app.services.settings import DISPOSABLE_MARKER_KEY, DISPOSABLE_MARKER_VALUE

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


class NotADisposableDatabaseError(RuntimeError):
    """Raised when a destructive demo operation is aimed at a database that has not
    positively identified itself as disposable."""


# Tables consulted to decide whether a markerless database is empty enough to bootstrap.
_EMPTINESS_PROBES = (
    ("incidents", text("SELECT count(*) FROM incidents")),
    ("personnel", text("SELECT count(*) FROM personnel")),
    ("users", text("SELECT count(*) FROM users")),
)


async def assert_disposable_database(conn: AsyncConnection | None = None) -> None:
    """Refuse to destroy data unless this database has declared itself disposable.

    Two independent things must be true, and both are checked HERE rather than by the
    caller. The scheduler used to be the only gate: `main.py` starts it when `DEMO_MODE`
    is set, and `scheduled_demo_reset` itself checked nothing. So the documented
    force-reseed one-liner — importing `scheduled_demo_reset` and awaiting it — walked
    straight past every guard, and its victim was whatever `DATABASE_URL` happened to name.

    1. ``DEMO_MODE`` must be set for *this process*. Cheap, and catches a stray import.
    2. The database must carry the marker row the demo seeder writes. This is the one that
       matters, because it is a property of the *data* rather than of the environment: a
       real station's database has no such row, so pointing a demo deployment at it (or
       copying a demo `.env` onto a station) refuses instead of truncating.

    An empty database is allowed through so a fresh demo can bootstrap itself — there is
    nothing there to lose.
    """
    if not settings.demo_mode:
        raise NotADisposableDatabaseError(
            "Refusing to truncate: DEMO_MODE is not set for this process. "
            "This function destroys every table; it is only ever valid on a demo deployment."
        )

    if conn is not None:
        await _assert_marker_present(conn)
        return

    async with engine.begin() as own_conn:
        await _assert_marker_present(own_conn)


async def _assert_marker_present(conn: AsyncConnection) -> None:
    """The data-side half of the check, run on a caller-supplied connection.

    Taking the connection rather than opening one matters: the truncate that follows must
    happen in the same transaction we inspected, otherwise the database could change
    between the check and the destruction.
    """
    marker = (
        await conn.execute(
            text("SELECT value FROM settings WHERE key = :key"),
            {"key": DISPOSABLE_MARKER_KEY},
        )
    ).scalar_one_or_none()

    if marker == DISPOSABLE_MARKER_VALUE:
        return

    # No marker: only tolerable when there is nothing to destroy (first boot of a
    # fresh demo). "Empty" is judged by the tables that hold operational data. The counts
    # are literal statements rather than interpolated table names — an identifier cannot be
    # a bind parameter, and this is not the function in which to hand-build SQL.
    for table, count_sql in _EMPTINESS_PROBES:
        exists = (
            await conn.execute(
                text("SELECT to_regclass(:name)"),
                {"name": f"public.{table}"},
            )
        ).scalar_one_or_none()
        if not exists:
            continue
        count = (await conn.execute(count_sql)).scalar_one()
        if count:
            raise NotADisposableDatabaseError(
                f"Refusing to truncate: this database holds data ({table}={count}) but carries no "
                f"'{DISPOSABLE_MARKER_KEY}={DISPOSABLE_MARKER_VALUE}' marker. If it really is a demo "
                "database, set that row in `settings`; if it is a station's database, this call was a mistake."
            )


async def _truncate_all_tables() -> None:
    """Truncate all application tables (preserve alembic_version)."""
    # Tables to preserve
    preserve = {"alembic_version"}

    async with engine.begin() as conn:
        # Check and truncate share one transaction — see _assert_marker_present.
        await assert_disposable_database(conn)

        # Get all table names
        result = await conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        tables = [row[0] for row in result if row[0] not in preserve]

        if tables:
            # Truncate all tables in one statement with CASCADE
            table_list = ", ".join(f'"{t}"' for t in tables)
            await conn.execute(text(f"TRUNCATE TABLE {table_list} CASCADE"))
            logger.info(f"Truncated {len(tables)} tables")


def _clear_photos() -> None:
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


async def scheduled_demo_reset() -> None:
    """Perform a scheduled demo reset: truncate data, re-seed, broadcast."""
    global _next_reset_time

    if _shutting_down:
        logger.debug("Demo reset skipped: shutdown in progress")
        return

    logger.info("Starting scheduled demo reset...")

    # Checked here as well as inside _truncate_all_tables: this is the function the
    # documented force-reseed one-liner imports directly, so it must refuse on its own
    # rather than trust that a scheduler vetted it.
    await assert_disposable_database()

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

    except NotADisposableDatabaseError:
        # A refusal is not a failed reset — it means the guard stopped us from destroying
        # something. Never fold it into the generic error path, where it reads as a hiccup.
        raise
    except Exception as e:
        logger.error(f"Demo reset failed: {e}")


def start_demo_reset_scheduler() -> None:
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


def stop_demo_reset_scheduler() -> None:
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
