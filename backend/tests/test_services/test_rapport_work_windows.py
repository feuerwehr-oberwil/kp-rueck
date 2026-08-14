"""Beginn/Ende Tätigkeit, derived rather than typed (plan 25, §4).

The Schadenplatz-Rapport used to ask the crew for two timestamps. It stopped:
the board already records the window three ways over, so
``rapport_work_windows`` reconstructs it and all three outputs — Einsätze-xlsx,
Lageblatt, Einsatzbericht — read it from there.

These chains are the part that decays silently: a wrong level still produces a
plausible-looking timestamp, so every level is exercised on its own.
"""

from datetime import UTC, datetime
from uuid import uuid4

from app.models import Event, Incident, IncidentAssignment, SchadenplatzReport, StatusTransition
from app.services.audit_export_service import EventReportData
from app.services.pdf_report_service import rapport_work_windows


def _event() -> Event:
    return Event(id=uuid4(), name="Sturm 2026", training_flag=False)


def _incident(event: Event, **overrides) -> Incident:
    defaults: dict = {
        "id": uuid4(),
        "event_id": event.id,
        "title": "Bahnhofstrasse 4, Oberwil",
        "type": "elementarereignis",
        "priority": "medium",
        "status": "complete",
        "location_address": "Bahnhofstrasse 4, Oberwil",
        "created_at": datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
    }
    defaults.update(overrides)
    return Incident(**defaults)


def _report(incident_id, **overrides) -> SchadenplatzReport:
    defaults: dict = {
        "id": uuid4(),
        "incident_id": incident_id,
        "is_draft": False,
        "personnel_count_corrected": False,
        "created_at": datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        "updated_at": datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
    }
    defaults.update(overrides)
    return SchadenplatzReport(**defaults)


def _transition(incident: Incident, to_status: str, at: datetime) -> StatusTransition:
    return StatusTransition(
        id=uuid4(),
        incident_id=incident.id,
        from_status="dispatched",
        to_status=to_status,
        timestamp=at,
    )


def _assignment(incident: Incident, at: datetime) -> IncidentAssignment:
    return IncidentAssignment(
        id=uuid4(),
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=uuid4(),
        assigned_at=at,
    )


def _data(event, incidents, reports=(), assignments=(), transitions=()) -> EventReportData:
    return EventReportData(
        event=event,
        incidents=list(incidents),
        assignments=list(assignments),
        transitions=list(transitions),
        reko_reports=[],
        schadenplatz_reports=list(reports),
        incident_map={inc.id: inc for inc in incidents},
    )


class TestBeginn:
    """Arrival → first `active` → earliest assignment."""

    def test_the_arrival_wins_over_everything(self):
        event = _event()
        incident = _incident(event)
        arrived = datetime(2026, 6, 1, 10, 10, tzinfo=UTC)
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id, arrived_at=arrived)],
            transitions=[_transition(incident, "active", datetime(2026, 6, 1, 9, 0, tzinfo=UTC))],
            assignments=[_assignment(incident, datetime(2026, 6, 1, 8, 0, tzinfo=UTC))],
        )
        assert rapport_work_windows(data)[incident.id].started_at == arrived

    def test_falls_back_to_the_first_transition_into_active(self):
        event = _event()
        incident = _incident(event)
        first = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id)],
            # The later one must not win: the FIRST is the beginning of the work.
            transitions=[
                _transition(incident, "active", datetime(2026, 6, 1, 11, 0, tzinfo=UTC)),
                _transition(incident, "active", first),
            ],
            assignments=[_assignment(incident, datetime(2026, 6, 1, 8, 0, tzinfo=UTC))],
        )
        assert rapport_work_windows(data)[incident.id].started_at == first

    def test_falls_back_to_the_earliest_assignment(self):
        event = _event()
        incident = _incident(event)
        earliest = datetime(2026, 6, 1, 8, 0, tzinfo=UTC)
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id)],
            assignments=[
                _assignment(incident, datetime(2026, 6, 1, 8, 45, tzinfo=UTC)),
                _assignment(incident, earliest),
            ],
        )
        assert rapport_work_windows(data)[incident.id].started_at == earliest

    def test_nothing_at_all_stays_empty(self):
        """A guess would be worse than a blank on an invoice."""
        event = _event()
        incident = _incident(event)
        data = _data(event, [incident], reports=[_report(incident.id)])
        assert rapport_work_windows(data)[incident.id].started_at is None

    def test_an_incident_without_a_rapport_still_gets_a_window(self):
        """The derivation is the board's, not the rapport's — it needs no slip."""
        event = _event()
        incident = _incident(event)
        data = _data(
            event,
            [incident],
            transitions=[_transition(incident, "active", datetime(2026, 6, 1, 9, 0, tzinfo=UTC))],
        )
        assert rapport_work_windows(data)[incident.id].started_at == datetime(2026, 6, 1, 9, 0, tzinfo=UTC)


class TestEnde:
    """ "beendet" gemeldet → first `returning`/`complete` → empty."""

    def test_the_field_complete_message_wins(self):
        event = _event()
        reported = datetime(2026, 6, 1, 11, 40, tzinfo=UTC)
        incident = _incident(event, field_complete_reported_at=reported)
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id)],
            transitions=[_transition(incident, "complete", datetime(2026, 6, 1, 12, 30, tzinfo=UTC))],
        )
        assert rapport_work_windows(data)[incident.id].ended_at == reported

    def test_falls_back_to_the_first_returning_or_complete_transition(self):
        """The one the task names: `field_complete_reported_at` is NULL."""
        event = _event()
        incident = _incident(event)
        assert incident.field_complete_reported_at is None
        returning = datetime(2026, 6, 1, 12, 10, tzinfo=UTC)
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id)],
            transitions=[
                _transition(incident, "complete", datetime(2026, 6, 1, 12, 30, tzinfo=UTC)),
                _transition(incident, "returning", returning),
            ],
        )
        assert rapport_work_windows(data)[incident.id].ended_at == returning

    def test_a_running_incident_has_no_end(self):
        event = _event()
        incident = _incident(event, status="active")
        data = _data(
            event,
            [incident],
            reports=[_report(incident.id)],
            transitions=[_transition(incident, "active", datetime(2026, 6, 1, 9, 0, tzinfo=UTC))],
        )
        assert rapport_work_windows(data)[incident.id].ended_at is None


class TestBatching:
    def test_every_incident_of_the_event_is_keyed_and_never_crosses_over(self):
        """One pass over the shared lists — and no incident borrows another's times."""
        event = _event()
        a = _incident(event, title="A", location_address="A")
        b = _incident(event, title="B", location_address="B")
        data = _data(
            event,
            [a, b],
            reports=[_report(a.id, arrived_at=datetime(2026, 6, 1, 9, 30, tzinfo=UTC))],
            transitions=[_transition(b, "active", datetime(2026, 6, 1, 10, 0, tzinfo=UTC))],
        )
        windows = rapport_work_windows(data)
        assert set(windows) == {a.id, b.id}
        assert windows[a.id].started_at == datetime(2026, 6, 1, 9, 30, tzinfo=UTC)
        assert windows[b.id].started_at == datetime(2026, 6, 1, 10, 0, tzinfo=UTC)
        assert windows[a.id].ended_at is None
