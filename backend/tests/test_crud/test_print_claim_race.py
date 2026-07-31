"""Two agents must never both print the same slip.

The claim used to be a read-then-write: `SELECT`, check `status != "pending"` in Python, then
assign. Two agents polling one queue could both pass the check and both print — the "each job
prints once, at random" hazard, defended only by the prose rule that you must not run two
agents. compose ships a second agent behind a `printing` profile, so that rule is one flag away
from being broken by accident.

These tests run genuinely concurrent claims on SEPARATE connections. The shared `db_session`
fixture cannot express that — it is one connection with savepoint rollback, so two "concurrent"
requests through the test client serialise onto the same session. A `asyncio.gather` over one
session proves nothing, which is why the suite had no concurrency coverage at all before this.
"""

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.print import claim_print_job
from app.models import PrintJob


async def _claim(engine, job_id) -> int:
    """
    One agent's claim, on its own connection, through the REAL endpoint function.

    Calling `claim_print_job` rather than re-implementing its UPDATE is the point: a test that
    reproduces the query proves only that Postgres is atomic, and would keep passing if the
    endpoint went back to read-then-write. Returns 1 if this caller won the job, 0 on the 409.
    """
    async with AsyncSession(bind=engine, expire_on_commit=False) as session:
        try:
            await claim_print_job(job_id, BackgroundTasks(), db=session)
            return 1
        except HTTPException as exc:
            assert exc.status_code == 409, f"unexpected failure claiming: {exc.status_code}"
            return 0


@pytest.mark.asyncio
async def test_two_agents_racing_one_job_produce_exactly_one_print(test_engine):
    job_id = uuid4()
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as setup:
        setup.add(PrintJob(id=job_id, job_type="assignment", status="pending", payload={}))
        await setup.commit()

    try:
        # The real thing: two claims in flight at once, on different connections.
        won = await asyncio.gather(_claim(test_engine, job_id), _claim(test_engine, job_id))

        assert sum(won) == 1, f"expected exactly one winner, got {won} — the slip prints twice"

        async with AsyncSession(bind=test_engine, expire_on_commit=False) as check:
            job = (await check.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one()
            assert job.status == "printing"
            assert job.claimed_at is not None
    finally:
        async with AsyncSession(bind=test_engine, expire_on_commit=False) as cleanup:
            await cleanup.execute(text("DELETE FROM print_jobs WHERE id = :i"), {"i": str(job_id)})
            await cleanup.commit()


@pytest.mark.asyncio
async def test_a_crowd_of_agents_still_produces_exactly_one_print(test_engine):
    """
    Five at once — the invariant must not depend on there being only two.

    This is the test that actually catches the regression. Verified by reverting the endpoint
    to its old read-then-write form: the two-agent case above still passed (the interleaving
    has to land just so), while this one failed with `[1, 1, 0, 0, 0]` — two agents both told
    to print the same slip. Widening the race is what makes it reproducible rather than
    occasional, which is also why the bug survived in production code for so long.
    """
    job_id = uuid4()
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as setup:
        setup.add(PrintJob(id=job_id, job_type="board", status="pending", payload={}))
        await setup.commit()

    try:
        won = await asyncio.gather(*(_claim(test_engine, job_id) for _ in range(5)))
        assert sum(won) == 1, f"expected exactly one winner, got {won}"
    finally:
        async with AsyncSession(bind=test_engine, expire_on_commit=False) as cleanup:
            await cleanup.execute(text("DELETE FROM print_jobs WHERE id = :i"), {"i": str(job_id)})
            await cleanup.commit()


@pytest.mark.asyncio
async def test_claiming_an_already_claimed_job_wins_nothing(test_engine):
    """The loser's 409 path: a job that is already printing must not be claimable."""
    job_id = uuid4()
    async with AsyncSession(bind=test_engine, expire_on_commit=False) as setup:
        setup.add(
            PrintJob(
                id=job_id,
                job_type="assignment",
                status="printing",
                payload={},
                claimed_at=datetime.now(UTC),
            )
        )
        await setup.commit()

    try:
        assert await _claim(test_engine, job_id) == 0
    finally:
        async with AsyncSession(bind=test_engine, expire_on_commit=False) as cleanup:
            await cleanup.execute(text("DELETE FROM print_jobs WHERE id = :i"), {"i": str(job_id)})
            await cleanup.commit()
