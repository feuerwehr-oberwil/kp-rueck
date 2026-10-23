"""Tests for StatusTransition model."""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, StatusTransition, User


class TestStatusTransitionModel:
    """Test StatusTransition model operations."""

    async def test_status_transition_cascade_delete(
        self, db_session: AsyncSession, test_incident: Incident, test_user: User
    ):
        """Test that transitions are deleted when incident is deleted."""
        transition = StatusTransition(
            id=uuid4(),
            incident_id=test_incident.id,
            from_status="incoming",
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
        result = await db_session.execute(select(StatusTransition).where(StatusTransition.id == transition_id))
        assert result.scalar_one_or_none() is None
