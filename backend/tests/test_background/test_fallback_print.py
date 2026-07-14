"""Tests for the paper-fallback auto-print background task.

The task idles unless ``fallback.auto_print_enabled`` AND ``printer.enabled``
are both on, then queues one board-snapshot print job per live event every
interval — and only when the board changed since the last automatic job.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.background.fallback_print import FallbackPrintTask
from app.models import Event, Incident, PrintJob, Setting


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
        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, test_event.id) == []

    async def test_printer_disabled_creates_no_jobs(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "false")
        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, test_event.id) == []

    async def test_training_events_are_ignored(self, db_session, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")
        training_event = Event(id=uuid4(), name="Übung", training_flag=True)
        db_session.add(training_event)
        await db_session.commit()

        await task._check_and_print(db_session)
        assert await _auto_jobs(db_session, training_event.id) == []


@pytest.mark.asyncio
class TestFallbackPrintBehavior:
    async def test_first_run_queues_snapshot(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")

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

        await task._check_and_print(db_session)
        await task._check_and_print(db_session)

        assert len(await _auto_jobs(db_session, test_event.id)) == 1

    async def test_after_interval_without_changes_no_job(self, db_session, test_event, test_incident, task):
        await _set_setting(db_session, "fallback.auto_print_enabled", "true")
        await _set_setting(db_session, "printer.enabled", "true")

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
