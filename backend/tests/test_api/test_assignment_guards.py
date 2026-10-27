"""Who may be assigned where, and what an assignment protects (audit 2026-10, F02/F03/F13).

* A release names its incident in the path; an assignment id of another card is a 404.
* An Auftrag's assignment protects a resource from archive and purge like an Einsatz's.
* ``ensure_assignable`` refuses archived or out-of-service inventory, an archived
  Ereignis, and personnel/vehicles onto a closed Einsatz (material may still go there).
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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

    async def test_completed_incident_refuses_personnel(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_personnel: Personnel,
    ):
        closed = await _incident(db_session, test_event, test_editor, status="complete")

        response = await editor_client.post(
            f"/api/incidents/{closed.id}/assign",
            json={"resource_type": "personnel", "resource_id": str(test_personnel.id)},
        )

        assert response.status_code == 409
        assert "abgeschlossen" in response.json()["detail"]

    async def test_completed_incident_still_takes_material(
        self,
        editor_client: AsyncClient,
        db_session: AsyncSession,
        test_event: Event,
        test_editor: User,
        test_material: Material,
    ):
        closed = await _incident(db_session, test_event, test_editor, status="complete")

        response = await editor_client.post(
            f"/api/incidents/{closed.id}/assign",
            json={"resource_type": "material", "resource_id": str(test_material.id)},
        )

        assert response.status_code == 200


async def test_transfer_onto_a_closed_einsatz_is_409(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_event: Event,
    test_editor: User,
    test_personnel: Personnel,
):
    source = await _incident(db_session, test_event, test_editor)
    target = await _incident(db_session, test_event, test_editor, status="complete")
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
