"""A printer that did not answer must not cost the slip its retries.

Failing is not one thing. A job the printer REFUSED (unrenderable, wrong type) will fail the
same way on every attempt, and three of those are two too many. A printer that did not ANSWER
is the opposite: it is rebooting, being refilled, or briefly off the WLAN, and it comes back.

Both used to increment `retry_count`, so a two-minute outage burnt the whole budget in ninety
seconds and the Einsatzzettel was dropped — while its TTL still said it stayed worth printing
for an hour. The agent now says which kind of failure it was (`retryable`), and only the
printer's refusal counts against the job.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.crud.print_jobs import (
    FAILED_RETRY_DELAY_SECONDS,
    MAX_PRINT_ATTEMPTS,
    REQUEUE_MAX_AGE_SECONDS,
    requeue_lost_jobs,
)
from app.models import PrintJob

AGENT_TOKEN = "test-agent-token"
AGENT = {"X-Agent-Token": AGENT_TOKEN}


@pytest.fixture
def agent_token_configured(monkeypatch):
    monkeypatch.setattr(app_settings, "print_agent_token", AGENT_TOKEN)


@pytest_asyncio.fixture
async def claimed_job(db_session: AsyncSession) -> PrintJob:
    job = PrintJob(id=uuid4(), job_type="assignment", status="printing", payload={}, claimed_at=datetime.now(UTC))
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


@pytest.mark.asyncio
@pytest.mark.api
async def test_an_unreachable_printer_does_not_spend_an_attempt(
    client: AsyncClient, db_session: AsyncSession, agent_token_configured, claimed_job
):
    response = await client.patch(
        f"/api/print/jobs/{claimed_job.id}/complete/",
        headers=AGENT,
        json={"status": "failed", "error_message": "Drucker nicht erreichbar", "retryable": True},
    )

    assert response.status_code == 200
    assert response.json()["retry_count"] == 0
    # …and the operator still learns why nothing came out.
    assert response.json()["error_message"] == "Drucker nicht erreichbar"


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_refused_job_still_spends_one(client: AsyncClient, agent_token_configured, claimed_job):
    response = await client.patch(
        f"/api/print/jobs/{claimed_job.id}/complete/",
        headers=AGENT,
        json={"status": "failed", "error_message": "unknown job type: nonsense"},
    )

    assert response.status_code == 200
    assert response.json()["retry_count"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_an_older_agent_that_omits_the_flag_behaves_exactly_as_before(
    client: AsyncClient, agent_token_configured, claimed_job
):
    """The field defaults to False, so an un-updated Pi keeps the old accounting."""
    response = await client.patch(
        f"/api/print/jobs/{claimed_job.id}/complete/",
        headers=AGENT,
        json={"status": "failed", "error_message": "Papier leer"},
    )

    assert response.json()["retry_count"] == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_fallback_note_rides_along_on_a_success(client: AsyncClient, agent_token_configured, claimed_job):
    """Printed — but on the backup, and the room has to hear that."""
    note = "auf Ersatzdrucker gedruckt (ESC/POS → 10.0.0.50:9100) — 10.0.0.9 nicht erreichbar"
    response = await client.patch(
        f"/api/print/jobs/{claimed_job.id}/complete/",
        headers=AGENT,
        json={"status": "completed", "error_message": note},
    )

    body = response.json()
    assert body["status"] == "completed"
    assert body["error_message"] == note
    assert body["retry_count"] == 0


@pytest.mark.asyncio
async def test_requeueing_stops_when_the_paper_would_be_pointless(db_session: AsyncSession):
    """The attempt cap stopped being a stop once unreachable stopped counting.

    Types with a TTL are retired by expiry long before this bites; the one that has none on
    purpose — the Testdruck — needs something, or a printer that is off for the weekend gets
    offered the same slip every thirty seconds until somebody notices.
    """
    now = datetime.now(UTC)
    fresh = PrintJob(
        id=uuid4(),
        job_type="test",
        status="failed",
        payload={},
        retry_count=0,
        created_at=now - timedelta(seconds=60),
        completed_at=now - timedelta(seconds=FAILED_RETRY_DELAY_SECONDS + 5),
    )
    ancient = PrintJob(
        id=uuid4(),
        job_type="test",
        status="failed",
        payload={},
        retry_count=0,
        created_at=now - timedelta(seconds=REQUEUE_MAX_AGE_SECONDS + 60),
        completed_at=now - timedelta(seconds=FAILED_RETRY_DELAY_SECONDS + 5),
    )
    db_session.add_all([fresh, ancient])
    await db_session.commit()

    await requeue_lost_jobs(db_session)
    await db_session.refresh(fresh)
    await db_session.refresh(ancient)

    assert fresh.status == "pending", "a recent failure is still worth another printer"
    assert ancient.status == "failed", "an hour later nobody is waiting for this paper"
    assert MAX_PRINT_ATTEMPTS == 3, "the cap still governs failures the printer actually refused"
