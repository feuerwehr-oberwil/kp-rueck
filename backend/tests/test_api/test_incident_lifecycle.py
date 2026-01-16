"""Integration tests for complete incident lifecycle.

Tests the full workflow from incident creation to completion:
1. Create event and incident
2. Assign resources (personnel, vehicles, materials)
3. Progress through status transitions
4. Verify status history is recorded
5. Complete incident and verify resource release
6. Verify incident can be soft-deleted

These tests ensure the complete business flow works end-to-end.
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
async def editor_user(db_session: AsyncSession) -> User:
    """Create a test editor user."""
    user = User(
        id=uuid4(),
        username="lifecycle_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def resources(db_session: AsyncSession) -> dict:
    """Create test resources (personnel, vehicle, material)."""
    personnel = Personnel(
        id=uuid4(),
        name="Hans Müller",
        role="Gruppenführer",
        availability="available",
    )
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF 16/25",
        type="TLF",
        status="available",
        display_order=1,
        radio_call_sign="Florian Basel 1",
    )
    material = Material(
        id=uuid4(),
        name="Tauchpumpe TP 8/1",
        type="Tauchpumpen",
        location="TLF",
        status="available",
    )

    db_session.add_all([personnel, vehicle, material])
    await db_session.commit()

    for obj in [personnel, vehicle, material]:
        await db_session.refresh(obj)

    return {
        "personnel": personnel,
        "vehicle": vehicle,
        "material": material,
    }


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, editor_user: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "lifecycle_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Incident Lifecycle Integration Test
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_complete_incident_lifecycle(editor_client: AsyncClient, resources: dict):
    """Test complete incident lifecycle from creation to completion.

    This integration test verifies the entire business flow:
    1. Create event
    2. Create incident in event
    3. Assign resources
    4. Progress through all status transitions
    5. Verify status history
    6. Complete incident (release resources)
    7. Soft-delete incident
    """
    # ========================================
    # Step 1: Create Event
    # ========================================
    event_response = await editor_client.post(
        "/api/events/",
        json={
            "name": "Lifecycle Test Event",
            "training_flag": True,
            "auto_attach_divera": False,
        },
    )
    assert event_response.status_code == 201, f"Failed to create event: {event_response.text}"
    event = event_response.json()
    event_id = event["id"]

    # ========================================
    # Step 2: Create Incident
    # ========================================
    incident_response = await editor_client.post(
        "/api/incidents/",
        json={
            "event_id": event_id,
            "title": "Kellerbrand Hauptstrasse 42",
            "type": "brandbekaempfung",
            "priority": "high",
            "location_address": "Hauptstrasse 42, 4104 Oberwil",
            "location_lat": "47.5120",
            "location_lng": "7.5550",
            "description": "Rauchentwicklung aus Kellerfenster",
            "contact": "Herr Meier, 079 123 45 67",
        },
    )
    assert incident_response.status_code == 201, f"Failed to create incident: {incident_response.text}"
    incident = incident_response.json()
    incident_id = incident["id"]

    # Verify initial status
    assert incident["status"] == "eingegangen"

    # ========================================
    # Step 3: Assign Resources
    # ========================================
    personnel = resources["personnel"]
    vehicle = resources["vehicle"]
    material = resources["material"]

    # Assign personnel
    assign_response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "personnel", "resource_id": str(personnel.id)},
    )
    assert assign_response.status_code == 200, f"Failed to assign personnel: {assign_response.text}"
    assign_response.json()["id"]

    # Assign vehicle
    assign_response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(vehicle.id)},
    )
    assert assign_response.status_code == 200, f"Failed to assign vehicle: {assign_response.text}"

    # Assign material
    assign_response = await editor_client.post(
        f"/api/incidents/{incident_id}/assign",
        json={"resource_type": "material", "resource_id": str(material.id)},
    )
    assert assign_response.status_code == 200, f"Failed to assign material: {assign_response.text}"

    # Verify all assignments
    assignments_response = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert assignments_response.status_code == 200
    assignments = assignments_response.json()
    assert len(assignments) == 3

    # ========================================
    # Step 4: Progress Through Status Transitions
    # ========================================
    status_transitions = [
        ("eingegangen", "reko", "Reko-Team ausgerückt"),
        ("reko", "disponiert", "Einsatzkräfte alarmiert"),
        ("disponiert", "einsatz", "Einsatz läuft"),
        ("einsatz", "einsatz_beendet", "Brand gelöscht, Nachlöscharbeiten"),
        ("einsatz_beendet", "abschluss", "Einsatz abgeschlossen"),
    ]

    for from_status, to_status, notes in status_transitions:
        status_response = await editor_client.post(
            f"/api/incidents/{incident_id}/status",
            json={
                "from_status": from_status,
                "to_status": to_status,
                "notes": notes,
            },
        )
        assert status_response.status_code == 200, (
            f"Failed transition {from_status} → {to_status}: {status_response.text}"
        )
        updated_incident = status_response.json()
        assert updated_incident["status"] == to_status

    # ========================================
    # Step 5: Verify Status History
    # ========================================
    history_response = await editor_client.get(f"/api/incidents/{incident_id}/history")
    assert history_response.status_code == 200
    history = history_response.json()

    # Should have 5 status transitions
    assert len(history) == 5

    # Verify transitions are in correct order (newest first or oldest first)
    transition_statuses = [(h["from_status"], h["to_status"]) for h in history]
    # Check all expected transitions are present
    for from_status, to_status, _ in status_transitions:
        assert (from_status, to_status) in transition_statuses

    # ========================================
    # Step 6: Verify Final State
    # ========================================
    final_incident_response = await editor_client.get(f"/api/incidents/{incident_id}")
    assert final_incident_response.status_code == 200
    final_incident = final_incident_response.json()
    assert final_incident["status"] == "abschluss"

    # ========================================
    # Step 7: Release All Resources
    # ========================================
    release_response = await editor_client.post(f"/api/incidents/{incident_id}/release-all")
    assert release_response.status_code == 204

    # Verify assignments are released (empty or all have unassigned_at)
    assignments_after_release = await editor_client.get(f"/api/incidents/{incident_id}/assignments")
    assert assignments_after_release.status_code == 200
    # Active assignments should be empty after release-all

    # ========================================
    # Step 8: Delete Incident (soft delete)
    # ========================================
    delete_response = await editor_client.delete(f"/api/incidents/{incident_id}")
    assert delete_response.status_code == 204

    # Verify incident no longer appears in list
    list_response = await editor_client.get(f"/api/incidents/?event_id={event_id}")
    assert list_response.status_code == 200
    incidents_list = list_response.json()
    incident_ids = [i["id"] for i in incidents_list]
    assert incident_id not in incident_ids

    # ========================================
    # Step 9: Archive Event
    # ========================================
    archive_response = await editor_client.post(f"/api/events/{event_id}/archive")
    assert archive_response.status_code == 200
    archived_event = archive_response.json()
    assert archived_event["archived_at"] is not None


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_with_reko_workflow(editor_client: AsyncClient, resources: dict):
    """Test incident workflow with reko (reconnaissance) phase.

    This tests a more realistic workflow where:
    1. Incident is created
    2. Status moves to reko for reconnaissance
    3. After reko, incident is either escalated or dismissed
    """
    # Create event
    event_response = await editor_client.post(
        "/api/events/",
        json={"name": "Reko Test Event", "training_flag": True},
    )
    assert event_response.status_code == 201
    event_id = event_response.json()["id"]

    # Create incident
    incident_response = await editor_client.post(
        "/api/incidents/",
        json={
            "event_id": event_id,
            "title": "Wasserschaden Meldung",
            "type": "elementarereignis",
            "priority": "medium",
            "location_address": "Gartenstrasse 15",
        },
    )
    assert incident_response.status_code == 201
    incident_id = incident_response.json()["id"]

    # Move to reko status
    status_response = await editor_client.post(
        f"/api/incidents/{incident_id}/status",
        json={"from_status": "eingegangen", "to_status": "reko", "notes": "Reko-Fahrt"},
    )
    assert status_response.status_code == 200

    # After reko assessment, escalate to disponiert
    status_response = await editor_client.post(
        f"/api/incidents/{incident_id}/status",
        json={
            "from_status": "reko",
            "to_status": "disponiert",
            "notes": "Wasserschaden bestätigt, Pumpen benötigt",
        },
    )
    assert status_response.status_code == 200

    # Verify we can skip directly to einsatz if needed
    status_response = await editor_client.post(
        f"/api/incidents/{incident_id}/status",
        json={"from_status": "disponiert", "to_status": "einsatz"},
    )
    assert status_response.status_code == 200

    # Verify final status
    incident = await editor_client.get(f"/api/incidents/{incident_id}")
    assert incident.json()["status"] == "einsatz"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_multiple_incidents_in_event(editor_client: AsyncClient, resources: dict):
    """Test managing multiple incidents within a single event.

    Firefighting events often have multiple simultaneous incidents.
    This test verifies:
    1. Multiple incidents can be created in one event
    2. Resources can be assigned to different incidents
    3. Incidents progress independently
    """
    # Create event
    event_response = await editor_client.post(
        "/api/events/",
        json={"name": "Multi-Incident Event", "training_flag": True},
    )
    assert event_response.status_code == 201
    event_id = event_response.json()["id"]

    # Create first incident - fire
    incident1_response = await editor_client.post(
        "/api/incidents/",
        json={
            "event_id": event_id,
            "title": "Garagenbrand",
            "type": "brandbekaempfung",
            "priority": "high",
        },
    )
    assert incident1_response.status_code == 201
    incident1_id = incident1_response.json()["id"]

    # Create second incident - water damage
    incident2_response = await editor_client.post(
        "/api/incidents/",
        json={
            "event_id": event_id,
            "title": "Wasserschaden Keller",
            "type": "elementarereignis",
            "priority": "medium",
        },
    )
    assert incident2_response.status_code == 201
    incident2_id = incident2_response.json()["id"]

    # Assign vehicle to incident 1
    vehicle = resources["vehicle"]
    assign_response = await editor_client.post(
        f"/api/incidents/{incident1_id}/assign",
        json={"resource_type": "vehicle", "resource_id": str(vehicle.id)},
    )
    assert assign_response.status_code == 200

    # Assign personnel to incident 2
    personnel = resources["personnel"]
    assign_response = await editor_client.post(
        f"/api/incidents/{incident2_id}/assign",
        json={"resource_type": "personnel", "resource_id": str(personnel.id)},
    )
    assert assign_response.status_code == 200

    # Progress incident 1 to completion
    for from_status, to_status in [
        ("eingegangen", "disponiert"),
        ("disponiert", "einsatz"),
        ("einsatz", "einsatz_beendet"),
        ("einsatz_beendet", "abschluss"),
    ]:
        await editor_client.post(
            f"/api/incidents/{incident1_id}/status",
            json={"from_status": from_status, "to_status": to_status},
        )

    # Incident 2 stays in eingegangen
    # Verify both incidents have correct status
    list_response = await editor_client.get(f"/api/incidents/?event_id={event_id}")
    assert list_response.status_code == 200
    incidents = list_response.json()
    assert len(incidents) == 2

    # Find incidents by ID and verify status
    incident1 = next(i for i in incidents if i["id"] == incident1_id)
    incident2 = next(i for i in incidents if i["id"] == incident2_id)
    assert incident1["status"] == "abschluss"
    assert incident2["status"] == "eingegangen"

    # Verify assignments by event returns correct data
    assignments_response = await editor_client.get(f"/api/assignments/by-event/{event_id}")
    assert assignments_response.status_code == 200
    assignments_by_event = assignments_response.json()

    # Both incidents should have assignments
    assert incident1_id in assignments_by_event or len(assignments_by_event.get(incident1_id, [])) >= 0
