"""Tests for print job expiry (TTL).

A printer that was offline for two hours used to drain its whole backlog the moment it came
back: dozens of slips, oldest first, describing incidents that had since been closed — while
the operation that was still running needed the paper. Stale paper in a command post does not
merely waste itself, it competes with the current picture.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.print_jobs import (
    PRINT_JOB_TTL_SECONDS,
    expire_stale_jobs,
    requeue_lost_jobs,
)
from app.models import PrintJob


async def _job(db: AsyncSession, *, job_type: str, age_seconds: int, status: str = "pending") -> PrintJob:
    job = PrintJob(
        id=uuid4(),
        job_type=job_type,
        status=status,
        payload={},
        created_at=datetime.now(UTC) - timedelta(seconds=age_seconds),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def _status(db: AsyncSession, job_id) -> str:
    row = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one()
    await db.refresh(row)
    return row.status


@pytest.mark.asyncio
async def test_fresh_jobs_are_untouched(db_session: AsyncSession):
    board = await _job(db_session, job_type="board", age_seconds=60)
    slip = await _job(db_session, job_type="assignment", age_seconds=60)

    assert await expire_stale_jobs(db_session) == 0
    assert await _status(db_session, board.id) == "pending"
    assert await _status(db_session, slip.id) == "pending"


@pytest.mark.asyncio
async def test_board_snapshots_expire_faster_than_assignment_slips(db_session: AsyncSession):
    """A snapshot is a photograph of a moment; a slip is about one incident."""
    age = PRINT_JOB_TTL_SECONDS["board"] + 60
    board = await _job(db_session, job_type="board", age_seconds=age)
    slip = await _job(db_session, job_type="assignment", age_seconds=age)

    await expire_stale_jobs(db_session)

    assert await _status(db_session, board.id) == "expired"
    # The slip is well within its own, longer TTL — the incident may still be running.
    assert await _status(db_session, slip.id) == "pending"


@pytest.mark.asyncio
async def test_assignment_slips_expire_once_past_their_own_ttl(db_session: AsyncSession):
    slip = await _job(db_session, job_type="assignment", age_seconds=PRINT_JOB_TTL_SECONDS["assignment"] + 60)
    await expire_stale_jobs(db_session)
    assert await _status(db_session, slip.id) == "expired"


@pytest.mark.asyncio
async def test_test_prints_never_expire(db_session: AsyncSession):
    """
    Somebody is standing at the printer waiting for a Testdruck, and if it is late that is
    exactly the diagnosis they are making. Expiring it would hide the answer.
    """
    probe = await _job(db_session, job_type="test", age_seconds=24 * 3600)
    await expire_stale_jobs(db_session)
    assert await _status(db_session, probe.id) == "pending"


@pytest.mark.asyncio
async def test_only_pending_jobs_expire(db_session: AsyncSession):
    """A job already in flight or finished is not the queue's business any more."""
    old = PRINT_JOB_TTL_SECONDS["board"] + 3600
    printing = await _job(db_session, job_type="board", age_seconds=old, status="printing")
    completed = await _job(db_session, job_type="board", age_seconds=old, status="completed")

    await expire_stale_jobs(db_session)

    assert await _status(db_session, printing.id) == "printing"
    assert await _status(db_session, completed.id) == "completed"


@pytest.mark.asyncio
async def test_expiry_runs_on_the_agent_poll_path(db_session: AsyncSession):
    """
    Expiry has to happen on the same path that would otherwise hand the job to the agent,
    or a backlog drains before anything gets a chance to retire it.
    """
    stale = await _job(db_session, job_type="board", age_seconds=PRINT_JOB_TTL_SECONDS["board"] + 60)
    await requeue_lost_jobs(db_session)
    assert await _status(db_session, stale.id) == "expired"
