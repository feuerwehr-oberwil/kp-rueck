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
async def test_delete_vehicle_archives_and_removes_it_from_the_board(editor_client: AsyncClient, test_vehicle: Vehicle):
    """Deleting archives — and the row genuinely leaves the default listing."""
    response = await editor_client.delete(f"/api/vehicles/{test_vehicle.id}")
    assert response.status_code == 204

    listed = await editor_client.get("/api/vehicles/")
    assert listed.json() == []

    with_archive = await editor_client.get("/api/vehicles/?include_archived=true")
    rows = with_archive.json()
    assert len(rows) == 1
    assert rows[0]["archived_at"] is not None
    assert rows[0]["out_of_service"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_restore_vehicle_brings_it_back(editor_client: AsyncClient, test_vehicle: Vehicle):
    """«Zurückholen» is a button, not a trick via Bearbeiten → Status."""
    await editor_client.delete(f"/api/vehicles/{test_vehicle.id}")

    response = await editor_client.post(f"/api/vehicles/{test_vehicle.id}/restore")
    assert response.status_code == 200
    assert response.json()["archived_at"] is None
    assert len((await editor_client.get("/api/vehicles/")).json()) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_archive_refused_while_the_vehicle_stands_on_a_live_einsatz(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_incident_for_vehicle: "Incident",
):
    """Archiving mid-deployment would vanish the vehicle off a card an operator is working — 409.

    Same pattern as the purge's `in_use` refusal; closing the assignment reopens
    the normal retirement path.
    """
    from datetime import UTC, datetime

    from app.models import IncidentAssignment

    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=test_incident_for_vehicle.id,
        resource_type="vehicle",
        resource_id=test_vehicle.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    refused = await editor_client.post(f"/api/vehicles/{test_vehicle.id}/archive")
    assert refused.status_code == 409
    assert test_vehicle.name in refused.json()["detail"]

    # The default DELETE is the same archive — same refusal.
    assert (await editor_client.delete(f"/api/vehicles/{test_vehicle.id}")).status_code == 409

    assignment.unassigned_at = datetime.now(UTC)
    await db_session.commit()
    assert (await editor_client.post(f"/api/vehicles/{test_vehicle.id}/archive")).status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_permanent_delete_requires_archiving_first(editor_client: AsyncClient, test_vehicle: Vehicle):
    """The irreversible action takes two deliberate steps."""
    response = await editor_client.delete(f"/api/vehicles/{test_vehicle.id}?permanent=true")
    assert response.status_code == 409

    await editor_client.post(f"/api/vehicles/{test_vehicle.id}/archive")
    response = await editor_client.delete(f"/api/vehicles/{test_vehicle.id}?permanent=true")
    assert response.status_code == 204
    assert (await editor_client.get(f"/api/vehicles/{test_vehicle.id}")).status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_out_of_service_is_its_own_state(editor_client: AsyncClient, test_vehicle: Vehicle):
    """The board can no longer overwrite a recorded defect — it is a flag with a date."""
    response = await editor_client.put(f"/api/vehicles/{test_vehicle.id}", json={"out_of_service": True})
    assert response.status_code == 200
    data = response.json()
    assert data["out_of_service"] is True
    assert data["out_of_service_since"] is not None
    assert data["archived_at"] is None
    assert data["status"] == "unavailable"  # legacy mirror stays in lockstep


@pytest.mark.asyncio
@pytest.mark.api
async def test_delete_vehicle_not_found(editor_client: AsyncClient):
    """Test deleting a non-existent vehicle."""
    response = await editor_client.delete(f"/api/vehicles/{uuid4()}")
    assert response.status_code == 404


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

    expected_fields = [
        "id",
        "name",
        "type",
        "status",
        "display_order",
        "radio_call_sign",
        "out_of_service",
        "out_of_service_since",
        "archived_at",
        "assignment_count",
        "can_delete",
    ]
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
async def test_incident_for_vehicle(db_session: AsyncSession, test_event: "Event", test_editor: User) -> "Incident":
    """Create a test incident."""
    from app.models import Incident

    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Vehicle Test Incident",
        type="brandbekaempfung",
        priority="medium",
        status="active",
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
        status="available",
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
    from datetime import UTC, datetime

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
    from datetime import UTC, datetime, timedelta

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


async def _statuses(client: AsyncClient, event_id) -> dict[str, dict]:
    """GET /api/vehicles/status for one event, keyed by vehicle id."""
    response = await client.get(f"/api/vehicles/status?event_id={event_id}")
    assert response.status_code == 200
    return {row["id"]: row for row in response.json()}


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_require_auth(client: AsyncClient):
    assert (await client.get(f"/api/vehicles/status?event_id={uuid4()}")).status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_require_event(editor_client: AsyncClient):
    assert (await editor_client.get("/api/vehicles/status")).status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_idle_vehicle(viewer_client: AsyncClient, test_vehicle: Vehicle, test_event: "Event"):
    """Viewers read it too; an idle vehicle has no driver and no deployments."""
    row = (await _statuses(viewer_client, test_event.id))[str(test_vehicle.id)]
    assert row["name"] == test_vehicle.name
    assert row["radio_call_sign"] == test_vehicle.radio_call_sign
    assert row["driver_id"] is None
    assert row["deployments"] == []


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_leave_out_archived(
    editor_client: AsyncClient, db_session: AsyncSession, test_vehicle: Vehicle, test_event: "Event"
):
    from datetime import UTC, datetime

    test_vehicle.archived_at = datetime.now(UTC)
    await db_session.commit()
    assert str(test_vehicle.id) not in await _statuses(editor_client, test_event.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_driver_only_in_its_event(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    vehicle_with_driver: Vehicle,
    test_event: "Event",
    test_personnel_driver: "Personnel",
):
    from app.models import Event

    other = Event(id=uuid4(), name="Other", training_flag=False)
    db_session.add(other)
    await db_session.commit()

    row = (await _statuses(editor_client, test_event.id))[str(vehicle_with_driver.id)]
    assert row["driver_id"] == str(test_personnel_driver.id)
    assert row["driver_name"] == test_personnel_driver.name
    assert (await _statuses(editor_client, other.id))[str(vehicle_with_driver.id)]["driver_id"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_deployment(
    editor_client: AsyncClient,
    vehicle_with_incident_assignment: Vehicle,
    test_event: "Event",
    test_incident_for_vehicle: "Incident",
):
    [deployment] = (await _statuses(editor_client, test_event.id))[str(vehicle_with_incident_assignment.id)][
        "deployments"
    ]
    assert deployment["incident_id"] == str(test_incident_for_vehicle.id)
    assert deployment["title"] == test_incident_for_vehicle.title
    assert deployment["status"] == test_incident_for_vehicle.status
    assert 29 <= deployment["duration_minutes"] <= 31


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_list_every_einsatz_oldest_first(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_event: "Event",
    test_editor: User,
):
    """A vehicle serving two Einsätze shows both – not one picked at random.

    Closed and deleted assignments, and other events, stay out.
    """
    from datetime import UTC, datetime, timedelta

    from app.models import Event, Incident, IncidentAssignment

    other_event = Event(id=uuid4(), name="Other", training_flag=False)
    db_session.add(other_event)
    now = datetime.now(UTC)

    def incident(title: str, event_id=test_event.id, **extra) -> Incident:
        row = Incident(
            id=uuid4(),
            event_id=event_id,
            title=title,
            type="brandbekaempfung",
            priority="medium",
            status="active",
            created_by=test_editor.id,
            **extra,
        )
        db_session.add(row)
        return row

    newer = incident("Blumenweg 21")
    older = incident("Hauptstrasse 1")
    closed = incident("Closed")
    deleted = incident("Deleted", deleted_at=now)
    elsewhere = incident("Elsewhere", event_id=other_event.id)
    await db_session.flush()

    def assign(target: Incident, minutes_ago: int, **extra) -> None:
        db_session.add(
            IncidentAssignment(
                id=uuid4(),
                incident_id=target.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                assigned_at=now - timedelta(minutes=minutes_ago),
                **extra,
            )
        )

    assign(newer, 5)
    assign(older, 40)
    assign(closed, 60, unassigned_at=now - timedelta(minutes=50))
    assign(deleted, 30)
    assign(elsewhere, 20)
    await db_session.commit()

    deployments = (await _statuses(editor_client, test_event.id))[str(test_vehicle.id)]["deployments"]
    assert [d["title"] for d in deployments] == ["Hauptstrasse 1", "Blumenweg 21"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_list_its_auftraege_before_its_einsaetze(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    test_vehicle: Vehicle,
    test_event: "Event",
    test_editor: User,
):
    """A vehicle that only drives an Auftrag is deployed too (Sol review S4).

    The Auftrag comes first and opens its first stop with work ahead; a direct
    assignment on a stop of that Auftrag is listed too (pass 2, S4).
    """
    from datetime import UTC, datetime, timedelta

    from app.models import Incident, IncidentAssignment, IncidentGroup, IncidentGroupAssignment

    now = datetime.now(UTC)
    route = IncidentGroup(id=uuid4(), event_id=test_event.id, name="Nord", color="#336699")
    db_session.add(route)
    await db_session.flush()

    def incident(title: str, status: str = "active", **extra) -> Incident:
        row = Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=title,
            type="brandbekaempfung",
            priority="medium",
            status=status,
            created_by=test_editor.id,
            **extra,
        )
        db_session.add(row)
        return row

    incident("Stopp 1", status="complete", group_id=route.id, group_position=0)
    ahead = incident("Stopp 2", status="enroute", group_id=route.id, group_position=1)
    lone = incident("Blumenweg 21")
    await db_session.flush()
    db_session.add_all(
        [
            IncidentGroupAssignment(
                id=uuid4(),
                incident_group_id=route.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                assigned_at=now - timedelta(minutes=10),
            ),
            # An Einsatz-level row on its own route's stop, older than the route row.
            IncidentAssignment(
                id=uuid4(),
                incident_id=ahead.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                assigned_at=now - timedelta(minutes=50),
            ),
            IncidentAssignment(
                id=uuid4(),
                incident_id=lone.id,
                resource_type="vehicle",
                resource_id=test_vehicle.id,
                assigned_at=now - timedelta(minutes=30),
            ),
        ]
    )
    await db_session.commit()

    deployments = (await _statuses(editor_client, test_event.id))[str(test_vehicle.id)]["deployments"]
    assert [(d["kind"], d.get("name") or d["title"]) for d in deployments] == [
        ("auftrag", "Nord"),
        ("einsatz", "Stopp 2"),
        ("einsatz", "Blumenweg 21"),
    ]
    assert deployments[0]["group_id"] == str(route.id)
    assert deployments[0]["color"] == "#336699"
    assert deployments[0]["incident_id"] == str(ahead.id)


@pytest.mark.asyncio
@pytest.mark.api
async def test_vehicle_statuses_location_display(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    vehicle_with_incident_assignment: Vehicle,
    test_event: "Event",
    test_incident_for_vehicle: "Incident",
):
    """The deployment label comes computed: home city stripped, the title when there is no address."""
    from app.models import Setting

    db_session.add(Setting(key="home_city", value="Oberwil, BL"))
    test_incident_for_vehicle.location_address = "Hauptstrasse 123, 4104 Oberwil"
    await db_session.commit()
    [deployment] = (await _statuses(editor_client, test_event.id))[str(vehicle_with_incident_assignment.id)][
        "deployments"
    ]
    assert deployment["location_address"] == "Hauptstrasse 123, 4104 Oberwil"
    assert deployment["location_display"] == "Hauptstrasse 123"

    test_incident_for_vehicle.location_address = None
    test_incident_for_vehicle.title = "Muehlemattstrasse 4, Oberwil"
    await db_session.commit()
    [deployment] = (await _statuses(editor_client, test_event.id))[str(vehicle_with_incident_assignment.id)][
        "deployments"
    ]
    assert deployment["location_display"] == "Muehlemattstrasse 4"
