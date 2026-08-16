"""Tests for Standard-Aufträge (Auftrag templates).

Covers:
- CRUD through the API, incl. the resource list being replaced rather than merged
- viewer may read, may not write
- creating an event materialises every ``auto_create`` template, in order, with
  its colour, notes and default equipment — and leaves the others alone
- a template's equipment is attached even when it is already committed
  elsewhere: the conflict is meant to be visible on the board
- an auto-created Auftrag that never got a stop stays out of the reports
"""

import uuid
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuftragTemplate,
    AuftragTemplateResource,
    Event,
    IncidentGroup,
    IncidentGroupAssignment,
    Material,
    User,
    Vehicle,
)
from app.services.audit_export_service import collect_event_report_data


@pytest_asyncio.fixture
async def storm_template(db_session: AsyncSession, test_vehicle: Vehicle, test_material: Material) -> AuftragTemplate:
    """«Sturmholz» — auto-created, one vehicle and one piece of equipment."""
    template = AuftragTemplate(
        id=uuid4(), name="Sturmholz", color="#10b981", notes="Fahrbahn freihalten", auto_create=True, position=0
    )
    template.resources = [
        AuftragTemplateResource(resource_type="vehicle", resource_id=test_vehicle.id, position=0),
        AuftragTemplateResource(resource_type="material", resource_id=test_material.id, position=1),
    ]
    db_session.add(template)
    await db_session.commit()
    return template


@pytest_asyncio.fixture
async def backup_template(db_session: AsyncSession) -> AuftragTemplate:
    """«TLF-Backup» — a Vorlage the station opens by hand, not automatically."""
    template = AuftragTemplate(id=uuid4(), name="TLF-Backup", color="#ef4444", auto_create=False, position=1)
    db_session.add(template)
    await db_session.commit()
    return template


# ============================================
# CRUD
# ============================================


@pytest.mark.asyncio
async def test_create_and_list(editor_client: AsyncClient, test_vehicle: Vehicle):
    response = await editor_client.post(
        "/api/auftrag-templates/",
        json={
            "name": "Absperren",
            "color": "#f59e0b",
            "notes": "Signalmaterial ab MTW",
            "auto_create": True,
            "resources": [{"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}],
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Absperren"
    assert created["auto_create"] is True
    assert created["resources"] == [{"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}]

    listed = await editor_client.get("/api/auftrag-templates/")
    assert listed.status_code == 200
    assert [t["name"] for t in listed.json()] == ["Absperren"]


@pytest.mark.asyncio
async def test_patch_replaces_the_resource_list(
    editor_client: AsyncClient, storm_template: AuftragTemplate, test_material: Material
):
    """A given `resources` list is the new truth, not an addition to the old one."""
    response = await editor_client.patch(
        f"/api/auftrag-templates/{storm_template.id}",
        json={"resources": [{"resource_type": "material", "resource_id": str(test_material.id)}]},
    )
    assert response.status_code == 200
    assert response.json()["resources"] == [{"resource_type": "material", "resource_id": str(test_material.id)}]


@pytest.mark.asyncio
async def test_patch_leaves_untouched_fields_alone(editor_client: AsyncClient, storm_template: AuftragTemplate):
    response = await editor_client.patch(f"/api/auftrag-templates/{storm_template.id}", json={"auto_create": False})
    assert response.status_code == 200
    body = response.json()
    assert body["auto_create"] is False
    assert body["name"] == "Sturmholz"
    assert body["notes"] == "Fahrbahn freihalten"
    assert len(body["resources"]) == 2


@pytest.mark.asyncio
async def test_personnel_is_not_a_template_resource(editor_client: AsyncClient, test_personnel):
    """Who is on a squad is decided per Lage — the schema refuses to store it."""
    response = await editor_client.post(
        "/api/auftrag-templates/",
        json={
            "name": "Verkehrsdienst",
            "resources": [{"resource_type": "personnel", "resource_id": str(test_personnel.id)}],
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_deleted_resource_is_dropped_on_write(editor_client: AsyncClient):
    """`resource_id` has no FK, so a ghost must not survive into every future Lage."""
    response = await editor_client.post(
        "/api/auftrag-templates/",
        json={
            "name": "Wasserversorgung",
            "resources": [{"resource_type": "vehicle", "resource_id": str(uuid4())}],
        },
    )
    assert response.status_code == 201
    assert response.json()["resources"] == []


@pytest.mark.asyncio
async def test_reorder(editor_client: AsyncClient, storm_template: AuftragTemplate, backup_template: AuftragTemplate):
    response = await editor_client.post(
        "/api/auftrag-templates/reorder",
        json={"template_ids": [str(backup_template.id), str(storm_template.id)]},
    )
    assert response.status_code == 204

    listed = await editor_client.get("/api/auftrag-templates/")
    assert [t["name"] for t in listed.json()] == ["TLF-Backup", "Sturmholz"]


@pytest.mark.asyncio
async def test_delete(editor_client: AsyncClient, backup_template: AuftragTemplate):
    response = await editor_client.delete(f"/api/auftrag-templates/{backup_template.id}")
    assert response.status_code == 204
    assert (await editor_client.get("/api/auftrag-templates/")).json() == []


@pytest.mark.asyncio
async def test_viewer_reads_but_cannot_write(viewer_client: AsyncClient, storm_template: AuftragTemplate):
    """The board needs the Vorlagen row; changing the station's config is an editor's job."""
    assert (await viewer_client.get("/api/auftrag-templates/")).status_code == 200
    assert (await viewer_client.post("/api/auftrag-templates/", json={"name": "Nope"})).status_code == 403
    assert (await viewer_client.delete(f"/api/auftrag-templates/{storm_template.id}")).status_code == 403


# ============================================
# Instantiation on event creation
# ============================================


@pytest.mark.asyncio
async def test_event_creation_opens_the_automatic_auftraege(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    storm_template: AuftragTemplate,
    backup_template: AuftragTemplate,
    test_vehicle: Vehicle,
    test_material: Material,
):
    response = await editor_client.post("/api/events/", json={"name": "Sturm", "training_flag": False})
    assert response.status_code == 201
    event_id = response.json()["id"]

    groups = (
        (
            await db_session.execute(
                select(IncidentGroup).where(IncidentGroup.event_id == event_id).order_by(IncidentGroup.position)
            )
        )
        .scalars()
        .all()
    )
    # Only the auto template — «TLF-Backup» waits in the Vorlagen row.
    assert [g.name for g in groups] == ["Sturmholz"]
    assert groups[0].color == "#10b981"
    assert groups[0].notes == "Fahrbahn freihalten"

    assignments = (
        (
            await db_session.execute(
                select(IncidentGroupAssignment).where(IncidentGroupAssignment.incident_group_id == groups[0].id)
            )
        )
        .scalars()
        .all()
    )
    assert {(a.resource_type, a.resource_id) for a in assignments} == {
        ("vehicle", test_vehicle.id),
        ("material", test_material.id),
    }


@pytest.mark.asyncio
async def test_automatic_auftraege_keep_the_settings_order(
    editor_client: AsyncClient, db_session: AsyncSession, storm_template: AuftragTemplate
):
    second = AuftragTemplate(id=uuid4(), name="Absperren", auto_create=True, position=5)
    db_session.add(second)
    await db_session.commit()

    response = await editor_client.post("/api/events/", json={"name": "Sturm", "training_flag": False})
    event_id = response.json()["id"]

    groups = (
        (
            await db_session.execute(
                select(IncidentGroup).where(IncidentGroup.event_id == event_id).order_by(IncidentGroup.position)
            )
        )
        .scalars()
        .all()
    )
    assert [g.name for g in groups] == ["Sturmholz", "Absperren"]


@pytest.mark.asyncio
async def test_no_templates_means_an_empty_board(editor_client: AsyncClient, db_session: AsyncSession):
    """A station that never opens the section keeps today's behaviour exactly."""
    response = await editor_client.post("/api/events/", json={"name": "Ohne", "training_flag": False})
    event_id = response.json()["id"]

    groups = (await db_session.execute(select(IncidentGroup).where(IncidentGroup.event_id == event_id))).scalars().all()
    assert groups == []


@pytest.mark.asyncio
async def test_committed_equipment_is_attached_anyway(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    storm_template: AuftragTemplate,
    test_vehicle: Vehicle,
    test_event: Event,
    test_editor: User,
):
    """The station named this vehicle on purpose, so the clash belongs on the board.

    Quietly dropping it would hide that «Sturmholz» is short a TLF — exactly the
    thing the conflict warning exists to say out loud.
    """
    other_group = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Laufender Auftrag", position=0)
    db_session.add(other_group)
    await db_session.flush()
    db_session.add(
        IncidentGroupAssignment(incident_group_id=other_group.id, resource_type="vehicle", resource_id=test_vehicle.id)
    )
    await db_session.commit()

    response = await editor_client.post("/api/events/", json={"name": "Sturm", "training_flag": False})
    new_group_id = await db_session.scalar(
        select(IncidentGroup.id).where(IncidentGroup.event_id == response.json()["id"])
    )

    still_held = await db_session.scalar(
        select(IncidentGroupAssignment.id).where(
            IncidentGroupAssignment.incident_group_id == new_group_id,
            IncidentGroupAssignment.resource_id == test_vehicle.id,
            IncidentGroupAssignment.unassigned_at.is_(None),
        )
    )
    assert still_held is not None


@pytest.mark.asyncio
async def test_untouched_auftrag_contributes_nothing_to_the_reports(
    editor_client: AsyncClient, db_session: AsyncSession, storm_template: AuftragTemplate
):
    """An automatic Auftrag that never got a stop must not print anywhere.

    Both PDF exports are rendered from :class:`EventReportData`, which is
    assembled from the event's incidents and carries no Auftrag at all — so a
    zero-stop Auftrag has nothing it *could* contribute. Templates turn empty
    Aufträge from an oddity into the normal opening state of every Lage, so this
    pins the property rather than leaving it to be rediscovered.
    """
    response = await editor_client.post("/api/events/", json={"name": "Sturm", "training_flag": False})
    event_id = uuid.UUID(response.json()["id"])

    assert (await db_session.scalar(select(IncidentGroup.id).where(IncidentGroup.event_id == event_id))) is not None

    data = await collect_event_report_data(db_session, event_id)
    assert data.incidents == []
    assert data.assignments == []
    assert not hasattr(data, "groups")  # nothing to leak an Auftrag through

    # And both exports still render for such an event rather than falling over.
    assert (await editor_client.get(f"/api/exports/events/{event_id}/report")).status_code == 200
    assert (await editor_client.get(f"/api/exports/events/{event_id}/lageblatt")).status_code == 200
