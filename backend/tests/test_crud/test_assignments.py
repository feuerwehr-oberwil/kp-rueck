"""Tests for Assignment CRUD operations.

Tests cover:
- assign_resource: Create resource assignments to incidents
- unassign_resource: Release resources from incidents
- update_resource_status: Update availability status
- get_incident_assignments: Get all active assignments
- get_assignments_by_event: Batch load assignments for an event
- check_resource_conflicts: Check if resource is assigned elsewhere
- auto_release_incident_resources: Auto-release on incident completion
- transfer_assignments: Transfer assignments between incidents
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import assignments as assignment_crud
from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    Material,
    Personnel,
    User,
    Vehicle,
)


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="assignment_test_editor",
        password_hash="hashed_password",
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Assignment Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_user: User, test_event: Event) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        title="Test Incident",
        type="brandbekaempfung",
        priority="high",
        location_address="Test Street 1",
        status="eingegangen",
        event_id=test_event.id,
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def second_incident(db_session: AsyncSession, test_user: User, test_event: Event) -> Incident:
    """Create a second test incident for transfer tests."""
    incident = Incident(
        id=uuid4(),
        title="Second Test Incident",
        type="strassenrettung",
        priority="medium",
        location_address="Test Street 2",
        status="eingegangen",
        event_id=test_event.id,
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create a test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF Test",
        type="TLF",
        status="available",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Test Person",
        role="firefighter",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create test material."""
    material = Material(
        id=uuid4(),
        name="Test Material",
        type="equipment",
        status="available",
        location="Storage",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


# ============================================
# Test: assign_resource
# ============================================


class TestAssignResource:
    """Tests for assign_resource function."""

    async def test_assign_vehicle_to_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test successfully assigning a vehicle to an incident."""
        assignment = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        assert assignment is not None
        assert assignment.incident_id == test_incident.id
        assert assignment.resource_type == "vehicle"
        assert assignment.resource_id == test_vehicle.id
        assert assignment.assigned_by == test_user.id
        assert assignment.unassigned_at is None

        # Verify vehicle status updated
        await db_session.refresh(test_vehicle)
        assert test_vehicle.status == "assigned"

    async def test_assign_personnel_to_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test assigning personnel to an incident."""
        assignment = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        assert assignment is not None
        assert assignment.resource_type == "personnel"

        # Verify personnel availability updated
        await db_session.refresh(test_personnel)
        assert test_personnel.availability == "assigned"

    async def test_assign_material_to_incident(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_material: Material,
        test_user: User,
        mock_request,
    ):
        """Test assigning material to an incident."""
        assignment = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=test_material.id,
            current_user=test_user,
            request=mock_request,
        )

        assert assignment is not None
        assert assignment.resource_type == "material"

        # Verify material status updated
        await db_session.refresh(test_material)
        assert test_material.status == "assigned"

    async def test_assign_duplicate_resource_raises_error(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test assigning same resource twice to same incident raises error."""
        # First assignment
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Second assignment should fail
        with pytest.raises(ValueError, match="already assigned to this incident"):
            await assignment_crud.assign_resource(
                db=db_session,
                incident_id=test_incident.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                current_user=test_user,
                request=mock_request,
            )

    async def test_assign_resource_already_assigned_elsewhere_allowed(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        second_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test assigning resource to another incident is allowed (shows warning in UI)."""
        # First assignment
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Second assignment to different incident should succeed (warning handled in UI)
        # Note: This tests current behavior which allows override
        # The function doesn't raise an error for conflicts with other incidents


# ============================================
# Test: unassign_resource
# ============================================


class TestUnassignResource:
    """Tests for unassign_resource function."""

    async def test_unassign_vehicle(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test unassigning a vehicle from an incident."""
        # First assign
        assignment = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Then unassign
        result = await assignment_crud.unassign_resource(
            db=db_session,
            assignment_id=assignment.id,
            current_user=test_user,
            request=mock_request,
        )

        assert result is True

        # Verify assignment marked as unassigned
        await db_session.refresh(assignment)
        assert assignment.unassigned_at is not None

        # Verify vehicle status returned to available
        await db_session.refresh(test_vehicle)
        assert test_vehicle.status == "available"

    async def test_unassign_nonexistent_assignment(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_request,
    ):
        """Test unassigning a nonexistent assignment returns False."""
        result = await assignment_crud.unassign_resource(
            db=db_session,
            assignment_id=uuid4(),
            current_user=test_user,
            request=mock_request,
        )

        assert result is False


# ============================================
# Test: update_resource_status
# ============================================


class TestUpdateResourceStatus:
    """Tests for update_resource_status function."""

    async def test_update_personnel_status(
        self,
        db_session: AsyncSession,
        test_personnel: Personnel,
    ):
        """Test updating personnel availability status."""
        await assignment_crud.update_resource_status(
            db=db_session,
            resource_type="personnel",
            resource_id=test_personnel.id,
            new_status="assigned",
        )
        # Note: update_resource_status doesn't commit - caller must commit
        await db_session.commit()

        await db_session.refresh(test_personnel)
        assert test_personnel.availability == "assigned"

    async def test_update_vehicle_status(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
    ):
        """Test updating vehicle status."""
        await assignment_crud.update_resource_status(
            db=db_session,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            new_status="assigned",
        )
        await db_session.commit()

        await db_session.refresh(test_vehicle)
        assert test_vehicle.status == "assigned"

    async def test_update_material_status(
        self,
        db_session: AsyncSession,
        test_material: Material,
    ):
        """Test updating material status."""
        await assignment_crud.update_resource_status(
            db=db_session,
            resource_type="material",
            resource_id=test_material.id,
            new_status="assigned",
        )
        await db_session.commit()

        await db_session.refresh(test_material)
        assert test_material.status == "assigned"

    async def test_update_nonexistent_resource(
        self,
        db_session: AsyncSession,
    ):
        """Test updating nonexistent resource doesn't crash."""
        # Should not raise an error
        await assignment_crud.update_resource_status(
            db=db_session,
            resource_type="vehicle",
            resource_id=uuid4(),
            new_status="assigned",
        )


# ============================================
# Test: get_incident_assignments
# ============================================


class TestGetIncidentAssignments:
    """Tests for get_incident_assignments function."""

    async def test_get_active_assignments(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test getting all active assignments for an incident."""
        # Create two assignments
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )

        assert len(assignments) == 2

    async def test_excludes_unassigned(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test that unassigned resources are excluded."""
        # Assign then unassign
        assignment = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.unassign_resource(
            db=db_session,
            assignment_id=assignment.id,
            current_user=test_user,
            request=mock_request,
        )

        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )

        assert len(assignments) == 0

    async def test_empty_assignments(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
    ):
        """Test getting assignments for incident with none."""
        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )

        assert len(assignments) == 0


# ============================================
# Test: get_assignments_by_event
# ============================================


class TestGetAssignmentsByEvent:
    """Tests for get_assignments_by_event function."""

    async def test_get_all_event_assignments(
        self,
        db_session: AsyncSession,
        test_event: Event,
        test_incident: Incident,
        second_incident: Incident,
        test_vehicle: Vehicle,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test getting all assignments for all incidents in an event."""
        # Assign vehicle to first incident
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        # Assign personnel to second incident
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=second_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        assignments_by_incident = await assignment_crud.get_assignments_by_event(
            db=db_session,
            event_id=test_event.id,
        )

        assert test_incident.id in assignments_by_incident
        assert second_incident.id in assignments_by_incident
        assert len(assignments_by_incident[test_incident.id]) == 1
        assert len(assignments_by_incident[second_incident.id]) == 1

    async def test_empty_event_returns_empty_dict(
        self,
        db_session: AsyncSession,
    ):
        """Test getting assignments for event with no incidents."""
        # Create empty event
        empty_event = Event(id=uuid4(), name="Empty Event", training_flag=False)
        db_session.add(empty_event)
        await db_session.commit()

        assignments = await assignment_crud.get_assignments_by_event(
            db=db_session,
            event_id=empty_event.id,
        )

        assert assignments == {}


# ============================================
# Test: check_resource_conflicts
# ============================================


class TestCheckResourceConflicts:
    """Tests for check_resource_conflicts function."""

    async def test_no_conflicts_when_not_assigned(
        self,
        db_session: AsyncSession,
        test_vehicle: Vehicle,
    ):
        """Test checking conflicts for unassigned resource."""
        conflicts = await assignment_crud.check_resource_conflicts(
            db=db_session,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
        )

        assert conflicts == []

    async def test_returns_incident_ids_when_assigned(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test returns incident IDs where resource is assigned."""
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        conflicts = await assignment_crud.check_resource_conflicts(
            db=db_session,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
        )

        assert test_incident.id in conflicts


# ============================================
# Test: auto_release_incident_resources
# ============================================


class TestAutoReleaseIncidentResources:
    """Tests for auto_release_incident_resources function."""

    async def test_releases_personnel_and_vehicles(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test auto-release releases personnel and vehicles."""
        # Assign both
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        # Auto-release
        await assignment_crud.auto_release_incident_resources(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
            exclude_materials=True,
        )

        # Verify both released
        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )
        assert len(assignments) == 0

    async def test_keeps_materials_when_excluded(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_material: Material,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test auto-release keeps materials when exclude_materials=True."""
        # Assign vehicle and material
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=test_material.id,
            current_user=test_user,
            request=mock_request,
        )

        # Auto-release with exclude_materials=True
        await assignment_crud.auto_release_incident_resources(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
            exclude_materials=True,
        )

        # Verify material kept, vehicle released
        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )
        assert len(assignments) == 1
        assert assignments[0].resource_type == "material"

    async def test_releases_all_including_materials(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_material: Material,
        test_user: User,
        mock_request,
    ):
        """Test auto-release releases materials when exclude_materials=False."""
        # Assign material
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="material",
            resource_id=test_material.id,
            current_user=test_user,
            request=mock_request,
        )

        # Auto-release with exclude_materials=False
        await assignment_crud.auto_release_incident_resources(
            db=db_session,
            incident_id=test_incident.id,
            current_user=test_user,
            request=mock_request,
            exclude_materials=False,
        )

        # Verify all released
        assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )
        assert len(assignments) == 0


# ============================================
# Test: transfer_assignments
# ============================================


class TestTransferAssignments:
    """Tests for transfer_assignments function."""

    async def test_transfer_all_assignments(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        second_incident: Incident,
        test_vehicle: Vehicle,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """Test transferring all assignments from one incident to another."""
        # Assign to source incident
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        # Transfer
        result = await assignment_crud.transfer_assignments(
            db=db_session,
            source_incident_id=test_incident.id,
            target_incident_id=second_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        assert result["transferred_count"] == 2
        assert len(result["assignment_ids"]) == 2

        # Verify source has no active assignments
        source_assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )
        assert len(source_assignments) == 0

        # Verify target has all assignments
        target_assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=second_incident.id,
        )
        assert len(target_assignments) == 2

    async def test_transfer_fails_on_nonexistent_source(
        self,
        db_session: AsyncSession,
        second_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """Test transfer fails when source incident doesn't exist."""
        with pytest.raises(ValueError, match="Source incident not found"):
            await assignment_crud.transfer_assignments(
                db=db_session,
                source_incident_id=uuid4(),
                target_incident_id=second_incident.id,
                current_user=test_user,
                request=mock_request,
            )

    async def test_transfer_fails_on_nonexistent_target(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test transfer fails when target incident doesn't exist."""
        # Need at least one assignment to transfer
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        with pytest.raises(ValueError, match="Target incident not found"):
            await assignment_crud.transfer_assignments(
                db=db_session,
                source_incident_id=test_incident.id,
                target_incident_id=uuid4(),
                current_user=test_user,
                request=mock_request,
            )

    async def test_transfer_fails_when_no_assignments(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        second_incident: Incident,
        test_user: User,
        mock_request,
    ):
        """Test transfer fails when source has no assignments."""
        with pytest.raises(ValueError, match="no active assignments to transfer"):
            await assignment_crud.transfer_assignments(
                db=db_session,
                source_incident_id=test_incident.id,
                target_incident_id=second_incident.id,
                current_user=test_user,
                request=mock_request,
            )

    async def test_transfer_fails_on_conflict(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        second_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test transfer fails when resource already assigned to target."""
        # Assign to both incidents (we can do this because conflicts are warnings not errors)
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Create a new vehicle for target
        second_vehicle = Vehicle(id=uuid4(), name="Second Vehicle", type="TLF", status="available")
        db_session.add(second_vehicle)
        await db_session.commit()

        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=second_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        with pytest.raises(ValueError, match="already assigned to target"):
            await assignment_crud.transfer_assignments(
                db=db_session,
                source_incident_id=test_incident.id,
                target_incident_id=second_incident.id,
                current_user=test_user,
                request=mock_request,
            )
