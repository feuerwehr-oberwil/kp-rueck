"""Tests for Special Functions API endpoints.

Tests cover:
- Listing special function assignments
- Assigning special functions to personnel
- Removing special function assignments
- Permission enforcement
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, EventSpecialFunction, Personnel, User, Vehicle

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
        username="sf_editor",
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
        username="sf_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
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
        name="Special Functions Test Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create a test personnel."""
    person = Personnel(
        id=uuid4(),
        name="Test Person SF",
        role="atemschutz",
        availability="available",
    )
    db_session.add(person)
    await db_session.commit()
    await db_session.refresh(person)
    return person


@pytest_asyncio.fixture
async def test_vehicle(db_session: AsyncSession) -> Vehicle:
    """Create a test vehicle."""
    vehicle = Vehicle(
        id=uuid4(),
        name="TLF Test SF",
        type="tlf",
        status="available",
    )
    db_session.add(vehicle)
    await db_session.commit()
    await db_session.refresh(vehicle)
    return vehicle


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "sf_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "sf_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def test_assignment(
    db_session: AsyncSession, test_event: Event, test_personnel: Personnel, test_editor: User
) -> EventSpecialFunction:
    """Create a test special function assignment."""
    assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=test_event.id,
        personnel_id=test_personnel.id,
        function_type="reko",  # Valid values: 'driver', 'reko', 'magazin'
        assigned_at=datetime.now(UTC),
        assigned_by=test_editor.id,
    )
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(assignment)
    return assignment


# ============================================
# List Special Functions Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_special_functions_requires_auth(client: AsyncClient, test_event: Event):
    """Test that listing special functions requires authentication."""
    response = await client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_special_functions_viewer_can_access(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers can list special functions."""
    response = await viewer_client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_special_functions_empty(editor_client: AsyncClient, test_event: Event):
    """Test listing special functions when none exist."""
    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_special_functions_with_assignments(
    editor_client: AsyncClient, test_event: Event, test_assignment: EventSpecialFunction, test_personnel: Personnel
):
    """Test listing special functions with existing assignments."""
    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["function_type"] == "reko"
    assert data[0]["personnel_name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_special_functions_includes_vehicle_name(
    db_session: AsyncSession,
    editor_client: AsyncClient,
    test_event: Event,
    test_personnel: Personnel,
    test_vehicle: Vehicle,
    test_editor: User,
):
    """Test that vehicle name is included for driver assignments."""
    # Create a driver assignment
    assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=test_event.id,
        personnel_id=test_personnel.id,
        function_type="driver",  # Valid values: 'driver', 'reko', 'magazin'
        vehicle_id=test_vehicle.id,
        assigned_at=datetime.now(UTC),
        assigned_by=test_editor.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 200

    data = response.json()
    driver_assignment = next((a for a in data if a["function_type"] == "driver"), None)
    assert driver_assignment is not None
    assert driver_assignment["vehicle_name"] == test_vehicle.name


# ============================================
# List Personnel Special Functions Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_special_functions(
    editor_client: AsyncClient, test_event: Event, test_assignment: EventSpecialFunction, test_personnel: Personnel
):
    """Test listing special functions for a specific personnel."""
    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/personnel/{test_personnel.id}")
    assert response.status_code == 200

    data = response.json()
    assert len(data) == 1
    assert data[0]["personnel_id"] == str(test_personnel.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_special_functions_empty(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test listing special functions for personnel with no assignments."""
    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/personnel/{test_personnel.id}")
    assert response.status_code == 200
    assert response.json() == []


# ============================================
# Assign Special Function Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_special_function_requires_auth(client: AsyncClient, test_event: Event, test_personnel: Personnel):
    """Test that assigning special functions requires authentication."""
    response = await client.post(
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "einsatzleiter"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_special_function_viewer_forbidden(
    viewer_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test that viewers cannot assign special functions."""
    response = await viewer_client.post(
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "einsatzleiter"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_special_function_success(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test successful special function assignment."""
    response = await editor_client.post(
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "magazin"},
    )
    assert response.status_code == 201

    data = response.json()
    assert data["function_type"] == "magazin"
    assert data["personnel_id"] == str(test_personnel.id)
    assert data["personnel_name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_special_function_with_vehicle(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel, test_vehicle: Vehicle
):
    """Test assigning driver function with vehicle."""
    response = await editor_client.post(
        f"/api/events/{test_event.id}/special-functions/",
        json={
            "personnel_id": str(test_personnel.id),
            "function_type": "driver",
            "vehicle_id": str(test_vehicle.id),
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["function_type"] == "driver"
    assert data["vehicle_id"] == str(test_vehicle.id)
    assert data["vehicle_name"] == test_vehicle.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_assign_special_function_duplicate(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel, test_assignment: EventSpecialFunction
):
    """Test that duplicate assignments are handled."""
    response = await editor_client.post(
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "reko"},
    )
    # Should either succeed or return appropriate error
    assert response.status_code in [201, 400]


# ============================================
# Unassign Special Function Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_special_function_requires_auth(
    client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test that unassigning special functions requires authentication."""
    response = await client.request(
        "DELETE",
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "reko"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_special_function_viewer_forbidden(
    viewer_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test that viewers cannot unassign special functions."""
    response = await viewer_client.request(
        "DELETE",
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "reko"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_special_function_success(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel, test_assignment: EventSpecialFunction
):
    """Test successful special function unassignment."""
    response = await editor_client.request(
        "DELETE",
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "reko"},
    )
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_special_function_not_found(
    editor_client: AsyncClient, test_event: Event, test_personnel: Personnel
):
    """Test unassigning non-existent assignment."""
    response = await editor_client.request(
        "DELETE",
        f"/api/events/{test_event.id}/special-functions/",
        json={"personnel_id": str(test_personnel.id), "function_type": "magazin"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_unassign_driver_with_vehicle(
    db_session: AsyncSession,
    editor_client: AsyncClient,
    test_event: Event,
    test_personnel: Personnel,
    test_vehicle: Vehicle,
    test_editor: User,
):
    """Test unassigning driver function with specific vehicle."""
    # Create a driver assignment
    assignment = EventSpecialFunction(
        id=uuid4(),
        event_id=test_event.id,
        personnel_id=test_personnel.id,
        function_type="driver",  # Valid values: 'driver', 'reko', 'magazin'
        vehicle_id=test_vehicle.id,
        assigned_at=datetime.now(UTC),
        assigned_by=test_editor.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    response = await editor_client.request(
        "DELETE",
        f"/api/events/{test_event.id}/special-functions/",
        json={
            "personnel_id": str(test_personnel.id),
            "function_type": "driver",
            "vehicle_id": str(test_vehicle.id),
        },
    )
    assert response.status_code == 204


# ============================================
# Response Format Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_assignment_response_format(
    editor_client: AsyncClient, test_event: Event, test_assignment: EventSpecialFunction
):
    """Test that assignment response has correct format."""
    response = await editor_client.get(f"/api/events/{test_event.id}/special-functions/")
    assert response.status_code == 200

    data = response.json()
    assignment = data[0]

    assert "id" in assignment
    assert "event_id" in assignment
    assert "personnel_id" in assignment
    assert "personnel_name" in assignment
    assert "function_type" in assignment
    assert "assigned_at" in assignment
    assert "assigned_by" in assignment
