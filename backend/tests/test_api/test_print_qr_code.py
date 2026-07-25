"""Tests for the QR-code print endpoint (POST /api/print/qr-code/)."""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PrintJob, Setting


@pytest_asyncio.fixture
async def printer_enabled(db_session: AsyncSession):
    """Enable the thermal printer so the agent-poll guard passes."""
    db_session.add(Setting(key="printer.enabled", value="true"))
    await db_session.commit()


QR_BODY = {
    "qr_content": "https://kp.example.li/check-in?token=abc.def.ghi",
    "title": "Personal Check-In",
    "subtitle": "Personal kann sich einchecken.",
}


class TestQRCodePrintEndpoint:
    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_requires_editor_auth(self, client: AsyncClient, printer_enabled):
        response = await client.post("/api/print/qr-code/", json=QR_BODY)
        assert response.status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_creates_qr_code_job(self, editor_client: AsyncClient, db_session: AsyncSession, printer_enabled):
        response = await editor_client.post("/api/print/qr-code/", json=QR_BODY)
        assert response.status_code == 201

        data = response.json()
        assert data["job_type"] == "qr_code"
        assert data["status"] == "pending"
        assert data["payload"]["qr_content"] == QR_BODY["qr_content"]
        assert data["payload"]["title"] == QR_BODY["title"]
        assert data["payload"]["subtitle"] == QR_BODY["subtitle"]

        # Job is actually persisted
        result = await db_session.execute(select(PrintJob).where(PrintJob.id == data["id"]))
        job = result.scalar_one()
        assert job.job_type == "qr_code"

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_subtitle_optional(self, editor_client: AsyncClient, printer_enabled):
        body = {"qr_content": "https://kp.example.li/viewer?token=x", "title": "Viewer-Link"}
        response = await editor_client.post("/api/print/qr-code/", json=body)
        assert response.status_code == 201
        assert response.json()["payload"]["subtitle"] is None

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_rejected_when_printer_disabled(self, editor_client: AsyncClient):
        response = await editor_client.post("/api/print/qr-code/", json=QR_BODY)
        assert response.status_code == 400
