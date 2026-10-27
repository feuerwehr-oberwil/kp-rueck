"""Every status a print job can hold is readable; the agent reports only an outcome.

`expired` is written by the server (`expire_stale_jobs`) and allowed by the table's CHECK,
but the response type did not know it, so reading such a job answered 500.
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.models import PrintJob

AGENT_TOKEN = "test-agent-token"


@pytest.mark.asyncio
@pytest.mark.api
async def test_an_expired_job_reads_back(editor_client: AsyncClient, db_session: AsyncSession):
    job = PrintJob(id=uuid4(), job_type="board", status="expired", payload={}, completed_at=datetime.now(UTC))
    db_session.add(job)
    await db_session.commit()

    response = await editor_client.get(f"/api/print/jobs/{job.id}/")

    assert response.status_code == 200
    assert response.json()["status"] == "expired"


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("status", ["expired", "pending", "printing"])
async def test_the_agent_reports_only_completed_or_failed(
    client: AsyncClient, db_session: AsyncSession, monkeypatch, status: str
):
    monkeypatch.setattr(app_settings, "print_agent_token", AGENT_TOKEN)
    job = PrintJob(id=uuid4(), job_type="assignment", status="printing", payload={}, claimed_at=datetime.now(UTC))
    db_session.add(job)
    await db_session.commit()

    response = await client.patch(
        f"/api/print/jobs/{job.id}/complete/", headers={"X-Agent-Token": AGENT_TOKEN}, json={"status": status}
    )

    assert response.status_code == 422
    await db_session.refresh(job)
    assert job.status == "printing"
