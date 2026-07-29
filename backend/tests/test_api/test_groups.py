"""Tests for the Auftrag (incident group) API endpoints.

Covers:
- create / list / update / delete groups (delete leaves stops on the board)
- reorder groups & stops; add / remove stops (cross-event rejected -> 400)
- group-level assignments via the API (assign / list / unassign)
- streamlined incident create with group_id attaches + stamps group_position
- auth: viewer gets 403 on mutations, 200 on GETs
- sync-version folds in group create / rename
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Event, Incident, User, Vehicle
from app.services.tokens import generate_viewer_token

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
    data = await _create_group(editor_client, test_event, name="Route A")
    assert data["name"] == "Route A"
    assert data["event_id"] == str(test_event.id)
    assert data["stop_ids"] == []
    assert data["progress"] == {"total": 0, "done": 0}
    assert data["assignments"] == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_group_event_not_found(editor_client: AsyncClient):
    response = await editor_client.post("/api/incident-groups/", json={"name": "Ghost", "event_id": str(uuid4())})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_group_empty_name_rejected(editor_client: AsyncClient, test_event: Event):
    response = await editor_client.post("/api/incident-groups/", json={"name": "   ", "event_id": str(test_event.id)})
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
        f"/api/incident-groups/{group['id']}", json={"name": "New", "color": "#00ff00"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New"
    assert data["color"] == "#00ff00"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_group_not_found(editor_client: AsyncClient):
    response = await editor_client.patch(f"/api/incident-groups/{uuid4()}", json={"name": "X"})
    assert response.status_code == 404


# ============================================
# Funkdurchsage — what was last read out over the radio
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_group_starts_without_an_announcement(editor_client: AsyncClient, test_event: Event):
    group = await _create_group(editor_client, test_event)
    assert group["last_announced_at"] is None
    assert group["last_announced_fingerprint"] is None
    assert group["last_announced_full"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_announce_records_what_was_said(editor_client: AsyncClient, test_event: Event, test_incident: Incident):
    group = await _create_group(editor_client, test_event)
    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/announce",
        json={"fingerprint": "p:a,b|v:pio|m:", "stop_id": str(test_incident.id), "full": True},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["last_announced_fingerprint"] == "p:a,b|v:pio|m:"
    assert data["last_announced_stop_id"] == str(test_incident.id)
    assert data["last_announced_full"] is True
    assert data["last_announced_at"] is not None

    # The record has to survive the reload — a second device and the wall screen
    # read it back to decide between the full and the short announcement.
    listed = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert listed.json()[0]["last_announced_fingerprint"] == "p:a,b|v:pio|m:"


@pytest.mark.asyncio
@pytest.mark.api
async def test_announce_overwrites_the_previous_one(editor_client: AsyncClient, test_event: Event):
    group = await _create_group(editor_client, test_event)
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/announce", json={"fingerprint": "p:a|v:|m:", "full": True}
    )
    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/announce", json={"fingerprint": "p:a,b|v:|m:", "full": False}
    )
    data = response.json()
    assert data["last_announced_fingerprint"] == "p:a,b|v:|m:"
    assert data["last_announced_full"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_announce_group_not_found(editor_client: AsyncClient):
    response = await editor_client.post(f"/api/incident-groups/{uuid4()}/announce", json={"fingerprint": "x"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_announce_rejects_an_oversized_fingerprint(editor_client: AsyncClient, test_event: Event):
    group = await _create_group(editor_client, test_event)
    response = await editor_client.post(
        f"/api/incident-groups/{group['id']}/announce", json={"fingerprint": "x" * 2001}
    )
    assert response.status_code == 422


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
# Group-level (Auftrag) assignments
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_list_unassign_group_resource(
    editor_client: AsyncClient, test_event: Event, test_vehicle: Vehicle
):
    group = await _create_group(editor_client, test_event)

    assign = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    assert assign.status_code == 200, assign.text
    created = assign.json()
    assert created["incident_group_id"] == group["id"]
    assert created["resource_id"] == str(test_vehicle.id)

    # It shows up in the group's assignment list and on the group response.
    listing = await editor_client.get(f"/api/incident-groups/{group['id']}/assignments")
    assert listing.status_code == 200
    assert [a["resource_id"] for a in listing.json()] == [str(test_vehicle.id)]

    groups = await editor_client.get(f"/api/incident-groups/?event_id={test_event.id}")
    assert [a["resource_id"] for a in groups.json()[0]["assignments"]] == [str(test_vehicle.id)]

    # Release it again.
    unassign = await editor_client.post(f"/api/incident-groups/{group['id']}/unassign/{created['id']}")
    assert unassign.status_code == 204
    listing2 = await editor_client.get(f"/api/incident-groups/{group['id']}/assignments")
    assert listing2.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_group_resource_works_with_zero_stops(
    editor_client: AsyncClient, test_event: Event, test_vehicle: Vehicle
):
    # A brand-new Auftrag has no stops, yet can carry a resource.
    group = await _create_group(editor_client, test_event)
    assert group["stop_ids"] == []
    assign = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    assert assign.status_code == 200, assign.text


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_group_resource_duplicate_conflict(
    editor_client: AsyncClient, test_event: Event, test_vehicle: Vehicle
):
    group = await _create_group(editor_client, test_event)
    body = {"resource_type": "vehicle", "resource_id": str(test_vehicle.id)}
    first = await editor_client.post(f"/api/incident-groups/{group['id']}/assign", json=body)
    assert first.status_code == 200
    dup = await editor_client.post(f"/api/incident-groups/{group['id']}/assign", json=body)
    assert dup.status_code == 409


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_group_resource_rejects_missing_and_wrong_type(
    editor_client: AsyncClient, test_event: Event, test_vehicle: Vehicle
):
    group = await _create_group(editor_client, test_event)
    missing = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "vehicle", "resource_id": str(uuid4())},
    )
    assert missing.status_code == 404

    wrong_type = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "personnel", "resource_id": str(test_vehicle.id)},
    )
    assert wrong_type.status_code == 422


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


def _incident_payload(event_id, group_id) -> dict:
    return {
        "title": "Validated Stop",
        "type": "brandbekaempfung",
        "priority": "medium",
        "status": "eingegangen",
        "event_id": str(event_id),
        "group_id": str(group_id),
    }


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_rejects_cross_event_and_deleted_group(
    editor_client: AsyncClient, test_event: Event, second_event: Event
):
    foreign = await _create_group(editor_client, second_event)
    cross = await editor_client.post("/api/incidents/", json=_incident_payload(test_event.id, foreign["id"]))
    assert cross.status_code == 400

    deleted = await _create_group(editor_client, test_event, name="Deleted")
    assert (await editor_client.delete(f"/api/incident-groups/{deleted['id']}")).status_code == 204
    gone = await editor_client.post("/api/incidents/", json=_incident_payload(test_event.id, deleted["id"]))
    assert gone.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_incident_rejects_cross_event_and_deleted_group(
    editor_client: AsyncClient, test_event: Event, second_event: Event, test_incident: Incident
):
    foreign = await _create_group(editor_client, second_event)
    cross = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"group_id": foreign["id"]})
    assert cross.status_code == 400

    deleted = await _create_group(editor_client, test_event, name="Deleted")
    await editor_client.delete(f"/api/incident-groups/{deleted['id']}")
    gone = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"group_id": deleted["id"]})
    assert gone.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_incident_group_membership_change_is_audited(
    editor_client: AsyncClient, db_session: AsyncSession, test_event: Event, test_incident: Incident
):
    group = await _create_group(editor_client, test_event)
    response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json={"group_id": group["id"]})
    assert response.status_code == 200

    audit = await db_session.scalar(
        select(AuditLog)
        .where(AuditLog.resource_type == "incident", AuditLog.resource_id == test_incident.id)
        .order_by(AuditLog.timestamp.desc())
    )
    assert audit.changes_json["group_id"] == {"before": None, "after": group["id"]}


@pytest.mark.asyncio
@pytest.mark.api
async def test_final_stop_release_broadcasts_group_refresh(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, test_vehicle: Vehicle
):
    group = await _create_group(editor_client, test_event)
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/stops",
        json={"incident_ids": [str(test_incident.id)]},
    )
    await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )

    with patch("app.api.incidents.broadcast_group_update", new_callable=AsyncMock) as broadcast:
        response = await editor_client.post(
            f"/api/incidents/{test_incident.id}/status",
            json={"from_status": "eingegangen", "to_status": "abschluss"},
        )

    assert response.status_code == 200
    broadcast.assert_awaited_once()
    assert broadcast.await_args.args[0]["id"] == group["id"]


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
async def test_public_viewer_data_includes_groups(
    client: AsyncClient,
    editor_client: AsyncClient,
    test_event: Event,
    test_incident: Incident,
):
    created = await editor_client.post(
        "/api/incident-groups/",
        json={"name": "Public Route", "event_id": str(test_event.id)},
    )
    assert created.status_code == 201
    group_id = created.json()["id"]
    attached = await editor_client.post(
        f"/api/incident-groups/{group_id}/stops",
        json={"incident_ids": [str(test_incident.id)]},
    )
    assert attached.status_code == 200

    token = generate_viewer_token(test_event.id)
    response = await client.get("/api/viewer/data", params={"token": token})

    assert response.status_code == 200
    assert response.json()["groups"] == [
        {
            **created.json(),
            "stop_ids": [str(test_incident.id)],
            "progress": {"total": 1, "done": 0},
            "assignments": [],
        }
    ]


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
            f"/api/incident-groups/{gid}/assign",
            json={"resource_type": "vehicle", "resource_id": str(uuid4())},
        ),
        viewer_client.post(f"/api/incident-groups/{gid}/unassign/{uuid4()}"),
        viewer_client.post(f"/api/incident-groups/{gid}/announce", json={"fingerprint": "x"}),
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


@pytest.mark.asyncio
@pytest.mark.api
async def test_sync_version_changes_on_group_assignment_assign_and_unassign(
    editor_client: AsyncClient, test_event: Event, test_vehicle: Vehicle
):
    async def version() -> str:
        response = await editor_client.get(f"/api/incidents/sync-version?event_id={test_event.id}")
        return response.json()["version"]

    group = await _create_group(editor_client, test_event)
    before = await version()
    assigned = await editor_client.post(
        f"/api/incident-groups/{group['id']}/assign",
        json={"resource_type": "vehicle", "resource_id": str(test_vehicle.id)},
    )
    after_assign = await version()
    assert after_assign != before
    await editor_client.post(f"/api/incident-groups/{group['id']}/unassign/{assigned.json()['id']}")
    assert await version() != after_assign
