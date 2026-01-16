"""Tests for Personnel Check-in API endpoints.

Tests cover:
- Check-in link generation
- Personnel list for check-in
- Check-in and check-out operations
- Token validation
- Statistics retrieval
"""

from datetime import UTC, datetime
from unittest.mock import patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.database import get_db
from app.main import app
from app.models import Event, EventAttendance, Personnel, User

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
        username="checkin_editor",
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
        name="Check-in Test Event",
        training_flag=False,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> list[Personnel]:
    """Create test personnel."""
    personnel_list = []
    for i in range(5):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="atemschutz",
            availability="available" if i < 4 else "unavailable",
        )
        db_session.add(person)
        personnel_list.append(person)

    await db_session.commit()
    for p in personnel_list:
        await db_session.refresh(p)
    return personnel_list


@pytest_asyncio.fixture
async def editor_client(client: AsyncClient, test_editor: User) -> AsyncClient:
    """Create an authenticated client with editor privileges."""
    response = await client.post(
        "/api/auth/login",
        data={"username": "checkin_editor", "password": "editorpass123"},
    )
    assert response.status_code == 200
    return client


@pytest_asyncio.fixture
def valid_token(test_event: Event) -> str:
    """Generate a valid check-in token for the test event."""
    from app.services.tokens import generate_checkin_token

    return generate_checkin_token(test_event.id)


# ============================================
# Generate Link Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_link_requires_auth(client: AsyncClient, test_event: Event):
    """Test that generating check-in link requires authentication."""
    response = await client.post(f"/api/personnel/check-in/generate-link?event_id={test_event.id}")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_link_requires_editor(client: AsyncClient, db_session: AsyncSession, test_event: Event):
    """Test that viewers cannot generate check-in links."""
    # Create viewer
    viewer = User(
        id=uuid4(),
        username="checkin_viewer",
        password_hash=hash_password("viewerpass123"),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    await client.post("/api/auth/login", data={"username": "checkin_viewer", "password": "viewerpass123"})

    response = await client.post(f"/api/personnel/check-in/generate-link?event_id={test_event.id}")
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_link_success(editor_client: AsyncClient, test_event: Event):
    """Test successful check-in link generation."""
    response = await editor_client.post(f"/api/personnel/check-in/generate-link?event_id={test_event.id}")
    assert response.status_code == 200

    data = response.json()
    assert "token" in data
    assert "link" in data
    assert "full_url" in data
    assert "qr_code_data" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_generate_link_contains_token(editor_client: AsyncClient, test_event: Event):
    """Test that generated link contains the token."""
    response = await editor_client.post(f"/api/personnel/check-in/generate-link?event_id={test_event.id}")
    assert response.status_code == 200

    data = response.json()
    assert data["token"] in data["link"]
    assert "/check-in" in data["link"]


# ============================================
# List Personnel Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_invalid_token(client: AsyncClient):
    """Test that invalid token is rejected."""
    response = await client.get("/api/personnel/check-in/list?token=invalid_token")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_valid_token(client: AsyncClient, valid_token: str, test_event: Event, test_personnel):
    """Test listing personnel with valid token."""
    response = await client.get(f"/api/personnel/check-in/list?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    assert "personnel" in data
    assert "event_id" in data
    assert "event_name" in data
    assert data["event_name"] == test_event.name


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_excludes_unavailable(client: AsyncClient, valid_token: str, test_personnel):
    """Test that unavailable personnel are excluded by default."""
    response = await client.get(f"/api/personnel/check-in/list?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    # We have 5 personnel, 4 available, 1 unavailable
    # Unavailable should be excluded
    personnel_names = [p["name"] for p in data["personnel"]]
    assert "Person 4" not in personnel_names  # Person 4 is unavailable


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_checked_in_only(
    client: AsyncClient, valid_token: str, db_session: AsyncSession, test_event: Event, test_personnel
):
    """Test filtering to only checked-in personnel."""
    # Check in one person
    person = test_personnel[0]
    attendance = EventAttendance(
        id=uuid4(),
        event_id=test_event.id,
        personnel_id=person.id,
        checked_in=True,
        checked_in_at=datetime.now(UTC),
    )
    db_session.add(attendance)
    await db_session.commit()

    response = await client.get(f"/api/personnel/check-in/list?token={valid_token}&checked_in_only=true")
    assert response.status_code == 200

    data = response.json()
    # Only checked-in personnel should be returned
    assert len(data["personnel"]) == 1
    assert data["personnel"][0]["name"] == person.name


# ============================================
# Check-in Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_invalid_token(client: AsyncClient, test_personnel):
    """Test that check-in with invalid token is rejected."""
    person = test_personnel[0]
    response = await client.post(f"/api/personnel/check-in/{person.id}/in?token=invalid_token")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_success(client: AsyncClient, valid_token: str, test_personnel):
    """Test successful check-in."""
    person = test_personnel[0]
    response = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    assert data["checked_in"] is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_not_found(client: AsyncClient, valid_token: str):
    """Test check-in for non-existent personnel."""
    response = await client.post(f"/api/personnel/check-in/{uuid4()}/in?token={valid_token}")
    assert response.status_code in [400, 404]


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_twice(client: AsyncClient, valid_token: str, test_personnel):
    """Test checking in the same person twice."""
    person = test_personnel[0]

    # First check-in
    response1 = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response1.status_code == 200

    # Second check-in - should either succeed or return appropriate error
    response2 = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response2.status_code in [200, 400]


# ============================================
# Check-out Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkout_invalid_token(client: AsyncClient, test_personnel):
    """Test that check-out with invalid token is rejected."""
    person = test_personnel[0]
    response = await client.post(f"/api/personnel/check-in/{person.id}/out?token=invalid_token")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkout_success(
    client: AsyncClient, valid_token: str, db_session: AsyncSession, test_event: Event, test_personnel
):
    """Test successful check-out after check-in."""
    person = test_personnel[0]

    # First check in
    await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")

    # Then check out
    response = await client.post(f"/api/personnel/check-in/{person.id}/out?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    assert data["checked_in"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkout_not_checked_in(client: AsyncClient, valid_token: str, test_personnel):
    """Test check-out for person who wasn't checked in."""
    person = test_personnel[0]
    response = await client.post(f"/api/personnel/check-in/{person.id}/out?token={valid_token}")
    # Should handle gracefully
    assert response.status_code in [200, 400, 404]


# ============================================
# Stats Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_stats_invalid_token(client: AsyncClient):
    """Test that stats with invalid token is rejected."""
    response = await client.get("/api/personnel/check-in/stats?token=invalid_token")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.api
async def test_stats_success(client: AsyncClient, valid_token: str, test_personnel):
    """Test successful stats retrieval."""
    response = await client.get(f"/api/personnel/check-in/stats?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    assert "total_available" in data
    assert "checked_in" in data
    assert "checked_out" in data


@pytest.mark.asyncio
@pytest.mark.api
async def test_stats_counts_correct(
    client: AsyncClient, valid_token: str, db_session: AsyncSession, test_event: Event, test_personnel
):
    """Test that stats counts are correct after check-ins."""
    # Check in 2 people
    for person in test_personnel[:2]:
        await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")

    response = await client.get(f"/api/personnel/check-in/stats?token={valid_token}")
    assert response.status_code == 200

    data = response.json()
    assert data["checked_in"] == 2


# ============================================
# Token Expiry Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_expired_token(client: AsyncClient, test_personnel):
    """Test that expired tokens are rejected."""
    with patch("app.services.tokens.validate_checkin_token", return_value=None):
        person = test_personnel[0]
        response = await client.post(f"/api/personnel/check-in/{person.id}/in?token=expired_token")
        assert response.status_code == 401


# ============================================
# Event Not Found Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_event_not_found(client: AsyncClient):
    """Test listing personnel for non-existent event."""
    # Generate a token for a non-existent event
    fake_event_id = uuid4()
    with patch("app.api.personnel_checkin.validate_checkin_token", return_value=fake_event_id):
        response = await client.get("/api/personnel/check-in/list?token=fake_token")
        assert response.status_code == 404


# ============================================
# No Auth Required Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_no_user_auth_required(client: AsyncClient, valid_token: str, test_personnel):
    """Test that check-in operations don't require user authentication."""
    # These operations should work with just a valid token, no login needed
    person = test_personnel[0]

    # List should work
    response = await client.get(f"/api/personnel/check-in/list?token={valid_token}")
    assert response.status_code == 200

    # Check-in should work
    response = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response.status_code == 200

    # Stats should work
    response = await client.get(f"/api/personnel/check-in/stats?token={valid_token}")
    assert response.status_code == 200
