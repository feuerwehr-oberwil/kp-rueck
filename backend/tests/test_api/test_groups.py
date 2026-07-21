"""Tests for the Auftrag (incident group) API endpoints.

Covers plan 12 (docs/plans/12-auftrag-multi-stop-routing.md):
- create / list / update / delete groups (delete leaves stops on the board)
- reorder groups & stops; add / remove stops (cross-event rejected -> 400)
- copy-squad via the API
- streamlined incident create with group_id attaches + stamps group_position
- auth: viewer gets 403 on mutations, 200 on GETs
- sync-version folds in group create / rename
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, User, Vehicle

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Group API Event", training_flag=False)
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def second_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Other API Event", training_flag=False)
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Board Stop",
        type="brandbekaempfung",
        priority="medium",
        status="eingegangen",
        location_address="Test Street 123",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def second_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Board Stop 2",
        type="strassenrettung",
        priority="medium",
        status="eingegangen",
        location_address="Test Street 456",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    vehicle = Vehicle(id=uuid4(), name="TLF API", type="TLF", status="available")
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


async def _create_group(client: AsyncClient, event: Event, name: str = "Sturm-Route West", **extra) -> dict:
    payload = {"name": name, "event_id": str(event.id), **extra}
    response = await client.post("/api/incident-groups/", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ============================================
# Create / list / update
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_group(editor_client: AsyncClient, test_event: Event):
    data = await _create_group(editor_client, test_event, name="Route A", mode="squad")
    assert data["name"] == "Route A"
    assert data["event_id"] == str(test_event.id)
    assert data["mode"] == "squad"
    assert data["stop_ids"] == []
    assert data["progress"] == {"total": 0, "done": 0}


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_group_event_not_found(editor_client: AsyncClient):
    response = await editor_client.post(
        "/api/incident-groups/", json={"name": "Ghost", "event_id": str(uuid4())}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_group_empty_name_rejected(editor_client: AsyncClient, test_event: Event):
    response = await editor_client.post(
        "/api/incident-groups/", json={"name": "   ", "event_id": str(test_event.id)}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_groups(editor_client: AsyncClient, test_event: Event):
    await _create_group(editor_client, test_event, name="Route A")
    await _create_group(editor_client, test_event, name="Route B")
    response = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert response.status_code == 200
    groups = response.json()
    assert [g["name"] for g in groups] == ["Route A", "Route B"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_group(editor_client: AsyncClient, test_event: Event):
    group = await _create_group(editor_client, test_event, name="Old")
    response = await editor_client.patch(
        f"/api/incident-groups/{group['id']}", json={"name": "New", "mode": "vehicle_only"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New"
    assert data["mode"] == "vehicle_only"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_group_not_found(editor_client: AsyncClient):
    response = await editor_client.patch(f"/api/incident-groups/{uuid4()}", json={"name": "X"})
    assert response.status_code == 404


# ============================================
# Delete leaves stops on the board
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_group_leaves_stops(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident
):
    group = await _create_group(editor_client, test_event)
    add = await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops", json={"incident_ids": [str(test_incident.id)]}
    )
    assert add.status_code == 200
    assert str(test_incident.id) in add.json()["stop_ids"]

    delete = await editor_client.delete(f"/api/incident-groups/{group['id']}")
    assert delete.status_code == 204

    # Group gone from the list...
    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert groups.json() == []

    # ...but the incident still lists on the board, ungrouped.
    incidents = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    listed = incidents.json()
    assert any(i["id"] == str(test_incident.id) for i in listed)
    row = await db_session.execute(select(Incident.group_id).where(Incident.id == test_incident.id))
    assert row.scalar_one() is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_group_not_found(editor_client: AsyncClient):
    response = await editor_client.delete(f"/api/incident-groups/{uuid4()}")
    assert response.status_code == 404


# ============================================
# Reorder groups & stops
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_reorder_groups(editor_client: AsyncClient, test_event: Event):
    g0 = await _create_group(editor_client, test_event, name="A")
    g1 = await _create_group(editor_client, test_event, name="B")
    response = await editor_client.post(
        "/api/incident-groups/reorder",
        json={"event_id": str(test_event.id), "ordered_ids": [g1["id"], g0["id"]]},
    )
    assert response.status_code == 204

    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert [g["name"] for g in groups.json()] == ["B", "A"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_reorder_stops(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, second_incident: Incident
):
    group = await _create_group(editor_client, test_event)
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops",
        json={"incident_ids": [str(test_incident.id), str(second_incident.id)]},
    )
    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops/reorder",
        json={"ordered_ids": [str(second_incident.id), str(test_incident.id)]},
    )
    assert response.status_code == 204

    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    stop_ids = groups.json()[0]["stop_ids"]
    assert stop_ids == [str(second_incident.id), str(test_incident.id)]


# ============================================
# Add / remove stops
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_add_stops(editor_client: AsyncClient, test_event: Event, test_incident: Incident):
    group = await _create_group(editor_client, test_event)
    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops", json={"incident_ids": [str(test_incident.id)]}
    )
    assert response.status_code == 200
    assert response.json()["stop_ids"] == [str(test_incident.id)]


@pytest.mark.asyncio
@pytest.mark.api
async def test_add_stops_cross_event_rejected(
    editor_client: AsyncClient, test_event: Event, second_event: Event, test_editor: User, db_session: AsyncSession
):
    group = await _create_group(editor_client, test_event)
    foreign = Incident(
        id=uuid4(),
        event_id=second_event.id,
        title="Foreign",
        type="brandbekaempfung",
        priority="low",
        status="eingegangen",
        location_address="Elsewhere 1",
        created_by=test_editor.id,
    )
    db_session.add(foreign)
    await db_session.commit()

    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops", json={"incident_ids": [str(foreign.id)]}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_remove_stop(editor_client: AsyncClient, test_event: Event, test_incident: Incident):
    group = await _create_group(editor_client, test_event)
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops", json={"incident_ids": [str(test_incident.id)]}
    )
    response = await editor_client.delete(f"/api/incident-groups/{group['id']}/stops/{test_incident.id}")
    assert response.status_code == 204

    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert groups.json()[0]["stop_ids"] == []


# ============================================
# copy-squad
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_copy_squad(
    editor_client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
    second_incident: Incident,
    test_vehicle: Vehicle,
):
    group = await _create_group(editor_client, test_event)
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops",
        json={"incident_ids": [str(test_incident.id), str(second_incident.id)]},
    )
    # Assign a vehicle to the source stop, then copy it to the siblings.
    assign = await editor_client.post(
        f"/api/incidents/{test_incident.id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    assert assign.status_code == 200

    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/copy-squad",
        json={"source_incident_id": str(test_incident.id)},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["copied"] == 1
    assert result["skipped"] == 0

    # The sibling now carries the vehicle.
    sib_assigns = await editor_client.get(f"/api/incidents/{second_incident.id}/assignments")
    assert any(a["resource_id"] == str(test_vehicle.id) for a in sib_assigns.json())


# ============================================
# Streamlined incident create with group_id
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_with_group_id_attaches(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident
):
    group = await _create_group(editor_client, test_event)
    # Pre-attach one stop so the streamlined create appends at position 1.
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops", json={"incident_ids": [str(test_incident.id)]}
    )

    response = await editor_client.post(
        "/api/incidents/",
        json={
            "title": "Streamlined Stop",
            "type": "brandbekaempfung",
            "priority": "medium",
            "status": "eingegangen",
            "location_address": "New Street 9",
            "event_id": str(test_event.id),
            "group_id": group["id"],
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["group_id"] == group["id"]
    assert created["group_position"] == 1  # appended after the existing stop

    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert created["id"] in groups.json()[0]["stop_ids"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_without_group_id_unchanged(editor_client: AsyncClient, test_event: Event):
    response = await editor_client.post(
        "/api/incidents/",
        json={
            "title": "Ungrouped",
            "type": "brandbekaempfung",
            "priority": "medium",
            "status": "eingegangen",
            "location_address": "Somewhere 1",
            "event_id": str(test_event.id),
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["group_id"] is None
    assert created["group_position"] == 0


# ============================================
# Auth: viewer 403 on mutations, 200 on GETs
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_can_list_groups(viewer_client: AsyncClient, test_event: Event):
    response = await viewer_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_forbidden_on_mutations(viewer_client: AsyncClient, test_event: Event, test_incident: Incident):
    gid = uuid4()
    iid = test_incident.id
    calls = [
        viewer_client.post("/api/incident-groups/", json={"name": "X", "event_id": str(test_event.id)}),
        viewer_client.patch(f"/api/incident-groups/{gid}", json={"name": "Y"}),
        viewer_client.delete(f"/api/incident-groups/{gid}"),
        viewer_client.post(
            "/api/incident-groups/reorder",
            json={"event_id": str(test_event.id), "ordered_ids": [str(gid)]},
        ),
        viewer_client.post(f"/api/incident-groups/{gid}/stops/reorder", json={"ordered_ids": [str(iid)]}),
        viewer_client.post(f"/api/incident-groups/{gid}/stops", json={"incident_ids": [str(iid)]}),
        viewer_client.delete(f"/api/incident-groups/{gid}/stops/{iid}"),
        viewer_client.post(
            f"/api/incident-groups/{gid}/copy-squad", json={"source_incident_id": str(iid)}
        ),
    ]
    for coro in calls:
        response = await coro
        assert response.status_code == 403, response.text


# ============================================
# sync-version folds in group changes
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_version_changes_on_group_create_and_rename(editor_client: AsyncClient, test_event: Event):
    async def version() -> str:
        response = await editor_client.get(f"/api/incidents/sync-version?event_id={test_event.id}")
        assert response.status_code == 200
        return response.json()["version"]

    v_initial = await version()

    group = await _create_group(editor_client, test_event, name="Route A")
    v_after_create = await version()
    assert v_after_create != v_initial

    await editor_client.patch(f"/api/incident-groups/{group['id']}", json={"name": "Route A renamed"})
    v_after_rename = await version()
    assert v_after_rename != v_after_create
