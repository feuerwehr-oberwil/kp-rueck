"""Tests for the paper-fallback auto-print background task.

The task idles unless ``fallback.auto_print_enabled`` and a WORKING printer —
``printer.enabled`` on AND ``printer.ip`` set — are all in place, then queues one
board-snapshot print job per open event every interval, and only when the board
changed since the last automatic job.

Training events are included: the station drills the paper fallback the way it
would run it, and the slip carries an ÜBUNG header so it cannot be confused with
a real one.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.background.fallback_print import FallbackPrintTask
from app.models import Event, PrintJob, Setting


async def _set_setting(db_session, key: str, value: str):
    result = await db_session.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        db_session.add(Setting(key=key, value=value))
    await db_session.commit()


async def _auto_jobs(db_session, event_id):
    result = await db_session.execute(
        select(PrintJob).where(PrintJob.event_id == event_id, PrintJob.job_type == "board")
    )
    return [j for j in result.scalars().all() if j.payload.get("auto")]


@pytest.fixture
def task():
    return FallbackPrintTask()


@pytest.mark.asyncio
class TestFallbackPrintGates:
    async def test_disabled_creates_no_jobs(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "false")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")
        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, test_event.id) == []

    async def test_printer_disabled_creates_no_jobs(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "false")
        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, test_event.id) == []

    async def test_no_printer_address_creates_no_jobs(self, db_session, test_event, test_incident, task):
        """Switched on but nowhere to send it: a snapshot every 15 minutes would fill the
        queue with jobs no agent can ever print. Same condition the API enforces at the door."""
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "  ")
        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, test_event.id) == []

    async def test_training_events_are_printed_too(self, db_session, task):
        """A drill prints. The fallback nobody can rehearse is not a fallback."""
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")
        training_event = Event(id=uuid4(), name="Übung", training_flag=True)
        db_session.add(training_event)
        await db_session.commit()

        await task._check_and_print(db_session)

        jobs = await _auto_jobs(db_session, training_event.id)
        assert len(jobs) == 1
        # The header the print agent renders from this is what keeps a drill slip
        # distinguishable from a real one (tools/print-agent/formatters.py).
        assert jobs[0].payload["training_flag"] is True

    async def test_archived_events_are_ignored(self, db_session, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")
        archived = Event(id=uuid4(), name="Alt", archived_at=datetime.now(UTC))
        db_session.add(archived)
        await db_session.commit()

        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, archived.id) == []


@pytest.mark.asyncio
class TestFallbackPrintBehavior:
    async def test_first_run_queues_snapshot(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")

        await task._check_and_print(db_session)

        jobs = await _auto_jobs(db_session, test_event.id)
        assert len(jobs) == 1
        assert jobs[0].status == "pending"
        assert jobs[0].payload["auto"] is True
        assert jobs[0].payload["event_name"] == test_event.name
        assert len(jobs[0].payload["incidents"]) == 1

    async def test_within_interval_no_second_job(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")

        await task._check_and_print(db_session)
        await task._check_and_print(db_session)

        assert len(await _auto_jobs(db_session, test_event.id)) == 1

    async def test_after_interval_without_changes_no_job(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")

        await task._check_and_print(db_session)
        jobs = await _auto_jobs(db_session, test_event.id)
        # Age both the job and the incident's last change past the interval
        jobs[0].created_at = datetime.now(UTC) - timedelta(minutes=30)
        test_incident.updated_at = datetime.now(UTC) - timedelta(minutes=60)
        await db_session.commit()

        await task._check_and_print(db_session)
        assert len(await _auto_jobs(db_session, test_event.id)) == 1

    async def test_after_interval_with_change_queues_again(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")

        await task._check_and_print(db_session)
        jobs = await _auto_jobs(db_session, test_event.id)
        jobs[0].created_at = datetime.now(UTC) - timedelta(minutes=30)
        await db_session.commit()

        # Board change after the last snapshot
        test_incident.title = "Wohnungsbrand — Lage verschärft"
        await db_session.commit()

        await task._check_and_print(db_session)
        assert len(await _auto_jobs(db_session, test_event.id)) == 2

    async def test_invalid_interval_falls_back_to_default(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        await _set_setting(db_session, "printer.ip", "10.10.10.230")
        await _set_setting(db_session, "fallback.auto_print_interval_min", "not-a-number")

        await task._check_and_print(db_session)
        assert len(await _auto_jobs(db_session, test_event.id)) == 1


@pytest.mark.asyncio
class TestFallbackPrintLifecycle:
    async def test_start_stop(self, task):
        await task.start()
        assert task.running
        await task.stop()
        assert not task.running
