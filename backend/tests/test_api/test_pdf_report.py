"""Tests for the PDF after-action report endpoint.

``GET /api/exports/events/{event_id}/report`` — editor-only, returns a PDF
``StreamingResponse`` with a slugified attachment filename. 404 for unknown
events, 401 for unauthenticated requests.
"""

import io
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from httpx import AsyncClient
from pypdf import PdfReader

from app.api.exports import slugify_event_name
from app.models import Event, Incident, Personnel, RekoReport, User


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


class TestRekoProvenanceInTheReport:
    """The channel a Reko report came through, in the after-action PDF (plan 26 §7).

    Same vocabulary as the Lageblatt and the Einsätze-Export: "(Feld)" for a crew
    filing, "(Funkmeldung)" for a radio message the KP typed, both lines for a
    report that is one of each.
    """

    def _pdf_text(
        self,
        event: Event,
        incident: Incident,
        report: RekoReport,
        *,
        personnel: Personnel | None = None,
        users: tuple[User, ...] = (),
    ) -> str:
        from app.services.audit_export_service import EventReportData
        from app.services.pdf_report_service import build_event_report_pdf

        data = EventReportData(
            event=event,
            incidents=[incident],
            assignments=[],
            transitions=[],
            reko_reports=[report],
            incident_map={incident.id: incident},
            personnel_map={personnel.id: personnel} if personnel else {},
            user_map={u.id: u for u in users},
        )
        pdf = build_event_report_pdf(data, generated_by="pytest")
        return "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)

    def _report(self, incident: Incident, **kwargs) -> RekoReport:
        defaults = {
            "id": uuid4(),
            "incident_id": incident.id,
            "token": "test-token",
            "summary_text": "Keller unter Wasser",
            "is_draft": False,
            "submitted_at": datetime(2026, 6, 1, 19, 22, tzinfo=UTC),
            "updated_at": datetime(2026, 6, 1, 19, 22, tzinfo=UTC),
        }
        return RekoReport(**{**defaults, **kwargs})

    @pytest.mark.asyncio
    async def test_field_filed_report_says_feld(
        self, test_event: Event, test_incident: Incident, test_personnel: Personnel
    ):
        report = self._report(test_incident, submitted_by_personnel_id=test_personnel.id)
        text = self._pdf_text(test_event, test_incident, report, personnel=test_personnel)
        assert "Erfasst von" in text
        assert "(Feld)" in text
        assert "Funkmeldung" not in text

    @pytest.mark.asyncio
    async def test_kp_filed_report_says_funkmeldung(
        self, test_event: Event, test_incident: Incident, test_editor: User
    ):
        report = self._report(
            test_incident,
            created_by_user_id=test_editor.id,
            updated_by_user_id=test_editor.id,
        )
        text = self._pdf_text(test_event, test_incident, report, users=(test_editor,))
        assert "Erfasst im KP durch" in text
        assert "(Funkmeldung)" in text
        assert "(Feld)" not in text

    @pytest.mark.asyncio
    async def test_mixed_report_prints_both_lines(
        self,
        test_event: Event,
        test_incident: Incident,
        test_personnel: Personnel,
        test_editor: User,
    ):
        report = self._report(
            test_incident,
            submitted_by_personnel_id=test_personnel.id,
            updated_by_user_id=test_editor.id,
            updated_at=datetime(2026, 6, 1, 19, 41, tzinfo=UTC),
        )
        text = self._pdf_text(test_event, test_incident, report, personnel=test_personnel, users=(test_editor,))
        assert "Erfasst von" in text
        assert "(Feld)" in text
        assert "Ergänzt im KP durch" in text
        assert "(Funkmeldung)" in text

    @pytest.mark.asyncio
    async def test_arrival_prints_with_its_own_channel(
        self, test_event: Event, test_incident: Incident, test_editor: User
    ):
        report = self._report(
            test_incident,
            arrived_at=datetime(2026, 6, 1, 19, 10, tzinfo=UTC),
            arrived_reported_by_user_id=test_editor.id,
        )
        text = self._pdf_text(test_event, test_incident, report, users=(test_editor,))
        assert "Vor Ort" in text
        assert "(Funkmeldung)" in text


class TestRekoProvenanceUsersAreLoaded:
    """The collector has to fetch the users the new FKs point at.

    Without them every KP-filed report would resolve to an empty name and print
    "unbekannt" for somebody the database knows perfectly well.
    """

    @pytest.mark.asyncio
    async def test_collect_event_report_data_loads_reko_authors(
        self, db_session, test_event: Event, test_incident: Incident, test_editor: User
    ):
        from app.services.audit_export_service import collect_event_report_data

        report = RekoReport(
            id=uuid4(),
            incident_id=test_incident.id,
            token="test-token",
            is_draft=False,
            created_by_user_id=test_editor.id,
            updated_by_user_id=test_editor.id,
            arrived_at=datetime(2026, 6, 1, 19, 10, tzinfo=UTC),
            arrived_reported_by_user_id=test_editor.id,
        )
        db_session.add(report)
        await db_session.commit()

        data = await collect_event_report_data(db_session, test_event.id)
        assert test_editor.id in data.user_map
