"""Tests for IncidentAssignment model."""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, IncidentAssignment, User, Vehicle


class TestIncidentAssignmentModel:
    """Test IncidentAssignment model operations."""

    async def test_invalid_resource_type_constraint(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that invalid resource_type is rejected."""
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="equipment",  # Invalid type
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)

        with pytest.raises(IntegrityError):
            await db_session.commit()

    async def test_cascade_delete_on_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that assignments are deleted when incident is deleted."""
        # Create assignment
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()
        assignment_id = assignment.id

        # Delete incident
        await db_session.delete(test_incident)
        await db_session.commit()

        # Assignment should be deleted
        result = await db_session.execute(select(IncidentAssignment).where(IncidentAssignment.id == assignment_id))
        assert result.scalar_one_or_none() is None
