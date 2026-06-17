"""Tests for the audit log cleanup background job."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.background import audit_cleanup
from app.background.audit_cleanup import (
    cleanup_old_audit_logs,
    start_audit_cleanup_scheduler,
    stop_audit_cleanup_scheduler,
)
from app.models import AuditLog


@pytest.fixture(autouse=True)
def reset_scheduler_state():
    """Reset global scheduler state before each test."""
    audit_cleanup.scheduler = None
    audit_cleanup._shutting_down = False
    yield
    if audit_cleanup.scheduler and audit_cleanup.scheduler.running:
        audit_cleanup.scheduler.shutdown(wait=False)
    audit_cleanup.scheduler = None
    audit_cleanup._shutting_down = False


@pytest.fixture
def session_maker(db_session):
    """Session factory yielding the test's savepoint-bound session.

    cleanup_old_audit_logs commits per batch; with the conftest's
    join_transaction_mode="create_savepoint" those commits stay inside the
    per-test transaction and roll back afterwards.
    """

    @asynccontextmanager
    async def _maker():
        yield db_session

    return _maker


def _audit_row(age: timedelta) -> AuditLog:
    return AuditLog(
        id=uuid4(),
        action_type="update",
        resource_type="incident",
        timestamp=datetime.now(UTC) - age,
    )


async def _count_rows(db_session) -> int:
    result = await db_session.execute(select(func.count()).select_from(AuditLog))
    return result.scalar_one()


class TestCleanupOldAuditLogs:
    @pytest.mark.asyncio
    async def test_deletes_old_keeps_recent(self, db_session, session_maker):
        old_rows = [_audit_row(timedelta(days=100)) for _ in range(3)]
        recent_rows = [_audit_row(timedelta(seconds=0)) for _ in range(2)]
        db_session.add_all(old_rows + recent_rows)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 3
        remaining = (await db_session.execute(select(AuditLog.id))).scalars().all()
        assert set(remaining) == {row.id for row in recent_rows}

    @pytest.mark.asyncio
    async def test_boundary_around_cutoff(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 90)
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)
        survivor = _audit_row(timedelta(days=90) - timedelta(hours=1))
        goner = _audit_row(timedelta(days=90) + timedelta(hours=1))
        db_session.add_all([survivor, goner])
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 1
        remaining = (await db_session.execute(select(AuditLog.id))).scalars().all()
        assert remaining == [survivor.id]

    @pytest.mark.asyncio
    async def test_batching_deletes_all_rows(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup, "BATCH_SIZE", 2)
        db_session.add_all([_audit_row(timedelta(days=100)) for _ in range(5)])
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 5
        assert await _count_rows(db_session) == 0

    @pytest.mark.asyncio
    async def test_demo_mode_caps_retention(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", True)
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 90)
        db_session.add(_audit_row(timedelta(days=10)))
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 1
        assert await _count_rows(db_session) == 0

    @pytest.mark.asyncio
    async def test_demo_mode_smaller_explicit_override_wins(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", True)
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 1)
        db_session.add(_audit_row(timedelta(days=2)))
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 1

    @pytest.mark.asyncio
    async def test_empty_table_returns_zero(self, session_maker):
        assert await cleanup_old_audit_logs(session_maker=session_maker) == 0

    @pytest.mark.asyncio
    async def test_skipped_during_shutdown(self, db_session, session_maker):
        audit_cleanup._shutting_down = True
        db_session.add(_audit_row(timedelta(days=100)))
        await db_session.commit()

        assert await cleanup_old_audit_logs(session_maker=session_maker) == 0
        assert await _count_rows(db_session) == 1

    @pytest.mark.asyncio
    async def test_errors_are_swallowed(self, monkeypatch):
        @asynccontextmanager
        async def broken_maker():
            raise RuntimeError("db down")
            yield  # pragma: no cover

        # Must not raise
        assert await cleanup_old_audit_logs(session_maker=broken_maker) == 0


class TestSchedulerLifecycle:
    @pytest.mark.asyncio
    async def test_start_then_stop(self):
        start_audit_cleanup_scheduler()
        assert audit_cleanup.scheduler is not None
        assert audit_cleanup.scheduler.running
        job_ids = {job.id for job in audit_cleanup.scheduler.get_jobs()}
        assert job_ids == {"audit_cleanup", "audit_cleanup_startup"}

        stop_audit_cleanup_scheduler()
        # AsyncIOScheduler defers shutdown via the running event loop
        await asyncio.sleep(0)
        assert not audit_cleanup.scheduler.running
        assert audit_cleanup._shutting_down is True
