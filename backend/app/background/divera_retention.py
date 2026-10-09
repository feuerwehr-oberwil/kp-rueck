"""Delete stored Divera Rückmeldungen 48 h after their alarm, and those of archived Ereignisse.

The answers are personal data (a note may say «krank»), kept only as long as «Anrückend» can
use them (services/divera_responses.py: display window 6 h, retention 48 h). The poller also
purges on every poll, but it only runs while somebody is connected – this hourly job is what
makes the 48 h hold when nobody opens the board for a week. Never raises.
"""

from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.database import async_session_maker
from app.logging_config import get_logger

logger = get_logger(__name__)

scheduler: AsyncIOScheduler | None = None


async def purge_divera_responses() -> int:
    from app.services.divera_responses import purge_expired

    try:
        async with async_session_maker() as db:
            purged = await purge_expired(db)
        if purged:
            logger.info("Divera Rückmeldungen: deleted the answers of %d alarm(s) past retention", purged)
        return purged
    except Exception as e:
        logger.warning("Divera Rückmeldungen retention failed (non-fatal): %s", type(e).__name__)
        return 0


def start_divera_retention_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    scheduler = AsyncIOScheduler()
    scheduler.add_job(purge_divera_responses, IntervalTrigger(hours=1), id="divera_retention", replace_existing=True)
    scheduler.add_job(
        purge_divera_responses,
        DateTrigger(run_date=datetime.now(UTC) + timedelta(minutes=2)),
        id="divera_retention_startup",
        replace_existing=True,
    )
    scheduler.start()


def stop_divera_retention_scheduler() -> None:
    global scheduler
    if scheduler is not None and scheduler.running:
        try:
            scheduler.shutdown(wait=False)
        except Exception as e:
            logger.warning("Divera retention scheduler shutdown error: %s", e)
    scheduler = None
