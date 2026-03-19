"""Tests for Divera 24/7 webhook integration API endpoints.

Tests cover:
- Webhook reception (no auth required)
- Emergency listing and filtering
- Emergency attachment to events
- Bulk attachment
- Emergency archival
- Permission enforcement (editor vs viewer)
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DiveraEmergency, Event


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Test Divera Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_emergency(db_session: AsyncSession) -> DiveraEmergency:
    """Create a test Divera emergency."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=12345,
        divera_number="E-2024-001",
        title="FEUER Wohnungsbrand",
        text="Brand in Mehrfamilienhaus, 3. OG",
        address="Musterstraße 42, 4000 Basel",
        latitude="47.5596",
        longitude="7.5886",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)
    return emergency


# ============================================
# Webhook Tests (No Auth Required)
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_receive_success(client: AsyncClient):
    """Test receiving a Divera webhook successfully.

    Note: Webhook endpoint does not require authentication.
    """
    webhook_payload = {
        "id": 67890,
        "number": "E-2024-002",
        "title": "THL-VERKEHR Unfall",
        "text": "VU mit eingeklemmter Person",
        "address": "Hauptstraße 1, 4000 Basel",
        "lat": 47.5596,
        "lng": 7.5886,
        "ts_create": 1700000000,
        "cluster": ["Gruppe A"],
        "vehicle": ["TLF", "DLK"],
    }

    # Mock the WebSocket broadcast
    with patch("app.api.divera.broadcast_message", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=webhook_payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "emergency_id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_duplicate_ignored(client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that duplicate webhooks are ignored."""
    # Send webhook with same divera_id as existing emergency
    webhook_payload = {
        "id": test_emergency.divera_id,  # Same ID as existing
        "title": "Duplicate test",
    }

    response = await client.post("/api/divera/webhook", json=webhook_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "Duplicate" in data["message"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_minimal_payload(client: AsyncClient):
    """Test webhook with minimal required fields."""
    webhook_payload = {
        "id": 99999,
        "title": "Minimal Emergency",
    }

    with patch("app.api.divera.broadcast_message", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=webhook_payload)
        assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_webhook_full_payload(client: AsyncClient):
    """Test webhook with all fields populated."""
    webhook_payload = {
        "id": 11111,
        "number": "E-2024-100",
        "title": "BMA Schulhaus Gymnasium",
        "text": "Automatische Brandmeldung aus Bereich Aula",
        "address": "Schulweg 5, 4000 Basel",
        "lat": 47.5600,
        "lng": 7.5900,
        "ts_create": 1700000000,
        "ts_update": 1700000100,
        "cluster": ["Löschzug 1", "Löschzug 2"],
        "group": ["Gruppenführer", "Atemschutz"],
        "vehicle": ["TLF", "DLK", "MTW"],
    }

    with patch("app.api.divera.broadcast_message", new_callable=AsyncMock):
        response = await client.post("/api/divera/webhook", json=webhook_payload)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"


# ============================================
# List Emergencies Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_requires_auth(client: AsyncClient):
    """Test that listing emergencies requires authentication."""
    response = await client.get("/api/divera/emergencies")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_success(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test listing emergencies successfully."""
    response = await editor_client.get("/api/divera/emergencies")
    assert response.status_code == 200
    data = response.json()

    assert "emergencies" in data
    assert "total" in data
    assert "unattached_count" in data
    assert len(data["emergencies"]) >= 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_viewer_can_read(viewer_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that viewers can list emergencies."""
    response = await viewer_client.get("/api/divera/emergencies")
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_filter_unattached(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test filtering to only unattached emergencies."""
    response = await editor_client.get("/api/divera/emergencies?attached=false")
    assert response.status_code == 200
    data = response.json()

    # All returned should be unattached
    for emergency in data["emergencies"]:
        assert emergency["attached_to_event_id"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_pagination(
    editor_client: AsyncClient, db_session: AsyncSession, test_emergency: DiveraEmergency
):
    """Test emergencies pagination."""
    # Create multiple emergencies
    for i in range(5):
        emergency = DiveraEmergency(
            id=uuid4(),
            divera_id=20000 + i,
            title=f"Test Emergency {i}",
            received_at=datetime.now(UTC),
            is_archived=False,
        )
        db_session.add(emergency)
    await db_session.commit()

    # Test pagination
    response = await editor_client.get("/api/divera/emergencies?skip=0&limit=3")
    assert response.status_code == 200
    data = response.json()
    assert len(data["emergencies"]) <= 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_exclude_archived(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that archived emergencies are excluded by default."""
    # Create an archived emergency
    archived_emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=30000,
        title="Archived Emergency",
        received_at=datetime.now(UTC),
        is_archived=True,
    )
    db_session.add(archived_emergency)
    await db_session.commit()

    response = await editor_client.get("/api/divera/emergencies")
    assert response.status_code == 200
    data = response.json()

    # Archived should not be in results
    emergency_ids = [e["id"] for e in data["emergencies"]]
    assert str(archived_emergency.id) not in emergency_ids


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_emergencies_include_archived(editor_client: AsyncClient, db_session: AsyncSession):
    """Test including archived emergencies when requested."""
    # Create an archived emergency
    archived_emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=30001,
        title="Archived Emergency Include",
        received_at=datetime.now(UTC),
        is_archived=True,
    )
    db_session.add(archived_emergency)
    await db_session.commit()
    await db_session.refresh(archived_emergency)

    response = await editor_client.get("/api/divera/emergencies?include_archived=true")
    assert response.status_code == 200
    data = response.json()

    # Archived should be in results
    emergency_ids = [e["id"] for e in data["emergencies"]]
    assert str(archived_emergency.id) in emergency_ids


# ============================================
# Get Emergency Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_emergency_requires_auth(client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that getting emergency requires authentication."""
    response = await client.get(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_emergency_success(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test getting a single emergency."""
    response = await editor_client.get(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 200
    data = response.json()

    assert data["id"] == str(test_emergency.id)
    assert data["title"] == test_emergency.title
    assert data["divera_id"] == test_emergency.divera_id


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_emergency_not_found(editor_client: AsyncClient):
    """Test getting a non-existent emergency."""
    response = await editor_client.get(f"/api/divera/emergencies/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_emergency_viewer_can_read(viewer_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that viewers can get emergency details."""
    response = await viewer_client.get(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 200


# ============================================
# Attach Emergency Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_requires_auth(client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event):
    """Test that attaching emergency requires authentication."""
    response = await client.post(
        f"/api/divera/emergencies/{test_emergency.id}/attach",
        json={"event_id": str(test_event.id)},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_viewer_forbidden(
    viewer_client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event
):
    """Test that viewers cannot attach emergencies."""
    response = await viewer_client.post(
        f"/api/divera/emergencies/{test_emergency.id}/attach",
        json={"event_id": str(test_event.id)},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_success(editor_client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event):
    """Test successfully attaching an emergency to an event."""
    # Mock WebSocket broadcast
    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{test_emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()

        # Should return created incident
        assert "id" in data
        assert data["title"] == test_emergency.title
        assert data["event_id"] == str(test_event.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_not_found(editor_client: AsyncClient, test_event: Event):
    """Test attaching non-existent emergency."""
    response = await editor_client.post(
        f"/api/divera/emergencies/{uuid4()}/attach",
        json={"event_id": str(test_event.id)},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_event_not_found(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test attaching to non-existent event."""
    response = await editor_client.post(
        f"/api/divera/emergencies/{test_emergency.id}/attach",
        json={"event_id": str(uuid4())},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_already_attached(
    editor_client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event
):
    """Test that attaching same emergency to same event is rejected."""
    # First attachment
    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response1 = await editor_client.post(
            f"/api/divera/emergencies/{test_emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response1.status_code == 201

    # Second attachment to same event
    response2 = await editor_client.post(
        f"/api/divera/emergencies/{test_emergency.id}/attach",
        json={"event_id": str(test_event.id)},
    )
    assert response2.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_attach_emergency_different_event_allowed(
    editor_client: AsyncClient, test_emergency: DiveraEmergency, db_session: AsyncSession
):
    """Test that re-attaching to different event is allowed."""
    # Create two events
    event1 = Event(id=uuid4(), name="Event 1", training_flag=False, created_at=datetime.now(UTC))
    event2 = Event(id=uuid4(), name="Event 2", training_flag=False, created_at=datetime.now(UTC))
    db_session.add_all([event1, event2])
    await db_session.commit()
    await db_session.refresh(event1)
    await db_session.refresh(event2)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        # Attach to first event
        response1 = await editor_client.post(
            f"/api/divera/emergencies/{test_emergency.id}/attach",
            json={"event_id": str(event1.id)},
        )
        assert response1.status_code == 201

        # Attach to different event should work
        response2 = await editor_client.post(
            f"/api/divera/emergencies/{test_emergency.id}/attach",
            json={"event_id": str(event2.id)},
        )
        assert response2.status_code == 201


# ============================================
# Bulk Attach Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_bulk_attach_requires_auth(client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event):
    """Test that bulk attach requires authentication."""
    response = await client.post(
        "/api/divera/emergencies/bulk-attach",
        json={"event_id": str(test_event.id), "emergency_ids": [str(test_emergency.id)]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_bulk_attach_viewer_forbidden(
    viewer_client: AsyncClient, test_emergency: DiveraEmergency, test_event: Event
):
    """Test that viewers cannot bulk attach."""
    response = await viewer_client.post(
        "/api/divera/emergencies/bulk-attach",
        json={"event_id": str(test_event.id), "emergency_ids": [str(test_emergency.id)]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_bulk_attach_success(editor_client: AsyncClient, db_session: AsyncSession, test_event: Event):
    """Test successfully bulk attaching emergencies."""
    # Create multiple emergencies
    emergencies = []
    for i in range(3):
        emergency = DiveraEmergency(
            id=uuid4(),
            divera_id=40000 + i,
            title=f"Bulk Test Emergency {i}",
            received_at=datetime.now(UTC),
            is_archived=False,
        )
        db_session.add(emergency)
        emergencies.append(emergency)
    await db_session.commit()

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            "/api/divera/emergencies/bulk-attach",
            json={
                "event_id": str(test_event.id),
                "emergency_ids": [str(e.id) for e in emergencies],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3  # All 3 incidents created


@pytest.mark.asyncio
@pytest.mark.api
async def test_bulk_attach_empty_list(editor_client: AsyncClient, test_event: Event):
    """Test bulk attach with empty list fails validation."""
    response = await editor_client.post(
        "/api/divera/emergencies/bulk-attach",
        json={"event_id": str(test_event.id), "emergency_ids": []},
    )
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
@pytest.mark.api
async def test_bulk_attach_event_not_found(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test bulk attach to non-existent event."""
    response = await editor_client.post(
        "/api/divera/emergencies/bulk-attach",
        json={"event_id": str(uuid4()), "emergency_ids": [str(test_emergency.id)]},
    )
    assert response.status_code == 404


# ============================================
# Archive Emergency Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_emergency_requires_auth(client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that archiving emergency requires authentication."""
    response = await client.delete(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_emergency_viewer_forbidden(viewer_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that viewers cannot archive emergencies."""
    response = await viewer_client.delete(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_emergency_success(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test successfully archiving an emergency."""
    response = await editor_client.delete(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_emergency_not_found(editor_client: AsyncClient):
    """Test archiving non-existent emergency."""
    response = await editor_client.delete(f"/api/divera/emergencies/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_emergency_idempotent(editor_client: AsyncClient, db_session: AsyncSession):
    """Test that archiving same emergency twice is handled gracefully."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=50000,
        title="Archive Test",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    # First archive
    response1 = await editor_client.delete(f"/api/divera/emergencies/{emergency.id}")
    assert response1.status_code == 204

    # Second archive - could be 204 (idempotent) or 404 (already archived)
    response2 = await editor_client.delete(f"/api/divera/emergencies/{emergency.id}")
    assert response2.status_code in [204, 404]


# ============================================
# Incident Type Detection Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_incident_type_detection_fire(editor_client: AsyncClient, test_event: Event, db_session: AsyncSession):
    """Test that fire-related titles detect as brandbekaempfung."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=60000,
        title="FEUER Wohnungsbrand 3. OG",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "brandbekaempfung"


@pytest.mark.asyncio
@pytest.mark.api
async def test_incident_type_detection_traffic(editor_client: AsyncClient, test_event: Event, db_session: AsyncSession):
    """Test that traffic-related titles detect as strassenrettung."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=60001,
        title="VU Verkehrsunfall B27",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "strassenrettung"


@pytest.mark.asyncio
@pytest.mark.api
async def test_incident_type_detection_default(editor_client: AsyncClient, test_event: Event, db_session: AsyncSession):
    """Test that unknown titles default to diverse_einsaetze."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=60002,
        title="Unbekannter Einsatztyp",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["type"] == "diverse_einsaetze"


# ============================================
# Priority Detection Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_priority_detection_high(editor_client: AsyncClient, test_event: Event, db_session: AsyncSession):
    """Test that emergency keywords result in HIGH priority."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=60003,
        title="BRAND Vollbrand Scheune",
        text="Person vermisst",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["priority"] == "high"


@pytest.mark.asyncio
@pytest.mark.api
async def test_priority_detection_low_default(
    editor_client: AsyncClient, test_event: Event, db_session: AsyncSession
):
    """Test that non-critical situations default to LOW priority."""
    emergency = DiveraEmergency(
        id=uuid4(),
        divera_id=60004,
        title="THL Wasserschaden Keller",
        text="Keine Gefahr",
        received_at=datetime.now(UTC),
        is_archived=False,
    )
    db_session.add(emergency)
    await db_session.commit()
    await db_session.refresh(emergency)

    with patch("app.api.divera.broadcast_incident_update", new_callable=AsyncMock):
        response = await editor_client.post(
            f"/api/divera/emergencies/{emergency.id}/attach",
            json={"event_id": str(test_event.id)},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["priority"] == "low"


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_emergency_response_structure(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that emergency response contains all expected fields."""
    response = await editor_client.get(f"/api/divera/emergencies/{test_emergency.id}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = [
        "id",
        "divera_id",
        "title",
        "received_at",
        "is_archived",
        "attached_to_event_id",
    ]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_response_structure(editor_client: AsyncClient, test_emergency: DiveraEmergency):
    """Test that list response contains all expected fields."""
    response = await editor_client.get("/api/divera/emergencies")
    assert response.status_code == 200
    data = response.json()

    assert "emergencies" in data
    assert "total" in data
    assert "unattached_count" in data
    assert isinstance(data["emergencies"], list)
    assert isinstance(data["total"], int)
    assert isinstance(data["unattached_count"], int)
