"""Tests for print agent endpoint authentication (X-Agent-Token)."""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.models import PrintJob

AGENT_TOKEN = "test-agent-token"


@pytest.fixture
def agent_token_configured(monkeypatch):
    monkeypatch.setattr(app_settings, "print_agent_token", AGENT_TOKEN)


@pytest.fixture
def agent_token_unset(monkeypatch):
    monkeypatch.setattr(app_settings, "print_agent_token", "")


@pytest_asyncio.fixture
async def pending_job(db_session: AsyncSession) -> PrintJob:
    job = PrintJob(id=uuid4(), job_type="test", status="pending", payload={})
    db_session.add(job)
    await db_session.commit()
    await db_session.refresh(job)
    return job


class TestAgentEndpointsWithToken:
    """When PRINT_AGENT_TOKEN is configured, agent endpoints require the header."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_config_without_header(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/config/")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_config_with_token(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/config/", headers={"X-Agent-Token": AGENT_TOKEN})
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_config_with_wrong_token(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/config/", headers={"X-Agent-Token": "wrong"})
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pending_without_header(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/jobs/pending/")
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pending_with_token(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/jobs/pending/", headers={"X-Agent-Token": AGENT_TOKEN})
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pending_with_wrong_token(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/jobs/pending/", headers={"X-Agent-Token": "wrong"})
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_claim_requires_token(self, client: AsyncClient, agent_token_configured, pending_job):
        response = await client.patch(f"/api/print/jobs/{pending_job.id}/claim/")
        assert response.status_code == 401

        response = await client.patch(
            f"/api/print/jobs/{pending_job.id}/claim/", headers={"X-Agent-Token": AGENT_TOKEN}
        )
        assert response.status_code == 200
        assert response.json()["status"] == "printing"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_complete_requires_token(self, client: AsyncClient, agent_token_configured, pending_job):
        body = {"status": "completed", "error_message": None}
        response = await client.patch(f"/api/print/jobs/{pending_job.id}/complete/", json=body)
        assert response.status_code == 401

        response = await client.patch(
            f"/api/print/jobs/{pending_job.id}/complete/",
            json=body,
            headers={"X-Agent-Token": AGENT_TOKEN},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"


class TestAgentEndpointsWithoutToken:
    """When PRINT_AGENT_TOKEN is unset, behavior is unchanged (LAN-only installs)."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_config_open(self, client: AsyncClient, agent_token_unset):
        response = await client.get("/api/print/config/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_pending_open(self, client: AsyncClient, agent_token_unset):
        response = await client.get("/api/print/jobs/pending/")
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_claim_and_complete_open(self, client: AsyncClient, agent_token_unset, pending_job):
        response = await client.patch(f"/api/print/jobs/{pending_job.id}/claim/")
        assert response.status_code == 200

        response = await client.patch(
            f"/api/print/jobs/{pending_job.id}/complete/",
            json={"status": "completed", "error_message": None},
        )
        assert response.status_code == 200


class TestUserFacingPrintEndpoints:
    """User-facing print endpoints keep user auth and ignore the agent token."""

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_status_requires_user_auth(self, client: AsyncClient, agent_token_configured):
        response = await client.get("/api/print/status/")
        assert response.status_code == 401

        # The agent token is not a substitute for user auth
        response = await client.get("/api/print/status/", headers={"X-Agent-Token": AGENT_TOKEN})
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_status_works_for_editor_without_agent_header(
        self, editor_client: AsyncClient, agent_token_configured
    ):
        response = await editor_client.get("/api/print/status/")
        assert response.status_code == 200
