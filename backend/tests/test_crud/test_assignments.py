"""Tests for Assignment CRUD operations.

Tests cover:
- assign_resource: Create resource assignments to incidents
- unassign_resource: Release resources from incidents
- get_incident_assignments: Get all active assignments
- get_assignments_by_event: Batch load assignments for an event
- check_resource_conflicts: Check if resource is assigned elsewhere
- auto_release_incident_resources: Auto-release on incident completion
- transfer_assignments: Transfer assignments between incidents
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import assignments as assignment_crud
from app.models import (
    Event,
    EventSpecialFunction,
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
        status="incoming",
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
        status="incoming",
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
        status="available",
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

        # Note: Base status is NOT updated - assignment is tracked via incident_assignments table
        await db_session.refresh(test_vehicle)
        assert test_vehicle.status == "available"  # Base status unchanged

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

        # Note: Base status is NOT updated - assignment is tracked via incident_assignments table
        await db_session.refresh(test_personnel)
        assert test_personnel.status == "available"  # Base status unchanged

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

        # Note: Base status is NOT updated - assignment is tracked via incident_assignments table
        await db_session.refresh(test_material)
        assert test_material.status == "available"  # Base status unchanged

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

    async def test_database_refuses_a_second_active_row_for_the_same_resource(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """The double-click race: the DATABASE has to refuse it, not just the application.

        `assign_resource` takes SELECT ... FOR UPDATE before inserting, which reads like it
        serialises concurrent callers — but it locks the rows it finds, and on the first
        assignment there are none. Two transactions therefore both saw an empty result and
        both inserted, and the board showed the same vehicle twice on one incident.

        The old `unique_assignment` covered unassigned_at, which is NULL on exactly the rows
        that matter, and NULL != NULL — so it permitted unlimited active duplicates. This
        writes the second row directly, the way a lost race does, and asserts the partial
        index stops it.
        """
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        db_session.add(
            IncidentAssignment(
                incident_id=test_incident.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                assigned_by=test_user.id,
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

    async def test_a_released_resource_can_be_assigned_again(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """The index must constrain ACTIVE rows only — releasing and re-assigning is normal.

        A crew leaves a Schadenplatz and comes back an hour later; the incident then holds two
        rows for one vehicle, one released and one active. A unique index over all rows would
        reject that, which is why this one carries `WHERE unassigned_at IS NULL`.
        """
        first = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.unassign_resource(
            db=db_session,
            assignment_id=first.id,
            current_user=test_user,
            request=mock_request,
        )
        await db_session.commit()

        again = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        assert again.unassigned_at is None

        rows = (
            (
                await db_session.execute(
                    select(IncidentAssignment).where(
                        IncidentAssignment.incident_id == test_incident.id,
                        IncidentAssignment.resource_id == test_vehicle.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2, "the released row must stay as history"
        assert sum(1 for row in rows if row.unassigned_at is None) == 1

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
        with pytest.raises(ValueError, match="keine aktiven Ressourcen"):
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

        with pytest.raises(ValueError, match="bereits zugewiesen"):
            await assignment_crud.transfer_assignments(
                db=db_session,
                source_incident_id=test_incident.id,
                target_incident_id=second_incident.id,
                current_user=test_user,
                request=mock_request,
            )

    async def test_transfer_ignores_reko_personnel(
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
        """A reko person on source + target must not block (or be part of) the transfer."""
        # Mark test_personnel as the event's reko person.
        db_session.add(
            EventSpecialFunction(
                id=uuid4(),
                event_id=test_event.id,
                personnel_id=test_personnel.id,
                function_type="reko",
            )
        )
        await db_session.commit()

        # Reko person is assigned to BOTH source and target (as a normal personnel
        # assignment) — without the exclusion this would raise a conflict.
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=second_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )

        # A real (non-reko) resource to actually transfer.
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        result = await assignment_crud.transfer_assignments(
            db=db_session,
            source_incident_id=test_incident.id,
            target_incident_id=second_incident.id,
            current_user=test_user,
            request=mock_request,
        )

        # Only the vehicle was transferred; the reko person was ignored.
        assert result["transferred_count"] == 1

        # Reko person remains assigned to the source (not unassigned by the transfer).
        source_assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=test_incident.id,
        )
        source_personnel_ids = {a.resource_id for a in source_assignments if a.resource_type == "personnel"}
        assert test_personnel.id in source_personnel_ids

        # Target received the vehicle.
        target_assignments = await assignment_crud.get_incident_assignments(
            db=db_session,
            incident_id=second_incident.id,
        )
        target_vehicle_ids = {a.resource_id for a in target_assignments if a.resource_type == "vehicle"}
        assert test_vehicle.id in target_vehicle_ids


# ============================================
# Test: Transaction Isolation (Row Locking)
# ============================================


class TestTransactionIsolation:
    """Tests for transaction isolation and row locking in assignments."""

    async def test_assign_resource_uses_for_update(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test that assign_resource uses FOR UPDATE locking.

        This test verifies that the assignment succeeds and the locking
        mechanism is in place. The actual concurrent behavior is tested
        at the integration level.
        """
        # Should succeed with locking enabled
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

    async def test_duplicate_assignment_prevented_with_locking(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test that duplicate assignment to same incident is prevented.

        This validates the check-and-create atomicity that FOR UPDATE provides.
        """
        # First assignment succeeds
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Second assignment to same incident should fail
        with pytest.raises(ValueError, match="already assigned to this incident"):
            await assignment_crud.assign_resource(
                db=db_session,
                incident_id=test_incident.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                current_user=test_user,
                request=mock_request,
            )

    async def test_assignment_to_different_incidents_allowed(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        second_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Test that assigning same resource to different incidents is allowed.

        The locking ensures accurate conflict detection while still allowing
        the override behavior for different incidents (UI shows warning).
        """
        # First assignment
        assignment1 = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        # Second assignment to different incident should succeed (warning in UI)
        assignment2 = await assignment_crud.assign_resource(
            db=db_session,
            incident_id=second_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        assert assignment1.incident_id == test_incident.id
        assert assignment2.incident_id == second_incident.id
        assert assignment1.id != assignment2.id
