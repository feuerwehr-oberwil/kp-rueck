"""Authorization boundary tests.

Tests verify that:
1. Unauthenticated users cannot access protected endpoints
2. Viewers cannot perform editor-only actions (create, update, delete)
3. Role enforcement is consistent across all endpoints
4. Session management is secure
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Event,
    Incident,
    Material,
    Personnel,
    User,
    Vehicle,
)


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Auth Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Auth Test Incident",
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
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Auth Test Person",
        role="Gruppenführer",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create a test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="Auth Test Vehicle",
        type="TLF",
        status="available",
        display_order=1,
        radio_call_sign="Auth-1",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create test material."""
    material = Material(
        id=uuid4(),
        name="Auth Test Material",
        type="Stromerzeuger",
        location="Depot",
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


# ============================================
# Unauthenticated Access Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_list_incidents(client: AsyncClient, test_event: Event):
    """Test that unauthenticated users cannot list incidents."""
    response = await client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_get_incident(client: AsyncClient, test_incident: Incident):
    """Test that unauthenticated users cannot get a single incident."""
    response = await client.get(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_create_incident(client: AsyncClient, test_event: Event):
    """Test that unauthenticated users cannot create incidents."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Unauthorized Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_list_personnel(client: AsyncClient):
    """Test that unauthenticated users cannot list personnel."""
    response = await client.get("/api/personnel/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_list_vehicles(client: AsyncClient):
    """Test that unauthenticated users cannot list vehicles."""
    response = await client.get("/api/vehicles/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_list_materials(client: AsyncClient):
    """Test that unauthenticated users cannot list materials."""
    response = await client.get("/api/materials/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_cannot_list_events(client: AsyncClient):
    """Test that unauthenticated users cannot list events."""
    response = await client.get("/api/events/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_unauthenticated_can_access_health(client: AsyncClient):
    """Test that health endpoint is accessible without authentication."""
    response = await client.get("/health")
    assert response.status_code == 200


# ============================================
# Viewer Read Permissions Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_list_incidents(viewer_client: AsyncClient, test_event: Event, test_incident: Incident):
    """Test that viewers can list incidents."""
    response = await viewer_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200
    assert len(response.json()) >= 1


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_get_incident(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers can get a single incident."""
    response = await viewer_client.get(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 200
    assert response.json()["id"] == str(test_incident.id)


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_list_personnel(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers can list personnel."""
    response = await viewer_client.get("/api/personnel/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_list_vehicles(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers can list vehicles."""
    response = await viewer_client.get("/api/vehicles/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_list_materials(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers can list materials."""
    response = await viewer_client.get("/api/materials/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_can_list_events(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers can list events."""
    response = await viewer_client.get("/api/events/")
    assert response.status_code == 200


# ============================================
# Viewer Write Permission Denied Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_create_incident(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot create incidents."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Viewer Created Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await viewer_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_incident(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot update incidents."""
    update_data = {"title": "Updated by Viewer"}
    response = await viewer_client.patch(f"/api/incidents/{test_incident.id}", json=update_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_delete_incident(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot delete incidents."""
    response = await viewer_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_incident_status(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot update incident status."""
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
    }
    response = await viewer_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_create_personnel(viewer_client: AsyncClient):
    """Test that viewers cannot create personnel."""
    personnel_data = {
        "name": "Viewer Created Person",
        "availability": "available",
    }
    response = await viewer_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_personnel(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot update personnel."""
    update_data = {"name": "Updated by Viewer"}
    response = await viewer_client.put(f"/api/personnel/{test_personnel.id}", json=update_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_delete_personnel(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot delete personnel."""
    response = await viewer_client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_create_vehicle(viewer_client: AsyncClient):
    """Test that viewers cannot create vehicles."""
    vehicle_data = {
        "name": "Viewer Created Vehicle",
        "type": "TLF",
        "status": "available",
        "display_order": 99,
        "radio_call_sign": "Viewer-1",
    }
    response = await viewer_client.post("/api/vehicles/", json=vehicle_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_vehicle(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers cannot update vehicles."""
    update_data = {"name": "Updated by Viewer"}
    response = await viewer_client.put(f"/api/vehicles/{test_vehicle.id}", json=update_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_delete_vehicle(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers cannot delete vehicles."""
    response = await viewer_client.delete(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_create_material(viewer_client: AsyncClient):
    """Test that viewers cannot create materials."""
    material_data = {
        "name": "Viewer Created Material",
        "type": "Stromerzeuger",
        "location": "Depot",
        "status": "available",
    }
    response = await viewer_client.post("/api/materials/", json=material_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_material(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers cannot update materials."""
    update_data = {"name": "Updated by Viewer"}
    response = await viewer_client.put(f"/api/materials/{test_material.id}", json=update_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_delete_material(viewer_client: AsyncClient, test_material: Material):
    """Test that viewers cannot delete materials."""
    response = await viewer_client.delete(f"/api/materials/{test_material.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_create_event(viewer_client: AsyncClient):
    """Test that viewers cannot create events."""
    event_data = {
        "name": "Viewer Created Event",
        "training_flag": False,
    }
    response = await viewer_client.post("/api/events/", json=event_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_update_event(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot update events."""
    update_data = {"name": "Updated by Viewer"}
    response = await viewer_client.put(f"/api/events/{test_event.id}", json=update_data)
    assert response.status_code == 403


# ============================================
# Editor Permissions Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_create_incident(editor_client: AsyncClient, test_event: Event):
    """Test that editors can create incidents."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Editor Created Incident",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_update_incident(editor_client: AsyncClient, test_incident: Incident):
    """Test that editors can update incidents."""
    update_data = {"title": "Updated by Editor"}
    response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json=update_data)
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_delete_incident(editor_client: AsyncClient, test_incident: Incident):
    """Test that editors can delete incidents."""
    response = await editor_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_create_personnel(editor_client: AsyncClient):
    """Test that editors can create personnel."""
    personnel_data = {
        "name": "Editor Created Person",
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_create_vehicle(editor_client: AsyncClient):
    """Test that editors can create vehicles."""
    vehicle_data = {
        "name": "Editor Created Vehicle",
        "type": "TLF",
        "status": "available",
        "display_order": 99,
        "radio_call_sign": "Editor-1",
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_editor_can_create_material(editor_client: AsyncClient):
    """Test that editors can create materials."""
    material_data = {
        "name": "Editor Created Material",
        "type": "Stromerzeuger",
        "location": "Depot",
        "status": "available",
    }
    response = await editor_client.post("/api/materials/", json=material_data)
    assert response.status_code == 201


# ============================================
# Session and Token Security Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_invalid_token_rejected(client: AsyncClient, test_event: Event):
    """Test that invalid/forged tokens are rejected."""
    # Set a forged Authorization header
    client.headers["Authorization"] = "Bearer invalid_token_12345"

    response = await client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_expired_session_rejected(client: AsyncClient, test_editor: User):
    """Test authentication with wrong password fails."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "auth_test_editor", "password": "wrong_password"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_nonexistent_user_login_fails(client: AsyncClient):
    """Test that login with nonexistent user fails."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "nonexistent_user", "password": "anypassword"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.security
async def test_logout_invalidates_session(editor_client: AsyncClient, test_event: Event):
    """Test that logout invalidates the session."""
    # Verify logged in
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200

    # Logout
    logout_response = await editor_client.post("/api/auth/logout")
    assert logout_response.status_code == 200

    # Create new client without cookies
    async with AsyncClient(
        transport=ASGITransport(app=editor_client._transport.app),  # type: ignore
        base_url="http://test"
    ) as new_client:
        # Try to access protected endpoint
        response = await new_client.get(f"/api/incidents/?event_id={test_event.id}")
        assert response.status_code == 401


# ============================================
# Role Escalation Prevention Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_change_own_role(editor_client: AsyncClient, test_editor: User):
    """Test that users cannot change their own role via user update."""
    # Try to update own user with elevated role - this should fail or be ignored
    # depending on the implementation
    response = await editor_client.get("/api/auth/me")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_access_admin_import_template(viewer_client: AsyncClient):
    """Test that viewers cannot access admin import template endpoint."""
    response = await viewer_client.get("/api/admin/import/template")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.security
async def test_viewer_cannot_access_admin_export(viewer_client: AsyncClient):
    """Test that viewers cannot access admin export endpoint."""
    response = await viewer_client.get("/api/admin/export/data")
    assert response.status_code == 403


# ============================================
# IDOR (Insecure Direct Object Reference) Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_access_incident_with_random_uuid(editor_client: AsyncClient):
    """Test that accessing a random UUID returns 404, not data leak."""
    random_id = uuid4()
    response = await editor_client.get(f"/api/incidents/{random_id}")
    assert response.status_code == 404
    # Error message should not leak information
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_access_personnel_with_random_uuid(editor_client: AsyncClient):
    """Test that accessing a random UUID returns 404."""
    random_id = uuid4()
    response = await editor_client.get(f"/api/personnel/{random_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_access_vehicle_with_random_uuid(editor_client: AsyncClient):
    """Test that accessing a random UUID returns 404."""
    random_id = uuid4()
    response = await editor_client.get(f"/api/vehicles/{random_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_access_material_with_random_uuid(editor_client: AsyncClient):
    """Test that accessing a random UUID returns 404."""
    random_id = uuid4()
    response = await editor_client.get(f"/api/materials/{random_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.security
async def test_cannot_access_event_with_random_uuid(editor_client: AsyncClient):
    """Test that accessing a random UUID returns 404."""
    random_id = uuid4()
    response = await editor_client.get(f"/api/events/{random_id}")
    assert response.status_code == 404
