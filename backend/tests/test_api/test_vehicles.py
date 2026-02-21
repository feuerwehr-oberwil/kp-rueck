"""Tests for Vehicle API endpoints.

Tests cover:
- Vehicle CRUD operations (create, read, update, delete)
- Vehicle listing
- Display order updates
- Permission enforcement (editor vs viewer)
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, Vehicle

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create a test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF 16/25",
        type="TLF",
        status="available",
        display_order=1,
        radio_call_sign="Florian Basel 1",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


# ============================================
# List Vehicles Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_vehicles_requires_auth(client: AsyncClient):
    """Test that listing vehicles requires authentication."""
    response = await client.get("/api/vehicles/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_vehicles_empty(editor_client: AsyncClient):
    """Test listing vehicles when none exist."""
    response = await editor_client.get("/api/vehicles/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_vehicles_success(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test listing vehicles successfully."""
    response = await editor_client.get("/api/vehicles/")
    assert response.status_code == 200
    vehicles = response.json()
    assert len(vehicles) == 1
    assert vehicles[0]["id"] == str(test_vehicle.id)
    assert vehicles[0]["name"] == test_vehicle.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_vehicles_viewer_can_read(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers can list vehicles."""
    response = await viewer_client.get("/api/vehicles/")
    assert response.status_code == 200
    assert len(response.json()) == 1


# ============================================
# Get Vehicle Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_requires_auth(client: AsyncClient, test_vehicle: Vehicle):
    """Test that getting vehicle requires authentication."""
    response = await client.get(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_success(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test getting a single vehicle."""
    response = await editor_client.get(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_vehicle.id)
    assert data["name"] == test_vehicle.name
    assert data["type"] == test_vehicle.type
    assert data["status"] == test_vehicle.status
    assert data["radio_call_sign"] == test_vehicle.radio_call_sign


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_not_found(editor_client: AsyncClient):
    """Test getting a non-existent vehicle."""
    response = await editor_client.get(f"/api/vehicles/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_viewer_can_read(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers can get vehicle details."""
    response = await viewer_client.get(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 200


# ============================================
# Create Vehicle Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_vehicle_requires_auth(client: AsyncClient):
    """Test that creating vehicle requires authentication."""
    response = await client.post("/api/vehicles/", json={"name": "New Vehicle"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_vehicle_success(editor_client: AsyncClient):
    """Test creating a vehicle successfully."""
    vehicle_data = {
        "name": "DLK 23-12",
        "type": "DLK",
        "status": "available",
        "display_order": 2,
        "radio_call_sign": "Florian Basel 2",
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "DLK 23-12"
    assert data["type"] == "DLK"
    assert data["status"] == "available"
    assert data["radio_call_sign"] == "Florian Basel 2"
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_vehicle_core_fields(editor_client: AsyncClient):
    """Test creating vehicle - verifies core fields are saved."""
    response = await editor_client.post(
        "/api/vehicles/",
        json={
            "name": "Basic Vehicle",
            "type": "MTW",
            "display_order": 5,
            "status": "available",
            "radio_call_sign": "Florian Test 1",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Basic Vehicle"
    assert data["type"] == "MTW"
    assert data["status"] == "available"


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_vehicle_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot create vehicles."""
    response = await viewer_client.post(
        "/api/vehicles/",
        json={"name": "New Vehicle", "display_order": 1},
    )
    assert response.status_code == 403


# ============================================
# Update Vehicle Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_vehicle_requires_auth(client: AsyncClient, test_vehicle: Vehicle):
    """Test that updating vehicle requires authentication."""
    response = await client.put(f"/api/vehicles/{test_vehicle.id}", json={"name": "Updated"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_vehicle_success(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test updating a vehicle successfully."""
    update_data = {
        "name": "Updated TLF 16/25",
        "status": "unavailable",
    }
    response = await editor_client.put(f"/api/vehicles/{test_vehicle.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated TLF 16/25"
    assert data["status"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_vehicle_partial(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test partial update of vehicle."""
    response = await editor_client.put(
        f"/api/vehicles/{test_vehicle.id}",
        json={"status": "unavailable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == test_vehicle.name  # Unchanged
    assert data["status"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_vehicle_not_found(editor_client: AsyncClient):
    """Test updating a non-existent vehicle."""
    response = await editor_client.put(f"/api/vehicles/{uuid4()}", json={"name": "Updated"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_vehicle_viewer_forbidden(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers cannot update vehicles."""
    response = await viewer_client.put(f"/api/vehicles/{test_vehicle.id}", json={"name": "Updated"})
    assert response.status_code == 403


# ============================================
# Delete Vehicle Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_vehicle_requires_auth(client: AsyncClient, test_vehicle: Vehicle):
    """Test that deleting vehicle requires authentication."""
    response = await client.delete(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_vehicle_success(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test deleting a vehicle successfully (soft delete)."""
    response = await editor_client.delete(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_vehicle_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent vehicle."""
    response = await editor_client.delete(f"/api/vehicles/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_vehicle_viewer_forbidden(viewer_client: AsyncClient, test_vehicle: Vehicle):
    """Test that viewers cannot delete vehicles."""
    response = await viewer_client.delete(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 403


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_response_structure(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test that vehicle response contains all expected fields."""
    response = await editor_client.get(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = ["id", "name", "type", "status", "display_order", "radio_call_sign"]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


# ============================================
# Vehicle Status Endpoint Tests
# ============================================


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> "Event":
    """Create a test event."""
    from app.models import Event

    event = Event(
        id=uuid4(),
        name="Vehicle Status Test Event",
        training_flag=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident_for_vehicle(
    db_session: AsyncSession, test_event: "Event", test_editor: User
) -> "Incident":
    """Create a test incident."""
    from app.models import Incident

    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Vehicle Test Incident",
        type="brandbekaempfung",
        priority="medium",
        status="einsatz",
        location_address="Hauptstrasse 123",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_personnel_driver(db_session: AsyncSession) -> "Personnel":
    """Create a test personnel for driver tests."""
    from app.models import Personnel

    personnel = Personnel(
        id=uuid4(),
        name="Hans Driver",
        role="Maschinist",
        availability="available",
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


@pytest_asyncio.fixture
async def vehicle_with_driver(
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_event: "Event",
    test_personnel_driver: "Personnel",
) -> Vehicle:
    """Create driver assignment for vehicle."""
    from datetime import datetime, UTC

    from app.models import EventSpecialFunction

    driver_assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=test_event.id,
        vehicle_id=test_vehicle.id,
        personnel_id=test_personnel_driver.id,
        function_type="driver",
        assigned_at=datetime.now(UTC),
    )
    db_session.add(driver_assignment)
    await db_session.commit()
    return test_vehicle


@pytest_asyncio.fixture
async def vehicle_with_incident_assignment(
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_incident_for_vehicle: "Incident",
) -> Vehicle:
    """Create incident assignment for vehicle."""
    from datetime import datetime, UTC, timedelta

    from app.models import IncidentAssignment

    # Assign vehicle to incident 30 minutes ago
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident_for_vehicle.id,
        resource_type="vehicle",
        resource_id=test_vehicle.id,
        assigned_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(assignment)
    await db_session.commit()
    return test_vehicle


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_requires_auth(client: AsyncClient, test_vehicle: Vehicle):
    """Test that vehicle status endpoint requires authentication."""
    response = await client.get(f"/api/vehicles/{test_vehicle.id}/status?event_id={uuid4()}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_requires_event_id(
    editor_client: AsyncClient, test_vehicle: Vehicle
):
    """Test that vehicle status endpoint requires event_id parameter."""
    response = await editor_client.get(f"/api/vehicles/{test_vehicle.id}/status")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_not_found(editor_client: AsyncClient, test_event: "Event"):
    """Test getting status for non-existent vehicle."""
    response = await editor_client.get(f"/api/vehicles/{uuid4()}/status?event_id={test_event.id}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_no_assignments(
    editor_client: AsyncClient, test_vehicle: Vehicle, test_event: "Event"
):
    """Test getting status for vehicle with no driver or incident assignment."""
    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    # Basic vehicle info should be present
    assert data["id"] == str(test_vehicle.id)
    assert data["name"] == test_vehicle.name
    assert data["type"] == test_vehicle.type
    assert data["status"] == test_vehicle.status
    assert data["radio_call_sign"] == test_vehicle.radio_call_sign

    # No driver assignment
    assert data["driver_id"] is None
    assert data["driver_name"] is None
    assert data["driver_assigned_at"] is None

    # No incident assignment
    assert data["incident_id"] is None
    assert data["incident_title"] is None
    assert data["assignment_duration_minutes"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_with_driver(
    editor_client: AsyncClient,
    vehicle_with_driver: Vehicle,
    test_event: "Event",
    test_personnel_driver: "Personnel",
):
    """Test getting status for vehicle with driver assigned."""
    response = await editor_client.get(
        f"/api/vehicles/{vehicle_with_driver.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    # Driver should be present
    assert data["driver_id"] == str(test_personnel_driver.id)
    assert data["driver_name"] == test_personnel_driver.name
    assert data["driver_assigned_at"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_with_incident(
    editor_client: AsyncClient,
    vehicle_with_incident_assignment: Vehicle,
    test_event: "Event",
    test_incident_for_vehicle: "Incident",
):
    """Test getting status for vehicle with incident assignment."""
    response = await editor_client.get(
        f"/api/vehicles/{vehicle_with_incident_assignment.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    # Incident assignment should be present
    assert data["incident_id"] == str(test_incident_for_vehicle.id)
    assert data["incident_title"] == test_incident_for_vehicle.title
    assert data["incident_location_address"] == test_incident_for_vehicle.location_address
    assert data["incident_status"] == test_incident_for_vehicle.status
    assert data["incident_assigned_at"] is not None
    # Duration should be approximately 30 minutes
    assert data["assignment_duration_minutes"] is not None
    assert 29 <= data["assignment_duration_minutes"] <= 31


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_with_both_driver_and_incident(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_event: "Event",
    test_personnel_driver: "Personnel",
    test_incident_for_vehicle: "Incident",
):
    """Test getting status for vehicle with both driver and incident assignment."""
    from datetime import datetime, UTC

    from app.models import EventSpecialFunction, IncidentAssignment

    # Create driver assignment
    driver_assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=test_event.id,
        vehicle_id=test_vehicle.id,
        personnel_id=test_personnel_driver.id,
        function_type="driver",
        assigned_at=datetime.now(UTC),
    )
    db_session.add(driver_assignment)

    # Create incident assignment
    incident_assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident_for_vehicle.id,
        resource_type="vehicle",
        resource_id=test_vehicle.id,
        assigned_at=datetime.now(UTC),
    )
    db_session.add(incident_assignment)
    await db_session.commit()

    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    # Both should be present
    assert data["driver_id"] == str(test_personnel_driver.id)
    assert data["incident_id"] == str(test_incident_for_vehicle.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_ignores_other_event(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_personnel_driver: "Personnel",
):
    """Test that vehicle status only shows assignments for the specified event."""
    from datetime import datetime, UTC

    from app.models import Event, EventSpecialFunction

    # Create two events
    event1 = Event(id=uuid4(), name="Event 1", training_flag=False)
    event2 = Event(id=uuid4(), name="Event 2", training_flag=False)
    db_session.add(event1)
    db_session.add(event2)
    await db_session.commit()

    # Assign driver to event1 only
    driver_assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=event1.id,
        vehicle_id=test_vehicle.id,
        personnel_id=test_personnel_driver.id,
        function_type="driver",
        assigned_at=datetime.now(UTC),
    )
    db_session.add(driver_assignment)
    await db_session.commit()

    # Query for event2 - should not see the driver
    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={event2.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["driver_id"] is None

    # Query for event1 - should see the driver
    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={event1.id}"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["driver_id"] == str(test_personnel_driver.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_ignores_unassigned(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_event: "Event",
    test_incident_for_vehicle: "Incident",
):
    """Test that vehicle status ignores unassigned (completed) incident assignments."""
    from datetime import datetime, UTC, timedelta

    from app.models import IncidentAssignment

    # Create completed assignment (has unassigned_at)
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident_for_vehicle.id,
        resource_type="vehicle",
        resource_id=test_vehicle.id,
        assigned_at=datetime.now(UTC) - timedelta(hours=1),
        unassigned_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(assignment)
    await db_session.commit()

    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    # Should not see the completed assignment
    assert data["incident_id"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_vehicle_status_viewer_can_access(
    viewer_client: AsyncClient, test_vehicle: Vehicle, test_event: "Event"
):
    """Test that viewers can access vehicle status."""
    response = await viewer_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200


# ============================================
# Vehicle Status Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_status_response_structure(
    editor_client: AsyncClient, test_vehicle: Vehicle, test_event: "Event"
):
    """Test that vehicle status response contains all expected fields."""
    response = await editor_client.get(
        f"/api/vehicles/{test_vehicle.id}/status?event_id={test_event.id}"
    )
    assert response.status_code == 200
    data = response.json()

    expected_fields = [
        "id",
        "name",
        "type",
        "status",
        "radio_call_sign",
        "driver_id",
        "driver_name",
        "driver_assigned_at",
        "incident_id",
        "incident_title",
        "incident_location_address",
        "incident_status",
        "incident_assigned_at",
        "assignment_duration_minutes",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"
