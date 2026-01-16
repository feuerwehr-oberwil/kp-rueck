"""Tests for Event API endpoints.

Tests cover:
- Event CRUD operations (create, read, update, delete)
- Event listing with pagination and filters
- Archive/unarchive workflow
- Permission enforcement (editor vs viewer)
- Incident count tracking
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, Incident, User


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
        username="event_editor",
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
        username="event_viewer",
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
        name="Test Event",
        training_flag=False,
        auto_attach_divera=True,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def archived_event(db_session: AsyncSession) -> Event:
    """Create an archived test event."""
    from datetime import datetime, timezone

    event = Event(
        id=uuid4(),
        name="Archived Event",
        training_flag=False,
        archived_at=datetime.now(timezone.utc),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def event_with_incidents(db_session: AsyncSession, test_editor: User) -> Event:
    """Create an event with associated incidents."""
    event = Event(
        id=uuid4(),
        name="Event With Incidents",
        training_flag=True,
    )
    db_session.add(event)
    await db_session.commit()

    # Add incidents to the event
    for i in range(3):
        incident = Incident(
            id=uuid4(),
            event_id=event.id,
            title=f"Incident {i + 1}",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            created_by=test_editor.id,
        )
        db_session.add(incident)

    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "event_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "event_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# List Events Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_requires_auth(client: AsyncClient):
    """Test that listing events requires authentication."""
    response = await client.get("/api/events/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_empty(editor_client: AsyncClient):
    """Test listing events when none exist."""
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200
    data = response.json()
    assert "events" in data
    assert "total" in data
    assert data["events"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_success(editor_client: AsyncClient, test_event: Event):
    """Test listing events successfully."""
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200
    data = response.json()
    assert len(data["events"]) == 1
    assert data["events"][0]["id"] == str(test_event.id)
    assert data["events"][0]["name"] == test_event.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_excludes_archived_by_default(
    editor_client: AsyncClient, test_event: Event, archived_event: Event
):
    """Test that archived events are excluded by default."""
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200
    data = response.json()

    event_ids = [e["id"] for e in data["events"]]
    assert str(test_event.id) in event_ids
    assert str(archived_event.id) not in event_ids


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_include_archived(
    editor_client: AsyncClient, test_event: Event, archived_event: Event
):
    """Test including archived events in list."""
    response = await editor_client.get("/api/events/?include_archived=true")
    assert response.status_code == 200
    data = response.json()

    event_ids = [e["id"] for e in data["events"]]
    assert str(test_event.id) in event_ids
    assert str(archived_event.id) in event_ids


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_pagination(editor_client: AsyncClient, db_session: AsyncSession):
    """Test event list pagination."""
    # Create multiple events
    for i in range(5):
        event = Event(id=uuid4(), name=f"Event {i}", training_flag=False)
        db_session.add(event)
    await db_session.commit()

    # Test skip
    response = await editor_client.get("/api/events/?skip=2&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["events"]) == 2


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_viewer_can_read(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers can list events."""
    response = await viewer_client.get("/api/events/")
    assert response.status_code == 200
    assert len(response.json()["events"]) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_events_with_incident_count(
    editor_client: AsyncClient, event_with_incidents: Event
):
    """Test that incident count is included in event response."""
    response = await editor_client.get("/api/events/")
    assert response.status_code == 200
    data = response.json()

    event = next(e for e in data["events"] if e["id"] == str(event_with_incidents.id))
    assert event["incident_count"] == 3


# ============================================
# Get Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_event_requires_auth(client: AsyncClient, test_event: Event):
    """Test that getting event requires authentication."""
    response = await client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_event_success(editor_client: AsyncClient, test_event: Event):
    """Test getting a single event."""
    response = await editor_client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_event.id)
    assert data["name"] == test_event.name
    assert data["training_flag"] == test_event.training_flag
    assert "incident_count" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_event_not_found(editor_client: AsyncClient):
    """Test getting a non-existent event."""
    response = await editor_client.get(f"/api/events/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_event_viewer_can_read(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers can get event details."""
    response = await viewer_client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 200


# ============================================
# Create Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_event_requires_auth(client: AsyncClient):
    """Test that creating event requires authentication."""
    response = await client.post("/api/events/", json={"name": "New Event"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_event_success(editor_client: AsyncClient):
    """Test creating an event successfully."""
    event_data = {
        "name": "New Event",
        "training_flag": True,
        "auto_attach_divera": False,
    }
    response = await editor_client.post("/api/events/", json=event_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "New Event"
    assert data["training_flag"] is True
    assert data["auto_attach_divera"] is False
    assert data["archived_at"] is None
    assert data["incident_count"] == 0
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_event_minimal(editor_client: AsyncClient):
    """Test creating event with minimal data."""
    response = await editor_client.post("/api/events/", json={"name": "Minimal Event"})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Minimal Event"
    # Defaults should be applied
    assert data["training_flag"] is False
    assert data["auto_attach_divera"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_event_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot create events."""
    response = await viewer_client.post("/api/events/", json={"name": "New Event"})
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_event_empty_name(editor_client: AsyncClient):
    """Test creating event with empty name.

    Note: Currently the API accepts empty names. This test documents
    the current behavior. Consider adding min_length=1 validation
    to EventCreate schema if empty names should be rejected.
    """
    response = await editor_client.post("/api/events/", json={"name": ""})
    # API currently accepts empty names - documenting behavior
    assert response.status_code == 201


# ============================================
# Update Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_event_requires_auth(client: AsyncClient, test_event: Event):
    """Test that updating event requires authentication."""
    response = await client.put(f"/api/events/{test_event.id}", json={"name": "Updated"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_event_success(editor_client: AsyncClient, test_event: Event):
    """Test updating an event successfully."""
    update_data = {
        "name": "Updated Event Name",
        "training_flag": True,
    }
    response = await editor_client.put(f"/api/events/{test_event.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Event Name"
    assert data["training_flag"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_event_partial(editor_client: AsyncClient, test_event: Event):
    """Test partial update of event."""
    response = await editor_client.put(
        f"/api/events/{test_event.id}",
        json={"auto_attach_divera": True},
    )
    assert response.status_code == 200
    data = response.json()
    # Name should remain unchanged
    assert data["name"] == test_event.name
    assert data["auto_attach_divera"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_event_not_found(editor_client: AsyncClient):
    """Test updating a non-existent event."""
    response = await editor_client.put(f"/api/events/{uuid4()}", json={"name": "Updated"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_event_viewer_forbidden(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot update events."""
    response = await viewer_client.put(f"/api/events/{test_event.id}", json={"name": "Updated"})
    assert response.status_code == 403


# ============================================
# Archive Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_event_requires_auth(client: AsyncClient, test_event: Event):
    """Test that archiving event requires authentication."""
    response = await client.post(f"/api/events/{test_event.id}/archive")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_event_success(editor_client: AsyncClient, test_event: Event):
    """Test archiving an event successfully."""
    response = await editor_client.post(f"/api/events/{test_event.id}/archive")
    assert response.status_code == 200
    data = response.json()
    assert data["archived_at"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_event_not_found(editor_client: AsyncClient):
    """Test archiving a non-existent event."""
    response = await editor_client.post(f"/api/events/{uuid4()}/archive")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_event_viewer_forbidden(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot archive events."""
    response = await viewer_client.post(f"/api/events/{test_event.id}/archive")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_removes_from_default_list(editor_client: AsyncClient, test_event: Event):
    """Test that archived events don't appear in default list."""
    # Archive the event
    await editor_client.post(f"/api/events/{test_event.id}/archive")

    # Check it's not in default list
    response = await editor_client.get("/api/events/")
    event_ids = [e["id"] for e in response.json()["events"]]
    assert str(test_event.id) not in event_ids


# ============================================
# Unarchive Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_unarchive_event_requires_auth(client: AsyncClient, archived_event: Event):
    """Test that unarchiving event requires authentication."""
    response = await client.post(f"/api/events/{archived_event.id}/unarchive")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_unarchive_event_success(editor_client: AsyncClient, archived_event: Event):
    """Test unarchiving an event successfully."""
    response = await editor_client.post(f"/api/events/{archived_event.id}/unarchive")
    assert response.status_code == 200
    data = response.json()
    assert data["archived_at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_unarchive_event_not_found(editor_client: AsyncClient):
    """Test unarchiving a non-existent event."""
    response = await editor_client.post(f"/api/events/{uuid4()}/unarchive")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_unarchive_event_viewer_forbidden(viewer_client: AsyncClient, archived_event: Event):
    """Test that viewers cannot unarchive events."""
    response = await viewer_client.post(f"/api/events/{archived_event.id}/unarchive")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_unarchive_restores_to_default_list(editor_client: AsyncClient, archived_event: Event):
    """Test that unarchived events appear in default list."""
    # Unarchive the event
    await editor_client.post(f"/api/events/{archived_event.id}/unarchive")

    # Check it's in default list
    response = await editor_client.get("/api/events/")
    event_ids = [e["id"] for e in response.json()["events"]]
    assert str(archived_event.id) in event_ids


# ============================================
# Delete Event Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_event_requires_auth(client: AsyncClient, archived_event: Event):
    """Test that deleting event requires authentication."""
    response = await client.delete(f"/api/events/{archived_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_event_success(editor_client: AsyncClient, archived_event: Event):
    """Test deleting an archived event successfully."""
    response = await editor_client.delete(f"/api/events/{archived_event.id}")
    assert response.status_code == 204

    # Verify event is gone (even with include_archived)
    response = await editor_client.get(f"/api/events/?include_archived=true")
    event_ids = [e["id"] for e in response.json()["events"]]
    assert str(archived_event.id) not in event_ids


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_event_must_be_archived_first(editor_client: AsyncClient, test_event: Event):
    """Test that non-archived events cannot be deleted."""
    response = await editor_client.delete(f"/api/events/{test_event.id}")
    assert response.status_code == 400
    assert "archived" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_event_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent event."""
    response = await editor_client.delete(f"/api/events/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_event_viewer_forbidden(viewer_client: AsyncClient, archived_event: Event):
    """Test that viewers cannot delete events."""
    response = await viewer_client.delete(f"/api/events/{archived_event.id}")
    assert response.status_code == 403


# ============================================
# Event Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_event_response_structure(editor_client: AsyncClient, test_event: Event):
    """Test that event response contains all expected fields."""
    response = await editor_client.get(f"/api/events/{test_event.id}")
    assert response.status_code == 200
    data = response.json()

    # Verify all expected fields are present
    expected_fields = [
        "id",
        "name",
        "training_flag",
        "auto_attach_divera",
        "created_at",
        "updated_at",
        "archived_at",
        "last_activity_at",
        "incident_count",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


@pytest.mark.asyncio
@pytest.mark.api
async def test_training_flag_filtering(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that training_flag is properly set and returned."""
    # Create training event
    training_event = Event(id=uuid4(), name="Training", training_flag=True)
    # Create live event
    live_event = Event(id=uuid4(), name="Live", training_flag=False)
    db_session.add_all([training_event, live_event])
    await db_session.commit()

    response = await editor_client.get("/api/events/")
    events = response.json()["events"]

    training = next(e for e in events if e["id"] == str(training_event.id))
    live = next(e for e in events if e["id"] == str(live_event.id))

    assert training["training_flag"] is True
    assert live["training_flag"] is False
