"""Tests for Stats API endpoints.

Tests cover:
- Event statistics retrieval
- Status counts calculation
- Personnel availability tracking
- Average duration calculation
- Resource utilization metrics
- Permission enforcement
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, EventAttendance, Incident, IncidentAssignment, Personnel, User

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
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id=uuid4(),
        username="stats_user",
        password_hash=hash_password("userpass123abc"),
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
        name="Stats Test Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_event_with_incidents(db_session: AsyncSession, test_event: Event) -> Event:
    """Create an event with incidents in various statuses."""
    statuses = ["eingegangen", "reko", "disponiert", "einsatz", "einsatz_beendet", "abschluss"]

    for i, status in enumerate(statuses):
        incident = Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=f"Incident {i}",
            type="brandbekaempfung",
            status=status,
            priority="medium",
            location_address=f"Street {i}",
            created_at=datetime.now(UTC),
        )
        db_session.add(incident)

    await db_session.commit()
    return test_event


@pytest_asyncio.fixture
async def test_event_with_personnel(db_session: AsyncSession, test_event: Event) -> tuple[Event, list[Personnel]]:
    """Create an event with checked-in personnel."""
    personnel_list = []

    # Create personnel with different base availability states
    # Note: "assigned" is now a runtime status based on incident_assignments, not a base status
    for i, availability in enumerate(["available", "available", "available", "unavailable"]):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="atemschutz",
            availability=availability,
        )
        db_session.add(person)
        personnel_list.append(person)

    await db_session.commit()

    # Check in the first 3 personnel (available ones)
    for person in personnel_list[:3]:  # First 3 personnel
        await db_session.refresh(person)
        attendance = EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=person.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
        db_session.add(attendance)

    await db_session.commit()
    return test_event, personnel_list


@pytest_asyncio.fixture
async def authenticated_client(client: AsyncClient, test_user: User) -> AsyncClient:
    """Create an authenticated client."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "stats_user", "password": "userpass123abc"},
    )
    assert response.status_code == 200
    return client


# ============================================
# Event Stats Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_requires_auth(client: AsyncClient, test_event: Event):
    """Test that getting stats requires authentication."""
    response = await client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_event_not_found(authenticated_client: AsyncClient):
    """Test getting stats for non-existent event."""
    response = await authenticated_client.get(f"/api/events/{uuid4()}/stats")
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_empty_event(authenticated_client: AsyncClient, test_event: Event):
    """Test getting stats for event with no incidents."""
    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    assert "status_counts" in data
    assert "personnel_available" in data
    assert "personnel_total" in data
    assert "avg_duration_minutes" in data
    assert "resource_utilization_percent" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_status_counts(authenticated_client: AsyncClient, test_event_with_incidents: Event):
    """Test that status counts are correct."""
    response = await authenticated_client.get(f"/api/events/{test_event_with_incidents.id}/stats")
    assert response.status_code == 200

    data = response.json()
    status_counts = data["status_counts"]

    # Each status should have exactly 1 incident
    assert status_counts.get("eingegangen", 0) == 1
    assert status_counts.get("reko", 0) == 1
    assert status_counts.get("disponiert", 0) == 1
    assert status_counts.get("einsatz", 0) == 1
    assert status_counts.get("einsatz_beendet", 0) == 1
    assert status_counts.get("abschluss", 0) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_personnel_counts(
    authenticated_client: AsyncClient, test_event_with_personnel: tuple[Event, list[Personnel]]
):
    """Test that personnel counts are correct."""
    event, _ = test_event_with_personnel

    response = await authenticated_client.get(f"/api/events/{event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    # 3 personnel checked in (all with base availability 'available')
    assert data["personnel_total"] == 3
    # All 3 personnel marked as available (base status)
    assert data["personnel_available"] == 3


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_resource_utilization(
    db_session: AsyncSession,
    authenticated_client: AsyncClient,
    test_event_with_personnel: tuple[Event, list[Personnel]],
    test_user: User,
):
    """Test that resource utilization is calculated correctly based on incident assignments."""
    event, personnel = test_event_with_personnel

    # Create an incident and assign one personnel to it
    incident = Incident(
        id=uuid4(),
        event_id=event.id,
        title="Test Incident",
        type="brandbekaempfung",
        status="einsatz",
        priority="medium",
        location_address="Test Street",
    )
    db_session.add(incident)
    await db_session.flush()

    # Assign first personnel to the incident
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=personnel[0].id,
        assigned_by=test_user.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    # 1 assigned out of 3 checked in = 33.3%
    utilization = data["resource_utilization_percent"]
    assert 33.0 <= utilization <= 34.0


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_avg_duration(db_session: AsyncSession, authenticated_client: AsyncClient, test_event: Event):
    """Test that average duration is calculated for completed incidents."""
    # Create completed incidents with known durations
    base_time = datetime.now(UTC)

    for i in range(3):
        incident = Incident(
            id=uuid4(),
            event_id=test_event.id,
            title=f"Completed Incident {i}",
            type="brandbekaempfung",
            status="abschluss",
            priority="medium",
            location_address=f"Street {i}",
            created_at=base_time - timedelta(minutes=60),  # Created 60 mins ago
            completed_at=base_time - timedelta(minutes=30),  # Completed 30 mins ago
        )
        db_session.add(incident)

    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    # Duration should be 30 minutes (60 - 30)
    assert data["avg_duration_minutes"] == 30


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_no_completed_incidents(authenticated_client: AsyncClient, test_event_with_incidents: Event):
    """Test that avg duration is 0 when no incidents are completed."""
    # test_event_with_incidents has incidents but none with completed_at
    response = await authenticated_client.get(f"/api/events/{test_event_with_incidents.id}/stats")
    assert response.status_code == 200

    data = response.json()
    assert data["avg_duration_minutes"] == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_no_personnel_checked_in(authenticated_client: AsyncClient, test_event: Event):
    """Test stats when no personnel are checked in."""
    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    assert data["personnel_total"] == 0
    assert data["personnel_available"] == 0
    assert data["resource_utilization_percent"] == 0.0


# ============================================
# Deleted Incidents Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_excludes_deleted_incidents(
    db_session: AsyncSession, authenticated_client: AsyncClient, test_event: Event
):
    """Test that deleted incidents are excluded from stats."""
    # Create an active incident
    active_incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Active Incident",
        type="brandbekaempfung",
        status="eingegangen",
        priority="medium",
        location_address="Active Street",
        created_at=datetime.now(UTC),
    )
    db_session.add(active_incident)

    # Create a deleted incident
    deleted_incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Deleted Incident",
        type="brandbekaempfung",
        status="eingegangen",
        priority="medium",
        location_address="Deleted Street",
        created_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )
    db_session.add(deleted_incident)
    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    # Only 1 incident (the active one) should be counted
    total_incidents = sum(data["status_counts"].values())
    assert total_incidents == 1


# ============================================
# Response Format Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_response_format(authenticated_client: AsyncClient, test_event: Event):
    """Test that stats response has correct format."""
    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"

    data = response.json()
    assert isinstance(data["status_counts"], dict)
    assert isinstance(data["personnel_available"], int)
    assert isinstance(data["personnel_total"], int)
    assert isinstance(data["avg_duration_minutes"], int)
    assert isinstance(data["resource_utilization_percent"], (int, float))


@pytest.mark.asyncio
@pytest.mark.api
async def test_get_stats_utilization_rounded(
    db_session: AsyncSession, authenticated_client: AsyncClient, test_event: Event, test_user: User
):
    """Test that utilization percentage is rounded to 1 decimal place."""
    # Create personnel with base availability
    personnel_list = []
    for i in range(3):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="atemschutz",
            availability="available",  # All have base availability "available"
        )
        db_session.add(person)
        personnel_list.append(person)

    await db_session.commit()

    # Check in all personnel
    for person in personnel_list:
        await db_session.refresh(person)
        attendance = EventAttendance(
            id=uuid4(),
            event_id=test_event.id,
            personnel_id=person.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
        db_session.add(attendance)

    # Create an incident and assign one personnel to it
    incident = Incident(
        id=uuid4(),
        event_id=test_event.id,
        title="Test Incident",
        type="brandbekaempfung",
        status="einsatz",
        priority="medium",
        location_address="Test Street",
    )
    db_session.add(incident)
    await db_session.flush()

    # Assign first personnel to the incident
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=personnel_list[0].id,
        assigned_by=test_user.id,
    )
    db_session.add(assignment)
    await db_session.commit()

    response = await authenticated_client.get(f"/api/events/{test_event.id}/stats")
    assert response.status_code == 200

    data = response.json()
    # 1/3 = 33.333... should be rounded to 33.3
    utilization = data["resource_utilization_percent"]
    # Check it's a reasonable rounding
    assert str(utilization).count(".") <= 1
    if "." in str(utilization):
        decimal_places = len(str(utilization).split(".")[1])
        assert decimal_places <= 1
