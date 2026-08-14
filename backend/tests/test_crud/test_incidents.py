"""Tests for Incident CRUD operations."""

from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import assignments as assignment_crud
from app.crud import incidents as incident_crud
from app.models import Incident, IncidentAssignment, Personnel, SchadenplatzReport, User, Vehicle


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

    async def test_rapport_flags_tell_a_draft_from_a_filed_one(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
    ):
        """A draft and a filed rapport are different states, on both read paths.

        The board needs to tell "nobody filed" from "somebody started and walked
        away" — the second is the actionable gap, and it used to be invisible
        because only the filed flag existed.
        """
        db_session.add(SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, is_draft=True))
        await db_session.commit()

        single = await incident_crud.get_incident(db_session, test_incident.id)
        assert single is not None
        assert single.has_schadenplatz_rapport is False
        assert single.has_schadenplatz_rapport_draft is True

        listed = await incident_crud.get_incidents(db_session)
        ours = next(inc for inc in listed if inc.id == test_incident.id)
        assert ours.has_schadenplatz_rapport is False
        assert ours.has_schadenplatz_rapport_draft is True

    async def test_a_filed_rapport_clears_the_draft_flag(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
    ):
        """The two flags are mutually exclusive — never both, never neither-when-a-row-exists."""
        db_session.add(SchadenplatzReport(id=uuid4(), incident_id=test_incident.id, is_draft=False))
        await db_session.commit()

        single = await incident_crud.get_incident(db_session, test_incident.id)
        assert single is not None
        assert single.has_schadenplatz_rapport is True
        assert single.has_schadenplatz_rapport_draft is False

        listed = await incident_crud.get_incidents(db_session)
        ours = next(inc for inc in listed if inc.id == test_incident.id)
        assert ours.has_schadenplatz_rapport is True
        assert ours.has_schadenplatz_rapport_draft is False

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


class TestCompletionIsUndoable:
    """Leaving `complete` puts back exactly what entering it released.

    The field test that produced these: an operator drags a card to
    Abgeschlossen, the "Material vor Ort oder ins Magazin?" gate opens, they
    press Abbrechen — and the incident comes back with its crew and vehicles
    gone. The status change is applied before the gate opens, and completing
    auto-releases everyone; reverting the status put the status back and nothing
    else.

    The undo lives in the same transaction as the status change on purpose, so
    there is no window in which the incident is open again but its crew is not.
    """

    @staticmethod
    async def _active(db: AsyncSession, incident_id) -> list[IncidentAssignment]:
        result = await db.execute(
            select(IncidentAssignment).where(
                IncidentAssignment.incident_id == incident_id,
                IncidentAssignment.unassigned_at.is_(None),
            )
        )
        return list(result.scalars().all())

    async def test_cancelling_the_completion_gate_keeps_the_crew(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Complete, then revert: the crew and the vehicle are still there."""
        for resource_type, resource_id in (("personnel", test_personnel.id), ("vehicle", test_vehicle.id)):
            await assignment_crud.assign_resource(
                db=db_session,
                incident_id=test_incident.id,
                resource_type=resource_type,
                resource_id=resource_id,
                current_user=test_user,
                request=mock_request,
            )

        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="complete",
            current_user=test_user,
            request=mock_request,
        )
        assert await self._active(db_session, test_incident.id) == []

        # Abbrechen: the gate reverts the status it moved.
        reverted = await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="active",
            current_user=test_user,
            request=mock_request,
        )

        assert reverted is not None
        assert reverted.completed_at is None
        active = await self._active(db_session, test_incident.id)
        assert {(a.resource_type, a.resource_id) for a in active} == {
            ("personnel", test_personnel.id),
            ("vehicle", test_vehicle.id),
        }

    async def test_the_einsatzleiter_comes_back_too(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_personnel: Personnel,
        test_user: User,
        mock_request,
    ):
        """A crew restored without its EL is a card the operator still has to repair."""
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="personnel",
            resource_id=test_personnel.id,
            current_user=test_user,
            request=mock_request,
        )
        active = await self._active(db_session, test_incident.id)
        assert active[0].is_leader is True  # derived by sync_auto_leader

        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="complete",
            current_user=test_user,
            request=mock_request,
        )
        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="active",
            current_user=test_user,
            request=mock_request,
        )

        restored = await self._active(db_session, test_incident.id)
        assert len(restored) == 1
        assert restored[0].is_leader is True

    async def test_patch_path_reverts_the_same_way(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """The board drags through PATCH /incidents/{id}, not through /status."""
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        await incident_crud.update_incident(
            db=db_session,
            incident_id=test_incident.id,
            incident_update=schemas.IncidentUpdate(status="complete"),
            current_user=test_user,
            request=mock_request,
        )
        assert await self._active(db_session, test_incident.id) == []

        await incident_crud.update_incident(
            db=db_session,
            incident_id=test_incident.id,
            incident_update=schemas.IncidentUpdate(status="active"),
            current_user=test_user,
            request=mock_request,
        )

        active = await self._active(db_session, test_incident.id)
        assert [a.resource_type for a in active] == ["vehicle"]

    async def test_a_resource_taken_by_another_incident_is_left_alone(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_event,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """An undo must not silently put a vehicle on two incidents at once."""
        other = Incident(
            id=uuid4(),
            title="Zweiter Einsatz",
            type="elementarereignis",
            priority="medium",
            status="active",
            event_id=test_event.id,
            created_by=test_user.id,
        )
        db_session.add(other)
        await db_session.commit()

        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="complete",
            current_user=test_user,
            request=mock_request,
        )
        # The vehicle went out again while the incident sat in Abgeschlossen.
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=other.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )

        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="active",
            current_user=test_user,
            request=mock_request,
        )

        assert await self._active(db_session, test_incident.id) == []
        assert len(await self._active(db_session, other.id)) == 1

    async def test_the_undo_is_consumed_not_replayed(
        self,
        db_session: AsyncSession,
        test_incident: Incident,
        test_vehicle: Vehicle,
        test_user: User,
        mock_request,
    ):
        """Reopening twice must not resurrect a release the operator undid once."""
        await assignment_crud.assign_resource(
            db=db_session,
            incident_id=test_incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            current_user=test_user,
            request=mock_request,
        )
        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="complete",
            current_user=test_user,
            request=mock_request,
        )
        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="active",
            current_user=test_user,
            request=mock_request,
        )
        # Operator releases the vehicle by hand, then reopens again later.
        active = await self._active(db_session, test_incident.id)
        await assignment_crud.unassign_resource(db_session, active[0].id, test_user, mock_request)
        await db_session.commit()

        await incident_crud.update_incident_status(
            db=db_session,
            incident_id=test_incident.id,
            new_status="returning",
            current_user=test_user,
            request=mock_request,
        )

        assert await self._active(db_session, test_incident.id) == []
