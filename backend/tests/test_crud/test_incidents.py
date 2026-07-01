"""Tests for Incident CRUD operations."""

from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import incidents as incident_crud
from app.models import Incident, IncidentAssignment, User, Vehicle


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request for audit logging."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


class TestIncidentCRUD:
    """Test incident CRUD operations."""

    async def test_get_incident_with_assigned_vehicles(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that get_incident returns assigned vehicles."""
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

        # Get incident (should include assigned vehicles)
        incident = await incident_crud.get_incident(db_session, test_incident.id)

        # Verify assigned_vehicles is populated
        assert incident is not None
        assert hasattr(incident, "assigned_vehicles")
        assert len(incident.assigned_vehicles) == 1

        # Verify vehicle details
        assigned_vehicle = incident.assigned_vehicles[0]
        assert isinstance(assigned_vehicle, schemas.AssignedVehicle)
        assert assigned_vehicle.assignment_id == assignment.id
        assert assigned_vehicle.vehicle_id == test_vehicle.id
        assert assigned_vehicle.name == test_vehicle.name
        assert assigned_vehicle.type == test_vehicle.type
        assert assigned_vehicle.assigned_at is not None

    async def test_get_incident_with_multiple_assigned_vehicles(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that get_incident returns multiple assigned vehicles."""
        # Create second vehicle
        vehicle2 = Vehicle(
            id=uuid4(),
            name="DLK 1",
            type="DLK",
            status="available",
        )
        db_session.add(vehicle2)
        await db_session.commit()

        # Create two assignments
        assignment1 = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
        )
        assignment2 = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=vehicle2.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment1)
        db_session.add(assignment2)
        await db_session.commit()

        # Get incident
        incident = await incident_crud.get_incident(db_session, test_incident.id)

        # Verify both vehicles are returned
        assert incident is not None
        assert len(incident.assigned_vehicles) == 2

        vehicle_names = {av.name for av in incident.assigned_vehicles}
        assert "TLF 1" in vehicle_names
        assert "DLK 1" in vehicle_names

    async def test_get_incident_excludes_unassigned_vehicles(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that unassigned vehicles are not returned."""
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

        # Unassign the vehicle
        assignment.unassigned_at = datetime.now()
        await db_session.commit()

        # Get incident
        incident = await incident_crud.get_incident(db_session, test_incident.id)

        # Verify no vehicles are returned
        assert incident is not None
        assert len(incident.assigned_vehicles) == 0

    async def test_get_incidents_with_assigned_vehicles(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that get_incidents returns assigned vehicles for all incidents."""
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

        # Get incidents
        incidents = await incident_crud.get_incidents(db_session)

        # Verify assigned_vehicles is populated
        assert len(incidents) > 0

        # Find our test incident
        our_incident = next((inc for inc in incidents if inc.id == test_incident.id), None)
        assert our_incident is not None
        assert len(our_incident.assigned_vehicles) == 1
        assert our_incident.assigned_vehicles[0].vehicle_id == test_vehicle.id

    async def test_get_incident_excludes_personnel_assignments(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_personnel,
        test_user: User,
    ):
        """Test that personnel assignments are not included in assigned_vehicles."""
        # Create personnel assignment (should not appear in assigned_vehicles)
        assignment = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            assigned_by=test_user.id,
        )
        db_session.add(assignment)
        await db_session.commit()

        # Get incident
        incident = await incident_crud.get_incident(db_session, test_incident.id)

        # Verify no vehicles are returned (personnel should not be in assigned_vehicles)
        assert incident is not None
        assert len(incident.assigned_vehicles) == 0

    async def test_assigned_vehicles_ordered_by_assigned_at(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
    ):
        """Test that assigned vehicles are ordered by assignment time."""
        from datetime import UTC, datetime, timedelta

        now = datetime.now(UTC)

        # Create second vehicle
        vehicle2 = Vehicle(
            id=uuid4(),
            name="DLK 1",
            type="DLK",
            status="available",
        )
        db_session.add(vehicle2)
        await db_session.commit()

        # Create first assignment with explicit earlier timestamp
        assignment1 = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
            assigned_at=now - timedelta(minutes=5),
        )
        db_session.add(assignment1)
        await db_session.commit()

        # Create second assignment with explicit later timestamp
        assignment2 = IncidentAssignment(
            id=uuid4(),
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=vehicle2.id,
            assigned_by=test_user.id,
            assigned_at=now,
        )
        db_session.add(assignment2)
        await db_session.commit()

        # Get incident
        incident = await incident_crud.get_incident(db_session, test_incident.id)

        # Verify vehicles are ordered by assignment time (first assigned first)
        assert incident is not None
        assert len(incident.assigned_vehicles) == 2
        assert incident.assigned_vehicles[0].name == "TLF 1"  # First assigned
        assert incident.assigned_vehicles[1].name == "DLK 1"  # Second assigned


class TestRestoreIncident:
    """Test restore_incident CRUD (undo delete)."""

    async def test_delete_uses_single_now_for_both_columns(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """delete_incident stamps deleted_at and completed_at with the same value."""
        assert test_incident.completed_at is None

        await incident_crud.delete_incident(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        await db_session.refresh(test_incident)
        assert test_incident.deleted_at is not None
        assert test_incident.completed_at == test_incident.deleted_at

    async def test_restore_clears_side_effect_completed_at(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """Restore clears completed_at when it was a delete side effect."""
        await incident_crud.delete_incident(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        restored = await incident_crud.restore_incident(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        assert restored is not None
        assert restored.deleted_at is None
        assert restored.completed_at is None

    async def test_restore_preserves_prior_completed_at(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """Restore preserves a pre-existing completed_at (different from deleted_at)."""
        test_incident.completed_at = datetime(2026, 1, 1, 12, 0, 0)
        await db_session.commit()
        # Capture the canonical DB form (tz-aware) for like-for-like comparison.
        await db_session.refresh(test_incident)
        completed = test_incident.completed_at

        await incident_crud.delete_incident(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        restored = await incident_crud.restore_incident(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        assert restored is not None
        assert restored.deleted_at is None
        assert restored.completed_at == completed

    async def test_restore_unknown_returns_none(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Restoring an unknown incident returns None (endpoint maps to 404)."""
        result = await incident_crud.restore_incident(
            db=db_session,
            incident_id=uuid4(),
            current_user=test_user,
            request=mock_request,
        )
        assert result is None

    async def test_restore_not_deleted_raises_value_error(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """Restoring a non-deleted incident raises ValueError (endpoint maps to 409)."""
        with pytest.raises(ValueError):
            await incident_crud.restore_incident(
                db=db_session,
                incident_id=test_incident.id,
                current_user=test_user,
                request=mock_request,
            )
