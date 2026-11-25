"""Every background job of the app, in one table: what runs where, started and stopped in order.

The lifespan (app/main.py) calls `start_jobs` once after the boot steps and `stop_jobs` once on
shutdown. Each row says where its job runs:

- ``standby``: on a standby mirror (app/standby.py). A job that WRITES into the mirrored tables
  is ``"skip"`` there – the hosted board runs it and its rows arrive by replication; a local
  write would be overwritten, or stop the replication with a duplicate key.
- ``demo``: on the public demo (``DEMO_MODE``).

``"also"`` runs there as well, ``"skip"`` not there, ``"only"`` only there. A new job is one
row here – and one line in tests/test_background/test_jobs.py, which pins the standby set.

The interval jobs share one APScheduler (``scheduler`` row, first in, last out); each of their
modules adds its jobs with ``schedule(scheduler)`` and logs when its config switches it off. The
other rows own an asyncio loop. A job that fails to start is logged and the boot goes on: a
station whose board refuses to boot because a monitor or a feed is down is worse off.
"""

import inspect
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from ..auth.login_throttle import login_throttle
from ..auth.token_blocklist import token_blocklist
from ..services.divera_poller import divera_poller, start_divera_polling
from ..services.traccar_poller import traccar_poller
from ..services.training_autogen_task import training_autogen_task
from ..services.training_regie import regie_autopilot_task
from ..websocket_manager import ws_manager
from . import (
    audit_cleanup,
    demo_reset,
    divera_retention,
    heartbeat,
    notification_watch,
    roster_snapshot,
    standby_watch,
    telemetry_flush,
    weather,
)
from .fallback_print import fallback_print_task

logger = logging.getLogger(__name__)

Where = Literal["also", "skip", "only"]
Step = Callable[[], Awaitable[None] | None]


@dataclass(frozen=True, kw_only=True)
class Job:
    """One background job: how to start and stop it, and where it runs (see the module docstring)."""

    name: str
    start: Step
    stop: Step | None = None
    standby: Where
    demo: Where

    def runs(self, *, standby: bool, demo: bool) -> bool:
        """Whether this job runs on a box that is (or is not) a standby mirror / the demo."""
        return _allowed(self.standby, standby) and _allowed(self.demo, demo)


def _allowed(where: Where, here: bool) -> bool:
    return where == "also" or (where == "only") == here


def lifespan_jobs(scheduler: AsyncIOScheduler) -> tuple[Job, ...]:
    """The table. Started top to bottom, stopped bottom to top."""

    def on(schedule: Callable[[AsyncIOScheduler], None]) -> Step:
        return lambda: schedule(scheduler)

    return (
        Job(
            name="scheduler",
            start=scheduler.start,
            stop=lambda: scheduler.shutdown(wait=False),
            standby="also",
            demo="also",
        ),
        # A no-op unless an admin opted in (app/telemetry/); scheduled always, so consent needs no restart.
        Job(name="telemetry_flush", start=on(telemetry_flush.schedule), standby="also", demo="also"),
        # Dead-man's switch; nothing without HEALTHCHECK_PING_URL.
        Job(name="heartbeat", start=on(heartbeat.schedule), standby="also", demo="also"),
        # Divera Rückmeldungen are personal data: deleted 48 h after the alarm.
        Job(name="divera_retention", start=on(divera_retention.schedule), standby="skip", demo="also"),
        # Radar and official warnings for the map; nothing with WEATHER_ENABLED=false.
        Job(name="weather", start=on(weather.schedule), standby="also", demo="also"),
        # The station's published roster file; nothing without a source.
        Job(name="roster_snapshot", start=on(roster_snapshot.schedule), standby="skip", demo="also"),
        Job(name="audit_cleanup", start=on(audit_cleanup.schedule), standby="skip", demo="also"),
        Job(name="demo_reset", start=on(demo_reset.schedule), standby="also", demo="only"),
        Job(
            name="websocket_cleanup",
            start=ws_manager.start_cleanup_task,
            stop=ws_manager.stop_cleanup_task,
            standby="also",
            demo="also",
        ),
        # Alarms are polled (and auto-attached) whether or not a board is open; nothing
        # without DIVERA_ACCESS_KEY.
        Job(
            name="divera_poller",
            start=start_divera_polling,
            stop=divera_poller.stop_polling,
            standby="skip",
            demo="also",
        ),
        # Positions for the map and the GPS automation, board open or not; nothing without
        # Traccar, a GPS simulation or the demo's own positions.
        Job(
            name="traccar_poller",
            start=traccar_poller.start_polling,
            stop=traccar_poller.stop_polling,
            standby="also",
            demo="also",
        ),
        Job(
            name="token_blocklist_cleanup",
            start=token_blocklist.start_cleanup_task,
            stop=token_blocklist.stop_cleanup_task,
            standby="also",
            demo="also",
        ),
        Job(
            name="login_throttle_cleanup",
            start=login_throttle.start_cleanup_task,
            stop=login_throttle.stop_cleanup_task,
            standby="also",
            demo="also",
        ),
        # Idle unless switched on; no unattended generation on the public demo.
        Job(
            name="training_autogen",
            start=training_autogen_task.start,
            stop=training_autogen_task.stop,
            standby="skip",
            demo="skip",
        ),
        # The Regie's Autopilot, idle unless switched on in the Übungs-Steuerung.
        Job(
            name="regie_autopilot",
            start=regie_autopilot_task.start,
            stop=regie_autopilot_task.stop,
            standby="skip",
            demo="skip",
        ),
        # Idle unless fallback.auto_print_enabled; the demo has no printer.
        Job(
            name="fallback_print",
            start=fallback_print_task.start,
            stop=fallback_print_task.stop,
            standby="also",
            demo="skip",
        ),
        # A mirror's notification rows come from the hosted board; everywhere else the rules
        # are evaluated on a clock.
        Job(
            name="notification_watch",
            start=notification_watch.start_notification_watch,
            stop=notification_watch.stop_notification_watch,
            standby="skip",
            demo="also",
        ),
        # Tells open boards on a mirror to reload when replication has applied something.
        Job(
            name="standby_watch",
            start=standby_watch.start_standby_watch,
            stop=standby_watch.stop_standby_watch,
            standby="only",
            demo="also",
        ),
    )


async def _run(step: Step) -> None:
    result = step()
    if inspect.isawaitable(result):
        await result


async def start_jobs(jobs: Sequence[Job], *, standby: bool, demo: bool) -> list[Job]:
    """Start every job that runs here, in table order. Returns the started ones for `stop_jobs`."""
    started: list[Job] = []
    for job in jobs:
        if not job.runs(standby=standby, demo=demo):
            continue
        try:
            await _run(job.start)
        except Exception:
            logger.exception("Background job %s failed to start", job.name)
            continue
        started.append(job)
    logger.info("Background jobs started: %s", ", ".join(job.name for job in started))
    return started


async def stop_jobs(started: Sequence[Job]) -> None:
    """Stop the started jobs in reverse order. A failed stop is logged; the others still stop."""
    for job in reversed(started):
        if job.stop is None:
            continue
        try:
            await _run(job.stop)
        except Exception:
            logger.exception("Background job %s failed to stop", job.name)
