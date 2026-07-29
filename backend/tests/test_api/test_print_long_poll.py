"""Tests for the long-polling pending-jobs endpoint.

The agent used to learn about a queued slip only on its next poll, and the poll only got
brisk *after* a print — so the slowest case was the first print of an operation. The endpoint
now holds the request open until a job arrives.

What these cover is the endpoint's own behaviour (does it return at once when it should, does
it hang when it should, does the hang end by itself) plus the wake-up signal in isolation.
What they deliberately do NOT simulate is an agent parked on the endpoint while another
request queues a job: the test client shares ONE session with the app (see conftest's
`override_get_db`), so a genuinely concurrent second request is not expressible here. That
half is covered on the agent side, against a stub backend that really does hold the socket
(`tools/print-agent/test_agent.py`).
"""

import asyncio
import time
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.print import LONG_POLL_MAX_SECONDS
from app.config import settings as app_settings
from app.models import PrintJob
from app.services import print_signal

AGENT_TOKEN = "test-agent-token"
HEADERS = {"X-Agent-Token": AGENT_TOKEN}


@pytest.fixture(autouse=True)
def agent_token_configured(monkeypatch):
    monkeypatch.setattr(app_settings, "print_agent_token", AGENT_TOKEN)


@pytest_asyncio.fixture
async def pending_job(db_session: AsyncSession) -> PrintJob:
    job = PrintJob(id=uuid4(), job_type="test", status="pending", payload={})
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


@pytest.mark.asyncio
@pytest.mark.api
async def test_without_wait_the_endpoint_answers_immediately(client: AsyncClient):
    """The old contract, unchanged — this is what lets the backend ship before the agent."""
    started = time.monotonic()
    response = await client.get("/api/print/jobs/pending/", headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == []
    assert time.monotonic() - started < 1.0


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_waiting_job_is_returned_without_any_hang(client: AsyncClient, pending_job: PrintJob):
    """`wait` must not delay a job that is already there."""
    started = time.monotonic()
    response = await client.get("/api/print/jobs/pending/?wait=10", headers=HEADERS)

    assert response.status_code == 200
    assert [j["id"] for j in response.json()] == [str(pending_job.id)]
    assert time.monotonic() - started < 1.0


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_hang_ends_by_itself_when_nothing_arrives(client: AsyncClient):
    """Otherwise the agent's HTTP timeout, not the backend, would decide when it gives up."""
    started = time.monotonic()
    response = await client.get("/api/print/jobs/pending/?wait=1", headers=HEADERS)
    elapsed = time.monotonic() - started

    assert response.status_code == 200
    assert response.json() == []
    assert 1.0 <= elapsed < 4.0, f"held for {elapsed:.1f}s, expected about 1s"


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_hang_is_bounded(client: AsyncClient):
    """An unbounded wait would sit past any proxy's idle timeout and be dropped mid-flight."""
    response = await client.get(f"/api/print/jobs/pending/?wait={LONG_POLL_MAX_SECONDS + 1:g}", headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_queueing_a_job_wakes_a_parked_waiter():
    """The signal itself: this is what turns 'up to ten seconds' into milliseconds."""
    print_signal.arm()
    waiter = asyncio.ensure_future(print_signal.wait_for_job())
    await asyncio.sleep(0)  # let it park

    print_signal.notify_job_queued()

    started = time.monotonic()
    async with asyncio.timeout(1.0):
        await waiter
    assert time.monotonic() - started < 1.0


@pytest.mark.asyncio
async def test_a_waiter_stays_parked_when_no_job_is_queued():
    """The mirror image — without this, the wake-up test would pass on a signal stuck open."""
    print_signal.arm()
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.2):
            await print_signal.wait_for_job()
