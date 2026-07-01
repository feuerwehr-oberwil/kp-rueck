"""Tests for Incident API endpoints.

Tests cover:
- CRUD operations (create, read, update, delete)
- Status transitions
- Permission enforcement (editor vs viewer)
- Validation errors
- Edge cases (not found, invalid data)
"""

from datetime import datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Event, Incident, User

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_event(db_session: AsyncSession) -> Event:
    """Create a test event."""
    event = Event(
        id=uuid4(),
        name="Test Event",
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
        title="Test Incident",
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


# ============================================
# List Incidents Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_incidents_requires_auth(client: AsyncClient, test_event: Event):
    """Test that listing incidents requires authentication."""
    response = await client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_incidents_empty(editor_client: AsyncClient, test_event: Event):
    """Test listing incidents when none exist."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_incidents_returns_incidents(editor_client: AsyncClient, test_event: Event, test_incident: Incident):
    """Test listing incidents returns existing incidents."""
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200
    incidents = response.json()
    assert len(incidents) == 1
    assert incidents[0]["id"] == str(test_incident.id)
    assert incidents[0]["title"] == "Test Incident"


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_incidents_requires_event_id(editor_client: AsyncClient):
    """Test that listing incidents requires event_id parameter."""
    response = await editor_client.get("/api/incidents/")
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_incidents_viewer_can_read(viewer_client: AsyncClient, test_event: Event, test_incident: Incident):
    """Test that viewers can list incidents."""
    response = await viewer_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200
    assert len(response.json()) == 1


# ============================================
# Get Single Incident Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_success(editor_client: AsyncClient, test_incident: Incident):
    """Test getting a single incident by ID."""
    response = await editor_client.get(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_incident.id)
    assert data["title"] == "Test Incident"
    assert data["type"] == "brandbekaempfung"
    assert data["priority"] == "medium"
    assert data["status"] == "eingegangen"


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_not_found(editor_client: AsyncClient):
    """Test getting a non-existent incident returns 404."""
    response = await editor_client.get(f"/api/incidents/{uuid4()}")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_incident_invalid_uuid(editor_client: AsyncClient):
    """Test getting incident with invalid UUID returns 422."""
    response = await editor_client.get("/api/incidents/invalid-uuid")
    assert response.status_code == 422


# ============================================
# Create Incident Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_success(editor_client: AsyncClient, test_event: Event):
    """Test creating an incident successfully."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "New Incident",
        "type": "brandbekaempfung",
        "priority": "high",
        "location_address": "Main Street 456",
        "description": "Test description",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "New Incident"
    assert data["type"] == "brandbekaempfung"
    assert data["priority"] == "high"
    assert data["status"] == "eingegangen"  # Default status
    assert data["event_id"] == str(test_event.id)
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_viewer_forbidden(viewer_client: AsyncClient, test_event: Event):
    """Test that viewers cannot create incidents."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "New Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await viewer_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_invalid_event(editor_client: AsyncClient):
    """Test creating incident with non-existent event returns 404."""
    incident_data = {
        "event_id": str(uuid4()),
        "title": "New Incident",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 404
    assert "event not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_missing_required_fields(editor_client: AsyncClient, test_event: Event):
    """Test creating incident without required fields returns 422."""
    # Missing title
    incident_data = {
        "event_id": str(test_event.id),
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_invalid_type(editor_client: AsyncClient, test_event: Event):
    """Test creating incident with invalid type returns 422."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "New Incident",
        "type": "invalid_type",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_invalid_priority(editor_client: AsyncClient, test_event: Event):
    """Test creating incident with invalid priority returns 422."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "New Incident",
        "type": "brandbekaempfung",
        "priority": "invalid",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_with_coordinates(editor_client: AsyncClient, test_event: Event):
    """Test creating incident with lat/lng coordinates."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "Incident with Location",
        "type": "brandbekaempfung",
        "priority": "medium",
        "location_address": "Test Address",
        "location_lat": "47.5596",
        "location_lng": "7.5886",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 201
    data = response.json()
    # Database may add trailing zeros, so compare as floats
    assert float(data["location_lat"]) == pytest.approx(47.5596)
    assert float(data["location_lng"]) == pytest.approx(7.5886)


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_invalid_latitude(editor_client: AsyncClient, test_event: Event):
    """Test creating incident with invalid latitude returns 422."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "New Incident",
        "type": "brandbekaempfung",
        "priority": "high",
        "location_lat": "100.0",  # Invalid: > 90
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


# ============================================
# Update Incident Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_incident_success(editor_client: AsyncClient, test_incident: Incident):
    """Test updating an incident successfully."""
    update_data = {
        "title": "Updated Title",
        "priority": "high",
    }
    response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["priority"] == "high"
    # Unchanged fields should remain
    assert data["type"] == "brandbekaempfung"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_incident_viewer_forbidden(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot update incidents."""
    update_data = {"title": "Updated Title"}
    response = await viewer_client.patch(f"/api/incidents/{test_incident.id}", json=update_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_incident_not_found(editor_client: AsyncClient):
    """Test updating non-existent incident returns 404."""
    update_data = {"title": "Updated Title"}
    response = await editor_client.patch(f"/api/incidents/{uuid4()}", json=update_data)
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_incident_partial(editor_client: AsyncClient, test_incident: Incident):
    """Test partial update only changes specified fields."""
    original_type = test_incident.type
    update_data = {"description": "New description"}
    response = await editor_client.patch(f"/api/incidents/{test_incident.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["description"] == "New description"
    assert data["type"] == original_type  # Unchanged


# ============================================
# Status Update Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_status_success(editor_client: AsyncClient, test_incident: Incident):
    """Test updating incident status."""
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
        "notes": "Sending reko team",
    }
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "reko"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_status_viewer_forbidden(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot update incident status."""
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
    }
    response = await viewer_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_status_not_found(editor_client: AsyncClient):
    """Test updating status of non-existent incident returns 404."""
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
    }
    response = await editor_client.post(f"/api/incidents/{uuid4()}/status", json=status_data)
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_status_history(editor_client: AsyncClient, test_incident: Incident):
    """Test getting status history for an incident."""
    # First make a status change
    status_data = {
        "from_status": "eingegangen",
        "to_status": "reko",
    }
    await editor_client.post(f"/api/incidents/{test_incident.id}/status", json=status_data)

    # Get history
    response = await editor_client.get(f"/api/incidents/{test_incident.id}/history")
    assert response.status_code == 200
    history = response.json()
    assert len(history) >= 1
    assert history[0]["to_status"] == "reko"


# ============================================
# Delete Incident Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_incident_success(editor_client: AsyncClient, test_incident: Incident, test_event: Event):
    """Test deleting an incident successfully (soft delete)."""
    response = await editor_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 204

    # Verify it's no longer in the list (soft deleted incidents are excluded from list)
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert response.status_code == 200
    incidents = response.json()
    incident_ids = [i["id"] for i in incidents]
    assert str(test_incident.id) not in incident_ids


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_incident_viewer_forbidden(viewer_client: AsyncClient, test_incident: Incident):
    """Test that viewers cannot delete incidents."""
    response = await viewer_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_incident_not_found(editor_client: AsyncClient):
    """Test deleting non-existent incident returns 404."""
    response = await editor_client.delete(f"/api/incidents/{uuid4()}")
    assert response.status_code == 404


# ============================================
# Restore Incident Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_round_trip(
    editor_client: AsyncClient, test_incident: Incident, test_event: Event, db_session: AsyncSession
):
    """Delete then restore: the card leaves and re-enters the list, deleted_at cleared."""
    # Delete
    response = await editor_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 204

    # Excluded from list
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert str(test_incident.id) not in [i["id"] for i in response.json()]

    # Restore
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 200
    assert response.json()["id"] == str(test_incident.id)

    # Back in the list
    response = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    assert str(test_incident.id) in [i["id"] for i in response.json()]

    # deleted_at cleared in the DB
    await db_session.refresh(test_incident)
    assert test_incident.deleted_at is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_clears_side_effect_completed_at(
    editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
):
    """An incident without completed_at → delete (stamps it) → restore clears it."""
    assert test_incident.completed_at is None

    response = await editor_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 204

    # Delete stamped completed_at as a side effect (== deleted_at)
    await db_session.refresh(test_incident)
    assert test_incident.completed_at is not None
    assert test_incident.completed_at == test_incident.deleted_at

    response = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 200

    # Restore recognized it as a side effect and cleared it
    await db_session.refresh(test_incident)
    assert test_incident.completed_at is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_preserves_prior_completed_at(
    editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
):
    """An incident with a pre-existing completed_at keeps it through delete+restore."""
    test_incident.completed_at = datetime(2026, 1, 1, 12, 0, 0)
    await db_session.commit()
    # Capture the canonical DB form (tz-aware) so later comparisons are like-for-like.
    await db_session.refresh(test_incident)
    completed = test_incident.completed_at
    assert completed is not None

    response = await editor_client.delete(f"/api/incidents/{test_incident.id}")
    assert response.status_code == 204

    # deleted_at differs from the pre-existing completed_at
    await db_session.refresh(test_incident)
    assert test_incident.completed_at == completed
    assert test_incident.deleted_at != completed

    response = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 200

    await db_session.refresh(test_incident)
    assert test_incident.completed_at == completed


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_not_deleted_conflict(editor_client: AsyncClient, test_incident: Incident):
    """Restoring an incident that is not deleted returns 409 (idempotency guard)."""
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 409


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_double_click_is_harmless(editor_client: AsyncClient, test_incident: Incident):
    """A double-click on undo: first restore succeeds, second 409s harmlessly."""
    await editor_client.delete(f"/api/incidents/{test_incident.id}")

    first = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert first.status_code == 200

    second = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert second.status_code == 409


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_not_found(editor_client: AsyncClient):
    """Restoring an unknown incident returns 404."""
    response = await editor_client.post(f"/api/incidents/{uuid4()}/restore")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_viewer_forbidden(viewer_client: AsyncClient, test_incident: Incident):
    """Viewers cannot restore incidents."""
    response = await viewer_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_requires_auth(client: AsyncClient, test_incident: Incident):
    """Unauthenticated restore is rejected."""
    response = await client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_incident_writes_audit_log(
    editor_client: AsyncClient, test_incident: Incident, db_session: AsyncSession
):
    """A successful restore writes an audit_log row with action 'restore'."""
    await editor_client.delete(f"/api/incidents/{test_incident.id}")
    response = await editor_client.post(f"/api/incidents/{test_incident.id}/restore")
    assert response.status_code == 200

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.action_type == "restore",
            AuditLog.resource_id == test_incident.id,
        )
    )
    audit_rows = result.scalars().all()
    assert len(audit_rows) >= 1
    assert audit_rows[0].resource_type == "incident"


# ============================================
# Edge Cases and Validation Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_empty_title(editor_client: AsyncClient, test_event: Event):
    """Test that empty title is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_whitespace_title(editor_client: AsyncClient, test_event: Event):
    """Test that whitespace-only title is rejected."""
    incident_data = {
        "event_id": str(test_event.id),
        "title": "   ",
        "type": "brandbekaempfung",
        "priority": "high",
    }
    response = await editor_client.post("/api/incidents/", json=incident_data)
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_all_types(editor_client: AsyncClient, test_event: Event):
    """Test creating incidents with all valid incident types."""
    valid_types = [
        "brandbekaempfung",
        "elementarereignis",
        "strassenrettung",
        "technische_hilfeleistung",
        "oelwehr",
        "chemiewehr",
        "strahlenwehr",
        "einsatz_bahnanlagen",
        "bma_unechte_alarme",
        "dienstleistungen",
        "diverse_einsaetze",
        "gerettete_menschen",
        "gerettete_tiere",
    ]
    for incident_type in valid_types:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Test {incident_type}",
            "type": incident_type,
            "priority": "medium",
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for type: {incident_type}"


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_incident_all_priorities(editor_client: AsyncClient, test_event: Event):
    """Test creating incidents with all valid priorities."""
    priorities = ["low", "medium", "high"]
    for priority in priorities:
        incident_data = {
            "event_id": str(test_event.id),
            "title": f"Test {priority}",
            "type": "brandbekaempfung",
            "priority": priority,
        }
        response = await editor_client.post("/api/incidents/", json=incident_data)
        assert response.status_code == 201, f"Failed for priority: {priority}"


# ============================================
# Reorder Tests (manual board ordering)
# ============================================


@pytest_asyncio.fixture
async def three_incidents(db_session: AsyncSession, test_event: Event, test_editor: User) -> list[Incident]:
    """Three incidents in the same status column, positions 0,1,2."""
    incidents = []
    for i in range(3):
        incident = Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=f"Incident {i}",
            type="brandbekaempfung",
            priority="medium",
            status="eingegangen",
            position=i,
            created_by=test_editor.id,
        )
        db_session.add(incident)
        incidents.append(incident)
    await db_session.commit()
    for incident in incidents:
        await db_session.refresh(incident)
    return incidents


@pytest.mark.asyncio
@pytest.mark.api
async def test_reorder_incidents_persists_order(
    editor_client: AsyncClient, test_event: Event, three_incidents: list[Incident]
):
    """Reordering writes positions so the next GET reproduces the new order."""
    # Reverse the column order: [2, 1, 0]
    new_order = [str(three_incidents[2].id), str(three_incidents[1].id), str(three_incidents[0].id)]
    response = await editor_client.post(
        "/api/incidents/reorder",
        json={"event_id": str(test_event.id), "ordered_ids": new_order},
    )
    assert response.status_code == 204

    listed = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    returned_ids = [inc["id"] for inc in listed.json()]
    assert returned_ids == new_order
    # Positions are 0,1,2 in the new order.
    by_id = {inc["id"]: inc["position"] for inc in listed.json()}
    assert [by_id[i] for i in new_order] == [0, 1, 2]


@pytest.mark.asyncio
@pytest.mark.api
async def test_reorder_incidents_viewer_forbidden(
    viewer_client: AsyncClient, test_event: Event, three_incidents: list[Incident]
):
    """Viewers cannot reorder the board."""
    response = await viewer_client.post(
        "/api/incidents/reorder",
        json={"event_id": str(test_event.id), "ordered_ids": [str(three_incidents[0].id)]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_reorder_incidents_ignores_foreign_ids(
    editor_client: AsyncClient, test_event: Event, three_incidents: list[Incident]
):
    """Unknown / other-event ids are ignored rather than corrupting order."""
    response = await editor_client.post(
        "/api/incidents/reorder",
        json={
            "event_id": str(test_event.id),
            "ordered_ids": [str(three_incidents[1].id), str(uuid4()), str(three_incidents[0].id)],
        },
    )
    assert response.status_code == 204

    listed = await editor_client.get(f"/api/incidents/?event_id={test_event.id}")
    by_id = {inc["id"]: inc["position"] for inc in listed.json()}
    # Index 0 and 2 in the request → positions 0 and 2; the stray uuid at index 1 is skipped.
    assert by_id[str(three_incidents[1].id)] == 0
    assert by_id[str(three_incidents[0].id)] == 2
