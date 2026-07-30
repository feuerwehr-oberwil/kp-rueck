"""The print agent's verdict has to leave the database.

Until now a job that failed with "Papier leer" only changed a row: the operator who
queued the slip had already been told "Druckauftrag gesendet" and heard nothing more,
and the error was visible solely under Einstellungen → Drucker. These tests pin the
broadcast that carries claim and outcome to the operations room, and pin what it may
and may not contain.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.print import job_event_payload
from app.config import settings as app_settings
from app.crud.print_jobs import MAX_PRINT_ATTEMPTS
from app.models import PrintJob

AGENT_TOKEN = "test-agent-token"
AGENT_HEADERS = {"X-Agent-Token": AGENT_TOKEN}


@pytest.fixture
def agent_token_configured(monkeypatch):
    monkeypatch.setattr(app_settings, "print_agent_token", AGENT_TOKEN)


@pytest_asyncio.fixture
async def pending_job(db_session: AsyncSession) -> PrintJob:
    job = PrintJob(
        id=uuid4(),
        job_type="assignment",
        status="pending",
        payload={"title": "Keller unter Wasser", "contact": "079 000 00 00"},
    )
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


def _broadcast_patch() -> AsyncMock:
    return patch("app.api.print.broadcast_print_job_update", new_callable=AsyncMock)


@pytest.mark.asyncio
@pytest.mark.api
async def test_claim_broadcasts_that_the_agent_took_the_job(
    client: AsyncClient, agent_token_configured, pending_job: PrintJob
):
    """The claim is the only proof an agent is alive and holding *this* job."""
    with _broadcast_patch() as broadcast:
        response = await client.patch(f"/api/print/jobs/{pending_job.id}/claim/", headers=AGENT_HEADERS)

    assert response.status_code == 200
    broadcast.assert_awaited_once()
    payload = broadcast.await_args.args[0]
    assert payload["id"] == str(pending_job.id)
    assert payload["status"] == "printing"


@pytest.mark.asyncio
@pytest.mark.api
async def test_completion_broadcasts_success(client: AsyncClient, agent_token_configured, pending_job: PrintJob):
    await client.patch(f"/api/print/jobs/{pending_job.id}/claim/", headers=AGENT_HEADERS)

    with _broadcast_patch() as broadcast:
        response = await client.patch(
            f"/api/print/jobs/{pending_job.id}/complete/",
            headers=AGENT_HEADERS,
            json={"status": "completed"},
        )

    assert response.status_code == 200
    payload = broadcast.await_args.args[0]
    assert payload["status"] == "completed"
    assert payload["error_message"] is None
    assert payload["will_retry"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_failure_broadcasts_the_agents_own_words(
    client: AsyncClient, agent_token_configured, pending_job: PrintJob
):
    """ "Papier leer" and "Drucker nicht erreichbar" are different problems."""
    await client.patch(f"/api/print/jobs/{pending_job.id}/claim/", headers=AGENT_HEADERS)

    with _broadcast_patch() as broadcast:
        response = await client.patch(
            f"/api/print/jobs/{pending_job.id}/complete/",
            headers=AGENT_HEADERS,
            json={"status": "failed", "error_message": "Papier leer"},
        )

    assert response.status_code == 200
    payload = broadcast.await_args.args[0]
    assert payload["status"] == "failed"
    assert payload["error_message"] == "Papier leer"
    # First attempt of three — the reaper will requeue, and the operator is told so.
    assert payload["will_retry"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_exhausted_retries_are_reported_as_final(
    client: AsyncClient, db_session: AsyncSession, agent_token_configured
):
    job = PrintJob(
        id=uuid4(),
        job_type="assignment",
        status="printing",
        payload={},
        retry_count=MAX_PRINT_ATTEMPTS - 1,
    )
    db_session.add(job)
    await db_session.commit()

    with _broadcast_patch() as broadcast:
        await client.patch(
            f"/api/print/jobs/{job.id}/complete/",
            headers=AGENT_HEADERS,
            json={"status": "failed", "error_message": "Drucker nicht erreichbar"},
        )

    payload = broadcast.await_args.args[0]
    assert payload["retry_count"] == MAX_PRINT_ATTEMPTS
    assert payload["will_retry"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_rejected_completion_broadcasts_nothing(
    client: AsyncClient, db_session: AsyncSession, agent_token_configured
):
    """A 409 changed no state, so it must not tell anyone a job finished."""
    job = PrintJob(id=uuid4(), job_type="test", status="completed", payload={})
    db_session.add(job)
    await db_session.commit()

    with _broadcast_patch() as broadcast:
        response = await client.patch(
            f"/api/print/jobs/{job.id}/complete/",
            headers=AGENT_HEADERS,
            json={"status": "failed", "error_message": "zu spät"},
        )

    assert response.status_code == 409
    broadcast.assert_not_awaited()


def test_broadcast_envelope_carries_no_incident_detail():
    """This goes to the whole operations room — viewers and wall displays included.

    `payload` holds crew names, the caller's phone number and internal notes; a toast
    needs none of it, so it must not ride along.
    """
    job = PrintJob(
        id=uuid4(),
        job_type="assignment",
        status="failed",
        payload={"contact": "079 000 00 00", "internal_notes": "Anwohner aggressiv"},
        error_message="Papier leer",
        retry_count=1,
    )

    envelope = job_event_payload(job)

    assert "payload" not in envelope
    assert set(envelope) == {
        "id",
        "job_type",
        "status",
        "incident_id",
        "event_id",
        "error_message",
        "retry_count",
        "will_retry",
    }
