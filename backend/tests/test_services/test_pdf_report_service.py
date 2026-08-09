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
    AuditLog,
    Event,
    Incident,
    IncidentAssignment,
    Personnel,
    RekoReport,
    SchadenplatzReport,
    StatusTransition,
    User,
    Vehicle,
)
from app.services.audit_export_service import EventReportData, collect_event_report_data
from app.services.pdf_report_service import (
    build_event_report_pdf,
    build_journal_entries,
    format_corrected_count,
    format_material_unit,
    material_left_on_site_names,
    material_used_label,
)


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
        status="returning",
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
        personnel = Personnel(id=uuid4(), name="Max Mustermann", role="Gruppenführer", status="available")
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
            from_status="incoming",
            to_status="active",
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
            status="incoming",
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
            status="active",
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
            status="incoming",
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
        status="returning",
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
            from_status="incoming",
            to_status="active",
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
    # Journal-worthy audit row (must be collected for the Einsatztagebuch)
    db_session.add(
        AuditLog(
            id=uuid4(),
            user_id=test_user.id,
            action_type="divera_alarm",
            resource_type="incident",
            resource_id=incident.id,
            changes_json={"recipients": [str(uuid4()), str(uuid4())]},
        )
    )
    # Noisy audit row that must NOT be collected (not whitelisted)
    db_session.add(
        AuditLog(
            id=uuid4(),
            user_id=test_user.id,
            action_type="update",
            resource_type="incident",
            resource_id=incident.id,
            changes_json={"title": "changed"},
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

        # Einsatztagebuch: whitelisted audit row collected, noisy one filtered
        assert len(data.audit_entries) == 1
        assert data.audit_entries[0].action_type == "divera_alarm"
        assert "Einsatztagebuch" in text
        assert "Divera-Alarm ausgelöst (2 Empfänger)" in text

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
            from_status="enroute",
            to_status="active",
            timestamp=datetime(2026, 6, 1, 9, 25, tzinfo=UTC),
        )
        # A later re-entry into the same status must NOT override the first one.
        later = StatusTransition(
            id=uuid4(),
            incident_id=simple_incident.id,
            from_status="returning",
            to_status="active",
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


# ============================================
# Einsatztagebuch (chronological journal)
# ============================================


def _journal_fixture_data(simple_event: Event, simple_incident: Incident) -> EventReportData:
    """Event with a full mix of journal sources, deliberately out of order."""
    user = User(id=uuid4(), username="disponent1", display_name="Dispo Eins", password_hash="x", role="editor")
    personnel = Personnel(id=uuid4(), name="Max Mustermann", role="Gruppenführer", status="available")
    vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available", radio_call_sign="Florian-1")

    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=simple_incident.id,
        resource_type="vehicle",
        resource_id=vehicle.id,
        assigned_at=datetime(2026, 6, 1, 9, 30, tzinfo=UTC),
        unassigned_at=datetime(2026, 6, 1, 10, 50, tzinfo=UTC),
        assigned_by=user.id,
    )
    transition = StatusTransition(
        id=uuid4(),
        incident_id=simple_incident.id,
        from_status="incoming",
        to_status="enroute",
        timestamp=datetime(2026, 6, 1, 9, 25, tzinfo=UTC),
        user_id=user.id,
    )
    reko = RekoReport(
        id=uuid4(),
        incident_id=simple_incident.id,
        token="tok",
        summary_text="Lage unter Kontrolle, keine weiteren Massnahmen nötig",
        submitted_by_personnel_id=personnel.id,
        is_draft=False,
        submitted_at=datetime(2026, 6, 1, 9, 40, tzinfo=UTC),
    )
    draft_reko = RekoReport(
        id=uuid4(),
        incident_id=simple_incident.id,
        token="tok2",
        summary_text="Entwurf darf nicht erscheinen",
        is_draft=True,
        submitted_at=datetime(2026, 6, 1, 9, 45, tzinfo=UTC),
    )
    divera_audit = AuditLog(
        id=uuid4(),
        user_id=user.id,
        action_type="divera_alarm",
        resource_type="incident",
        resource_id=simple_incident.id,
        changes_json={"recipients": [str(uuid4()), str(uuid4()), str(uuid4())]},
        timestamp=datetime(2026, 6, 1, 9, 28, tzinfo=UTC),
    )
    noisy_audit = AuditLog(
        id=uuid4(),
        user_id=user.id,
        action_type="export",
        resource_type="incident",
        resource_id=simple_incident.id,
        timestamp=datetime(2026, 6, 1, 9, 29, tzinfo=UTC),
    )

    return EventReportData(
        event=simple_event,
        incidents=[simple_incident],
        assignments=[assignment],
        transitions=[transition],
        reko_reports=[reko, draft_reko],
        audit_entries=[divera_audit, noisy_audit],
        incident_map={simple_incident.id: simple_incident},
        personnel_map={personnel.id: personnel},
        vehicle_map={vehicle.id: vehicle},
        user_map={user.id: user},
    )


class TestEinsatztagebuch:
    """The merged chronological journal chapter."""

    def test_entries_are_chronologically_sorted(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        entries = build_journal_entries(data)
        timestamps = [e.timestamp for e in entries]
        assert timestamps == sorted(timestamps)
        # created (9:15) first, vehicle release (10:50) last
        assert "Einsatz erstellt" in entries[0].text
        assert "freigegeben" in entries[-1].text

    def test_whitelist_filters_noisy_audit_actions(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        entries = build_journal_entries(data)
        # The "export" audit row must not produce an entry; divera_alarm must.
        assert not any("export" in e.text.lower() for e in entries)
        assert sum("Divera-Alarm" in e.text for e in entries) == 1

    def test_draft_reko_is_excluded(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        entries = build_journal_entries(data)
        reko_entries = [e for e in entries if "Reko-Bericht" in e.text]
        assert len(reko_entries) == 1
        assert "Entwurf darf nicht erscheinen" not in reko_entries[0].text

    def test_german_sentences_for_status_assignment_reko(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        texts = [e.text for e in build_journal_entries(data)]
        assert "Status: Eingegangen → Disponiert" in texts
        assert "TLF 1 (Florian-1) zugeteilt" in texts
        assert "TLF 1 (Florian-1) freigegeben" in texts
        assert any(t.startswith("Reko-Bericht eingegangen: Lage unter Kontrolle") for t in texts)

    def test_intake_source_is_mentioned(self, simple_event: Event):
        incident = Incident(
            id=uuid4(),
            event_id=simple_event.id,
            title="Wassereinbruch Keller",
            type="elementarereignis",
            priority="medium",
            status="incoming",
            source="intake",
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
        entries = build_journal_entries(data)
        assert entries[0].text == "Einsatz erstellt: «Wassereinbruch Keller» (Telefon)"

    def test_actor_names_resolved(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        entries = build_journal_entries(data)
        status_entry = next(e for e in entries if e.text.startswith("Status:"))
        assert status_entry.actor == "Dispo Eins"  # display_name preferred over username
        reko_entry = next(e for e in entries if e.text.startswith("Reko-Bericht"))
        assert reko_entry.actor == "Max Mustermann"

    def test_pdf_renders_journal_chapter_with_full_mix(self, simple_event: Event, simple_incident: Incident):
        data = _journal_fixture_data(simple_event, simple_incident)
        pdf_bytes = build_event_report_pdf(data, generated_by="tester")
        assert pdf_bytes.startswith(b"%PDF")
        assert _page_count(pdf_bytes) >= 1
        text = _extract_text(pdf_bytes)
        assert "Einsatztagebuch" in text
        assert "Automatisch aus den Protokolldaten erstellt." in text
        assert "Divera-Alarm ausgelöst (3 Empfänger)" in text
        assert "zugeteilt" in text

    def test_multiday_event_uses_date_prefixed_times(self, simple_event: Event, simple_incident: Incident):
        incident2 = Incident(
            id=uuid4(),
            event_id=simple_event.id,
            title="Sturmschaden Tag 2",
            type="elementarereignis",
            priority="low",
            status="incoming",
            nachbarhilfe=False,
            am_warten=False,
            zu_fuss=False,
            created_at=datetime(2026, 6, 2, 7, 5, tzinfo=UTC),
        )
        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident, incident2],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={simple_incident.id: simple_incident, incident2.id: incident2},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="tester")
        text = _extract_text(pdf_bytes)
        # 07:05 UTC renders as Swiss local time (09:05 CEST in June)
        assert "02.06. 09:05" in text

    def test_many_entries_paginate_cleanly(self, simple_event: Event, simple_incident: Incident):
        transitions = [
            StatusTransition(
                id=uuid4(),
                incident_id=simple_incident.id,
                from_status="incoming",
                to_status="enroute",
                timestamp=datetime(2026, 6, 1, 9, 0, tzinfo=UTC) + timedelta(minutes=i),
            )
            for i in range(150)
        ]
        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident],
            assignments=[],
            transitions=transitions,
            reko_reports=[],
            incident_map={simple_incident.id: simple_incident},
        )
        pdf_bytes = build_event_report_pdf(data, generated_by="tester")
        assert pdf_bytes.startswith(b"%PDF")
        assert _page_count(pdf_bytes) > 1


# ============================================
# 6. Schadenplatz-Rapport block (plan 25, §7)
# ============================================


def _material_row(name: str, *, used: bool | None, left_on_site: bool = False, consumable: bool = False) -> dict:
    """One `materials_json` entry as `/feld` and the KP twin both store it."""
    return {
        "assignment_id": str(uuid4()),
        "material_id": str(uuid4()),
        "name": name,
        "consumable": consumable,
        "used": used,
        "left_on_site": left_on_site,
    }


def _rapport(incident_id, **overrides) -> SchadenplatzReport:
    defaults: dict = {
        "id": uuid4(),
        "incident_id": incident_id,
        "is_draft": False,
        "submitted_at": datetime(2026, 6, 1, 12, 32, tzinfo=UTC),
        "created_at": datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        "updated_at": datetime(2026, 6, 1, 12, 32, tzinfo=UTC),
        "personnel_count_corrected": False,
        "vehicle_count_corrected": False,
    }
    defaults.update(overrides)
    return SchadenplatzReport(**defaults)


class TestRapportHelpers:
    """The pure helpers the three outputs share — exact strings, no PDF."""

    def test_used_three_states_never_collapse_to_a_boolean(self):
        assert material_used_label(True) == "gebraucht"
        assert material_used_label(False) == "nicht gebraucht"
        assert material_used_label(None) == "keine Angabe"

    def test_unanswered_unit_says_keine_angabe(self):
        line = format_material_unit(_material_row("Nassauger", used=None))
        assert "Nassauger: keine Angabe" in line

    def test_consumable_carries_no_left_on_site_state(self):
        """Decision 26: a consumable that was used is gone — no third answer."""
        line = format_material_unit(_material_row("Ölbindemittel", used=True, consumable=True))
        assert "gebraucht" in line
        assert "vor Ort verblieben" not in line
        assert "zurück" not in line

    def test_non_consumable_says_which_way_it_went(self):
        assert "vor Ort verblieben" in format_material_unit(_material_row("Pumpe", used=True, left_on_site=True))
        assert "zurück" in format_material_unit(_material_row("Pumpe", used=True, left_on_site=False))

    def test_corrected_count_carries_the_board_value(self):
        assert format_corrected_count(8, True, 6) == "8 (vom Board: 6)"
        assert format_corrected_count(6, False, 6) == "6"

    def test_consumables_are_never_left_on_site_names(self):
        report = _rapport(
            uuid4(),
            materials_json=[
                _material_row("Tauchpumpe", used=True, left_on_site=True),
                # An impossible row (the CRUD layer forbids it) — the outputs
                # must not print it either.
                _material_row("Ölbindemittel", used=True, left_on_site=True, consumable=True),
            ],
        )
        assert material_left_on_site_names(report) == ["Tauchpumpe"]


class TestRapportInThePdf:
    def _data(self, event: Event, incident: Incident, report: SchadenplatzReport, **kwargs) -> EventReportData:
        return EventReportData(
            event=event,
            incidents=[incident],
            assignments=kwargs.pop("assignments", []),
            transitions=[],
            reko_reports=[],
            incident_map={incident.id: incident},
            schadenplatz_reports=[report],
            **kwargs,
        )

    def test_block_renders_with_its_fields(self, simple_event: Event, simple_incident: Incident):
        report = _rapport(
            simple_incident.id,
            damage_type="wasserschaden",
            work_started_at=datetime(2026, 6, 1, 9, 30, tzinfo=UTC),
            work_ended_at=datetime(2026, 6, 1, 11, 10, tzinfo=UTC),
            kurzbericht="Keller ausgepumpt.",
            handed_over_to="Hauswart",
            owner_name="Muster Hans",
            owner_street="Bahnhofstrasse 4",
            owner_city="Oberwil",
        )
        text = _extract_text(build_event_report_pdf(self._data(simple_event, simple_incident, report), "tester"))
        assert "Schadenplatz-Rapport" in text
        assert "Wasserschaden" in text
        assert "Keller ausgepumpt." in text
        assert "Hauswart" in text
        assert "Muster Hans" in text

    def test_corrected_count_prints_the_board_value(self, simple_event: Event, simple_incident: Incident):
        """Decision 5: the divergence says the board was behind reality."""
        assignments = [
            IncidentAssignment(
                id=uuid4(),
                incident_id=simple_incident.id,
                resource_type="personnel",
                resource_id=uuid4(),
                assigned_at=datetime(2026, 6, 1, 9, 20, tzinfo=UTC),
            )
            for _ in range(6)
        ]
        report = _rapport(simple_incident.id, personnel_count=8, personnel_count_corrected=True)
        data = self._data(simple_event, simple_incident, report, assignments=assignments)
        text = _extract_text(build_event_report_pdf(data, "tester"))
        assert "8 (vom Board: 6)" in text

    def test_unanswered_material_renders_keine_angabe(self, simple_event: Event, simple_incident: Incident):
        report = _rapport(simple_incident.id, materials_json=[_material_row("Nassauger", used=None)])
        text = _extract_text(build_event_report_pdf(self._data(simple_event, simple_incident, report), "tester"))
        assert "keine Angabe" in text

    def test_consumable_never_renders_a_left_on_site_state(self, simple_event: Event, simple_incident: Incident):
        report = _rapport(
            simple_incident.id,
            materials_json=[_material_row("Ölbindemittel", used=True, consumable=True)],
        )
        text = _extract_text(build_event_report_pdf(self._data(simple_event, simple_incident, report), "tester"))
        assert "Verbrauchsmaterial" in text
        assert "vor Ort verblieben" not in text
        assert "zurück" not in text

    def test_field_filed_report_says_feld(self, simple_event: Event, simple_incident: Incident):
        person = Personnel(id=uuid4(), name="Muster Hans", role="mannschaft", status="available")
        report = _rapport(
            simple_incident.id,
            created_by_personnel_id=person.id,
            updated_by_personnel_id=person.id,
        )
        data = self._data(simple_event, simple_incident, report, personnel_map={person.id: person})
        text = _extract_text(build_event_report_pdf(data, "tester"))
        assert "Erfasst von Muster Hans (Feld)" in text
        assert "Funkmeldung" not in text

    def test_kp_filed_report_says_funkmeldung(self, simple_event: Event, simple_incident: Incident):
        user = User(id=uuid4(), username="beichenberger", display_name="B. Eichenberger", role="editor")
        report = _rapport(simple_incident.id, created_by_user_id=user.id, updated_by_user_id=user.id)
        data = self._data(simple_event, simple_incident, report, user_map={user.id: user})
        text = _extract_text(build_event_report_pdf(data, "tester"))
        assert "Erfasst im KP durch B. Eichenberger (Funkmeldung)" in text
        assert "(Feld)" not in text

    def test_mixed_report_shows_both_lines(self, simple_event: Event, simple_incident: Incident):
        """Crew filed, KP amended — provenance is never faked (decision 28)."""
        person = Personnel(id=uuid4(), name="Muster Hans", role="mannschaft", status="available")
        user = User(id=uuid4(), username="beichenberger", display_name="B. Eichenberger", role="editor")
        report = _rapport(
            simple_incident.id,
            created_by_personnel_id=person.id,
            updated_by_user_id=user.id,
        )
        data = self._data(
            simple_event,
            simple_incident,
            report,
            personnel_map={person.id: person},
            user_map={user.id: user},
        )
        text = _extract_text(build_event_report_pdf(data, "tester"))
        assert "Erfasst von Muster Hans (Feld)" in text
        assert "Zuletzt bearbeitet im KP durch B. Eichenberger (Funkmeldung)" in text

    def test_incident_without_a_rapport_renders_no_block(self, simple_event: Event, simple_incident: Incident):
        data = EventReportData(
            event=simple_event,
            incidents=[simple_incident],
            assignments=[],
            transitions=[],
            reko_reports=[],
            incident_map={simple_incident.id: simple_incident},
        )
        text = _extract_text(build_event_report_pdf(data, "tester"))
        assert "Schadenplatz-Rapport" not in text
