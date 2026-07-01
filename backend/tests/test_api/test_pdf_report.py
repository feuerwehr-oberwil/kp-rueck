"""Tests for the PDF after-action report endpoint.

``GET /api/exports/events/{event_id}/report`` — editor-only, returns a PDF
``StreamingResponse`` with a slugified attachment filename. 404 for unknown
events, 401 for unauthenticated requests.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.api.exports import slugify_event_name
from app.models import Event, Incident


class TestReportEndpointAuth:
    @pytest.mark.asyncio
    async def test_unauthenticated_gets_401(self, client: AsyncClient, test_event: Event):
        response = await client.get(f"/api/exports/events/{test_event.id}/report")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_viewer_gets_403(self, viewer_client: AsyncClient, test_event: Event):
        response = await viewer_client.get(f"/api/exports/events/{test_event.id}/report")
        assert response.status_code == 403


class TestReportEndpointSuccess:
    @pytest.mark.asyncio
    async def test_returns_pdf_with_correct_headers(
        self, editor_client: AsyncClient, test_event: Event, test_incident: Incident
    ):
        response = await editor_client.get(f"/api/exports/events/{test_event.id}/report")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"

        disposition = response.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert ".pdf" in disposition
        # Slugified event name ("Test Event" -> "test-event")
        assert "einsatzbericht-test-event-" in disposition

        # Body is a real PDF
        assert response.content[:4] == b"%PDF"

    @pytest.mark.asyncio
    async def test_empty_event_still_returns_pdf(self, editor_client: AsyncClient, test_event: Event):
        response = await editor_client.get(f"/api/exports/events/{test_event.id}/report")
        assert response.status_code == 200
        assert response.content[:4] == b"%PDF"

    @pytest.mark.asyncio
    async def test_writes_audit_log_entry(self, editor_client: AsyncClient, test_event: Event, db_session):
        from sqlalchemy import select

        from app.models import AuditLog

        response = await editor_client.get(f"/api/exports/events/{test_event.id}/report")
        assert response.status_code == 200

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action_type == "report_export",
                AuditLog.resource_id == test_event.id,
            )
        )
        entries = result.scalars().all()
        assert len(entries) >= 1
        assert entries[0].changes_json.get("format") == "pdf"


class TestReportEndpointNotFound:
    @pytest.mark.asyncio
    async def test_unknown_event_gets_404(self, editor_client: AsyncClient):
        response = await editor_client.get(f"/api/exports/events/{uuid4()}/report")
        assert response.status_code == 404


class TestSlugify:
    def test_transliterates_umlauts(self):
        assert slugify_event_name("Übung Zürich Öl") == "uebung-zuerich-oel"

    def test_lowercases_and_dashes_non_alnum(self):
        assert slugify_event_name("Hochwasser 2026-02-19!") == "hochwasser-2026-02-19"

    def test_collapses_and_trims(self):
        assert slugify_event_name("  --Test  Event--  ") == "test-event"

    def test_empty_falls_back(self):
        assert slugify_event_name("!!!") == "ereignis"


class TestExcelExportRegression:
    """The data-collection refactor must not break the Excel audit export."""

    @pytest.mark.asyncio
    async def test_excel_export_still_works(
        self, editor_client: AsyncClient, test_event: Event, test_incident: Incident
    ):
        response = await editor_client.post(f"/api/exports/events/{test_event.id}/audit")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        # xlsx files are ZIP archives -> start with "PK"
        assert response.content[:2] == b"PK"
