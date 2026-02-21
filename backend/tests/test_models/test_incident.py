"""Tests for Incident model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, User


class TestIncidentModel:
    """Test Incident model operations."""

    async def test_create_incident_minimal(
        self, db_session: AsyncSession, test_user: User, test_event: Event
    ):
        """Test creating an incident with minimal required fields."""
        incident = Incident(
            id=uuid4(),
            title="Test Incident",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)
        await db_session.commit()
        await db_session.refresh(incident)

        assert incident.id is not None
        assert incident.title == "Test Incident"
        assert incident.type == "brandbekaempfung"
        assert incident.priority == "medium"
        assert incident.status == "eingegangen"
        assert incident.event_id == test_event.id
        assert incident.created_at is not None
        assert incident.updated_at is not None

    async def test_create_incident_with_location(
        self, db_session: AsyncSession, test_user: User, test_event: Event
    ):
        """Test creating an incident with location coordinates."""
        incident = Incident(
            id=uuid4(),
            title="Fire at Main Street",
            type="brandbekaempfung",
            priority="high",
            location_address="Main Street 123",
            location_lat=47.5596,
            location_lng=7.5886,
            status="eingegangen",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)
        await db_session.commit()
        await db_session.refresh(incident)

        assert incident.location_address == "Main Street 123"
        assert float(incident.location_lat) == pytest.approx(47.5596)
        assert float(incident.location_lng) == pytest.approx(7.5886)

    async def test_location_coordinates_both_required(
        self, db_session: AsyncSession, test_user: User, test_event: Event
    ):
        """Test that both lat and lng must be provided or both null."""
        incident = Incident(
            id=uuid4(),
            title="Invalid Location",
            type="brandbekaempfung",
            priority="low",
            location_lat=47.5596,
            location_lng=None,  # Missing lng
            status="eingegangen",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_invalid_priority_constraint(
        self, db_session: AsyncSession, test_user: User, test_event: Event
    ):
        """Test that invalid priority is rejected."""
        incident = Incident(
            id=uuid4(),
            title="Invalid Priority",
            type="brandbekaempfung",
            priority="urgent",  # Invalid priority
            status="eingegangen",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_invalid_status_constraint(
        self, db_session: AsyncSession, test_user: User, test_event: Event
    ):
        """Test that invalid status is rejected."""
        incident = Incident(
            id=uuid4(),
            title="Invalid Status",
            type="brandbekaempfung",
            priority="medium",
            status="completed",  # Invalid status
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_event_id_required(self, db_session: AsyncSession, test_user: User):
        """Test that event_id is required."""
        incident = Incident(
            id=uuid4(),
            title="No Event Test",
            type="brandbekaempfung",
            priority="low",
            status="eingegangen",
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_incident_fixture(self, test_incident: Incident):
        """Test the test_incident fixture."""
        assert test_incident.id is not None
        assert test_incident.title == "Wohnungsbrand"
        assert test_incident.type == "brandbekaempfung"
        assert test_incident.priority == "high"
        assert test_incident.status == "eingegangen"
