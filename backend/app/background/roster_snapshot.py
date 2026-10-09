"""Poll the station's published roster file (services/roster_snapshot_sync.py).

Boot-gated like the heartbeat: ``ROSTER_SNAPSHOT_SOURCE`` is an environment setting, so a
deployment without one never schedules anything and the Divera roster sync is the only roster
source, exactly as before. With one, the file is read once shortly after boot and then every
``ROSTER_SNAPSHOT_INTERVAL_MINUTES``; an unchanged file is recognised by its checksum and skipped.

Fail-soft: a run that fails is recorded in its status row and logged, never raised — a roster
feed that is down must not disturb a board that is running.
"""

from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)

scheduler: AsyncIOScheduler | None = None

#: The first read waits this long after boot, so it never competes with migrations and seeding.
FIRST_RUN_DELAY_SECONDS = 60


async def tick() -> None:
    """One scheduled run. Never raises."""
    from app.database import async_session_maker
    from app.services.roster_snapshot_sync import run

    try:
        async with async_session_maker() as db:
            await run(db, trigger="scheduled", skip_unchanged=True)
    except Exception:
        logger.exception("Roster snapshot poll failed (non-fatal)")


def start_roster_snapshot_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    if not settings.roster_snapshot_source.strip():
        logger.info("Roster snapshot disabled (ROSTER_SNAPSHOT_SOURCE unset)")
        return
    minutes = settings.roster_snapshot_interval_minutes
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        tick,
        IntervalTrigger(minutes=minutes),
        id="roster_snapshot",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(UTC) + timedelta(seconds=FIRST_RUN_DELAY_SECONDS),
    )
    scheduler.start()
    logger.info("Roster snapshot scheduler started (every %d min)", minutes)


def stop_roster_snapshot_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None
