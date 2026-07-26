"""Tests for the audit log cleanup background job."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

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
def pruning_enabled(monkeypatch):
    """Turn retention on for tests about pruning.

    The default is 0 (keep everything) — the audit log is a record, not a cache — so a
    test that wants rows deleted has to say so. Tests that assert the *default* behaviour
    deliberately do not use this fixture.
    """
    monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 90)
    monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)


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


async def _remaining_of(db_session, rows: list[AuditLog]) -> set:
    """IDs of the given rows still present.

    Scoped to the rows each test created — other tests' API calls also write
    audit-log rows (via the middleware), so global counts aren't isolated.
    """
    ids = [row.id for row in rows]
    result = await db_session.execute(select(AuditLog.id).where(AuditLog.id.in_(ids)))
    return set(result.scalars().all())


class TestCleanupOldAuditLogs:
    @pytest.mark.asyncio
    async def test_deletes_old_keeps_recent(self, db_session, session_maker, pruning_enabled):
        old_rows = [_audit_row(timedelta(days=100)) for _ in range(3)]
        recent_rows = [_audit_row(timedelta(seconds=0)) for _ in range(2)]
        db_session.add_all(old_rows + recent_rows)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted >= 3
        assert await _remaining_of(db_session, old_rows + recent_rows) == {row.id for row in recent_rows}

    @pytest.mark.asyncio
    async def test_boundary_around_cutoff(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 90)
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)
        survivor = _audit_row(timedelta(days=90) - timedelta(hours=1))
        goner = _audit_row(timedelta(days=90) + timedelta(hours=1))
        db_session.add_all([survivor, goner])
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted >= 1
        assert await _remaining_of(db_session, [survivor, goner]) == {survivor.id}

    @pytest.mark.asyncio
    async def test_batching_deletes_all_rows(self, db_session, session_maker, monkeypatch, pruning_enabled):
        monkeypatch.setattr(audit_cleanup, "BATCH_SIZE", 2)
        rows = [_audit_row(timedelta(days=100)) for _ in range(5)]
        db_session.add_all(rows)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted >= 5
        assert await _remaining_of(db_session, rows) == set()

    @pytest.mark.asyncio
    async def test_demo_mode_caps_retention(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", True)
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 90)
        row = _audit_row(timedelta(days=10))
        db_session.add(row)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted >= 1
        assert await _remaining_of(db_session, [row]) == set()

    @pytest.mark.asyncio
    async def test_demo_mode_smaller_explicit_override_wins(self, db_session, session_maker, monkeypatch):
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", True)
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 1)
        db_session.add(_audit_row(timedelta(days=2)))
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 1

    @pytest.mark.asyncio
    async def test_retention_off_by_default_keeps_everything(self, db_session, session_maker, monkeypatch):
        """The default is a record, not a cache.

        This used to default to 90 days, so a deployment older than three months had
        already lost the audit trail for its earliest operations — silently, while the
        README advertised an append-only, defensible record.
        """
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)
        ancient = [_audit_row(timedelta(days=3650)) for _ in range(3)]
        db_session.add_all(ancient)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted == 0
        assert await _remaining_of(db_session, ancient) == {row.id for row in ancient}

    @pytest.mark.asyncio
    async def test_negative_retention_also_means_keep_everything(self, db_session, session_maker, monkeypatch):
        """A fat-fingered -1 must not be read as "delete rows from the future"."""
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", -1)
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)
        row = _audit_row(timedelta(days=3650))
        db_session.add(row)
        await db_session.commit()

        assert await cleanup_old_audit_logs(session_maker=session_maker) == 0
        assert await _remaining_of(db_session, [row]) == {row.id}

    @pytest.mark.asyncio
    async def test_demo_mode_caps_even_when_retention_is_unlimited(self, db_session, session_maker, monkeypatch):
        """The public demo must not accumulate a trail just because the default changed."""
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 0)
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", True)
        row = _audit_row(timedelta(days=10))
        db_session.add(row)
        await db_session.commit()

        deleted = await cleanup_old_audit_logs(session_maker=session_maker)

        assert deleted >= 1
        assert await _remaining_of(db_session, [row]) == set()

    @pytest.mark.asyncio
    async def test_empty_table_returns_zero(self, session_maker, pruning_enabled):
        assert await cleanup_old_audit_logs(session_maker=session_maker) == 0

    @pytest.mark.asyncio
    async def test_skipped_during_shutdown(self, db_session, session_maker, pruning_enabled):
        audit_cleanup._shutting_down = True
        row = _audit_row(timedelta(days=100))
        db_session.add(row)
        await db_session.commit()

        assert await cleanup_old_audit_logs(session_maker=session_maker) == 0
        assert await _remaining_of(db_session, [row]) == {row.id}

    @pytest.mark.asyncio
    async def test_errors_are_swallowed(self, monkeypatch):
        @asynccontextmanager
        async def broken_maker():
            raise RuntimeError("db down")
            yield  # pragma: no cover

        # Must not raise
        assert await cleanup_old_audit_logs(session_maker=broken_maker) == 0


class TestSchedulerLifecycle:
    async def test_scheduler_does_not_start_when_retention_is_off(self, monkeypatch):
        """No sweep job at all — not a job that runs and deletes nothing."""
        monkeypatch.setattr(audit_cleanup.settings, "audit_retention_days", 0)
        monkeypatch.setattr(audit_cleanup.settings, "demo_mode", False)

        start_audit_cleanup_scheduler()

        assert audit_cleanup.scheduler is None

    @pytest.mark.asyncio
    async def test_start_then_stop(self, pruning_enabled):
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
