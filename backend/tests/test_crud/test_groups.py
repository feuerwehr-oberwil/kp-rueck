"""Tests for Auftrag (incident group) CRUD operations.

Covers:
- create/list/update/soft-delete a group; list excludes soft-deleted
- stop_ids returned in group_position order; progress counts done stops
- soft delete nulls group_id on stops (incidents survive)
- reorder groups & stops (enumerate positions; unknown ids ignored)
- add stops (append at end; cross-event rejected) / remove stop
- group-level assignments: assign/list/unassign, works with 0 stops,
  cross-incident conflict allowed, exact-duplicate active row rejected
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.crud import assignments as assignment_crud
from app.crud import group_assignments as group_assignments_crud
from app.crud import groups as groups_crud
from app.crud import incidents as incidents_crud
from app.crud import print_jobs as print_jobs_crud
from app.models import (
    Event,
    Incident,
    IncidentAssignment,
    IncidentGroup,
    IncidentGroupAssignment,
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
        username="group_test_editor",
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
    event = Event(id=uuid4(), name="Group Test Event", training_flag=False)
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def second_event(db_session: AsyncSession) -> Event:
    """A separate event for cross-event rejection tests."""
    event = Event(id=uuid4(), name="Other Event", training_flag=False)
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request (audit logging needs .client/.headers)."""
    request = MagicMock()
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get = MagicMock(return_value=None)
    return request


async def _make_incident(
    db: AsyncSession,
    event: Event,
    user: User,
    *,
    title: str = "Stop",
    status: str = "eingegangen",
) -> Incident:
    """Create and persist a plain incident belonging to ``event``."""
    incident = Incident(
        id=uuid4(),
        title=title,
        type="brandbekaempfung",
        priority="medium",
        location_address=f"{title} Street 1",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _make_group(
    db: AsyncSession,
    event: Event,
    user: User,
    request,
    *,
    name: str = "Sturm-Route West",
) -> IncidentGroup:
    return await groups_crud.create_group(
        db,
        schemas.IncidentGroupCreate(name=name, event_id=event.id),
        user,
        request,
    )


# ============================================
# CRUD: create / list / update / soft-delete
# ============================================


class TestGroupLifecycle:
    async def test_create_and_list_group(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request, name="Route A")
        assert group.id is not None
        assert group.name == "Route A"
        assert group.position == 0

        responses = await groups_crud.list_groups_by_event(db_session, test_event.id)
        assert len(responses) == 1
        assert responses[0].id == group.id
        assert responses[0].name == "Route A"
        assert responses[0].stop_ids == []
        assert responses[0].progress.total == 0
        assert responses[0].progress.done == 0
        assert responses[0].assignments == []

    async def test_create_appends_position(self, db_session, test_event, test_user, mock_request):
        g0 = await _make_group(db_session, test_event, test_user, mock_request, name="A")
        g1 = await _make_group(db_session, test_event, test_user, mock_request, name="B")
        assert g0.position == 0
        assert g1.position == 1

    async def test_update_group(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        updated = await groups_crud.update_group(
            db_session,
            group.id,
            schemas.IncidentGroupUpdate(name="Renamed", color="#ff0000"),
            test_user,
            mock_request,
        )
        assert updated is not None
        assert updated.name == "Renamed"
        assert updated.color == "#ff0000"

    async def test_list_excludes_soft_deleted(self, db_session, test_event, test_user, mock_request):
        keep = await _make_group(db_session, test_event, test_user, mock_request, name="Keep")
        drop = await _make_group(db_session, test_event, test_user, mock_request, name="Drop")

        await groups_crud.soft_delete_group(db_session, drop.id, test_user, mock_request)

        responses = await groups_crud.list_groups_by_event(db_session, test_event.id)
        assert [r.id for r in responses] == [keep.id]

    async def test_stop_ids_in_group_position_order_and_progress(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="First", status="einsatz_beendet")
        i2 = await _make_incident(db_session, test_event, test_user, title="Second", status="abschluss")
        i3 = await _make_incident(db_session, test_event, test_user, title="Third", status="eingegangen")

        # Attach in a specific order -> group_position stamps 0,1,2 in that order.
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id, i2.id, i3.id], test_user, mock_request)

        response = await groups_crud.build_group_response(db_session, group)
        assert response.stop_ids == [i1.id, i2.id, i3.id]
        # done = stops in einsatz_beendet / abschluss (i1 + i2)
        assert response.progress.total == 3
        assert response.progress.done == 2

        # Reordering the stops re-orders stop_ids in the response.
        await groups_crud.reorder_group_stops(db_session, group.id, [i3.id, i1.id, i2.id])
        response2 = await groups_crud.build_group_response(db_session, group)
        assert response2.stop_ids == [i3.id, i1.id, i2.id]


# ============================================
# Delete leaves stops on the board
# ============================================


class TestSoftDeleteLeavesStops:
    async def test_soft_delete_nulls_group_id_and_keeps_incidents(
        self, db_session, test_event, test_user, mock_request
    ):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A")
        i2 = await _make_incident(db_session, test_event, test_user, title="B")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id, i2.id], test_user, mock_request)

        await groups_crud.soft_delete_group(db_session, group.id, test_user, mock_request)

        # Incidents still exist (not deleted), and their group_id is nulled.
        for inc in (i1, i2):
            await db_session.refresh(inc)
            assert inc.deleted_at is None
            assert inc.group_id is None

        # Group no longer listed.
        responses = await groups_crud.list_groups_by_event(db_session, test_event.id)
        assert responses == []

    async def test_soft_delete_releases_all_assignment_types(
        self, db_session, test_event, test_user, mock_request, test_vehicle, person_a, test_material
    ):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        for resource_type, resource_id in (
            ("vehicle", test_vehicle.id),
            ("personnel", person_a.id),
            ("material", test_material.id),
        ):
            await group_assignments_crud.assign_group_resource(
                db_session, group.id, resource_type, resource_id, test_user, mock_request
            )

        await groups_crud.soft_delete_group(db_session, group.id, test_user, mock_request)

        rows = await db_session.execute(
            select(IncidentGroupAssignment).where(IncidentGroupAssignment.incident_group_id == group.id)
        )
        assert all(row.unassigned_at is not None for row in rows.scalars().all())


# ============================================
# Reorder groups & stops
# ============================================


class TestReorder:
    async def test_reorder_groups_persists_positions(self, db_session, test_event, test_user, mock_request):
        g0 = await _make_group(db_session, test_event, test_user, mock_request, name="A")
        g1 = await _make_group(db_session, test_event, test_user, mock_request, name="B")
        g2 = await _make_group(db_session, test_event, test_user, mock_request, name="C")

        count = await groups_crud.reorder_groups(db_session, test_event.id, [g2.id, g0.id, g1.id])
        assert count == 3

        for g in (g0, g1, g2):
            await db_session.refresh(g)
        assert g2.position == 0
        assert g0.position == 1
        assert g1.position == 2

    async def test_reorder_groups_ignores_unknown_ids(self, db_session, test_event, test_user, mock_request):
        g0 = await _make_group(db_session, test_event, test_user, mock_request, name="A")
        g1 = await _make_group(db_session, test_event, test_user, mock_request, name="B")
        stale = uuid4()

        count = await groups_crud.reorder_groups(db_session, test_event.id, [stale, g1.id, g0.id])
        # Only the two real groups are repositioned; the stale id is skipped.
        assert count == 2
        for g in (g0, g1):
            await db_session.refresh(g)
        # stale occupies index 0 but is ignored; g1 gets index 1, g0 index 2.
        assert g1.position == 1
        assert g0.position == 2

    async def test_reorder_groups_ignores_cross_event(
        self, db_session, test_event, second_event, test_user, mock_request
    ):
        mine = await _make_group(db_session, test_event, test_user, mock_request, name="Mine")
        other = await _make_group(db_session, second_event, test_user, mock_request, name="Other")

        count = await groups_crud.reorder_groups(db_session, test_event.id, [other.id, mine.id])
        # The cross-event group is filtered out (not in test_event); only `mine` moves.
        assert count == 1
        await db_session.refresh(other)
        assert other.position == 0  # untouched

    async def test_reorder_group_stops_persists(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A")
        i2 = await _make_incident(db_session, test_event, test_user, title="B")
        i3 = await _make_incident(db_session, test_event, test_user, title="C")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id, i2.id, i3.id], test_user, mock_request)

        stale = uuid4()
        count = await groups_crud.reorder_group_stops(db_session, group.id, [i3.id, stale, i1.id, i2.id])
        # stale ignored; the three real stops re-index 0,2,3 by enumerate position.
        assert count == 3
        for inc in (i1, i2, i3):
            await db_session.refresh(inc)
        assert i3.group_position == 0
        assert i1.group_position == 2
        assert i2.group_position == 3


# ============================================
# Add / remove stops
# ============================================


class TestAddRemoveStops:
    async def test_add_stops_appends_at_end(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A")
        i2 = await _make_incident(db_session, test_event, test_user, title="B")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id, i2.id], test_user, mock_request)

        i3 = await _make_incident(db_session, test_event, test_user, title="C")
        attached = await groups_crud.add_stops_to_group(db_session, group.id, [i3.id], test_user, mock_request)
        assert attached == [i3.id]
        await db_session.refresh(i3)
        assert i3.group_id == group.id
        assert i3.group_position == 2  # appended after the two existing stops

    async def test_add_stops_skips_already_member(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id], test_user, mock_request)
        # Re-adding an existing member is a no-op.
        attached = await groups_crud.add_stops_to_group(db_session, group.id, [i1.id], test_user, mock_request)
        assert attached == []

    async def test_add_stops_cross_event_rejected(self, db_session, test_event, second_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        foreign = await _make_incident(db_session, second_event, test_user, title="Foreign")

        with pytest.raises(ValueError, match="different event"):
            await groups_crud.add_stops_to_group(db_session, group.id, [foreign.id], test_user, mock_request)

    async def test_add_stops_unknown_group_returns_none(self, db_session, test_event, test_user, mock_request):
        i1 = await _make_incident(db_session, test_event, test_user, title="A")
        result = await groups_crud.add_stops_to_group(db_session, uuid4(), [i1.id], test_user, mock_request)
        assert result is None

    async def test_remove_stop_nulls_group_without_status_change(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A", status="einsatz")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id], test_user, mock_request)

        ok = await groups_crud.remove_stop_from_group(db_session, group.id, i1.id, test_user, mock_request)
        assert ok is True
        await db_session.refresh(i1)
        assert i1.group_id is None
        assert i1.status == "einsatz"  # status untouched

    async def test_remove_stop_not_member_returns_false(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="A")  # not attached
        ok = await groups_crud.remove_stop_from_group(db_session, group.id, i1.id, test_user, mock_request)
        assert ok is False


# ============================================
# Group-level (Auftrag) assignments
# ============================================


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available")
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def person_a(db_session: AsyncSession) -> Personnel:
    p = Personnel(id=uuid4(), name="Anna", role="Truppmann", status="available")
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


@pytest_asyncio.fixture
async def person_b(db_session: AsyncSession) -> Personnel:
    p = Personnel(id=uuid4(), name="Bruno", role="Truppmann", status="available")
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    m = Material(id=uuid4(), name="Stromerzeuger", type="Stromerzeuger", status="available", location="Lager")
    db_session.add(m)
    await db_session.commit()
    await db_session.refresh(m)
    return m


async def _group_active_types(db, group_id):
    """Return the set of (resource_type, resource_id) actively assigned to an Auftrag."""
    assigns = await group_assignments_crud.get_group_assignments(db, group_id)
    return {(a.resource_type, a.resource_id) for a in assigns}


class TestGroupAssignments:
    async def test_assign_list_unassign(self, db_session, test_event, test_user, mock_request, test_vehicle, person_a):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        veh = await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "personnel", person_a.id, test_user, mock_request
        )

        assert await _group_active_types(db_session, group.id) == {
            ("vehicle", test_vehicle.id),
            ("personnel", person_a.id),
        }

        # Soft-release the vehicle; only the person remains active.
        ok = await group_assignments_crud.unassign_group_resource(db_session, group.id, veh.id, test_user, mock_request)
        assert ok is True
        assert await _group_active_types(db_session, group.id) == {("personnel", person_a.id)}

    async def test_assign_works_with_zero_stops(self, db_session, test_event, test_user, mock_request, test_vehicle):
        # An Auftrag with NO stops can still carry resources.
        group = await _make_group(db_session, test_event, test_user, mock_request)
        assert (await groups_crud.build_group_response(db_session, group)).stop_ids == []

        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )

        response = await groups_crud.build_group_response(db_session, group)
        assert response.progress.total == 0
        assert [(a.resource_type, a.resource_id) for a in response.assignments] == [("vehicle", test_vehicle.id)]

    async def test_duplicate_active_row_rejected(self, db_session, test_event, test_user, mock_request, test_vehicle):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        with pytest.raises(ValueError, match="already assigned"):
            await group_assignments_crud.assign_group_resource(
                db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
            )

    async def test_cross_incident_conflict_allowed(self, db_session, test_event, test_user, mock_request, test_vehicle):
        # The vehicle is already committed to an unrelated incident. Assigning it to
        # an Auftrag must still succeed (cross-incident conflict is warned, not blocked).
        unrelated = await _make_incident(db_session, test_event, test_user, title="Unrelated")
        await assignment_crud.assign_resource(
            db_session, unrelated.id, "vehicle", test_vehicle.id, test_user, mock_request
        )

        group = await _make_group(db_session, test_event, test_user, mock_request)
        result = await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        assert result.id is not None
        assert ("vehicle", test_vehicle.id) in await _group_active_types(db_session, group.id)

    async def test_reassign_after_release(self, db_session, test_event, test_user, mock_request, test_vehicle):
        # Releasing then re-assigning the same resource is allowed (unassigned_at
        # scopes the active-row uniqueness).
        group = await _make_group(db_session, test_event, test_user, mock_request)
        first = await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        await group_assignments_crud.unassign_group_resource(db_session, group.id, first.id, test_user, mock_request)
        again = await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        assert again.id != first.id
        assert await _group_active_types(db_session, group.id) == {("vehicle", test_vehicle.id)}

    async def test_unassign_unknown_returns_false(self, db_session, test_event, test_user, mock_request):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        ok = await group_assignments_crud.unassign_group_resource(
            db_session, group.id, uuid4(), test_user, mock_request
        )
        assert ok is False

    async def test_assignment_print_includes_route_resources_with_incident_precedence(
        self, db_session, test_event, test_user, mock_request, test_vehicle, person_a, test_material
    ):
        group = await _make_group(db_session, test_event, test_user, mock_request)
        incident = await _make_incident(db_session, test_event, test_user)
        await groups_crud.add_stops_to_group(db_session, group.id, [incident.id], test_user, mock_request)
        for resource_type, resource_id in (
            ("vehicle", test_vehicle.id),
            ("personnel", person_a.id),
            ("material", test_material.id),
        ):
            await group_assignments_crud.assign_group_resource(
                db_session, group.id, resource_type, resource_id, test_user, mock_request
            )
        direct = IncidentAssignment(
            incident_id=incident.id,
            resource_type="vehicle",
            resource_id=test_vehicle.id,
            assigned_by=test_user.id,
            driver_stay=True,
        )
        db_session.add(direct)
        await db_session.commit()

        job = await print_jobs_crud.queue_assignment_print(db_session, incident.id)

        assert job is not None
        assert [person["name"] for person in job.payload["crew"]] == [person_a.name]
        assert [material["name"] for material in job.payload["materials"]] == [test_material.name]
        assert len(job.payload["vehicles"]) == 1
        assert job.payload["vehicles"][0]["driver_stay"] is True


# ============================================
# Release route resources only on the LAST stop
# ============================================


class TestReleaseOnLastStop:
    async def test_group_resources_released_only_on_last_stop(self, db_session, test_event, test_user, mock_request):
        from app.crud import incidents as incidents_crud

        group = await _make_group(db_session, test_event, test_user, mock_request)
        i1 = await _make_incident(db_session, test_event, test_user, title="Stop1", status="einsatz")
        i2 = await _make_incident(db_session, test_event, test_user, title="Stop2", status="einsatz")
        await groups_crud.add_stops_to_group(db_session, group.id, [i1.id, i2.id], test_user, mock_request)
        vehicle = Vehicle(id=uuid4(), name="Route Vehicle", type="TLF", status="available")
        db_session.add(vehicle)
        await db_session.commit()
        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", vehicle.id, test_user, mock_request
        )
        assert len(await group_assignments_crud.get_group_assignments(db_session, group.id)) == 1

        # First stop completed → not the last, route keeps its resources.
        await incidents_crud.update_incident_status(db_session, i1.id, "abschluss", test_user, mock_request)
        assert len(await group_assignments_crud.get_group_assignments(db_session, group.id)) == 1

        # Last stop completed → route vehicle released.
        await incidents_crud.update_incident_status(db_session, i2.id, "abschluss", test_user, mock_request)
        assert len(await group_assignments_crud.get_group_assignments(db_session, group.id)) == 0

    async def test_material_kept_when_route_finishes(
        self, db_session, test_event, test_user, mock_request, test_material, test_vehicle
    ):
        from app.crud import incidents as incidents_crud

        group = await _make_group(db_session, test_event, test_user, mock_request)
        only = await _make_incident(db_session, test_event, test_user, title="Only", status="einsatz")
        await groups_crud.add_stops_to_group(db_session, group.id, [only.id], test_user, mock_request)
        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "material", test_material.id, test_user, mock_request
        )
        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        await incidents_crud.update_incident_status(db_session, only.id, "abschluss", test_user, mock_request)
        remaining = await group_assignments_crud.get_group_assignments(db_session, group.id)
        # Vehicle auto-released; material stays on site for manual return.
        assert [a.resource_type for a in remaining] == ["material"]

    async def test_reopen_then_reclose_runs_final_release_again(
        self, db_session, test_event, test_user, mock_request, test_vehicle
    ):
        from app.crud import incidents as incidents_crud

        group = await _make_group(db_session, test_event, test_user, mock_request)
        incident = await _make_incident(db_session, test_event, test_user, status="einsatz")
        await groups_crud.add_stops_to_group(db_session, group.id, [incident.id], test_user, mock_request)
        await incidents_crud.update_incident_status(db_session, incident.id, "abschluss", test_user, mock_request)
        await incidents_crud.update_incident_status(db_session, incident.id, "einsatz", test_user, mock_request)
        await db_session.refresh(incident)
        assert incident.completed_at is None

        await group_assignments_crud.assign_group_resource(
            db_session, group.id, "vehicle", test_vehicle.id, test_user, mock_request
        )
        await incidents_crud.update_incident_status(db_session, incident.id, "abschluss", test_user, mock_request)
        assert await group_assignments_crud.get_group_assignments(db_session, group.id) == []


# ============================================
# Restore a deleted stop without colliding on the
# partial unique index uq_incidents_group_position_active
# ============================================


class TestRestoreStopPosition:
    async def test_restore_deleted_stop_appends_and_avoids_position_collision(
        self, db_session, test_event, test_user, mock_request
    ):
        """Deleting the only stop, adding a replacement (which reuses slot 0),
        then restoring the deleted stop must not violate the active-position
        unique index. The restored stop is appended at the end instead."""
        group = await _make_group(db_session, test_event, test_user, mock_request)
        a = await _make_incident(db_session, test_event, test_user, title="A")
        await groups_crud.add_stops_to_group(db_session, group.id, [a.id], test_user, mock_request)
        assert a.group_position == 0

        # Soft-delete A. It keeps group_id + group_position=0 but drops out of
        # the partial index (deleted_at IS NOT NULL).
        await incidents_crud.delete_incident(db_session, a.id, test_user, mock_request)

        # Replacement C is appended over *active* stops only -> reuses slot 0.
        c = await _make_incident(db_session, test_event, test_user, title="C")
        await groups_crud.add_stops_to_group(db_session, group.id, [c.id], test_user, mock_request)
        assert c.group_position == 0

        # Restoring A must succeed (no IntegrityError) and append past C.
        restored = await incidents_crud.restore_incident(db_session, a.id, test_user, mock_request)
        assert restored is not None
        assert restored.deleted_at is None
        assert restored.group_id == group.id
        assert restored.group_position == 1  # appended after C(0)

        # Both stops are now active with distinct positions.
        response = await groups_crud.build_group_response(db_session, group)
        assert set(response.stop_ids) == {a.id, c.id}
        assert response.progress.total == 2
