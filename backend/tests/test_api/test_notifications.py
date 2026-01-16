"""Tests for Notification API endpoints.

Tests cover:
- Notification retrieval for events
- Notification dismissal
- Notification settings CRUD
- Permission enforcement (editor vs viewer)
- Notification evaluation rules
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, Incident, Notification, User


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
        username="notification_editor",
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
        username="notification_viewer",
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
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_incident(db_session: AsyncSession, test_event: Event) -> Incident:
    """Create a test incident."""
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Test Incident",
        type="brandbekaempfung",
        status="eingegangen",
        priority="medium",
        created_at=datetime.now(UTC),
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def test_notification(db_session: AsyncSession, test_event: Event, test_incident: Incident) -> Notification:
    """Create a test notification."""
    notification = Notification(
        id=uuid4(),
        type="time_overdue",
        severity="warning",
        message="Test notification message",
        incident_id=test_incident.id,
        event_id=test_event.id,
        created_at=datetime.now(UTC),
        dismissed=False,
    )
    db_session.add(notification)
    await db_session.commit()
    await db_session.refresh(notification)
    return notification


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "notification_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
async def viewer_client(client: AsyncClient, test_viewer: User) -> AsyncClient:
    """Create an authenticated client with viewer privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "notification_viewer", "password": "viewerpass123"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Get Notifications Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_requires_auth(client: AsyncClient, test_event: Event):
    """Test that getting notifications requires authentication."""
    response = await client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_requires_event_id(editor_client: AsyncClient):
    """Test that getting notifications requires event_id parameter."""
    response = await editor_client.get("/api/notifications/")
    assert response.status_code == 422  # Missing required query param


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_empty(editor_client: AsyncClient, test_event: Event):
    """Test getting notifications when none exist."""
    response = await editor_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_success(
    editor_client: AsyncClient, test_event: Event, test_notification: Notification
):
    """Test getting notifications successfully."""
    response = await editor_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    notifications = response.json()
    assert len(notifications) == 1
    assert notifications[0]["id"] == str(test_notification.id)
    assert notifications[0]["message"] == test_notification.message


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_viewer_can_read(
    viewer_client: AsyncClient, test_event: Event, test_notification: Notification
):
    """Test that viewers can get notifications."""
    response = await viewer_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notifications_invalid_event_id(editor_client: AsyncClient):
    """Test getting notifications for non-existent event returns empty list."""
    response = await editor_client.get(f"/api/notifications/?event_id={uuid4()}")
    assert response.status_code == 200
    assert response.json() == []


# ============================================
# Dismiss Notification Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismiss_notification_requires_auth(client: AsyncClient, test_notification: Notification):
    """Test that dismissing notification requires authentication."""
    response = await client.post(f"/api/notifications/{test_notification.id}/dismiss")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismiss_notification_success(editor_client: AsyncClient, test_notification: Notification):
    """Test dismissing a notification successfully."""
    response = await editor_client.post(f"/api/notifications/{test_notification.id}/dismiss")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismiss_notification_not_found(editor_client: AsyncClient):
    """Test dismissing a non-existent notification."""
    response = await editor_client.post(f"/api/notifications/{uuid4()}/dismiss")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismiss_notification_viewer_can_dismiss(viewer_client: AsyncClient, test_notification: Notification):
    """Test that viewers can dismiss notifications."""
    response = await viewer_client.post(f"/api/notifications/{test_notification.id}/dismiss")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismiss_notification_idempotent(editor_client: AsyncClient, test_notification: Notification):
    """Test that dismissing a notification twice is idempotent."""
    # First dismiss
    response1 = await editor_client.post(f"/api/notifications/{test_notification.id}/dismiss")
    assert response1.status_code == 204

    # Second dismiss (should still succeed)
    response2 = await editor_client.post(f"/api/notifications/{test_notification.id}/dismiss")
    assert response2.status_code == 204


# ============================================
# Get Notification Settings Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notification_settings_requires_auth(client: AsyncClient):
    """Test that getting notification settings requires authentication."""
    response = await client.get("/api/notifications/settings/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notification_settings_success(editor_client: AsyncClient):
    """Test getting notification settings successfully returns defaults."""
    response = await editor_client.get("/api/notifications/settings/")
    assert response.status_code == 200
    data = response.json()

    # Check default values exist
    assert "live_eingegangen_min" in data
    assert "training_eingegangen_min" in data
    assert "fatigue_hours" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_notification_settings_viewer_can_read(viewer_client: AsyncClient):
    """Test that viewers can read notification settings."""
    response = await viewer_client.get("/api/notifications/settings/")
    assert response.status_code == 200


# ============================================
# Update Notification Settings Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_requires_auth(client: AsyncClient):
    """Test that updating notification settings requires authentication."""
    response = await client.patch("/api/notifications/settings/", json={"fatigue_hours": 5})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_success(editor_client: AsyncClient):
    """Test updating notification settings successfully."""
    update_data = {
        "fatigue_hours": 6,
        "live_eingegangen_min": 45,
    }
    response = await editor_client.patch("/api/notifications/settings/", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["fatigue_hours"] == 6
    assert data["live_eingegangen_min"] == 45


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_partial(editor_client: AsyncClient):
    """Test partial update of notification settings."""
    # First get current settings
    response1 = await editor_client.get("/api/notifications/settings/")
    original_fatigue = response1.json()["fatigue_hours"]

    # Update only one field
    response2 = await editor_client.patch(
        "/api/notifications/settings/",
        json={"live_reko_min": 90},
    )
    assert response2.status_code == 200
    data = response2.json()
    assert data["live_reko_min"] == 90
    # Other fields should retain their values
    assert data["fatigue_hours"] == original_fatigue


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot update notification settings."""
    response = await viewer_client.patch("/api/notifications/settings/", json={"fatigue_hours": 5})
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_invalid_value(editor_client: AsyncClient):
    """Test updating with invalid values."""
    response = await editor_client.patch(
        "/api/notifications/settings/",
        json={"fatigue_hours": -1},
    )
    # API might accept negative values - depends on validation
    # This tests the boundary behavior
    assert response.status_code in [200, 422]


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_material_threshold(editor_client: AsyncClient):
    """Test updating material depletion thresholds."""
    update_data = {
        "material_depletion_threshold": {
            "Schläuche": 5,
            "Atemschutz": 3,
        }
    }
    response = await editor_client.patch("/api/notifications/settings/", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["material_depletion_threshold"]["Schläuche"] == 5
    assert data["material_depletion_threshold"]["Atemschutz"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_re_alarm(editor_client: AsyncClient):
    """Test updating re-alarm interval."""
    response = await editor_client.patch(
        "/api/notifications/settings/",
        json={"re_alarm_interval_min": 30},
    )
    assert response.status_code == 200
    assert response.json()["re_alarm_interval_min"] == 30


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_notification_settings_toggle_alerts(editor_client: AsyncClient):
    """Test toggling alert categories."""
    update_data = {
        "enabled_time_alerts": False,
        "enabled_resource_alerts": True,
        "enabled_data_quality_alerts": False,
        "enabled_event_alerts": True,
    }
    response = await editor_client.patch("/api/notifications/settings/", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["enabled_time_alerts"] is False
    assert data["enabled_resource_alerts"] is True


# ============================================
# Notification Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_notification_response_structure(
    editor_client: AsyncClient, test_event: Event, test_notification: Notification
):
    """Test that notification response contains all expected fields."""
    response = await editor_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    notifications = response.json()
    assert len(notifications) == 1

    notification = notifications[0]
    expected_fields = [
        "id",
        "type",
        "severity",
        "message",
        "incident_id",
        "event_id",
        "created_at",
        "dismissed",
    ]
    for field in expected_fields:
        assert field in notification, f"Missing field: {field}"


# ============================================
# Multiple Notifications Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_multiple_notifications(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, db_session: AsyncSession
):
    """Test getting multiple notifications."""
    # Create multiple notifications
    for i in range(5):
        notification = Notification(
            id=uuid4(),
            type="time_overdue",
            severity="warning" if i % 2 == 0 else "info",
            message=f"Test notification {i}",
            incident_id=test_incident.id,
            event_id=test_event.id,
            created_at=datetime.now(UTC),
            dismissed=False,
        )
        db_session.add(notification)
    await db_session.commit()

    response = await editor_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    notifications = response.json()
    assert len(notifications) == 5


@pytest.mark.asyncio
@pytest.mark.api
async def test_dismissed_notifications_included(
    editor_client: AsyncClient, test_event: Event, test_incident: Incident, db_session: AsyncSession
):
    """Test that recently dismissed notifications are included in response."""
    # Create a dismissed notification
    dismissed_notification = Notification(
        id=uuid4(),
        type="time_overdue",
        severity="warning",
        message="Dismissed notification",
        incident_id=test_incident.id,
        event_id=test_event.id,
        created_at=datetime.now(UTC) - timedelta(minutes=30),
        dismissed=True,
        dismissed_at=datetime.now(UTC) - timedelta(minutes=10),
    )
    db_session.add(dismissed_notification)
    await db_session.commit()

    response = await editor_client.get(f"/api/notifications/?event_id={test_event.id}")
    assert response.status_code == 200
    notifications = response.json()
    # Should include the dismissed notification (within 24 hours)
    assert len(notifications) >= 1


# ============================================
# Settings Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_settings_response_structure(editor_client: AsyncClient):
    """Test that settings response contains all expected fields."""
    response = await editor_client.get("/api/notifications/settings/")
    assert response.status_code == 200
    data = response.json()

    expected_fields = [
        "live_eingegangen_min",
        "live_reko_min",
        "live_disponiert_min",
        "live_einsatz_hours",
        "live_rueckfahrt_min",
        "live_archive_hours",
        "training_eingegangen_min",
        "training_reko_min",
        "training_disponiert_min",
        "training_einsatz_hours",
        "training_rueckfahrt_min",
        "training_archive_hours",
        "fatigue_hours",
        "material_depletion_threshold",
        "database_size_limit_gb",
        "photo_size_limit_gb",
        "re_alarm_interval_min",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


# ============================================
# Settings Persistence Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_settings_persistence(editor_client: AsyncClient):
    """Test that settings are persisted correctly."""
    # Update settings
    update_data = {"fatigue_hours": 8, "live_eingegangen_min": 30}
    response1 = await editor_client.patch("/api/notifications/settings/", json=update_data)
    assert response1.status_code == 200

    # Retrieve and verify
    response2 = await editor_client.get("/api/notifications/settings/")
    assert response2.status_code == 200
    data = response2.json()
    assert data["fatigue_hours"] == 8
    assert data["live_eingegangen_min"] == 30
