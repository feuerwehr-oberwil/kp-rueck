"""Scheduler for the map's weather layer (app/services/weather/service.py).

Radar every 5 minutes, offset 90 s past the slot (MeteoSwiss publishes a frame about a minute
after its nominal time); warnings every 10 minutes. Both run once right at startup so a freshly
booted board has weather within seconds, not after the first interval.

Fail-open like the heartbeat: WEATHER_ENABLED=false → nothing is scheduled; a failed round is
recorded in the source's status and swallowed. The board never waits on any of it.
"""

from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.database import async_session_maker
from app.logging_config import get_logger
from app.services.settings import get_station_coordinates
from app.services.weather.service import WARNINGS_INTERVAL_MINUTES, weather_service

logger = get_logger(__name__)

scheduler: AsyncIOScheduler | None = None


async def poll_radar() -> None:
    await weather_service.poll_radar()


async def poll_warnings() -> None:
    station: tuple[float, float] | None = None
    try:
        async with async_session_maker() as db:
            station = await get_station_coordinates(db)
    except Exception:
        # No database, no station – the warnings round still runs (and reports «no station»).
        logger.warning("Weather: could not read the station coordinates")
    await weather_service.poll_warnings(station)


def start_weather_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        return
    if not settings.weather_enabled:
        logger.info("Weather layer disabled (WEATHER_ENABLED=false)")
        return
    now = datetime.now(UTC)
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        poll_radar,
        # :01:30, :06:30, … – 90 s after each 5-minute slot.
        CronTrigger(minute="1-59/5", second=30),
        id="weather_radar",
        max_instances=1,
        coalesce=True,
        next_run_time=now,
    )
    scheduler.add_job(
        poll_warnings,
        IntervalTrigger(minutes=WARNINGS_INTERVAL_MINUTES),
        id="weather_warnings",
        max_instances=1,
        coalesce=True,
        next_run_time=now,
    )
    scheduler.start()
    logger.info("Weather scheduler started (radar 5 min, warnings %d min)", WARNINGS_INTERVAL_MINUTES)


def stop_weather_scheduler() -> None:
    global scheduler
    if scheduler is not None:
        scheduler.shutdown(wait=False)
        scheduler = None
