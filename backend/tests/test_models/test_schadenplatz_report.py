"""Tests for the SchadenplatzReport model and the field-reporting constraints."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Notification, SchadenplatzReport


class TestSchadenplatzReportModel:
    """Test SchadenplatzReport model operations."""

    async def test_create_minimal_report(self, db_session: AsyncSession, test_incident: Incident):
        """A row can exist with nothing but an incident — that is the "Angekommen" state."""
        report = SchadenplatzReport(id=uuid4(), incident_id=test_incident.id)
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.id is not None
        assert report.incident_id == test_incident.id
        # Opposite of RekoReport: a row created by "Angekommen" is not yet filed.
        assert report.is_draft is True
        assert report.submitted_at is None
        assert report.personnel_count_corrected is False
        assert report.vehicle_count_corrected is False
        assert report.created_at is not None
        assert report.updated_at is not None

    @pytest.mark.parametrize(
        "damage_type",
        ["wasserschaden", "sturmschaden", "schneebruch", "anderes"],
    )
    async def test_valid_damage_types_accepted(
        self, db_session: AsyncSession, test_incident: Incident, damage_type: str
    ):
        """All four Unwetter damage types from the paper form are accepted."""
        report = SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, damage_type=damage_type)
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.damage_type == damage_type

    async def test_null_damage_type_accepted(self, db_session: AsyncSession, test_incident: Incident):
        """Schadensart is not required — submit warns, it never blocks."""
        report = SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, damage_type=None)
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.damage_type is None

    async def test_invalid_damage_type_rejected(self, db_session: AsyncSession, test_incident: Incident):
        """An IncidentType value must not leak into damage_type — different vocabularies."""
        report = SchadenplatzReport(
            id=uuid4(),
            incident_id=test_incident.id,
            damage_type="elementarereignis",
        )
        db_session.add(report)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_one_report_per_incident(
        self, db_session: AsyncSession, test_user, test_event: Event, test_incident: Incident
    ):
        """A second report on the same incident is rejected: crews amend, they do not compete."""
        first = SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, kurzbericht="Keller ausgepumpt")
        db_session.add(first)
        await db_session.commit()

        second = SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, kurzbericht="Nochmal dasselbe")
        db_session.add(second)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_second_report_on_another_incident_is_fine(
        self, db_session: AsyncSession, test_user, test_event: Event, test_incident: Incident
    ):
        """The uniqueness is per incident, not global."""
        other = Incident(
            id=uuid4(),
            title="Sturmschaden Bahnhofstrasse",
            type="elementarereignis",
            priority="medium",
            status="active",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(other)
        await db_session.commit()

        db_session.add(SchadenplatzReport(id=uuid4(), incident_id=test_incident.id))
        db_session.add(SchadenplatzReport(id=uuid4(), incident_id=other.id))
        await db_session.commit()

    async def test_material_checklist_roundtrip(self, db_session: AsyncSession, test_incident: Incident):
        """The material checklist survives a roundtrip, including an unanswered `used`."""
        materials = [
            {
                "assignment_id": str(uuid4()),
                "material_id": str(uuid4()),
                "name": "Tauchpumpe TP-4",
                "used": True,
                "left_on_site": True,
            },
            {
                "assignment_id": str(uuid4()),
                "material_id": str(uuid4()),
                "name": "Nassauger",
                "used": None,
                "left_on_site": False,
            },
        ]
        report = SchadenplatzReport(
            id=uuid4(),
            incident_id=test_incident.id,
            materials_json=materials,
            cost_snapshot_json=[{"kind": "personnel", "name": "Muster Hans", "from": None, "to": None}],
        )
        db_session.add(report)
        await db_session.commit()
        await db_session.refresh(report)

        assert report.materials_json is not None
        assert report.materials_json[0]["left_on_site"] is True
        assert report.materials_json[1]["used"] is None
        assert report.cost_snapshot_json is not None
        assert report.cost_snapshot_json[0]["kind"] == "personnel"


class TestIncidentFieldReportingColumns:
    """The five incident columns the field actions write."""

    async def test_pickup_defaults_and_roundtrip(self, db_session: AsyncSession, test_incident: Incident):
        """pickup_needed defaults to false and carries note plus provenance when set."""
        await db_session.refresh(test_incident)
        assert test_incident.pickup_needed is False
        assert test_incident.pickup_note is None
        assert test_incident.pickup_requested_at is None
        assert test_incident.pickup_requested_by is None
        assert test_incident.field_complete_reported_by is None

        test_incident.pickup_needed = True
        test_incident.pickup_note = "3 Personen, Ecke Hauptstrasse"
        await db_session.commit()
        await db_session.refresh(test_incident)

        assert test_incident.pickup_needed is True
        assert test_incident.pickup_note == "3 Personen, Ecke Hauptstrasse"


class TestNotificationTypeConstraint:
    """The five field-reporting notification types."""

    @pytest.mark.parametrize(
        ("notification_type", "severity"),
        [
            ("rapport_submitted", "info"),
            ("field_arrived", "info"),
            ("field_complete", "info"),
            ("field_message", "info"),
            # A crew waiting to be collected is the one time-critical field event.
            ("field_pickup", "warning"),
        ],
    )
    async def test_new_types_accepted(
        self, db_session: AsyncSession, test_incident: Incident, notification_type: str, severity: str
    ):
        """Each of the five new types passes valid_notification_type."""
        notification = Notification(
            id=uuid4(),
            type=notification_type,
            severity=severity,
            message="Meldung vom Feld",
            incident_id=test_incident.id,
            event_id=test_incident.event_id,
        )
        db_session.add(notification)
        await db_session.commit()
        await db_session.refresh(notification)

        assert notification.type == notification_type

    async def test_unknown_type_still_rejected(self, db_session: AsyncSession, test_incident: Incident):
        """Widening the vocabulary must not have turned the constraint into a no-op."""
        notification = Notification(
            id=uuid4(),
            type="field_teleport",
            severity="info",
            message="Kein gültiger Typ",
            incident_id=test_incident.id,
        )
        db_session.add(notification)

        with pytest.raises(IntegrityError):
            await db_session.commit()
