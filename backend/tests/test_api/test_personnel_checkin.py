"""Tests for Personnel Check-in API endpoints.

Tests cover:
- Check-in link generation
- Personnel list for check-in
- Check-in and check-out operations
- Token validation
- Statistics retrieval
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, EventAttendance, EventSpecialFunction, IncidentGroup, IncidentGroupAssignment, Personnel
from app.services.tokens import generate_checkin_token, generate_link_token

# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def test_personnel(db_session: AsyncSession) -> list[Personnel]:
    """Create test personnel."""
    personnel_list = []
    for i in range(5):
        person = Personnel(
            id=uuid4(),
            name=f"Person {i}",
            role="atemschutz",
            status="available" if i < 4 else "unavailable",
        )
        db_session.add(person)
        personnel_list.append(person)

    await db_session.commit()
    for p in personnel_list:
        await db_session.refresh(p)
    return personnel_list


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
async def test_generate_link_success(editor_client: AsyncClient, test_event: Event):
    """Test successful check-in link generation."""
    response = await editor_client.post(f"/api/personnel/check-in/generate-link?event_id={test_event.id}")
    assert response.status_code == 200

    data = response.json()
    assert "token" in data
    assert "link" in data
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


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_marks_route_assigned_personnel(
    client: AsyncClient,
    valid_token: str,
    db_session: AsyncSession,
    test_event: Event,
    test_personnel,
):
    person = test_personnel[0]
    group = IncidentGroup(event_id=test_event.id, name="Route")
    db_session.add(group)
    await db_session.flush()
    db_session.add(
        IncidentGroupAssignment(
            incident_group_id=group.id,
            resource_type="personnel",
            resource_id=person.id,
        )
    )
    await db_session.commit()

    response = await client.get(f"/api/personnel/check-in/list?token={valid_token}")

    listed = next(item for item in response.json()["personnel"] if item["id"] == str(person.id))
    assert listed["is_assigned"] is True


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
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.api
async def test_checkin_twice(client: AsyncClient, valid_token: str, test_personnel):
    """Test checking in the same person twice."""
    person = test_personnel[0]

    # First check-in
    response1 = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response1.status_code == 200

    # Checking in again is idempotent
    response2 = await client.post(f"/api/personnel/check-in/{person.id}/in?token={valid_token}")
    assert response2.status_code == 200


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
    # Nothing to undo: answered, not refused
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_resume_undoes_a_board_check_out(editor_client: AsyncClient, test_event: Event, test_personnel):
    """The board's «Rückgängig»: back in, with the same «anwesend seit»."""
    person = test_personnel[0]
    query = {"event_id": str(test_event.id)}
    first = await editor_client.post(f"/api/personnel/check-in/{person.id}/in", params=query)
    out = await editor_client.post(f"/api/personnel/check-in/{person.id}/out", params=query)

    response = await editor_client.post(
        f"/api/personnel/check-in/{person.id}/in", params={**query, "resume": out.json()["checked_out_at"]}
    )

    assert response.status_code == 200
    assert response.json()["checked_in"] is True
    assert response.json()["checked_out_at"] is None
    assert response.json()["checked_in_at"] == first.json()["checked_in_at"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_resume_of_a_departure_that_is_gone_is_409(editor_client: AsyncClient, test_event: Event, test_personnel):
    """Somebody checked the person in and out again: the old undo is refused, not replayed."""
    person = test_personnel[0]
    query = {"event_id": str(test_event.id)}
    path = f"/api/personnel/check-in/{person.id}"
    await editor_client.post(f"{path}/in", params=query)
    out = await editor_client.post(f"{path}/out", params=query)
    await editor_client.post(f"{path}/in", params=query)
    await editor_client.post(f"{path}/out", params=query)

    response = await editor_client.post(f"{path}/in", params={**query, "resume": out.json()["checked_out_at"]})

    assert response.status_code == 409


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_check_out_somebody_else_already_made_is_not_ours_to_undo(
    editor_client: AsyncClient, test_event: Event, test_personnel
):
    """Operator A checked the person out; B's stale popover checks out again: 200, but
    `changed` is false – B gets no undo that would reopen A's departure."""
    person = test_personnel[0]
    query = {"event_id": str(test_event.id)}
    path = f"/api/personnel/check-in/{person.id}"
    await editor_client.post(f"{path}/in", params=query)
    first = await editor_client.post(f"{path}/out", params={**query, "only_if_free": "true"})

    again = await editor_client.post(f"{path}/out", params={**query, "only_if_free": "true"})

    assert first.json()["changed"] is True
    assert again.status_code == 200
    assert again.json()["changed"] is False
    assert again.json()["checked_out_at"] == first.json()["checked_out_at"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_resume_through_the_link_is_a_new_stint(client: AsyncClient, valid_token: str, test_personnel):
    """The link has no check-out to take back: `resume` changes nothing there."""
    person = test_personnel[0]
    path = f"/api/personnel/check-in/{person.id}"
    first = await client.post(f"{path}/in", params={"token": valid_token})
    out = await client.post(f"{path}/out", params={"token": valid_token})

    response = await client.post(f"{path}/in", params={"token": valid_token, "resume": out.json()["checked_out_at"]})

    assert response.status_code == 200
    assert response.json()["checked_in"] is True
    assert response.json()["checked_in_at"] != first.json()["checked_in_at"]


@pytest.mark.asyncio
@pytest.mark.api
async def test_only_if_free_refuses_a_bound_person(
    editor_client: AsyncClient, db_session, test_event: Event, test_personnel
):
    """The popover's question-less check-out: 409 for a person with a function; plain call goes through."""
    person = test_personnel[0]
    query = {"event_id": str(test_event.id)}
    path = f"/api/personnel/check-in/{person.id}"
    await editor_client.post(f"{path}/in", params=query)
    db_session.add(EventSpecialFunction(event_id=test_event.id, personnel_id=person.id, function_type="magazin"))
    await db_session.commit()

    refused = await editor_client.post(f"{path}/out", params={**query, "only_if_free": "true"})
    assert refused.status_code == 409

    confirmed = await editor_client.post(f"{path}/out", params=query)
    assert confirmed.status_code == 200
    assert confirmed.json()["checked_in"] is False


# ============================================
# "Nicht anwesend" — the third step of the board's cycle
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_clear_attendance_returns_person_to_absent(editor_client: AsyncClient, test_event: Event, test_personnel):
    """anwesend → gegangen → nicht anwesend, and the row is gone rather than blanked."""
    person = test_personnel[0]
    query = f"?event_id={test_event.id}"

    await editor_client.post(f"/api/personnel/check-in/{person.id}/in{query}")
    await editor_client.post(f"/api/personnel/check-in/{person.id}/out{query}")

    left = await editor_client.get(f"/api/personnel/check-in/list{query}&include_unavailable=true")
    row = next(p for p in left.json()["personnel"] if p["id"] == str(person.id))
    assert row["checked_out_at"] is not None  # "gegangen"

    response = await editor_client.delete(f"/api/personnel/check-in/{person.id}{query}")
    assert response.status_code == 200
    assert response.json()["checked_in"] is False
    assert response.json()["checked_out_at"] is None

    after = await editor_client.get(f"/api/personnel/check-in/list{query}&include_unavailable=true")
    row = next(p for p in after.json()["personnel"] if p["id"] == str(person.id))
    # Absent means the absence of a record — not a row with both stamps NULL.
    assert row["checked_in"] is False
    assert row["checked_in_at"] is None
    assert row["checked_out_at"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_clear_attendance_is_idempotent(editor_client: AsyncClient, test_event: Event, test_personnel):
    """Clearing somebody who never came is a no-op, not a 404."""
    person = test_personnel[0]
    response = await editor_client.delete(f"/api/personnel/check-in/{person.id}?event_id={test_event.id}")
    assert response.status_code == 200
    assert response.json()["checked_in"] is False


@pytest.mark.asyncio
@pytest.mark.api
async def test_clear_attendance_requires_an_editor(
    viewer_client: AsyncClient, client: AsyncClient, test_event: Event, test_personnel
):
    """The phone has no "I was never here" to report — this is the board's correction."""
    person = test_personnel[0]
    query = f"?event_id={test_event.id}"
    # No session and a viewer session both come back 403 here — the route has no
    # token door at all, so there is nothing for an anonymous caller to be
    # challenged for.
    assert (await client.delete(f"/api/personnel/check-in/{person.id}{query}")).status_code == 403
    assert (await viewer_client.delete(f"/api/personnel/check-in/{person.id}{query}")).status_code == 403


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
    expired = generate_link_token("checkin", uuid4(), expires_hours=-1)
    person = test_personnel[0]
    response = await client.post(f"/api/personnel/check-in/{person.id}/in?token={expired}")
    assert response.status_code == 401


# ============================================
# Event Not Found Tests
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_list_personnel_event_not_found(client: AsyncClient):
    """Test listing personnel for non-existent event."""
    # Generate a token for a non-existent event
    token = generate_checkin_token(uuid4())
    response = await client.get(f"/api/personnel/check-in/list?token={token}")
    assert response.status_code == 401


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
