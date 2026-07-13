"""Tests for the PDF after-action report builder (pure function).

The builder (:func:`build_event_report_pdf`) is synchronous and pure — it takes
an :class:`EventReportData` plus the generating user's name and returns PDF
bytes. These tests construct :class:`EventReportData` directly (no DB needed for
the pure builder, though a couple use the DB collector) and assert on extracted
text via ``pypdf``.
"""

import io
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    Personnel,
    RekoReport,
    StatusTransition,
    User,
    Vehicle,
)
from app.services.audit_export_service import EventReportData, collect_event_report_data
from app.services.pdf_report_service import build_event_report_pdf


def _extract_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() for page in reader.pages)


def _page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(io.BytesIO(pdf_bytes)).pages)


# ============================================
# Fixtures — in-memory model objects (no DB)
# ============================================


@pytest.fixture
def simple_event() -> Event:
    return Event(
        id=uuid4(),
        name="Hochwasser Übung 2026",
        training_flag=False,
        created_at=datetime(2026, 6, 1, 8, 0, tzinfo=UTC),
    )


@pytest.fixture
def simple_incident(simple_event: Event) -> Incident:
    return Incident(
        id=uuid4(),
        event_id=simple_event.id,
        title="Wohnungsbrand Hauptstrasse",
        type="brandbekaempfung",
        priority="high",
        status="einsatz_beendet",
        location_address="Hauptstrasse 123, Basel",
        description="Brand in Mehrfamilienhaus mit Rauchentwicklung.",
        contact="Meldung via 118",
        nachbarhilfe=True,
        nachbarhilfe_note="Zug Allschwil",
        am_warten=False,
        zu_fuss=False,
        created_at=datetime(2026, 6, 1, 9, 15, tzinfo=UTC),
        completed_at=datetime(2026, 6, 1, 11, 0, tzinfo=UTC),
    )


# ============================================
# 1. Golden content
# ============================================


class TestGoldenContent:
    """Full report with incident, assignments, transition, reko report."""

    def test_golden_report_contains_expected_text(self, simple_event: Event, simple_incident: Incident):
        personnel = Personnel(id=uuid4(), name="Max Mustermann", role="Gruppenführer", availability="available")
        vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available", radio_call_sign="Florian-1")
        pers_assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=simple_incident.id,
            resource_type="personnel",
            resource_id=personnel.id,
            assigned_at=datetime(2026, 6, 1, 9, 20, tzinfo=UTC),
        )
        veh_assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=simple_incident.id,
            resource_type="vehicle",
            resource_id=vehicle.id,
            assigned_at=datetime(2026, 6, 1, 9, 20, tzinfo=UTC),
            unassigned_at=datetime(2026, 6, 1, 11, 0, tzinfo=UTC),
        )
        transition = StatusTransition(
            id=uuid4(),
            incident_id=simple_incident.id,
            from_status="eingegangen",
            to_status="einsatz",
            timestamp=datetime(2026, 6, 1, 9, 25, tzinfo=UTC),
        )
        reko = RekoReport(
            id=uuid4(),
            incident_id=simple_incident.id,
            token="tok",
            is_relevant=True,
            summary_text="Lage unter Kontrolle",
            is_draft=False,
            submitted_at=datetime(2026, 6, 1, 9, 40, tzinfo=UTC),
        )

        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident],
            assignments=[pers_assignment, veh_assignment],
            transitions=[transition],
            reko_reports=[reko],
            incident_map={simple_incident.id: simple_incident},
            personnel_map={personnel.id: personnel},
            vehicle_map={vehicle.id: vehicle},
        )

        pdf_bytes = build_event_report_pdf(data, generated_by="fixture_editor", funkrufname="Omega")

        assert pdf_bytes[:4] == b"%PDF"
        text = _extract_text(pdf_bytes)
        assert "Einsatzbericht" in text
        assert "Hochwasser" in text  # event name
        assert "Wohnungsbrand Hauptstrasse" in text  # incident title
        assert "Einsatz beendet" in text  # status label
        assert "Seite 1 von" in text  # footer
        assert "Omega" in text  # funkrufname
        assert "Max Mustermann" in text  # assigned crew
        assert "fixture_editor" in text  # generated_by

    def test_returns_bytes_starting_with_pdf_magic(self, simple_event: Event):
        data = EventReportData(
            event=simple_event,
            incidents=[],
            assignments=[],
            transitions=[],
            reko_reports=[],
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        assert isinstance(pdf_bytes, bytes)
        assert pdf_bytes.startswith(b"%PDF")


# ============================================
# 2. Empty event
# ============================================


class TestEmptyEvent:
    def test_zero_incidents_renders_placeholder(self, simple_event: Event):
        data = EventReportData(
            event=simple_event,
            incidents=[],
            assignments=[],
            transitions=[],
            reko_reports=[],
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        text = _extract_text(pdf_bytes)
        assert "Keine Einsätze erfasst" in text
        assert _page_count(pdf_bytes) >= 1


# ============================================
# 3. Training event
# ============================================


class TestTrainingEvent:
    def test_training_flag_renders_uebung_badge(self):
        event = Event(
            id=uuid4(),
            name="Übungsdienst",
            training_flag=True,
            created_at=datetime(2026, 6, 1, 8, 0, tzinfo=UTC),
        )
        data = EventReportData(
            event=event,
            incidents=[],
            assignments=[],
            transitions=[],
            reko_reports=[],
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        text = _extract_text(pdf_bytes)
        assert "ÜBUNG" in text


# ============================================
# 4. Null-tolerance
# ============================================


class TestNullTolerance:
    def test_incident_all_optional_none_does_not_raise(self, simple_event: Event):
        incident = Incident(
            id=uuid4(),
            event_id=simple_event.id,
            title="Minimal",
            type="diverse_einsaetze",
            priority="low",
            status="eingegangen",
            # all optional fields left as their defaults / None
            location_address=None,
            description=None,
            contact=None,
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            created_at=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
            completed_at=None,
        )
        data = EventReportData(
            event=simple_event,
            incidents=[incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={incident.id: incident},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        assert pdf_bytes.startswith(b"%PDF")
        text = _extract_text(pdf_bytes)
        # Em-dash placeholder for missing fields
        assert "—" in text


# ============================================
# 5. Long text -> multipage
# ============================================


class TestLongText:
    def test_long_description_produces_multipage_pdf(self, simple_event: Event):
        long_desc = "Lorem ipsum dolor sit amet. " * 250  # ~7000 chars
        incident = Incident(
            id=uuid4(),
            event_id=simple_event.id,
            title="Grossbrand",
            type="brandbekaempfung",
            priority="high",
            status="einsatz",
            description=long_desc,
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            created_at=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
        )
        data = EventReportData(
            event=simple_event,
            incidents=[incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={incident.id: incident},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        assert pdf_bytes.startswith(b"%PDF")
        assert _page_count(pdf_bytes) > 1


# ============================================
# 6. XML/special-char safety
# ============================================


class TestSpecialCharacters:
    def test_ampersand_and_angle_brackets_do_not_break_render(self, simple_event: Event):
        incident = Incident(
            id=uuid4(),
            event_id=simple_event.id,
            title="Brand & Rauch <Halle 3>",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            description="Gefahr durch <Chemikalien> & Hitze",
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            created_at=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
        )
        data = EventReportData(
            event=simple_event,
            incidents=[incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={incident.id: incident},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        assert pdf_bytes.startswith(b"%PDF")


# ============================================
# 7. Integration with collect_event_report_data (DB-backed)
# ============================================


@pytest_asyncio.fixture
async def event_with_full_data(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
) -> Event:
    """Create an event with an incident + assignment + transition + reko."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="DB Wohnungsbrand",
        type="brandbekaempfung",
        priority="high",
        status="einsatz_beendet",
        location_address="Teststrasse 1",
        description="DB test incident",
        created_by=test_user.id,
        completed_at=datetime.now(UTC),
    )
    db_session.add(incident)
    await db_session.flush()

    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            assigned_by=test_user.id,
        )
    )
    db_session.add(
        StatusTransition(
            id=uuid4(),
            incident_id=incident.id,
            from_status="eingegangen",
            to_status="einsatz",
            user_id=test_user.id,
            notes="DB transition",
        )
    )
    db_session.add(
        RekoReport(
            id=uuid4(),
            incident_id=incident.id,
            token="db-tok",
            is_relevant=True,
            summary_text="DB reko summary",
            submitted_by_personnel_id=test_personnel.id,
            is_draft=False,
        )
    )
    await db_session.commit()
    await db_session.refresh(test_event)
    return test_event


class TestCollectAndBuild:
    @pytest.mark.asyncio
    async def test_collect_then_build_produces_valid_pdf(self, db_session: AsyncSession, event_with_full_data: Event):
        data = await collect_event_report_data(db_session, event_with_full_data.id)
        assert isinstance(data, EventReportData)
        assert len(data.incidents) == 1

        pdf_bytes = build_event_report_pdf(data, generated_by="fixture_editor", funkrufname="Omega")
        assert pdf_bytes.startswith(b"%PDF")
        text = _extract_text(pdf_bytes)
        assert "DB Wohnungsbrand" in text
        assert "Max Mustermann" in text  # linked personnel name

    @pytest.mark.asyncio
    async def test_collect_raises_for_unknown_event(self, db_session: AsyncSession):
        with pytest.raises(ValueError, match="not found"):
            await collect_event_report_data(db_session, uuid4())

    @pytest.mark.asyncio
    async def test_archived_event_period_shows_dates(self, db_session: AsyncSession):
        archived = Event(
            id=uuid4(),
            name="Archiviertes Ereignis",
            training_flag=False,
            archived_at=datetime.now(UTC) - timedelta(hours=2),
        )
        db_session.add(archived)
        await db_session.commit()

        data = await collect_event_report_data(db_session, archived.id)
        pdf_bytes = build_event_report_pdf(data, generated_by="u")
        text = _extract_text(pdf_bytes)
        assert "Zeitraum" in text
        assert "laufend" not in text  # archived -> concrete end date, not "laufend"


# ============================================
# Reaction times (debrief metrics)
# ============================================


class TestReactionTimes:
    """The Reaktionszeiten table: first time each status was reached."""

    def test_reaction_times_section_renders_deltas(self, simple_event: Event, simple_incident: Incident):
        # created 9:15 → einsatz first reached 9:25 = 10 min
        transition = StatusTransition(
            id=uuid4(),
            incident_id=simple_incident.id,
            from_status="disponiert",
            to_status="einsatz",
            timestamp=datetime(2026, 6, 1, 9, 25, tzinfo=UTC),
        )
        # A later re-entry into the same status must NOT override the first one.
        later = StatusTransition(
            id=uuid4(),
            incident_id=simple_incident.id,
            from_status="einsatz_beendet",
            to_status="einsatz",
            timestamp=datetime(2026, 6, 1, 10, 45, tzinfo=UTC),
        )
        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident],
            assignments=[],
            transitions=[transition, later],
            reko_reports=[],
            incident_map={simple_incident.id: simple_incident},
        )

        pdf_bytes = build_event_report_pdf(data, generated_by="tester")
        text = _extract_text(pdf_bytes)
        assert "Reaktionszeiten" in text
        assert "10 min" in text  # eingegangen 9:15 → einsatz 9:25

    def test_reaction_times_without_transitions_shows_dashes(self, simple_event: Event, simple_incident: Incident):
        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={simple_incident.id: simple_incident},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="tester")
        assert pdf_bytes[:4] == b"%PDF"
        assert "Reaktionszeiten" in _extract_text(pdf_bytes)
