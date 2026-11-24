"""Who may be assigned where, and what an assignment protects (audit 2026-10, F02/F03/F13).

* A release names its incident in the path; an assignment id of another card is a 404.
* An Auftrag's assignment protects a resource from archive and purge like an Einsatz's.
* ``ensure_assignable`` refuses archived or out-of-service inventory, an archived
  Ereignis, anything onto a closed Einsatz, and anything onto an Auftrag whose stops are all
  closed (owner feedback 23.11.2026 #7).
* «Übertragen» onto an Auftrag makes the Einsatz a stop and moves its resources up (#9).
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
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


@pytest_asyncio.fixture
async def auftrag(db_session: AsyncSession, test_event: Event) -> IncidentGroup:
    """A live Auftrag with no stops on the fixture's (non-training) Ereignis."""
    group = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Route Nord")
    db_session.add(group)
    await db_session.commit()
    return group


async def _incident(db: AsyncSession, event: Event, user: User, *, status: str = "incoming") -> Incident:
    incident = Incident(
        id=uuid4(),
        title="Keller",
        type="elementarereignis",
        priority="medium",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    return incident


class TestReleaseIsScopedToItsIncident:
    async def test_assignment_of_another_incident_is_404_and_stays_assigned(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_personnel: Personnel,
    ):
        a = await _incident(db_session, test_event, test_editor)
        b = await _incident(db_session, test_event, test_editor)
        on_b = IncidentAssignment(
            incident_id=b.id, resource_type="personnel", resource_id=test_personnel.id, assigned_by=test_editor.id
        )
        db_session.add(on_b)
        await db_session.commit()

        response = await editor_client.post(f"/api/incidents/{a.id}/unassign/{on_b.id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Zuweisung nicht gefunden"
        await db_session.refresh(on_b)
        assert on_b.unassigned_at is None


class TestAuftragAssignmentsProtectResources:
    @pytest.mark.parametrize("kind", ["material", "vehicle"])
    async def test_archive_refused_while_only_an_auftrag_holds_it(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        auftrag: IncidentGroup,
        test_editor: User,
        test_material: Material,
        test_vehicle: Vehicle,
        kind: str,
    ):
        resource = test_material if kind == "material" else test_vehicle
        db_session.add(
            IncidentGroupAssignment(
                incident_group_id=auftrag.id, resource_type=kind, resource_id=resource.id, assigned_by=test_editor.id
            )
        )
        await db_session.commit()

        response = await editor_client.post(f"/api/{kind}s/{resource.id}/archive")

        assert response.status_code == 409
        await db_session.refresh(resource)
        assert resource.archived_at is None

    async def test_purge_refused_with_auftrag_history(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        auftrag: IncidentGroup,
        test_editor: User,
        test_material: Material,
    ):
        db_session.add(
            IncidentGroupAssignment(
                incident_group_id=auftrag.id,
                resource_type="material",
                resource_id=test_material.id,
                assigned_by=test_editor.id,
                unassigned_at=datetime.now(UTC),
            )
        )
        test_material.archived_at = datetime.now(UTC)
        await db_session.commit()

        response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")

        assert response.status_code == 409
        assert await db_session.get(Material, test_material.id) is not None

    async def test_purge_takes_training_auftrag_rows_with_it(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_editor: User,
        test_material: Material,
    ):
        training = Event(id=uuid4(), name="Übung", training_flag=True)
        db_session.add(training)
        await db_session.flush()
        group = IncidentGroup(id=uuid4(), event_id=training.id, name="Übungsroute")
        db_session.add(group)
        await db_session.flush()
        db_session.add(
            IncidentGroupAssignment(
                incident_group_id=group.id,
                resource_type="material",
                resource_id=test_material.id,
                assigned_by=test_editor.id,
                unassigned_at=datetime.now(UTC),
            )
        )
        test_material.archived_at = datetime.now(UTC)
        await db_session.commit()

        response = await editor_client.delete(f"/api/materials/{test_material.id}?permanent=true")

        assert response.status_code == 204
        dangling = await db_session.scalar(
            select(IncidentGroupAssignment.id).where(IncidentGroupAssignment.resource_id == test_material.id)
        )
        assert dangling is None

    async def test_personnel_delete_refused_while_assigned(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        auftrag: IncidentGroup,
        test_editor: User,
        test_personnel: Personnel,
    ):
        db_session.add(
            IncidentGroupAssignment(
                incident_group_id=auftrag.id,
                resource_type="personnel",
                resource_id=test_personnel.id,
                assigned_by=test_editor.id,
            )
        )
        await db_session.commit()

        response = await editor_client.delete(f"/api/personnel/{test_personnel.id}")

        assert response.status_code == 409
        assert await db_session.get(Personnel, test_personnel.id) is not None


class TestEnsureAssignable:
    async def test_archived_vehicle_refused_on_an_incident(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident, test_vehicle: Vehicle
    ):
        test_vehicle.archived_at = datetime.now(UTC)
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/assign",
            json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
        )

        assert response.status_code == 409
        assert "archiviert" in response.json()["detail"]

    async def test_archived_material_refused_on_an_auftrag(
        self, editor_client: AsyncClient, db_session: AsyncSession, auftrag: IncidentGroup, test_material: Material
    ):
        test_material.archived_at = datetime.now(UTC)
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/assign",
            json={"resource_type": "material", "resource_id": str(test_material.id)},
        )

        assert response.status_code == 409
        assert "archiviert" in response.json()["detail"]

    async def test_out_of_service_vehicle_refused(
        self, editor_client: AsyncClient, db_session: AsyncSession, test_incident: Incident, test_vehicle: Vehicle
    ):
        test_vehicle.out_of_service_since = datetime.now(UTC)
        test_vehicle.status = "unavailable"
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/assign",
            json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
        )

        assert response.status_code == 409
        assert "nicht einsatzbereit" in response.json()["detail"]

    async def test_archived_event_refused(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        auftrag: IncidentGroup,
        test_personnel: Personnel,
    ):
        test_event.archived_at = datetime.now(UTC)
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/assign",
            json={"resource_type": "personnel", "resource_id": str(test_personnel.id)},
        )

        assert response.status_code == 409
        assert "Ereignis ist archiviert" in response.json()["detail"]

    @pytest.mark.parametrize("kind", ["personnel", "material"])
    async def test_completed_incident_refuses_everything(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_personnel: Personnel,
        test_material: Material,
        kind: str,
    ):
        closed = await _incident(db_session, test_event, test_editor, status="complete")
        resource = test_personnel if kind == "personnel" else test_material

        response = await editor_client.post(
            f"/api/incidents/{closed.id}/assign",
            json={"resource_type": kind, "resource_id": str(resource.id)},
        )

        assert response.status_code == 409
        assert "abgeschlossen" in response.json()["detail"]

    @pytest.mark.parametrize(
        ("statuses", "refused"), [(["complete", "complete"], True), (["complete", "active"], False)]
    )
    async def test_auftrag_with_every_stop_closed_refuses(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
        test_material: Material,
        statuses: list[str],
        refused: bool,
    ):
        for position, status in enumerate(statuses):
            stop = await _incident(db_session, test_event, test_editor, status=status)
            stop.group_id, stop.group_position = auftrag.id, position
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/assign",
            json={"resource_type": "material", "resource_id": str(test_material.id)},
        )

        assert response.status_code == (409 if refused else 200)


@pytest.mark.parametrize("closed", ["source", "target"])
async def test_transfer_from_or_onto_a_closed_einsatz_is_409(
    closed: str,
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_editor: User,
    test_personnel: Personnel,
):
    source = await _incident(
        db_session, test_event, test_editor, status="complete" if closed == "source" else "incoming"
    )
    target = await _incident(
        db_session, test_event, test_editor, status="complete" if closed == "target" else "incoming"
    )
    db_session.add(
        IncidentAssignment(
            incident_id=source.id, resource_type="personnel", resource_id=test_personnel.id, assigned_by=test_editor.id
        )
    )
    await db_session.commit()
    source_id, target_id = source.id, target.id

    response = await editor_client.post(
        f"/api/incidents/{source_id}/transfer", json={"target_incident_id": str(target_id)}
    )

    assert response.status_code == 409


class TestTransferUndo:
    """«Rückgängig» of a transfer moves back exactly what the transfer moved (sweep 11.2026, UX-10)."""

    async def _transferred(
        self,
        editor_client: AsyncClient,
        db: AsyncSession,
        event: Event,
        user: User,
        person: Personnel,
        vehicle: Vehicle,
    ):
        """`person` moved from source to target; `vehicle` was on the target before."""
        source = await _incident(db, event, user)
        target = await _incident(db, event, user)
        db.add_all(
            [
                IncidentAssignment(
                    incident_id=source.id, resource_type="personnel", resource_id=person.id, assigned_by=user.id
                ),
                IncidentAssignment(
                    incident_id=target.id, resource_type="vehicle", resource_id=vehicle.id, assigned_by=user.id
                ),
            ]
        )
        await db.commit()
        source_id, target_id = source.id, target.id
        moved = await editor_client.post(
            f"/api/incidents/{source_id}/transfer", json={"target_incident_id": str(target_id)}
        )
        assert moved.status_code == 200
        return source_id, target_id, moved.json()["assignment_ids"]

    async def _active(self, db: AsyncSession, incident_id) -> set[str]:
        rows = await db.execute(
            select(IncidentAssignment.resource_type).where(
                IncidentAssignment.incident_id == incident_id, IncidentAssignment.unassigned_at.is_(None)
            )
        )
        return set(rows.scalars().all())

    async def test_moves_back_only_what_the_transfer_moved(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        source_id, target_id, moved_ids = await self._transferred(
            editor_client, db_session, test_event, test_editor, test_personnel, test_vehicle
        )

        undo = await editor_client.post(
            f"/api/incidents/{target_id}/transfer",
            json={"target_incident_id": str(source_id), "assignment_ids": moved_ids},
        )

        assert undo.status_code == 200
        assert undo.json()["transferred_count"] == 1
        # The vehicle the target held before the transfer stays where it was.
        assert await self._active(db_session, source_id) == {"personnel"}
        assert await self._active(db_session, target_id) == {"vehicle"}

    async def test_is_refused_once_a_moved_resource_was_released(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        source_id, target_id, moved_ids = await self._transferred(
            editor_client, db_session, test_event, test_editor, test_personnel, test_vehicle
        )
        released = await editor_client.post(f"/api/incidents/{target_id}/unassign/{moved_ids[0]}")
        assert released.status_code in (200, 204)

        undo = await editor_client.post(
            f"/api/incidents/{target_id}/transfer",
            json={"target_incident_id": str(source_id), "assignment_ids": moved_ids},
        )

        assert undo.status_code == 409
        assert await self._active(db_session, source_id) == set()


async def test_release_retry_and_stale_promotion_preserve_active_leader(
    editor_client, db_session, test_incident, test_personnel, test_editor
):
    current = Personnel(id=uuid4(), name="Walter", role="Wachtmeister", status="available")
    db_session.add(current)
    await db_session.commit()
    path = f"/api/incidents/{test_incident.id}"
    ids = []
    for person in (test_personnel, current):
        reply = await editor_client.post(
            f"{path}/assign", json={"resource_type": "personnel", "resource_id": str(person.id)}
        )
        assert reply.status_code == 200
        ids.append(reply.json()["id"])
    released_id, leader_id = ids
    assert (await editor_client.post(f"{path}/unassign/{released_id}")).status_code == 204
    released = await db_session.get(IncidentAssignment, released_id)
    first = released.unassigned_at
    assert (await editor_client.post(f"{path}/unassign/{released_id}")).status_code == 204
    await db_session.refresh(released)
    assert released.unassigned_at == first
    logs = (
        await db_session.scalars(
            select(AuditLog).where(AuditLog.resource_id == released.id, AuditLog.action_type == "unassign")
        )
    ).all()
    assert len(logs) == 1
    assert (await editor_client.patch(f"{path}/assignments/{released_id}", json={"is_leader": True})).status_code == 409
    assert (await db_session.get(IncidentAssignment, leader_id)).is_leader
    await db_session.refresh(test_incident)
    assert test_incident.leader_personnel_id == current.id
    assert not test_incident.leader_manual


async def test_released_route_member_cannot_be_promoted(editor_client, db_session, auftrag, test_personnel):
    row = IncidentGroupAssignment(
        incident_group_id=auftrag.id,
        resource_id=test_personnel.id,
        resource_type="personnel",
        unassigned_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.commit()
    response = await editor_client.patch(
        f"/api/incident-groups/{auftrag.id}/assignments/{row.id}", json={"is_leader": True}
    )
    assert response.status_code == 409
    await db_session.refresh(auftrag)
    assert not auftrag.leader_manual


async def test_deleted_crew_can_check_out_and_restore_respects_their_departure(
    editor_client, db_session, test_incident, test_personnel, test_event
):
    from app.crud import personnel_checkin
    from app.services.journal import journal_rows

    path = f"/api/incidents/{test_incident.id}"
    await personnel_checkin.check_in_personnel(db_session, test_event.id, test_personnel.id)
    await db_session.commit()
    assert (
        await editor_client.post(
            f"{path}/assign", json={"resource_type": "personnel", "resource_id": str(test_personnel.id)}
        )
    ).status_code == 200
    assert (await editor_client.delete(path)).status_code == 204
    rows = await journal_rows(db_session, test_event.id)
    assert any(row.data and row.data.get("action") == "deleted" for row in rows)
    assert not next(
        person.is_assigned
        for person in await personnel_checkin.get_available_personnel(db_session, test_event.id)
        if person.id == test_personnel.id
    )
    assert not (await personnel_checkin.check_out_personnel(db_session, test_event.id, test_personnel.id)).checked_in
    await db_session.commit()
    response = await editor_client.post(f"{path}/restore")
    assert response.status_code == 409
    assert response.json()["code"] == "incident_restore_resource_conflict"
    assert response.json()["params"]["name"] == test_personnel.name
    await personnel_checkin.check_in_personnel(db_session, test_event.id, test_personnel.id)
    await db_session.commit()
    assert (await editor_client.post(f"{path}/restore")).status_code == 200
    assert (await editor_client.post(f"{path}/restore")).json()["code"] == "incident_already_restored"


@pytest.mark.parametrize("preexisting,consumable", [(False, False), (True, False), (False, True)])
async def test_restore_preserves_deployment_choices(
    editor_client, db_session, test_incident, test_material, auftrag, preexisting, consumable
):
    path = f"/api/incidents/{test_incident.id}"
    test_material.consumable = consumable
    await db_session.commit()
    payload = {"resource_type": "material", "resource_id": str(test_material.id)}
    assert (await editor_client.post(f"{path}/assign", json=payload)).status_code == 200
    assignment = IncidentGroupAssignment(
        incident_group_id=auftrag.id, resource_type="material", resource_id=test_material.id
    )
    if preexisting:
        db_session.add(assignment)
        await db_session.commit()
    assert (await editor_client.delete(path)).status_code == 204
    if not preexisting:
        db_session.add(assignment)
        await db_session.commit()
    response = await editor_client.post(f"{path}/restore")
    if preexisting or consumable:
        assert response.status_code == 200
    else:
        assert response.status_code == 409
        assert response.json()["code"] == "incident_restore_resource_conflict"
    await db_session.refresh(assignment)
    assert assignment.unassigned_at is None


async def test_missing_attendance_is_not_a_checkout(editor_client, test_incident, test_personnel):
    path = f"/api/incidents/{test_incident.id}"
    assert (
        await editor_client.post(
            f"{path}/assign", json={"resource_type": "personnel", "resource_id": str(test_personnel.id)}
        )
    ).status_code == 200
    assert (await editor_client.delete(path)).status_code == 204
    assert (await editor_client.post(f"{path}/restore")).status_code == 200


async def _use_previous_snapshot_format(db_session):
    """Previous builds recorded the other assignment IDs only."""
    for audit in await db_session.scalars(select(AuditLog).where(AuditLog.action_type == "archive")):
        audit.changes_json = {"shared_assignments": audit.changes_json["shared_assignments"]}
    await db_session.commit()


@pytest.mark.parametrize("legacy_snapshot", [False, True])
@pytest.mark.parametrize("delete_order", [(0, 1), (1, 0)])
@pytest.mark.parametrize("restore_order", [(0, 1), (1, 0)])
async def test_two_shared_incidents_can_be_restored_in_either_order(
    editor_client, db_session, test_event, test_editor, test_vehicle, delete_order, restore_order, legacy_snapshot
):
    paths = [f"/api/incidents/{(await _incident(db_session, test_event, test_editor)).id}" for _ in range(2)]
    payload = {"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}
    for path in paths:
        assert (await editor_client.post(f"{path}/assign", json=payload)).status_code == 200
    for index in delete_order:
        assert (await editor_client.delete(paths[index])).status_code == 204
    if legacy_snapshot:
        await _use_previous_snapshot_format(db_session)
    for index in restore_order:
        response = await editor_client.post(f"{paths[index]}/restore")
        assert response.status_code == 200, response.text


@pytest.mark.parametrize("legacy_snapshot", [False, True])
async def test_a_new_assignment_of_the_same_vehicle_is_not_the_old_share(
    editor_client, db_session, test_event, test_editor, test_vehicle, legacy_snapshot
):
    a = await _incident(db_session, test_event, test_editor)
    b = await _incident(db_session, test_event, test_editor)
    paths = [f"/api/incidents/{card.id}" for card in (a, b)]
    payload = {"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}
    original = (await editor_client.post(f"{paths[0]}/assign", json=payload)).json()["id"]
    assert (await editor_client.post(f"{paths[1]}/assign", json=payload)).status_code == 200
    for path in paths:
        assert (await editor_client.delete(path)).status_code == 204
    if legacy_snapshot:
        await _use_previous_snapshot_format(db_session)
    assert (await editor_client.post(f"{paths[0]}/restore")).status_code == 200
    assert (await editor_client.post(f"{paths[0]}/unassign/{original}")).status_code == 204
    replacement = await editor_client.post(f"{paths[0]}/assign", json=payload)
    assert replacement.status_code == 200 and replacement.json()["id"] != original
    refused = await editor_client.post(f"{paths[1]}/restore")
    assert refused.status_code == 409
    assert refused.json()["code"] == "incident_restore_resource_conflict"


@pytest.mark.parametrize("assigned_after", [False, True])
async def test_delete_without_inventory_snapshot_uses_assignment_time(
    editor_client, db_session, test_event, test_editor, test_material, assigned_after
):
    a = await _incident(db_session, test_event, test_editor)
    b = await _incident(db_session, test_event, test_editor)
    payload = {"resource_type": "material", "resource_id": str(test_material.id)}
    assert (await editor_client.post(f"/api/incidents/{a.id}/assign", json=payload)).status_code == 200
    assert (await editor_client.delete(f"/api/incidents/{a.id}")).status_code == 204
    await db_session.refresh(a)
    audit = await db_session.scalar(
        select(AuditLog).where(AuditLog.resource_id == a.id, AuditLog.action_type == "archive")
    )
    audit.changes_json = None
    assignment_time = a.deleted_at + timedelta(minutes=1 if assigned_after else -1)
    db_session.add(
        IncidentAssignment(
            incident_id=b.id, resource_id=test_material.id, resource_type="material", assigned_at=assignment_time
        )
    )
    await db_session.commit()
    response = await editor_client.post(f"/api/incidents/{a.id}/restore")
    assert response.status_code == (409 if assigned_after else 200)


@pytest.mark.parametrize("restore_order", [(0, 1), (1, 0)])
async def test_deleted_incidents_that_never_shared_cannot_acquire_each_others_vehicle(
    editor_client, db_session, test_event, test_editor, test_vehicle, restore_order
):
    paths = [f"/api/incidents/{(await _incident(db_session, test_event, test_editor)).id}" for _ in range(2)]
    payload = {"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}
    # The first card has *already disappeared* before the second picks up the vehicle.
    for path in paths:
        assert (await editor_client.post(f"{path}/assign", json=payload)).status_code == 200
        assert (await editor_client.delete(path)).status_code == 204
    first, second = restore_order
    assert (await editor_client.post(f"{paths[first]}/restore")).status_code == 200
    refused = await editor_client.post(f"{paths[second]}/restore")
    assert refused.status_code == 409
    assert refused.json()["code"] == "incident_restore_resource_conflict"


class TestTransferToAuftrag:
    """«Übertragen» onto an Auftrag: the Einsatz becomes a stop, its resources move up (#9)."""

    async def _setup(self, db: AsyncSession, event: Event, user: User, auftrag: IncidentGroup, person, vehicle):
        """An Einsatz with `person` and `vehicle`; the Auftrag holds `vehicle` already and has one stop."""
        first = await _incident(db, event, user, status="active")
        first.group_id, first.group_position = auftrag.id, 0
        source = await _incident(db, event, user)
        db.add_all(
            [
                IncidentAssignment(incident_id=source.id, resource_type="personnel", resource_id=person.id),
                IncidentAssignment(incident_id=source.id, resource_type="vehicle", resource_id=vehicle.id),
                IncidentGroupAssignment(incident_group_id=auftrag.id, resource_type="vehicle", resource_id=vehicle.id),
            ]
        )
        await db.commit()
        return source.id

    async def _on_auftrag(self, db: AsyncSession, group_id) -> list[str]:
        rows = await db.scalars(
            select(IncidentGroupAssignment.resource_type).where(
                IncidentGroupAssignment.incident_group_id == group_id, IncidentGroupAssignment.unassigned_at.is_(None)
            )
        )
        return sorted(rows.all())

    async def _on_incident(self, db: AsyncSession, incident_id) -> list[str]:
        rows = await db.scalars(
            select(IncidentAssignment.resource_type).where(
                IncidentAssignment.incident_id == incident_id, IncidentAssignment.unassigned_at.is_(None)
            )
        )
        return sorted(rows.all())

    async def test_becomes_the_last_stop_and_moves_its_resources_up(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        source_id = await self._setup(db_session, test_event, test_editor, auftrag, test_personnel, test_vehicle)

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer", json={"incident_id": str(source_id)}
        )

        assert response.status_code == 200
        body = response.json()
        # The vehicle was on the Auftrag already: no second row, only the person is new.
        assert len(body["group_assignment_ids"]) == 1
        assert len(body["released_assignment_ids"]) == 2
        source = await db_session.get(Incident, source_id)
        await db_session.refresh(source)
        assert (source.group_id, source.group_position) == (auftrag.id, 1)
        assert await self._on_auftrag(db_session, auftrag.id) == ["personnel", "vehicle"]
        assert await self._on_incident(db_session, source_id) == []

        undo = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer/undo", json={"incident_id": str(source_id)} | body
        )

        assert undo.status_code == 204
        await db_session.refresh(source)
        assert source.group_id is None
        assert await self._on_auftrag(db_session, auftrag.id) == ["vehicle"]
        assert await self._on_incident(db_session, source_id) == ["personnel", "vehicle"]

    async def test_undo_is_refused_once_a_moved_resource_was_released(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        source_id = await self._setup(db_session, test_event, test_editor, auftrag, test_personnel, test_vehicle)
        body = (
            await editor_client.post(
                f"/api/incident-groups/{auftrag.id}/transfer", json={"incident_id": str(source_id)}
            )
        ).json()
        released = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/unassign/{body['group_assignment_ids'][0]}"
        )
        assert released.status_code == 204

        undo = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer/undo", json={"incident_id": str(source_id)} | body
        )

        assert undo.status_code == 409
        assert (await db_session.get(Incident, source_id)).group_id == auftrag.id

    async def test_a_stop_cannot_be_transferred(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
    ):
        other = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Route Süd")
        stop = await _incident(db_session, test_event, test_editor)
        db_session.add(other)
        await db_session.flush()
        stop.group_id, stop.group_position = other.id, 0
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer", json={"incident_id": str(stop.id)}
        )

        assert response.status_code == 409
        assert (await db_session.get(Incident, stop.id)).group_id == other.id

    @pytest.mark.parametrize("closed", ["source", "auftrag"])
    async def test_refused_from_a_closed_einsatz_and_onto_an_all_closed_auftrag(
        self,
        closed: str,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        """Review B: a closed Einsatz moves nothing; an open one does not reopen a closed Auftrag."""
        source_id = await self._setup(db_session, test_event, test_editor, auftrag, test_personnel, test_vehicle)
        if closed == "source":
            (await db_session.get(Incident, source_id)).status = "complete"
        else:
            first = await db_session.scalar(select(Incident).where(Incident.group_id == auftrag.id))
            first.status = "complete"
        await db_session.commit()

        response = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer", json={"incident_id": str(source_id)}
        )

        assert response.status_code == 409
        source = await db_session.get(Incident, source_id)
        await db_session.refresh(source)
        assert source.group_id is None
        assert await self._on_incident(db_session, source_id) == ["personnel", "vehicle"]

    async def test_undo_brings_back_a_hand_picked_leader(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        auftrag: IncidentGroup,
        test_personnel: Personnel,
        test_vehicle: Vehicle,
    ):
        source_id = await self._setup(db_session, test_event, test_editor, auftrag, test_personnel, test_vehicle)
        source = await db_session.get(Incident, source_id)
        source.leader_manual, source.leader_personnel_id = True, test_personnel.id
        person_row = await db_session.scalar(
            select(IncidentAssignment).where(
                IncidentAssignment.incident_id == source_id, IncidentAssignment.resource_type == "personnel"
            )
        )
        person_row.is_leader = True
        await db_session.commit()
        body = (
            await editor_client.post(
                f"/api/incident-groups/{auftrag.id}/transfer", json={"incident_id": str(source_id)}
            )
        ).json()

        undo = await editor_client.post(
            f"/api/incident-groups/{auftrag.id}/transfer/undo", json={"incident_id": str(source_id)} | body
        )

        assert undo.status_code == 204
        leader = await db_session.scalar(
            select(IncidentAssignment.resource_id).where(
                IncidentAssignment.incident_id == source_id,
                IncidentAssignment.unassigned_at.is_(None),
                IncidentAssignment.is_leader.is_(True),
            )
        )
        assert leader == test_personnel.id
