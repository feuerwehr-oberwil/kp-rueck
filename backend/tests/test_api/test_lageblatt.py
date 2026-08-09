"""Tests for the Lageblatt (paper-fallback board snapshot) PDF endpoint.

``GET /api/exports/events/{event_id}/lageblatt`` — editor-only, returns a PDF
in the layout of the cantonal Führungsformular. 404 for unknown events, 401
for unauthenticated requests.
"""

import io
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from pypdf import PdfReader

from app.models import Event, Incident, SchadenplatzReport


def _extract_text(pdf_bytes: bytes) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf_bytes)).pages)


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


class TestLageblattRapportRows:
    """The Schadenplatz-Rapport's own family of detail rows (plan 25, §7).

    The Lageblatt is what the KP prints when the screens die, so the field's
    answers — Tätigkeit, übergeben an, Fahrzeuge, Material vor Ort — and a
    crew still waiting for a pickup have to be on it.
    """

    def _pdf_text(self, event: Event, incident: Incident, report=None) -> str:
        from app.services.audit_export_service import EventReportData
        from app.services.lageblatt_service import build_lageblatt_pdf

        data = EventReportData(
            event=event,
            incidents=[incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={incident.id: incident},
            schadenplatz_reports=[report] if report is not None else [],
        )
        return _extract_text(build_lageblatt_pdf(data, home_city="Oberwil"))

    @pytest.mark.asyncio
    async def test_rapport_rows_render(self, db_session, test_event: Event, test_incident: Incident):
        report = SchadenplatzReport(
            id=uuid4(),
            incident_id=test_incident.id,
            work_started_at=datetime(2026, 6, 1, 9, 30, tzinfo=UTC),
            work_ended_at=datetime(2026, 6, 1, 11, 10, tzinfo=UTC),
            handed_over_to="Hauswart Meier",
            vehicles_json=[
                {"assignment_id": str(uuid4()), "vehicle_id": str(uuid4()), "name": "TLF 1", "present": True},
                {"assignment_id": str(uuid4()), "vehicle_id": str(uuid4()), "name": "MTW", "present": False},
            ],
            materials_json=[
                {"assignment_id": str(uuid4()), "name": "Tauchpumpe", "used": True, "left_on_site": True},
                {"assignment_id": str(uuid4()), "name": "Nassauger", "used": None, "left_on_site": False},
            ],
            is_draft=False,
            created_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
            updated_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        )
        text = self._pdf_text(test_event, test_incident, report)
        assert "Tätigkeit" in text
        assert "Übergeben an" in text
        assert "Hauswart Meier" in text
        # The vehicles by name, and only the ones the crew ticked.
        assert "TLF 1" in text
        assert "MTW" not in text
        assert "Material vor Ort" in text
        assert "Tauchpumpe" in text

    @pytest.mark.asyncio
    async def test_consumable_never_reaches_material_vor_ort(
        self, db_session, test_event: Event, test_incident: Incident
    ):
        """Decision 26 — a used consumable is gone, nobody drives out for it."""
        report = SchadenplatzReport(
            id=uuid4(),
            incident_id=test_incident.id,
            materials_json=[
                {
                    "assignment_id": str(uuid4()),
                    "name": "Ölbindemittel",
                    "consumable": True,
                    "used": True,
                    "left_on_site": True,
                }
            ],
            is_draft=False,
            created_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
            updated_at=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        )
        text = self._pdf_text(test_event, test_incident, report)
        assert "Material vor Ort" not in text

    @pytest.mark.asyncio
    async def test_open_pickup_is_on_the_sheet(self, db_session, test_event: Event, test_incident: Incident):
        """A crew still standing in the rain belongs on the paper fallback."""
        test_incident.pickup_needed = True
        test_incident.pickup_note = "3 Mann Kreuzung"
        test_incident.pickup_requested_at = datetime(2026, 6, 1, 21, 14, tzinfo=UTC)
        text = self._pdf_text(test_event, test_incident)
        assert "Abholung offen" in text
        assert "3 Mann Kreuzung" in text

    @pytest.mark.asyncio
    async def test_incident_without_a_rapport_stays_quiet(self, db_session, test_event: Event, test_incident: Incident):
        text = self._pdf_text(test_event, test_incident)
        assert "Übergeben an" not in text
        assert "Abholung offen" not in text
