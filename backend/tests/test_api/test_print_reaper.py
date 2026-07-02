"""Tests for the print-job reaper (audit point 13).

A job that fails (paper out) or is claimed by an agent that then dies stayed
'failed'/'printing' forever — invisible to the pending query, so the slip
silently vanished. The reaper requeues both, with a retry cap.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.print_jobs import MAX_PRINT_ATTEMPTS, requeue_lost_jobs
from app.models import PrintJob


def _job(status: str, *, retry_count: int = 0, claimed_ago: int | None = None, completed_ago: int | None = None) -> PrintJob:
    now = datetime.now(UTC)
    return PrintJob(
        id=uuid4(),
        job_type="test",
        status=status,
        payload={},
        retry_count=retry_count,
        claimed_at=now - timedelta(seconds=claimed_ago) if claimed_ago is not None else None,
        completed_at=now - timedelta(seconds=completed_ago) if completed_ago is not None else None,
    )


@pytest.mark.asyncio
async def test_stale_printing_job_is_requeued(db_session: AsyncSession):
    """Agent claimed the job and lost power — no completion will ever arrive."""
    job = _job("printing", claimed_ago=600)
    db_session.add(job)
    await db_session.commit()

    requeued = await requeue_lost_jobs(db_session)

    assert requeued == 1
    await db_session.refresh(job)
    assert job.status == "pending"
    assert job.claimed_at is None
    assert job.retry_count == 1  # the lost claim consumed an attempt


@pytest.mark.asyncio
async def test_fresh_printing_job_is_left_alone(db_session: AsyncSession):
    job = _job("printing", claimed_ago=5)
    db_session.add(job)
    await db_session.commit()

    assert await requeue_lost_jobs(db_session) == 0
    await db_session.refresh(job)
    assert job.status == "printing"


@pytest.mark.asyncio
async def test_failed_job_is_retried_after_delay(db_session: AsyncSession):
    job = _job("failed", retry_count=1, completed_ago=120)
    db_session.add(job)
    await db_session.commit()

    requeued = await requeue_lost_jobs(db_session)

    assert requeued == 1
    await db_session.refresh(job)
    assert job.status == "pending"
    assert job.completed_at is None


@pytest.mark.asyncio
async def test_recently_failed_job_waits_out_the_delay(db_session: AsyncSession):
    job = _job("failed", retry_count=1, completed_ago=5)
    db_session.add(job)
    await db_session.commit()

    assert await requeue_lost_jobs(db_session) == 0
    await db_session.refresh(job)
    assert job.status == "failed"


@pytest.mark.asyncio
async def test_retry_cap_is_final(db_session: AsyncSession):
    """A broken printer must not loop forever — attempts are capped."""
    failed = _job("failed", retry_count=MAX_PRINT_ATTEMPTS, completed_ago=600)
    stale = _job("printing", retry_count=MAX_PRINT_ATTEMPTS, claimed_ago=600)
    db_session.add_all([failed, stale])
    await db_session.commit()

    assert await requeue_lost_jobs(db_session) == 0
    await db_session.refresh(failed)
    await db_session.refresh(stale)
    assert failed.status == "failed"
    assert stale.status == "printing"


@pytest.mark.asyncio
async def test_completed_jobs_are_never_touched(db_session: AsyncSession):
    job = _job("completed", completed_ago=600)
    db_session.add(job)
    await db_session.commit()

    assert await requeue_lost_jobs(db_session) == 0
    await db_session.refresh(job)
    assert job.status == "completed"
