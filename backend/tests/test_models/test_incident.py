"""Tests for Incident model."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, User


class TestIncidentModel:
    """Test Incident model operations."""

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
            status="incoming",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_invalid_priority_constraint(self, db_session: AsyncSession, test_user: User, test_event: Event):
        """Test that invalid priority is rejected."""
        incident = Incident(
            id=uuid4(),
            title="Invalid Priority",
            type="brandbekaempfung",
            priority="urgent",  # Invalid priority
            status="incoming",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_invalid_status_constraint(self, db_session: AsyncSession, test_user: User, test_event: Event):
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
            status="incoming",
            created_by=test_user.id,
        )
        db_session.add(incident)

        with pytest.raises(IntegrityError):
            await db_session.commit()
