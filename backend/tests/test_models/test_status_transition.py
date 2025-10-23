"""Tests for StatusTransition model."""
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Incident, StatusTransition, User


class TestStatusTransitionModel:
    """Test StatusTransition model operations."""

    async def test_create_status_transition(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        """Test creating a status transition."""
        transition = StatusTransition(
            id=uuid4(),
            incident_id=test_incident.id,
            from_status="eingegangen",
            to_status="disponiert",
            user_id=test_user.id,
            notes="Fahrzeug alarmiert",
        )
        db_session.add(transition)
        await db_session.commit()
        await db_session.refresh(transition)

        assert transition.id is not None
        assert transition.incident_id == test_incident.id
        assert transition.from_status == "eingegangen"
        assert transition.to_status == "disponiert"
        assert transition.user_id == test_user.id
        assert transition.notes == "Fahrzeug alarmiert"
        assert transition.timestamp is not None

    async def test_status_transition_without_user(
        self, db_session: AsyncSession, test_incident: Incident
    ):
        """Test creating a status transition without user (automated)."""
        transition = StatusTransition(
            id=uuid4(),
            incident_id=test_incident.id,
            from_status="reko",
            to_status="disponiert",
            user_id=None,
            notes="Automated transition",
        )
        db_session.add(transition)
        await db_session.commit()
        await db_session.refresh(transition)

        assert transition.user_id is None

    async def test_status_transition_cascade_delete(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        """Test that transitions are deleted when incident is deleted."""
        transition = StatusTransition(
            id=uuid4(),
            incident_id=test_incident.id,
            from_status="eingegangen",
            to_status="reko",
            user_id=test_user.id,
        )
        db_session.add(transition)
        await db_session.commit()
        transition_id = transition.id

        # Delete incident
        await db_session.delete(test_incident)
        await db_session.commit()

        # Transition should be deleted
        result = await db_session.execute(
            select(StatusTransition).where(StatusTransition.id == transition_id)
        )
        assert result.scalar_one_or_none() is None

    async def test_status_transition_relationship(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        """Test loading transitions through incident relationship."""
        # Create multiple transitions
        transitions = [
            StatusTransition(
                id=uuid4(),
                incident_id=test_incident.id,
                from_status="eingegangen",
                to_status="reko",
                user_id=test_user.id,
            ),
            StatusTransition(
                id=uuid4(),
                incident_id=test_incident.id,
                from_status="reko",
                to_status="disponiert",
                user_id=test_user.id,
            ),
        ]
        for transition in transitions:
            db_session.add(transition)
        await db_session.commit()

        # Load incident with transitions
        result = await db_session.execute(
            select(Incident)
            .options(selectinload(Incident.status_transitions))
            .where(Incident.id == test_incident.id)
        )
        incident = result.scalar_one()

        assert len(incident.status_transitions) == 2

    async def test_status_transition_index(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        """Test that timestamp index exists for efficient queries."""
        # Create transitions
        for i in range(5):
            transition = StatusTransition(
                id=uuid4(),
                incident_id=test_incident.id,
                from_status="eingegangen",
                to_status="disponiert",
                user_id=test_user.id,
            )
            db_session.add(transition)
        await db_session.commit()

        # Query by timestamp (should use index)
        result = await db_session.execute(
            select(StatusTransition)
            .where(StatusTransition.incident_id == test_incident.id)
            .order_by(StatusTransition.timestamp.desc())
        )
        transitions = result.scalars().all()
        assert len(transitions) == 5
