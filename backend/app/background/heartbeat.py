"""Dead-man's switch: ping an external monitor on a short cadence.

If this process or its event loop dies, the pings stop and the monitor alerts. That is the
class a plain HTTP probe of /health can miss — and the one that actually happened to the
sibling deployment on 2026-08-03, where a healthy container was stopped, nothing replaced it,
and the first thing that noticed was a person opening the app 25 minutes later.

The check is deliberately *outward*: a watchdog living inside the thing it watches dies with
it, which is exactly what makes the silence meaningful here. Absence of a ping is the signal.

Fail-open in every direction. No URL configured → the job is never scheduled. A failed ping is
logged and swallowed: a monitoring outage must never disturb an operational deployment, and a
station whose board stops working because healthchecks.io is down would be a worse bug than
the one this exists to catch.

Mirrors kp-front's `scheduler.py::_heartbeat` — same env var name, same 60 s cadence — so the
two deployments can be configured and reasoned about identically.
"""

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)

scheduler: AsyncIOScheduler | None = None

#: Matches kp-front. With a monitor period of 1 min and a few minutes of grace, a stopped
#: container surfaces in roughly the time it takes to walk to the tablet and find it dead.
PING_INTERVAL_SECONDS = 60


async def ping() -> bool:
    """GET the configured ping URL. Returns whether it landed. Never raises."""
    if not settings.healthcheck_ping_url:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.get(settings.healthcheck_ping_url)
        return True
    except Exception:
        logger.warning("Heartbeat ping failed (non-fatal)")
        return False


def start_heartbeat_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    if not settings.healthcheck_ping_url:
        logger.info("Heartbeat disabled (HEALTHCHECK_PING_URL unset)")
        return
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        ping,
        IntervalTrigger(seconds=PING_INTERVAL_SECONDS),
        id="heartbeat",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("Heartbeat scheduler started (%ds)", PING_INTERVAL_SECONDS)


def stop_heartbeat_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None
