"""Tests for the SchadenplatzReport model and the field-reporting constraints."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, Notification, SchadenplatzReport


class TestSchadenplatzReportModel:
    """Test SchadenplatzReport model operations."""

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
