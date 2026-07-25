"""Background scheduler for draining the telemetry outbox.

Nothing here runs in a request path. A crash on the board posts to this station's own
backend and that request ends there; the forward happens later, on a timer, from the server.
An Einsatz never waits on our ingest being reachable, and an offline station simply queues.

Registered unconditionally but genuinely free when telemetry is off: `flush` returns at its
first env check without touching the database. Registering it always (rather than behind the
env flag) means an admin who switches consent on does not have to restart anything.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.database import async_session_maker
from app.logging_config import get_logger
from app.telemetry.forwarder import flush
from app.telemetry.outbox import sweep

logger = get_logger(__name__)

scheduler: AsyncIOScheduler | None = None


async def flush_outbox(session_maker=None) -> int:
    """Deliver what is queued and sweep what has expired. Never raises."""
    maker = session_maker or async_session_maker
    async with maker() as db:
        try:
            sent = await flush(db)
            await sweep(db)
            await db.commit()
            return sent
        except Exception:  # noqa: BLE001 — a diagnostics job must never wedge the scheduler
            await db.rollback()
            logger.exception("Telemetry flush failed")
            return 0


def start_telemetry_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        flush_outbox,
        IntervalTrigger(minutes=max(1, settings.telemetry_flush_minutes)),
        id="telemetry_flush",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("Telemetry flush scheduler started (%d min)", settings.telemetry_flush_minutes)


def stop_telemetry_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None
