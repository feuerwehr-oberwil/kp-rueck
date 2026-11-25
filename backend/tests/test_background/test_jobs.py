"""Which background jobs run where (app/background/jobs.py).

A job that writes into the mirrored tables must never run on a standby box: its write is
overwritten by the replication, or stops it with a duplicate key. These sets are the gate,
spelled out – a new job, or a changed row, changes them on purpose.
"""

from unittest.mock import AsyncMock

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.background.jobs import Job, lifespan_jobs, start_jobs, stop_jobs

EVERYWHERE = {
    "scheduler",
    "telemetry_flush",
    "heartbeat",
    "weather",
    "websocket_cleanup",
    "traccar_poller",
    "token_blocklist_cleanup",
    "login_throttle_cleanup",
}


def _running(*, standby: bool, demo: bool) -> set[str]:
    return {job.name for job in lifespan_jobs(AsyncIOScheduler()) if job.runs(standby=standby, demo=demo)}


def test_a_standby_mirror_runs_exactly_these_jobs():
    # The Traccar poll (with the GPS automation) and the fallback print ran on a mirror before
    # the job table too; whether they should is an open question, not this table's to settle.
    assert _running(standby=True, demo=False) == EVERYWHERE | {"fallback_print", "standby_watch"}


def test_the_hosted_board_runs_every_job_but_the_mirror_watch_and_the_demo_reset():
    assert _running(standby=False, demo=False) == EVERYWHERE | {
        "divera_retention",
        "roster_snapshot",
        "audit_cleanup",
        "divera_poller",
        "training_autogen",
        "regie_autopilot",
        "fallback_print",
        "notification_watch",
    }


def test_the_demo_resets_nightly_and_generates_nothing_unattended():
    assert _running(standby=False, demo=True) == EVERYWHERE | {
        "divera_retention",
        "roster_snapshot",
        "audit_cleanup",
        "demo_reset",
        "divera_poller",
        "notification_watch",
    }


@pytest.mark.asyncio
async def test_a_job_that_fails_to_start_is_skipped_and_the_rest_stop_in_reverse():
    calls: list[str] = []

    def step(name: str) -> AsyncMock:
        return AsyncMock(side_effect=lambda: calls.append(name))

    jobs = [
        Job(name="first", start=step("start first"), stop=step("stop first"), standby="also", demo="also"),
        Job(
            name="broken",
            start=AsyncMock(side_effect=RuntimeError("down")),
            stop=step("stop broken"),
            standby="also",
            demo="also",
        ),
        Job(name="last", start=step("start last"), stop=step("stop last"), standby="also", demo="also"),
    ]

    started = await start_jobs(jobs, standby=False, demo=False)
    await stop_jobs(started)

    assert calls == ["start first", "start last", "stop last", "stop first"]
