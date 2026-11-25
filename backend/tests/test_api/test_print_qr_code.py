"""Tests for the QR-code print endpoint (POST /api/print/qr-code/)."""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PrintJob, Setting


@pytest_asyncio.fixture
async def printer_enabled(db_session: AsyncSession):
    """A WORKING printer: switched on and reachable — the queue guard wants both."""
    db_session.add(Setting(key="printer.enabled", value="true"))
    db_session.add(Setting(key="printer.ip", value="10.10.10.230"))
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
    async def test_a_request_that_fails_queues_no_slip(
        self, editor_client: AsyncClient, db_session: AsyncSession, printer_enabled, monkeypatch
    ):
        """The job is committed with the request, not before its answer: a failure after the
        insert used to leave the slip queued under a 500, and the retry printed it twice."""
        monkeypatch.setattr(editor_client._transport, "raise_app_exceptions", False)
        refresh = db_session.refresh

        async def failing_refresh(instance, *args, **kwargs):
            if isinstance(instance, PrintJob):
                raise RuntimeError("injected: the read-back fails")
            return await refresh(instance, *args, **kwargs)

        monkeypatch.setattr(db_session, "refresh", failing_refresh)
        response = await editor_client.post("/api/print/qr-code/", json=QR_BODY)
        monkeypatch.undo()

        assert response.status_code == 500
        assert (await db_session.execute(select(PrintJob))).scalars().all() == []

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

    @pytest.mark.asyncio
    @pytest.mark.api
    async def test_rejected_when_no_printer_address(self, editor_client: AsyncClient, db_session: AsyncSession):
        """Switched on, no address: the job used to be accepted with a 201 and then sat in
        the queue forever — no error on the board, nothing on paper. The operator has to
        find out at the moment they press print, and the message has to say where to fix it."""
        db_session.add(Setting(key="printer.enabled", value="true"))
        db_session.add(Setting(key="printer.ip", value="   "))
        await db_session.commit()

        response = await editor_client.post("/api/print/qr-code/", json=QR_BODY)
        assert response.status_code == 400
        assert "Druckeradresse" in response.json()["detail"]

        # And nothing was stored.
        jobs = (await db_session.execute(select(PrintJob))).scalars().all()
        assert jobs == []
