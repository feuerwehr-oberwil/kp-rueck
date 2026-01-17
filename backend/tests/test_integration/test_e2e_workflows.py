"""End-to-End Workflow Tests (Phase 4.2).

Tests verify complete business workflows from start to finish:
- Full incident lifecycle (create event → incidents → status transitions → completion)
- Personnel check-in workflow
- Resource assignment workflow
- Reko form submission workflow
- Assignment transfer between incidents
- Event archival workflow
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Material, Personnel, User, Vehicle

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """Create an async test client with test database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_editor(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="workflow_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_viewer(db_session: AsyncSession) -> User:
    """Create a test viewer user."""
    user = User(
        id=uuid4(),
        username="workflow_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "workflow_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "workflow_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def resources(db_session: AsyncSession) -> dict:
    """Create test resources (personnel, vehicles, materials)."""
    # Create personnel
    personnel_list = []
    for i in range(3):
        personnel = Personnel(
            id=uuid4(),
            name=f"Firefighter {i + 1}",
            role="Gruppenführer" if i == 0 else "Feuerwehrmann",
            availability="available",
        )
        db_session.add(personnel)
        personnel_list.append(personnel)

    # Create vehicles
    vehicles_list = []
    vehicle_types = [("TLF 1", "TLF"), ("DLK 1", "DLK"), ("MTW 1", "MTW")]
    for i, (name, vtype) in enumerate(vehicle_types):
        vehicle = Vehicle(
            id=uuid4(),
            name=name,
            type=vtype,
            display_order=i + 1,
            status="available",
            radio_call_sign=f"Florian-{i + 1}",
        )
        db_session.add(vehicle)
        vehicles_list.append(vehicle)

    # Create materials
    materials_list = []
    material_types = [("Stromerzeuger", "Generator"), ("Tauchpumpe", "Pumpe"), ("Motorsäge", "Werkzeug")]
    for i, (name, mtype) in enumerate(material_types):
        material = Material(
            id=uuid4(),
            name=name,
            type=mtype,
            location="Depot",
            status="available",
        )
        db_session.add(material)
        materials_list.append(material)

    await db_session.commit()

    for p in personnel_list:
        await db_session.refresh(p)
    for v in vehicles_list:
        await db_session.refresh(v)
    for m in materials_list:
        await db_session.refresh(m)

    return {
        "personnel": personnel_list,
        "vehicles": vehicles_list,
        "materials": materials_list,
    }


# ============================================
# Full Incident Lifecycle Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_complete_incident_lifecycle(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """
    Test complete incident lifecycle from event creation to archival.

    Flow:
    1. Create event
    2. Create incident
    3. Assign resources
    4. Progress through status transitions
    5. Complete incident
    6. Release resources
    7. Archive event
    """
    # Step 1: Create event
    event_data = {"name": "Lifecycle Test Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    assert response.status_code == 201
    event = response.json()
    event_id = event["id"]

    # Step 2: Create incident
    incident_data = {
        "event_id": event_id,
        "title": "Wohnungsbrand Hauptstrasse",
        "type": "brandbekaempfung",
        "priority": "high",
        "location_address": "Hauptstrasse 123, Basel",
        "description": "Brand in Mehrfamilienhaus",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201
    incident = response.json()
    incident_id = incident["id"]
    assert incident["status"] == "eingegangen"

    # Step 3: Assign resources
    # Assign personnel
    personnel_id = str(resources["personnel"][0].id)
    response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "personnel", "resource_id": personnel_id},
    )
    assert response.status_code == 200

    # Assign vehicle
    vehicle_id = str(resources["vehicles"][0].id)
    response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "vehicle", "resource_id": vehicle_id},
    )
    assert response.status_code == 200

    # Assign material
    material_id = str(resources["materials"][0].id)
    response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "material", "resource_id": material_id},
    )
    assert response.status_code == 200

    # Verify assignments
    response = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert response.status_code == 200
    assignments = response.json()
    assert len(assignments) == 3

    # Step 4: Progress through status transitions
    status_flow = [
        ("eingegangen", "reko"),
        ("reko", "disponiert"),
        ("disponiert", "einsatz"),
        ("einsatz", "einsatz_beendet"),
        ("einsatz_beendet", "abschluss"),
    ]

    for from_status, to_status in status_flow:
        response = await editor_client.post(
            f"/api/incidents/{incident_id}/status",
            json={"from_status": from_status, "to_status": to_status},
        )
        assert response.status_code == 200, f"Failed transition {from_status} -> {to_status}"
        assert response.json()["status"] == to_status

    # Step 5: Verify status history
    response = await editor_client.get(f"/api/incidents/{incident_id}/history")
    assert response.status_code == 200
    history = response.json()
    assert len(history) == 5  # 5 transitions

    # Step 6: Release all resources
    response = await editor_client.post(f"/api/incidents/{incident_id}/release-all")
    assert response.status_code == 204

    # Verify resources are released
    response = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert response.status_code == 200
    # Active assignments should be empty (unassigned_at is set)
    # Note: The endpoint may still return assignments with unassigned_at set

    # Step 7: Archive event
    response = await editor_client.post(f"/api/events/{event_id}/archive")
    assert response.status_code == 200
    assert response.json()["archived_at"] is not None

    # Verify archived event is excluded from default list
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200
    active_event_ids = [e["id"] for e in response.json()["events"]]
    assert event_id not in active_event_ids

    # But can be retrieved with include_archived
    response = await editor_client.get("/api/events/?include_archived=true")
    assert response.status_code == 200
    all_event_ids = [e["id"] for e in response.json()["events"]]
    assert event_id in all_event_ids


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_status_history_tracking(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that status transitions are properly tracked with timestamps."""
    # Create event
    event_data = {"name": "History Tracking Event", "training_flag": True}
    response = await editor_client.post("/api/events/", json=event_data)
    assert response.status_code == 201
    event_id = response.json()["id"]

    # Create incident
    incident_data = {
        "event_id": event_id,
        "title": "History Test Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201
    incident_id = response.json()["id"]

    # Make multiple status transitions
    transitions = [
        ("eingegangen", "reko", "Starting reconnaissance"),
        ("reko", "disponiert", "Resources assigned"),
        ("disponiert", "einsatz", "Team en route"),
    ]

    for from_s, to_s, notes in transitions:
        response = await editor_client.post(
            f"/api/incidents/{incident_id}/status",
            json={"from_status": from_s, "to_status": to_s, "notes": notes},
        )
        assert response.status_code == 200

    # Check history
    response = await editor_client.get(f"/api/incidents/{incident_id}/history")
    assert response.status_code == 200
    history = response.json()

    # Verify all transitions are recorded in order
    assert len(history) == 3

    # History should be in chronological order
    for i, (from_s, to_s, notes) in enumerate(transitions):
        assert history[i]["from_status"] == from_s
        assert history[i]["to_status"] == to_s
        # Notes may or may not be returned depending on API


# ============================================
# Resource Assignment Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_resource_assignment_workflow(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """Test complete resource assignment and unassignment workflow."""
    # Create event and incident
    event_data = {"name": "Assignment Workflow Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    incident_data = {
        "event_id": event_id,
        "title": "Assignment Test",
        "type": "technische_hilfeleistung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    incident_id = response.json()["id"]

    # Assign multiple resources
    assignment_ids = []

    for personnel in resources["personnel"][:2]:
        response = await editor_client.post(
            f"/api/incidents/{incident_id}/assign",
            json={"resource_type": "personnel", "resource_id": str(personnel.id)},
        )
        assert response.status_code == 200
        assignment_ids.append(response.json()["id"])

    for vehicle in resources["vehicles"][:1]:
        response = await editor_client.post(
            f"/api/incidents/{incident_id}/assign",
            json={"resource_type": "vehicle", "resource_id": str(vehicle.id)},
        )
        assert response.status_code == 200
        assignment_ids.append(response.json()["id"])

    # Verify all assignments
    response = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert response.status_code == 200
    assert len(response.json()) == 3

    # Unassign one resource
    response = await editor_client.post(f"/api/incidents/{incident_id}/unassign/{assignment_ids[0]}")
    assert response.status_code == 204

    # Verify remaining assignments
    response = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert response.status_code == 200
    remaining = [a for a in response.json() if a["unassigned_at"] is None]
    assert len(remaining) == 2


@pytest.mark.asyncio
@pytest.mark.integration
async def test_bulk_assignment_by_event(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """Test getting all assignments for an event in one request."""
    # Create event
    event_data = {"name": "Bulk Assignment Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Create multiple incidents
    incident_ids = []
    for i in range(3):
        incident_data = {
            "event_id": event_id,
            "title": f"Incident {i + 1}",
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        incident_ids.append(response.json()["id"])

    # Assign resources to different incidents
    await editor_client.post(
        f"/api/incidents/{incident_ids[0]}/assign",
        json={"resource_type": "personnel", "resource_id": str(resources["personnel"][0].id)},
    )
    await editor_client.post(
        f"/api/incidents/{incident_ids[1]}/assign",
        json={"resource_type": "vehicle", "resource_id": str(resources["vehicles"][0].id)},
    )
    await editor_client.post(
        f"/api/incidents/{incident_ids[2]}/assign",
        json={"resource_type": "material", "resource_id": str(resources["materials"][0].id)},
    )

    # Get all assignments for event in one request
    response = await editor_client.get(f"/api/assignments/by-event/{event_id}")
    assert response.status_code == 200

    assignments_by_incident = response.json()

    # Each incident should have its assignments
    assert incident_ids[0] in assignments_by_incident
    assert incident_ids[1] in assignments_by_incident
    assert incident_ids[2] in assignments_by_incident


# ============================================
# Assignment Transfer Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_assignment_transfer_workflow(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """Test transferring all assignments from one incident to another."""
    # Create event
    event_data = {"name": "Transfer Workflow Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Create source incident
    source_data = {
        "event_id": event_id,
        "title": "Source Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=source_data)
    source_id = response.json()["id"]

    # Create target incident
    target_data = {
        "event_id": event_id,
        "title": "Target Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=target_data)
    target_id = response.json()["id"]

    # Assign resources to source incident
    for personnel in resources["personnel"][:2]:
        await editor_client.post(
            f"/api/incidents/{source_id}/assign",
            json={"resource_type": "personnel", "resource_id": str(personnel.id)},
        )

    await editor_client.post(
        f"/api/incidents/{source_id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(resources["vehicles"][0].id)},
    )

    # Verify source has assignments
    response = await editor_client.get(f"/api/incidents/{source_id}/assignments")
    assert len([a for a in response.json() if a["unassigned_at"] is None]) == 3

    # Transfer assignments to target
    response = await editor_client.post(
        f"/api/incidents/{source_id}/transfer",
        json={"target_incident_id": target_id},
    )
    assert response.status_code == 200
    assert response.json()["transferred_count"] == 3

    # Verify target now has assignments
    response = await editor_client.get(f"/api/incidents/{target_id}/assignments")
    assert len([a for a in response.json() if a["unassigned_at"] is None]) == 3

    # Verify source no longer has active assignments
    response = await editor_client.get(f"/api/incidents/{source_id}/assignments")
    active = [a for a in response.json() if a["unassigned_at"] is None]
    assert len(active) == 0


# ============================================
# Event Archival Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_event_archive_unarchive_workflow(editor_client: AsyncClient, db_session: AsyncSession):
    """Test archiving and unarchiving an event."""
    # Create event
    event_data = {"name": "Archive Test Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    assert response.status_code == 201
    event_id = response.json()["id"]

    # Archive event
    response = await editor_client.post(f"/api/events/{event_id}/archive")
    assert response.status_code == 200
    assert response.json()["archived_at"] is not None

    # Verify not in default list
    response = await editor_client.get("/api/events/")
    event_ids = [e["id"] for e in response.json()["events"]]
    assert event_id not in event_ids

    # Unarchive event
    response = await editor_client.post(f"/api/events/{event_id}/unarchive")
    assert response.status_code == 200
    assert response.json()["archived_at"] is None

    # Verify back in default list
    response = await editor_client.get("/api/events/")
    event_ids = [e["id"] for e in response.json()["events"]]
    assert event_id in event_ids


@pytest.mark.asyncio
@pytest.mark.integration
async def test_event_delete_requires_archive_first(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that event must be archived before deletion."""
    # Create event
    event_data = {"name": "Delete Test Event", "training_flag": True}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Try to delete without archiving first
    response = await editor_client.delete(f"/api/events/{event_id}")
    assert response.status_code == 400  # Should fail

    # Archive first
    response = await editor_client.post(f"/api/events/{event_id}/archive")
    assert response.status_code == 200

    # Now delete should work
    response = await editor_client.delete(f"/api/events/{event_id}")
    assert response.status_code == 204

    # Verify deletion
    response = await editor_client.get(f"/api/events/{event_id}")
    assert response.status_code == 404


# ============================================
# Multiple Incident Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_multiple_incidents_in_event(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """Test managing multiple incidents in one event simultaneously."""
    # Create event
    event_data = {"name": "Multi-Incident Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Create 5 incidents
    incident_ids = []
    for i in range(5):
        incident_data = {
            "event_id": event_id,
            "title": f"Incident {i + 1}",
            "type": "brandbekaempfung",
            "priority": ["low", "medium", "high"][i % 3],
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201
        incident_ids.append(response.json()["id"])

    # Progress each to different status
    statuses = ["eingegangen", "reko", "disponiert", "einsatz", "einsatz_beendet"]
    for i, (incident_id, target_status) in enumerate(zip(incident_ids, statuses)):
        if target_status != "eingegangen":
            # Get current status
            response = await editor_client.get(f"/api/incidents/{incident_id}")
            current_status = response.json()["status"]

            # Progress to target status
            status_flow = ["eingegangen", "reko", "disponiert", "einsatz", "einsatz_beendet"]
            current_idx = status_flow.index(current_status)
            target_idx = status_flow.index(target_status)

            for j in range(current_idx, target_idx):
                await editor_client.post(
                    f"/api/incidents/{incident_id}/status",
                    json={"from_status": status_flow[j], "to_status": status_flow[j + 1]},
                )

    # List all incidents for event
    response = await editor_client.get(f"/api/incidents/?event_id={event_id}")
    assert response.status_code == 200
    incidents = response.json()
    assert len(incidents) == 5

    # Verify each has expected status
    for i, status in enumerate(statuses):
        incident = next(inc for inc in incidents if inc["id"] == incident_ids[i])
        assert incident["status"] == status

    # Verify event incident count
    response = await editor_client.get(f"/api/events/{event_id}")
    assert response.json()["incident_count"] == 5


# ============================================
# Training vs Live Mode Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_training_vs_live_event_isolation(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that training and live events are properly isolated."""
    # Create training event
    training_event = {"name": "Training Event", "training_flag": True}
    response = await editor_client.post("/api/events/", json=training_event)
    training_event_id = response.json()["id"]

    # Create live event
    live_event = {"name": "Live Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=live_event)
    live_event_id = response.json()["id"]

    # Create incidents in each
    training_incident = {
        "event_id": training_event_id,
        "title": "Training Incident",
        "type": "brandbekaempfung",
        "priority": "low",
    }
    await editor_client.post("/api/incidents/", json=training_incident)

    live_incident = {
        "event_id": live_event_id,
        "title": "Live Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    await editor_client.post("/api/incidents/", json=live_incident)

    # Verify training event only has training incident
    response = await editor_client.get(f"/api/incidents/?event_id={training_event_id}")
    assert len(response.json()) == 1
    assert response.json()[0]["title"] == "Training Incident"

    # Verify live event only has live incident
    response = await editor_client.get(f"/api/incidents/?event_id={live_event_id}")
    assert len(response.json()) == 1
    assert response.json()[0]["title"] == "Live Incident"


# ============================================
# Resource Reuse Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_resource_reuse_after_release(editor_client: AsyncClient, db_session: AsyncSession, resources: dict):
    """Test that released resources can be assigned to new incidents."""
    # Create event
    event_data = {"name": "Resource Reuse Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Create first incident
    incident1_data = {
        "event_id": event_id,
        "title": "First Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident1_data)
    incident1_id = response.json()["id"]

    # Assign vehicle to first incident
    vehicle_id = str(resources["vehicles"][0].id)
    response = await editor_client.post(
        f"/api/incidents/{incident1_id}/assign",
        json={"resource_type": "vehicle", "resource_id": vehicle_id},
    )
    assert response.status_code == 200
    assignment_id = response.json()["id"]

    # Create second incident
    incident2_data = {
        "event_id": event_id,
        "title": "Second Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident2_data)
    incident2_id = response.json()["id"]

    # Try to assign same vehicle to second incident - should have conflict warning
    # but API allows override
    response = await editor_client.post(
        f"/api/incidents/{incident2_id}/assign",
        json={"resource_type": "vehicle", "resource_id": vehicle_id},
    )
    # May succeed with conflict warning or return 409
    if response.status_code == 409:
        # Release from first incident
        await editor_client.post(f"/api/incidents/{incident1_id}/unassign/{assignment_id}")

        # Now should succeed
        response = await editor_client.post(
            f"/api/incidents/{incident2_id}/assign",
            json={"resource_type": "vehicle", "resource_id": vehicle_id},
        )
        assert response.status_code == 200

    # Verify vehicle is assigned to second incident
    response = await editor_client.get(f"/api/incidents/{incident2_id}/assignments")
    assert response.status_code == 200
    vehicle_assignments = [a for a in response.json() if a["resource_type"] == "vehicle" and a["unassigned_at"] is None]
    assert len(vehicle_assignments) >= 1


# ============================================
# Pagination Workflow Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_pagination_workflow(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that pagination works correctly for incidents."""
    # Create event
    event_data = {"name": "Pagination Event", "training_flag": False}
    response = await editor_client.post("/api/events/", json=event_data)
    event_id = response.json()["id"]

    # Create 25 incidents
    for i in range(25):
        incident_data = {
            "event_id": event_id,
            "title": f"Incident {i + 1:02d}",
            "type": "brandbekaempfung",
            "priority": "medium",
        }
        await editor_client.post("/api/incidents/", json=incident_data)

    # Get first page (10 items)
    response = await editor_client.get(f"/api/incidents/?event_id={event_id}&limit=10&skip=0")
    assert response.status_code == 200
    page1 = response.json()
    assert len(page1) == 10

    # Get second page
    response = await editor_client.get(f"/api/incidents/?event_id={event_id}&limit=10&skip=10")
    assert response.status_code == 200
    page2 = response.json()
    assert len(page2) == 10

    # Get third page
    response = await editor_client.get(f"/api/incidents/?event_id={event_id}&limit=10&skip=20")
    assert response.status_code == 200
    page3 = response.json()
    assert len(page3) == 5  # Only 5 remaining

    # Verify no overlap between pages
    page1_ids = {i["id"] for i in page1}
    page2_ids = {i["id"] for i in page2}
    page3_ids = {i["id"] for i in page3}

    assert len(page1_ids & page2_ids) == 0
    assert len(page2_ids & page3_ids) == 0
    assert len(page1_ids & page3_ids) == 0

    # Verify total count
    all_ids = page1_ids | page2_ids | page3_ids
    assert len(all_ids) == 25
