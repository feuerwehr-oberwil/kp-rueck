"""Tests for the Lageblatt (paper-fallback board snapshot) PDF endpoint.

``GET /api/exports/events/{event_id}/lageblatt`` — editor-only, returns a PDF
in the layout of the cantonal Führungsformular. 404 for unknown events, 401
for unauthenticated requests.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.models import Event, Incident


class TestLageblattAuth:
    @pytest.mark.asyncio
    async def test_unauthenticated_gets_401(self, client: AsyncClient, test_event: Event):
        response = await client.get(f"/api/exports/events/{test_event.id}/lageblatt")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_viewer_gets_403(self, viewer_client: AsyncClient, test_event: Event):
        response = await viewer_client.get(f"/api/exports/events/{test_event.id}/lageblatt")
        assert response.status_code == 403


class TestLageblattSuccess:
    @pytest.mark.asyncio
    async def test_returns_pdf_with_correct_headers(
        self, editor_client: AsyncClient, test_event: Event, test_incident: Incident
    ):
        response = await editor_client.get(f"/api/exports/events/{test_event.id}/lageblatt")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"

        disposition = response.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert "lageblatt-test-event-" in disposition
        assert response.content[:4] == b"%PDF"

    @pytest.mark.asyncio
    async def test_empty_event_still_returns_pdf(self, editor_client: AsyncClient, test_event: Event):
        """No incidents — the sheet is just the empty handwriting grid."""
        response = await editor_client.get(f"/api/exports/events/{test_event.id}/lageblatt")
        assert response.status_code == 200
        assert response.content[:4] == b"%PDF"

    @pytest.mark.asyncio
    async def test_unknown_event_404(self, editor_client: AsyncClient):
        response = await editor_client.get(f"/api/exports/events/{uuid4()}/lageblatt")
        assert response.status_code == 404


class TestLageblattService:
    @pytest.mark.asyncio
    async def test_row_content_and_local_time(self, db_session, test_event: Event, test_incident: Incident):
        """The built PDF contains the incident and empty continuation rows."""
        from app.services.audit_export_service import collect_event_report_data
        from app.services.lageblatt_service import EMPTY_ROWS, build_lageblatt_pdf

        data = await collect_event_report_data(db_session, test_event.id)
        pdf = build_lageblatt_pdf(data, home_city="Oberwil")
        assert pdf[:4] == b"%PDF"
        assert EMPTY_ROWS >= 5
