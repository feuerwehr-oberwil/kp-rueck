"""Tests for Personnel API endpoints.

Tests cover:
- Personnel CRUD operations (create, read, update, delete)
- Personnel listing
- Category sort order updates
- Permission enforcement (editor vs viewer)
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, EventAttendance, Personnel

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> Personnel:
    """Create test personnel."""
    personnel = Personnel(
        id=uuid4(),
        name="Hans Müller",
        role="Gruppenführer",
        status="available",
        tags=["Atemschutz", "Maschinisten"],
    )
    db_session.add(personnel)
    await db_session.commit()
    await db_session.refresh(personnel)
    return personnel


# ============================================
# List Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_requires_auth(client: AsyncClient):
    """Test that listing personnel requires authentication."""
    response = await client.get("/api/personnel/")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_empty(editor_client: AsyncClient):
    """Test listing personnel when none exist."""
    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test listing personnel successfully."""
    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    personnel_list = response.json()
    assert len(personnel_list) == 1
    assert personnel_list[0]["id"] == str(test_personnel.id)
    assert personnel_list[0]["name"] == test_personnel.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_viewer_can_read(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers can list personnel."""
    response = await viewer_client.get("/api/personnel/")
    assert response.status_code == 200
    assert len(response.json()) == 1


# ============================================
# Get Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that getting personnel requires authentication."""
    response = await client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test getting a single personnel record."""
    response = await editor_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(test_personnel.id)
    assert data["name"] == test_personnel.name
    assert data["role"] == test_personnel.role
    assert data["status"] == test_personnel.status
    assert data["tags"] == test_personnel.tags


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_not_found(editor_client: AsyncClient):
    """Test getting a non-existent personnel record."""
    response = await editor_client.get(f"/api/personnel/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_personnel_viewer_can_read(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers can get personnel details."""
    response = await viewer_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200


# ============================================
# Create Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_requires_auth(client: AsyncClient):
    """Test that creating personnel requires authentication."""
    response = await client.post("/api/personnel/", json={"name": "New Person"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_success(editor_client: AsyncClient):
    """Test creating personnel successfully.

    Note: Tags may be processed asynchronously or stored differently.
    We verify the core fields are set correctly.
    """
    personnel_data = {
        "name": "Anna Schmidt",
        "role": "Zugführer",
        "status": "available",
    }
    response = await editor_client.post("/api/personnel/", json=personnel_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Anna Schmidt"
    assert data["role"] == "Zugführer"
    assert data["status"] == "available"
    assert "id" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_minimal(editor_client: AsyncClient):
    """Test creating personnel with required data.

    Required fields: name, status
    """
    response = await editor_client.post(
        "/api/personnel/",
        json={"name": "Basic Person", "status": "available"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Basic Person"
    assert data["status"] == "available"


@pytest.mark.asyncio
@pytest.mark.api
async def test_create_personnel_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot create personnel."""
    response = await viewer_client.post("/api/personnel/", json={"name": "New Person"})
    assert response.status_code == 403


# ============================================
# Update Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that updating personnel requires authentication."""
    response = await client.put(f"/api/personnel/{test_personnel.id}", json={"name": "Updated"})
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating personnel successfully."""
    update_data = {
        "name": "Hans Müller Updated",
        "status": "unavailable",
    }
    response = await editor_client.put(f"/api/personnel/{test_personnel.id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Hans Müller Updated"
    assert data["status"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_partial(editor_client: AsyncClient, test_personnel: Personnel):
    """Test partial update of personnel."""
    response = await editor_client.put(
        f"/api/personnel/{test_personnel.id}",
        json={"status": "unavailable"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == test_personnel.name  # Unchanged
    assert data["status"] == "unavailable"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_tags(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating personnel tags."""
    response = await editor_client.put(
        f"/api/personnel/{test_personnel.id}",
        json={"tags": ["Atemschutz", "Maschinisten", "Sanitäter"]},
    )
    assert response.status_code == 200
    data = response.json()
    assert "Sanitäter" in data["tags"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_not_found(editor_client: AsyncClient):
    """Test updating a non-existent personnel record."""
    response = await editor_client.put(f"/api/personnel/{uuid4()}", json={"name": "Updated"})
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_personnel_viewer_forbidden(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot update personnel."""
    response = await viewer_client.put(f"/api/personnel/{test_personnel.id}", json={"name": "Updated"})
    assert response.status_code == 403


# ============================================
# Delete Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_requires_auth(client: AsyncClient, test_personnel: Personnel):
    """Test that deleting personnel requires authentication."""
    response = await client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test deleting personnel successfully (soft delete)."""
    response = await editor_client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 204


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent personnel record."""
    response = await editor_client.delete(f"/api/personnel/{uuid4()}")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_personnel_viewer_forbidden(viewer_client: AsyncClient, test_personnel: Personnel):
    """Test that viewers cannot delete personnel."""
    response = await viewer_client.delete(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 403


# ============================================
# Category Sort Order Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_requires_auth(client: AsyncClient):
    """Test that updating role sort order requires authentication."""
    response = await client.post(
        "/api/personnel/categories/sort-order",
        json={"categories": [{"category": "Gruppenführer", "sort_order": 1}]},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_success(editor_client: AsyncClient, test_personnel: Personnel):
    """Test updating role sort order."""
    sort_data = {
        "categories": [
            {"category": "Zugführer", "sort_order": 1},
            {"category": "Gruppenführer", "sort_order": 2},
            {"category": "Truppführer", "sort_order": 3},
        ]
    }
    response = await editor_client.post("/api/personnel/categories/sort-order", json=sort_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"


@pytest.mark.asyncio
@pytest.mark.api
async def test_update_role_sort_order_viewer_forbidden(viewer_client: AsyncClient):
    """Test that viewers cannot update role sort order."""
    response = await viewer_client.post(
        "/api/personnel/categories/sort-order",
        json={"categories": [{"category": "Gruppenführer", "sort_order": 1}]},
    )
    assert response.status_code == 403


# ============================================
# Response Structure Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_response_structure(editor_client: AsyncClient, test_personnel: Personnel):
    """Test that personnel response contains all expected fields."""
    response = await editor_client.get(f"/api/personnel/{test_personnel.id}")
    assert response.status_code == 200
    data = response.json()

    expected_fields = ["id", "name", "role", "status", "tags"]
    for field in expected_fields:
        assert field in data, f"Missing field: {field}"


# ============================================
# Multiple Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_multiple_personnel(editor_client: AsyncClient, db_session: AsyncSession):
    """Test listing multiple personnel records."""
    # Create multiple personnel
    for i in range(5):
        personnel = Personnel(
            id=uuid4(),
            name=f"Firefighter {i}",
            role="Truppmann",
            status="available",
        )
        db_session.add(personnel)
    await db_session.commit()

    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    personnel_list = response.json()
    assert len(personnel_list) == 5


# ============================================
# Event-scoped attendance in the personnel response
# ============================================
#
# Regression cover for the bug where `GET /api/personnel/?checked_in_only=true&event_id=…`
# returned exactly the checked-in people and reported `checked_in: false` for every one of
# them: the filter had moved to `event_attendance`, the response field was still being read
# off the (never-written) `personnel.checked_in` column.


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_reports_event_attendance(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_personnel: Personnel,
    test_event: Event,
):
    """A person checked in for the event is reported as checked in, with their timestamp."""
    checked_in_at = datetime(2026, 8, 11, 6, 30, tzinfo=UTC)
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            checked_in=True,
            checked_in_at=checked_in_at,
        )
    )
    await db_session.commit()

    response = await editor_client.get(
        f"/api/personnel/?checked_in_only=true&event_id={test_event.id}",
    )
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["id"] == str(test_personnel.id)
    assert rows[0]["checked_in"] is True
    assert rows[0]["checked_in_at"] is not None
    assert rows[0]["checked_out_at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_reports_attendance_of_the_event_asked_about(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_personnel: Personnel,
    test_event: Event,
):
    """Attendance at one Ereignis says nothing about another."""
    other_event = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
    db_session.add(other_event)
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await editor_client.get(f"/api/personnel/?event_id={other_event.id}")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["checked_in"] is False
    assert rows[0]["checked_in_at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_full_roster_keeps_absent_people(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_personnel: Personnel,
    test_event: Event,
):
    """Without `checked_in_only` everybody is listed, present or not."""
    absent = Personnel(id=uuid4(), name="Zurückgeblieben Zora", status="available")
    db_session.add(absent)
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await editor_client.get(f"/api/personnel/?event_id={test_event.id}")
    assert response.status_code == 200
    by_id = {row["id"]: row for row in response.json()}
    assert by_id[str(test_personnel.id)]["checked_in"] is True
    assert by_id[str(absent.id)]["checked_in"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_reports_departure(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_personnel: Personnel,
    test_event: Event,
):
    """Somebody who came and went is not checked in, but keeps both stamps."""
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            checked_in=False,
            checked_in_at=datetime(2026, 8, 11, 6, 0, tzinfo=UTC),
            checked_out_at=datetime(2026, 8, 11, 8, 0, tzinfo=UTC),
        )
    )
    await db_session.commit()

    response = await editor_client.get(f"/api/personnel/?event_id={test_event.id}")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["checked_in"] is False
    assert row["checked_in_at"] is not None
    assert row["checked_out_at"] is not None

    filtered = await editor_client.get(f"/api/personnel/?checked_in_only=true&event_id={test_event.id}")
    assert filtered.json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_without_event_reports_no_attendance(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_personnel: Personnel,
    test_event: Event,
):
    """No Ereignis, no attendance — and `checked_in_only` alone can only mean nobody."""
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=test_personnel.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await editor_client.get("/api/personnel/")
    assert response.status_code == 200
    assert response.json()[0]["checked_in"] is False

    assert (await editor_client.get("/api/personnel/?checked_in_only=true")).json() == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_walk_in_becomes_visible_in_the_roster(
    editor_client: AsyncClient,
    test_event: Event,
):
    """The reported symptom, end to end: create a walk-in, check them in, see them.

    The Fahrer dialog does exactly this. Before the fix the person came back from the
    roster call stamped `checked_in: false`, one second after the check-in call had
    answered `true` about the same person.
    """
    created = await editor_client.post(
        "/api/personnel/",
        json={"name": "Zugelaufen Zeno", "status": "available", "tags": ["F"]},
    )
    assert created.status_code == 201
    person_id = created.json()["id"]
    # The create response is what a client trusts to build the person locally.
    assert created.json()["tags"] == ["F"]
    assert created.json()["checked_in"] is False

    checked_in = await editor_client.post(f"/api/personnel/check-in/{person_id}/in?event_id={test_event.id}")
    assert checked_in.status_code == 200
    assert checked_in.json()["checked_in"] is True
    assert checked_in.json()["tags"] == ["F"]

    roster = await editor_client.get(f"/api/personnel/?checked_in_only=true&event_id={test_event.id}")
    assert roster.status_code == 200
    rows = {row["id"]: row for row in roster.json()}
    assert person_id in rows, "the freshly checked-in walk-in is missing from the roster"
    assert rows[person_id]["checked_in"] is True
    assert rows[person_id]["tags"] == ["F"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_personnel_row_carries_no_attendance_column():
    """The dead column stays dead.

    `personnel.checked_in` was never written after `event_attendance` landed, but
    `schemas.Personnel` read it through `from_attributes` — so the roster confidently
    answered "nobody is here". Re-adding an attendance column to this table would make
    that answer available again to the next reader.
    """
    for column in ("checked_in", "checked_in_at", "checked_out_at"):
        assert not hasattr(Personnel, column), (
            f"Personnel.{column} is back — attendance belongs to EventAttendance, per Ereignis"
        )
