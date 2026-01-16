"""Input validation tests.

Tests verify that:
1. Boundary values are handled correctly (min/max lengths, ranges)
2. Invalid types are rejected with proper error messages
3. Empty/null values are handled appropriately
4. Special characters don't cause issues
5. Format validation works (coordinates, UUIDs, etc.)
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, User


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
        username="validation_test_editor",
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
        name="Validation Test Event",
        training_flag=False,
        auto_attach_divera=False,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "validation_test_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# String Length Boundary Tests - Incidents
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_title_empty_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that empty incident title is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_title_whitespace_only_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that whitespace-only incident title is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "   ",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_title_max_length(editor_client: AsyncClient, test_event: Event):
    """Test that incident title at max length (200 chars) is accepted."""
    long_title = "A" * 200
    incident_data = {
        "event_id": str(test_event.id),
        "title": long_title,
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201
    assert response.json()["title"] == long_title


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_title_exceeds_max_length(editor_client: AsyncClient, test_event: Event):
    """Test that incident title exceeding max length (>200 chars) is rejected."""
    long_title = "A" * 201
    incident_data = {
        "event_id": str(test_event.id),
        "title": long_title,
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_title_min_length(editor_client: AsyncClient, test_event: Event):
    """Test that single character incident title is accepted."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "X",
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201


# ============================================
# String Length Boundary Tests - Personnel
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_name_empty_rejected(editor_client: AsyncClient):
    """Test that empty personnel name is rejected."""
    personnel_data = {
        "name": "",
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_name_max_length(editor_client: AsyncClient):
    """Test that personnel name at max length (100 chars) is accepted."""
    long_name = "A" * 100
    personnel_data = {
        "name": long_name,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_name_exceeds_max_length(editor_client: AsyncClient):
    """Test that personnel name exceeding max length (>100 chars) is rejected."""
    long_name = "A" * 101
    personnel_data = {
        "name": long_name,
        "availability": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 422


# ============================================
# Coordinate Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_valid_latitude_range(editor_client: AsyncClient, test_event: Event):
    """Test that valid latitude values are accepted."""
    # Database requires both lat and lng to be set together
    valid_latitudes = ["0", "45.5", "-45.5", "90", "-90", "89.999999"]

    for lat in valid_latitudes:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Latitude test {lat}",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_lat": lat,
            "location_lng": "7.5",  # Must provide both lat and lng
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for latitude: {lat}"


@pytest.mark.asyncio
@pytest.mark.security
async def test_invalid_latitude_out_of_range(editor_client: AsyncClient, test_event: Event):
    """Test that latitude values outside -90 to 90 are rejected."""
    invalid_latitudes = ["91", "-91", "100", "-100", "180", "-180"]

    for lat in invalid_latitudes:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Invalid latitude test {lat}",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_lat": lat,
            "location_lng": "7.5",  # Must provide both lat and lng
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 422, f"Should reject latitude: {lat}"


@pytest.mark.asyncio
@pytest.mark.security
async def test_valid_longitude_range(editor_client: AsyncClient, test_event: Event):
    """Test that valid longitude values are accepted."""
    # Database requires both lat and lng to be set together
    valid_longitudes = ["0", "45.5", "-45.5", "180", "-180", "179.999999"]

    for lng in valid_longitudes:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Longitude test {lng}",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_lat": "47.5",  # Must provide both lat and lng
            "location_lng": lng,
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for longitude: {lng}"


@pytest.mark.asyncio
@pytest.mark.security
async def test_invalid_longitude_out_of_range(editor_client: AsyncClient, test_event: Event):
    """Test that longitude values outside -180 to 180 are rejected."""
    invalid_longitudes = ["181", "-181", "200", "-200", "360"]

    for lng in invalid_longitudes:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Invalid longitude test {lng}",
            "type": "brandbekaempfung",
            "priority": "medium",
            "location_lat": "47.5",  # Must provide both lat and lng
            "location_lng": lng,
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 422, f"Should reject longitude: {lng}"


# ============================================
# Enum Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_invalid_type_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that invalid incident type is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Invalid Type Test",
        "type": "invalid_type",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_invalid_priority_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that invalid incident priority is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Invalid Priority Test",
        "type": "brandbekaempfung",
        "priority": "critical",  # Not a valid priority
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_incident_invalid_status_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that invalid incident status is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Invalid Status Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "status": "completed",  # Not a valid status
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_invalid_availability_rejected(editor_client: AsyncClient):
    """Test that invalid personnel availability is rejected."""
    personnel_data = {
        "name": "Test Person",
        "availability": "maybe",  # Not a valid availability
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_vehicle_invalid_status_rejected(editor_client: AsyncClient):
    """Test that invalid vehicle status is rejected."""
    vehicle_data = {
        "name": "Test Vehicle",
        "type": "TLF",
        "status": "broken",  # Not a valid status
        "display_order": 1,
        "radio_call_sign": "Test-1",
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_material_invalid_status_rejected(editor_client: AsyncClient):
    """Test that invalid material status is rejected."""
    material_data = {
        "name": "Test Material",
        "type": "Stromerzeuger",
        "location": "Depot",
        "status": "lost",  # Not a valid status
    }
    response = await editor_client.post("/api/materials/", json=material_data)
    assert response.status_code == 422


# ============================================
# UUID Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_invalid_uuid_format_incident(editor_client: AsyncClient):
    """Test that invalid UUID format for incident ID is rejected."""
    invalid_uuids = [
        "not-a-uuid",
        "12345",
        "123e4567-e89b-12d3-a456",  # Truncated UUID
        "123e4567-e89b-12d3-a456-4266141740000",  # Extra character
        "",
        "null",
        "undefined",
    ]

    for invalid_id in invalid_uuids:
        response = await editor_client.get(f"/api/incidents/{invalid_id}")
        assert response.status_code == 422, f"Should reject invalid UUID: {invalid_id}"


@pytest.mark.asyncio
@pytest.mark.security
async def test_invalid_uuid_format_event_id(editor_client: AsyncClient):
    """Test that invalid UUID format for event_id is rejected."""
    invalid_uuids = ["not-a-uuid", "12345", ""]

    for invalid_id in invalid_uuids:
        response = await editor_client.get(f"/api/incidents/?event_id={invalid_id}")
        assert response.status_code == 422, f"Should reject invalid event_id: {invalid_id}"


# ============================================
# Type Coercion Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_string_in_numeric_field(editor_client: AsyncClient):
    """Test that string in numeric field is rejected."""
    personnel_data = {
        "name": "Test Person",
        "availability": "available",
        "role_sort_order": "not_a_number",  # Should be int
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_negative_sort_order_rejected(editor_client: AsyncClient):
    """Test that negative sort order is rejected."""
    personnel_data = {
        "name": "Test Person",
        "availability": "available",
        "role_sort_order": -1,
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_negative_display_order_rejected(editor_client: AsyncClient):
    """Test that negative display order for vehicles is rejected."""
    vehicle_data = {
        "name": "Test Vehicle",
        "type": "TLF",
        "status": "available",
        "display_order": -1,  # Should be non-negative
        "radio_call_sign": "Test-1",
    }
    response = await editor_client.post("/api/vehicles/", json=vehicle_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_boolean_field_type_coercion(editor_client: AsyncClient):
    """Test that boolean fields handle various input types."""
    # These should either work (type coercion) or fail with validation error
    event_data_variants = [
        {"name": "Bool Test 1", "training_flag": "true"},  # String
        {"name": "Bool Test 2", "training_flag": 1},  # Integer
        {"name": "Bool Test 3", "training_flag": "yes"},  # Non-standard string
    ]

    for event_data in event_data_variants:
        response = await editor_client.post("/api/events/", json=event_data)
        # Should either accept with coercion or reject with 422
        assert response.status_code in [201, 422]


# ============================================
# Null/None Value Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_null_required_field_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that null in required field is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": None,  # Required field
        "type": "brandbekaempfung",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_null_optional_field_accepted(editor_client: AsyncClient, test_event: Event):
    """Test that null in optional field is accepted."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Null Optional Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "description": None,  # Optional field
        "contact": None,  # Optional field
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_missing_required_field_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that missing required field is rejected."""
    # Missing 'type' field
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Missing Field Test",
        "priority": "medium",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


# ============================================
# Pagination Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_negative_skip(editor_client: AsyncClient, test_event: Event):
    """Test that negative skip value is rejected."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&skip=-1")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_zero_limit(editor_client: AsyncClient, test_event: Event):
    """Test that zero limit is rejected."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&limit=0")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_negative_limit(editor_client: AsyncClient, test_event: Event):
    """Test that negative limit is rejected."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&limit=-1")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_exceeds_max_limit(editor_client: AsyncClient, test_event: Event):
    """Test that limit exceeding max (500) is rejected."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&limit=501")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_valid_max_limit(editor_client: AsyncClient, test_event: Event):
    """Test that valid max limit (500) is accepted."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&limit=500")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.security
async def test_pagination_non_integer_values(editor_client: AsyncClient, test_event: Event):
    """Test that non-integer pagination values are rejected."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&skip=abc")
    assert response.status_code == 422

    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}&limit=1.5")
    assert response.status_code == 422


# ============================================
# Array/List Field Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_tags_valid_array(editor_client: AsyncClient):
    """Test that valid tags array is accepted."""
    personnel_data = {
        "name": "Test Person",
        "availability": "available",
        "tags": ["driver", "medic", "leader"],
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201
    assert response.json()["tags"] == ["driver", "medic", "leader"]


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_tags_empty_array(editor_client: AsyncClient):
    """Test that empty tags array is accepted."""
    personnel_data = {
        "name": "Test Person",
        "availability": "available",
        "tags": [],
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201


@pytest.mark.asyncio
@pytest.mark.security
async def test_personnel_tags_null_accepted(editor_client: AsyncClient):
    """Test that null tags is accepted."""
    personnel_data = {
        "name": "Test Person",
        "availability": "available",
        "tags": None,
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201


# ============================================
# JSON Structure Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_malformed_json_rejected(editor_client: AsyncClient):
    """Test that malformed JSON is rejected."""
    response = await editor_client.post(
        "/api/incidents/",
        content="{invalid json}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_extra_fields_ignored_or_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that extra fields in request are handled appropriately."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Extra Fields Test",
        "type": "brandbekaempfung",
        "priority": "medium",
        "extra_field": "should be ignored",
        "another_extra": 12345,
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    # Should either accept (ignoring extra fields) or reject
    assert response.status_code in [201, 422]

    if response.status_code == 201:
        data = response.json()
        # Extra fields should not appear in response
        assert "extra_field" not in data
        assert "another_extra" not in data


# ============================================
# Content-Type Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.security
async def test_wrong_content_type_rejected(editor_client: AsyncClient, test_event: Event):
    """Test that wrong Content-Type is handled appropriately."""
    response = await editor_client.post(
        "/api/incidents/",
        content="title=test&type=fire",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    # Should reject form data when JSON is expected
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.security
async def test_empty_request_body(editor_client: AsyncClient):
    """Test that empty request body is handled appropriately."""
    response = await editor_client.post(
        "/api/incidents/",
        content="",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
