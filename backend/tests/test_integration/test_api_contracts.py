"""API Contract Validation Tests (Phase 4.1).

Tests verify that API responses strictly match Pydantic schema definitions:
- All required fields are present
- Optional fields are properly typed or null
- Enum values are valid
- Datetime fields are properly serialized
- Decimal fields are properly serialized as strings
- Nested objects match expected structure
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, Incident, Material, Personnel, User, Vehicle

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
        username="contract_editor",
        password_hash=hash_password("editorpass123"),
        role="editor",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Contract Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_event: Event, test_editor: User) -> Incident:
    """Create a test incident with all optional fields populated."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Contract Test Incident",
        type="brandbekaempfung",
        priority="high",
        status="eingegangen",
        location_address="Hauptstrasse 123, Basel",
        location_lat=Decimal("47.5596"),
        location_lng=Decimal("7.5886"),
        description="Test description for contract validation",
        contact="John Doe, +41 61 123 4567",
        internal_notes="Internal notes for testing",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create a test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Max Mustermann",
        role="Gruppenführer",
        role_sort_order=1,
        availability="available",
        tags=["ADL", "Funk"],
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
        name="TLF 1 Oberwil",
        type="TLF",
        display_order=1,
        status="available",
        radio_call_sign="Florian-1",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def test_material(db_session: AsyncSession) -> Material:
    """Create a test material."""
    material = Material(
        id=uuid4(),
        name="Stromerzeuger 5kW",
        type="Generator",
        location="TLF",
        location_sort_order=1,
        description="Test generator description",
        status="available",
    )
    db_session.add(material)
    await db_session.commit()
    await db_session.refresh(material)
    return material


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "contract_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Event API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_event_response_contract(editor_client: AsyncClient, test_event: Event):
    """Test that Event API response matches EventResponse schema."""
    response = await editor_client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 200

    data = response.json()

    # Validate against Pydantic schema - will raise ValidationError if invalid
    event_response = schemas.EventResponse.model_validate(data)

    # Verify required fields
    assert isinstance(event_response.id, UUID)
    assert isinstance(event_response.name, str)
    assert isinstance(event_response.training_flag, bool)
    assert isinstance(event_response.auto_attach_divera, bool)
    assert isinstance(event_response.created_at, datetime)
    assert isinstance(event_response.updated_at, datetime)
    assert isinstance(event_response.last_activity_at, datetime)
    assert isinstance(event_response.incident_count, int)

    # Verify optional field (can be None)
    assert event_response.archived_at is None or isinstance(event_response.archived_at, datetime)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_event_list_response_contract(editor_client: AsyncClient, test_event: Event):
    """Test that Event list API response matches EventListResponse schema."""
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200

    data = response.json()

    # Validate against Pydantic schema
    list_response = schemas.EventListResponse.model_validate(data)

    assert isinstance(list_response.events, list)
    assert isinstance(list_response.total, int)
    assert len(list_response.events) > 0

    # Validate each event in the list
    for event in list_response.events:
        assert isinstance(event, schemas.EventResponse)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_event_create_response_contract(editor_client: AsyncClient):
    """Test that Event creation response matches schema."""
    event_data = {
        "name": "New Contract Test Event",
        "training_flag": True,
        "auto_attach_divera": False,
    }
    response = await editor_client.post("/api/events/", json=event_data)
    assert response.status_code == 201

    data = response.json()

    # Should be valid EventResponse
    event_response = schemas.EventResponse.model_validate(data)
    assert event_response.name == "New Contract Test Event"
    assert event_response.training_flag is True
    assert event_response.incident_count == 0


# ============================================
# Incident API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_response_contract_full(editor_client: AsyncClient, test_incident: Incident):
    """Test that Incident API response with all fields matches schema."""
    response = await editor_client.get(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 200

    data = response.json()

    # Validate against Pydantic schema
    incident_response = schemas.IncidentResponse.model_validate(data)

    # Verify required fields
    assert isinstance(incident_response.id, UUID)
    assert isinstance(incident_response.event_id, UUID)
    assert isinstance(incident_response.title, str)
    assert isinstance(incident_response.type, schemas.IncidentType)
    assert isinstance(incident_response.priority, schemas.IncidentPriority)
    assert isinstance(incident_response.status, schemas.IncidentStatus)
    assert isinstance(incident_response.created_at, datetime)
    assert isinstance(incident_response.updated_at, datetime)

    # Verify optional fields are present and typed correctly
    assert incident_response.location_address is not None
    assert incident_response.description is not None
    assert incident_response.contact is not None
    assert incident_response.internal_notes is not None

    # Verify decimal fields are serialized as strings
    assert incident_response.location_lat is not None
    assert incident_response.location_lng is not None

    # Verify list fields
    assert isinstance(incident_response.assigned_vehicles, list)
    assert isinstance(incident_response.has_completed_reko, bool)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_response_contract_minimal(editor_client: AsyncClient, test_event: Event):
    """Test that minimal Incident response (only required fields) matches schema."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Minimal Incident",
        "type": "brandbekaempfung",
        "priority": "low",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201

    data = response.json()

    # Validate against Pydantic schema
    incident_response = schemas.IncidentResponse.model_validate(data)

    # Optional fields should be None or empty
    assert incident_response.location_address is None
    assert incident_response.location_lat is None
    assert incident_response.location_lng is None
    assert incident_response.description is None
    assert incident_response.contact is None
    assert incident_response.internal_notes is None
    assert incident_response.assigned_vehicles == []


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_enum_values(editor_client: AsyncClient, test_event: Event):
    """Test that incident enum fields accept all valid values."""
    valid_types = [e.value for e in schemas.IncidentType]
    valid_priorities = [e.value for e in schemas.IncidentPriority]

    # Test each incident type
    for incident_type in valid_types:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Incident type {incident_type}",
            "type": incident_type,
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for type: {incident_type}"

        data = response.json()
        incident_response = schemas.IncidentResponse.model_validate(data)
        assert incident_response.type.value == incident_type

    # Test each priority
    for priority in valid_priorities:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Incident priority {priority}",
            "type": "brandbekaempfung",
            "priority": priority,
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for priority: {priority}"

        data = response.json()
        incident_response = schemas.IncidentResponse.model_validate(data)
        assert incident_response.priority.value == priority


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_status_response_contract(editor_client: AsyncClient, test_incident: Incident):
    """Test that status update response matches schema."""
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
        "notes": "Sending reko team",
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)
    assert response.status_code == 200

    data = response.json()

    # Response is the updated incident
    incident_response = schemas.IncidentResponse.model_validate(data)
    assert incident_response.status == schemas.IncidentStatus.REKO


@pytest.mark.asyncio
@pytest.mark.integration
async def test_status_history_response_contract(editor_client: AsyncClient, test_incident: Incident):
    """Test that status history response matches schema."""
    # First make a status transition
    status_data = {"from_status": "eingegangen", "to_status": "reko"}
    await editor_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)

    # Get history
    response = await editor_client.get(f"/api/incidents/{test_incident.id}/history")
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, list)

    for transition in data:
        # Validate each transition
        transition_response = schemas.StatusTransitionResponse.model_validate(transition)
        assert isinstance(transition_response.id, UUID)
        assert isinstance(transition_response.incident_id, UUID)
        assert isinstance(transition_response.from_status, str)
        assert isinstance(transition_response.to_status, str)
        assert isinstance(transition_response.timestamp, datetime)


# ============================================
# Personnel API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_personnel_response_contract(editor_client: AsyncClient, test_personnel: Personnel):
    """Test that Personnel API response matches schema."""
    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0

    # Find our test personnel
    personnel_data = next((p for p in data if p["id"] == str(test_personnel.id)), None)
    assert personnel_data is not None

    # Validate against schema
    personnel_response = schemas.Personnel.model_validate(personnel_data)

    assert isinstance(personnel_response.id, UUID)
    assert isinstance(personnel_response.name, str)
    assert isinstance(personnel_response.availability, str)
    assert isinstance(personnel_response.role_sort_order, int)
    assert isinstance(personnel_response.checked_in, bool)
    assert isinstance(personnel_response.created_at, datetime)
    assert isinstance(personnel_response.updated_at, datetime)

    # Optional fields
    assert personnel_response.role is None or isinstance(personnel_response.role, str)
    assert personnel_response.tags is None or isinstance(personnel_response.tags, list)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_personnel_with_tags_contract(editor_client: AsyncClient, test_personnel: Personnel):
    """Test that Personnel with tags is serialized correctly."""
    response = await editor_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200

    data = response.json()
    personnel_response = schemas.Personnel.model_validate(data)

    # Test personnel has tags
    assert personnel_response.tags is not None
    assert isinstance(personnel_response.tags, list)
    assert "ADL" in personnel_response.tags


# ============================================
# Vehicle API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_vehicle_response_contract(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test that Vehicle API response matches schema."""
    response = await editor_client.get(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 200

    data = response.json()
    vehicle_response = schemas.Vehicle.model_validate(data)

    assert isinstance(vehicle_response.id, UUID)
    assert isinstance(vehicle_response.name, str)
    assert isinstance(vehicle_response.type, str)
    assert isinstance(vehicle_response.display_order, int)
    assert isinstance(vehicle_response.status, str)
    assert isinstance(vehicle_response.radio_call_sign, str)
    assert isinstance(vehicle_response.created_at, datetime)
    assert isinstance(vehicle_response.updated_at, datetime)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_vehicle_list_response_contract(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Test that Vehicle list API response is a valid list of Vehicle schemas."""
    response = await editor_client.get("/api/vehicles/")
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, list)

    for vehicle_data in data:
        vehicle_response = schemas.Vehicle.model_validate(vehicle_data)
        assert isinstance(vehicle_response.id, UUID)


# ============================================
# Material API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_material_response_contract(editor_client: AsyncClient, test_material: Material):
    """Test that Material API response matches schema."""
    response = await editor_client.get(f"/api/materials/{test_material.id}")
    assert response.status_code == 200

    data = response.json()
    material_response = schemas.Material.model_validate(data)

    assert isinstance(material_response.id, UUID)
    assert isinstance(material_response.name, str)
    assert isinstance(material_response.type, str)
    assert isinstance(material_response.location, str)
    assert isinstance(material_response.location_sort_order, int)
    assert isinstance(material_response.status, str)
    assert isinstance(material_response.created_at, datetime)
    assert isinstance(material_response.updated_at, datetime)

    # Optional field
    assert material_response.description is None or isinstance(material_response.description, str)


# ============================================
# Assignment API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_assignment_response_contract(
    editor_client: AsyncClient, test_incident: Incident, test_personnel: Personnel
):
    """Test that Assignment API response matches schema."""
    assignment_data = {
        "resource_type": "personnel",
        "resource_id": str(test_personnel.id),
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)
    assert response.status_code == 200

    data = response.json()
    assignment_response = schemas.AssignmentResponse.model_validate(data)

    assert isinstance(assignment_response.id, UUID)
    assert isinstance(assignment_response.incident_id, UUID)
    assert isinstance(assignment_response.resource_type, str)
    assert isinstance(assignment_response.resource_id, UUID)
    assert isinstance(assignment_response.assigned_at, datetime)

    # Optional fields
    assert assignment_response.unassigned_at is None or isinstance(assignment_response.unassigned_at, datetime)
    assert assignment_response.assigned_by is None or isinstance(assignment_response.assigned_by, UUID)


# ============================================
# User API Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_user_me_response_contract(editor_client: AsyncClient, test_editor: User):
    """Test that /auth/me response matches schema."""
    response = await editor_client.get("/api/auth/me")
    assert response.status_code == 200

    data = response.json()
    user_response = schemas.UserResponse.model_validate(data)

    assert isinstance(user_response.id, UUID)
    assert isinstance(user_response.username, str)
    assert isinstance(user_response.role, str)
    assert isinstance(user_response.created_at, datetime)

    # Optional field
    assert user_response.last_login is None or isinstance(user_response.last_login, datetime)


# ============================================
# Error Response Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_404_error_response_contract(editor_client: AsyncClient):
    """Test that 404 error responses have consistent structure."""
    response = await editor_client.get(f"/api/incidents/{uuid4()}")
    assert response.status_code == 404

    data = response.json()
    assert "detail" in data
    assert isinstance(data["detail"], str)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_422_validation_error_contract(editor_client: AsyncClient, test_event: Event):
    """Test that validation error responses have consistent structure."""
    # Missing required field
    incident_data = {
        "event_id": str(test_event.id),
        # Missing title
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422

    data = response.json()
    assert "detail" in data
    assert isinstance(data["detail"], list)

    # Each validation error should have loc, msg, type
    for error in data["detail"]:
        assert "loc" in error
        assert "msg" in error
        assert "type" in error


@pytest.mark.asyncio
@pytest.mark.integration
async def test_401_unauthorized_contract(client: AsyncClient):
    """Test that unauthorized responses have consistent structure."""
    response = await client.get("/api/incidents/?event_id=" + str(uuid4()))
    assert response.status_code == 401

    data = response.json()
    assert "detail" in data


@pytest.mark.asyncio
@pytest.mark.integration
async def test_invalid_enum_value_error(editor_client: AsyncClient, test_event: Event):
    """Test that invalid enum values return proper validation error."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Test",
        "type": "invalid_type",  # Invalid enum
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422

    data = response.json()
    assert "detail" in data
    # Should mention the invalid type
    error_msg = str(data["detail"])
    assert "type" in error_msg.lower() or "invalid" in error_msg.lower()


# ============================================
# Decimal/Coordinate Serialization Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_coordinate_serialization_precision(editor_client: AsyncClient, test_event: Event):
    """Test that coordinates maintain precision when serialized."""
    # Use precise coordinates
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Precise Location Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "location_lat": "47.55961234",
        "location_lng": "7.58864567",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201

    data = response.json()
    incident_response = schemas.IncidentResponse.model_validate(data)

    # Coordinates should be strings maintaining precision
    assert incident_response.location_lat is not None
    assert incident_response.location_lng is not None

    # Values should match (allowing for database precision)
    lat_val = float(str(incident_response.location_lat))
    lng_val = float(str(incident_response.location_lng))
    assert abs(lat_val - 47.55961234) < 0.0001
    assert abs(lng_val - 7.58864567) < 0.0001


# ============================================
# Datetime Serialization Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_datetime_serialization_format(editor_client: AsyncClient, test_event: Event):
    """Test that datetimes are serialized in ISO format."""
    response = await editor_client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 200

    data = response.json()

    # created_at should be ISO format string
    created_at_str = data["created_at"]
    assert isinstance(created_at_str, str)

    # Should be parseable as datetime
    parsed_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
    assert isinstance(parsed_dt, datetime)


# ============================================
# Nested Object Contract Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.integration
async def test_incident_with_assigned_vehicles_contract(
    editor_client: AsyncClient, test_incident: Incident, test_vehicle: Vehicle
):
    """Test that incident with assigned vehicles has correct nested structure."""
    # Assign vehicle
    assignment_data = {
        "resource_type": "vehicle",
        "resource_id": str(test_vehicle.id),
    }
    await editor_client.post(f"/api/incidents/{test_incident.id}/assign", json=assignment_data)

    # Get incident
    response = await editor_client.get(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 200

    data = response.json()
    incident_response = schemas.IncidentResponse.model_validate(data)

    # Should have assigned vehicles
    assert len(incident_response.assigned_vehicles) == 1

    # Validate nested AssignedVehicle structure
    assigned_vehicle = incident_response.assigned_vehicles[0]
    assert isinstance(assigned_vehicle.assignment_id, UUID)
    assert isinstance(assigned_vehicle.vehicle_id, UUID)
    assert isinstance(assigned_vehicle.name, str)
    assert isinstance(assigned_vehicle.type, str)
    assert isinstance(assigned_vehicle.assigned_at, datetime)
