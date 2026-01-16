"""Tests for IncidentAssignment model."""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, IncidentAssignment, Personnel, User, Vehicle


class TestIncidentAssignmentModel:
    """Test IncidentAssignment model operations."""

    async def test_assign_vehicle_to_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test assigning a vehicle to an incident."""
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()
        await db_session.refresh(assignment)

        assert assignment.id is not None
        assert assignment.incident_id == test_incident.id
        assert assignment.resource_type == "vehicle"
        assert assignment.resource_id == test_vehicle.id
        assert assignment.assigned_at is not None
        assert assignment.unassigned_at is None

    async def test_assign_personnel_to_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
    ):
        """Test assigning personnel to an incident."""
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()
        await db_session.refresh(assignment)

        assert assignment.resource_type == "personnel"
        assert assignment.resource_id == test_personnel.id

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

    async def test_relationship_loading(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test loading relationships between incident and assignments."""
        from sqlalchemy.orm import selectinload

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

        # Reload incident with eager loading of assignments
        result = await db_session.execute(
            select(Incident).options(selectinload(Incident.assignments)).where(Incident.id == test_incident.id)
        )
        incident = result.scalar_one()

        # Access assignments relationship
        assert len(incident.assignments) == 1
        assert incident.assignments[0].resource_type == "vehicle"

    async def test_unassign_resource(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test marking a resource as unassigned."""
        from datetime import datetime

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

        # Mark as unassigned
        assignment.unassigned_at = datetime.now()
        await db_session.commit()
        await db_session.refresh(assignment)

        assert assignment.unassigned_at is not None
