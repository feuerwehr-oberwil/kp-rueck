"""«‹Name› als Gast einchecken» – the check-in link's walk-in door (phone sweep 24.11.2026, 7A).

An unauthenticated write: the link's token is the only key, so these tests hold the gate
(missing, forged, expired, other-kind and revoked tokens), the Ereignis scope, and the
duplicate rule (a listed name checks that person in, it never makes a second one).
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.personnel_checkin import DOOR_GUEST_TAG, DOOR_GUESTS_PER_EVENT
from app.models import AuditLog, Event, EventAttendance, Personnel
from app.services import share_links
from app.services.tokens import generate_checkin_token, generate_link_token

URL = "/api/personnel/check-in/guest"


@pytest_asyncio.fixture
async def two_events(db_session: AsyncSession) -> tuple[Event, Event]:
    now = datetime.now(UTC)
    tonight = Event(id=uuid4(), name="Sturm", training_flag=False, created_at=now)
    other = Event(id=uuid4(), name="Übung", training_flag=True, created_at=now)
    db_session.add_all([tonight, other])
    await db_session.commit()
    return tonight, other


async def _people_named(db: AsyncSession, name: str) -> list[Personnel]:
    rows = await db.scalars(select(Personnel).where(Personnel.name == name).execution_options(populate_existing=True))
    return list(rows)


@pytest.mark.asyncio
@pytest.mark.api
async def test_an_unknown_name_becomes_a_checked_in_guest_of_this_ereignis_only(
    client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event]
):
    tonight, other = two_events
    response = await client.post(
        URL, params={"token": generate_checkin_token(tonight.id)}, json={"name": "  Gast   Peter "}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["name"], body["checked_in"], body["tags"]) == ("Gast Peter", True, [DOOR_GUEST_TAG])

    [guest] = await _people_named(db_session, "Gast Peter")
    assert guest.guest_event_id == tonight.id
    attendance = await db_session.scalar(select(EventAttendance).where(EventAttendance.personnel_id == guest.id))
    assert attendance is not None and attendance.event_id == tonight.id and attendance.checked_in

    audit = await db_session.scalar(select(AuditLog).where(AuditLog.resource_id == guest.id))
    assert audit is not None and audit.action_type == "check_in_guest" and audit.user_id is None
    assert audit.changes_json is not None and audit.changes_json["created"] is True

    # Listed at tonight's door, invisible at the other Ereignis's.
    listed = (
        await client.get("/api/personnel/check-in/list", params={"token": generate_checkin_token(tonight.id)})
    ).json()
    assert "Gast Peter" in [p["name"] for p in listed["personnel"]]
    elsewhere = (
        await client.get("/api/personnel/check-in/list", params={"token": generate_checkin_token(other.id)})
    ).json()
    assert "Gast Peter" not in [p["name"] for p in elsewhere["personnel"]]


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_listed_name_checks_that_person_in_instead_of_making_a_second(
    client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event]
):
    tonight, _ = two_events
    roster = Personnel(id=uuid4(), name="Baumann Michael", status="available")
    db_session.add(roster)
    await db_session.commit()
    token = generate_checkin_token(tonight.id)

    response = await client.post(URL, params={"token": token}, json={"name": "baumann  MICHAEL"})
    assert response.status_code == 200, response.text
    assert (response.json()["id"], response.json()["checked_in"]) == (str(roster.id), True)

    # A double tap on a new name makes one guest: the second call finds the first.
    first = await client.post(URL, params={"token": token}, json={"name": "Gast Peter"})
    second = await client.post(URL, params={"token": token}, json={"name": "Gast Peter"})
    assert first.json()["id"] == second.json()["id"]
    assert len(await _people_named(db_session, "Baumann Michael")) == 1
    assert len(await _people_named(db_session, "Gast Peter")) == 1


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_guest_of_another_ereignis_is_not_a_match(
    client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event]
):
    tonight, other = two_events
    db_session.add(Personnel(id=uuid4(), name="Gast Peter", status="available", guest_event_id=other.id))
    await db_session.commit()

    response = await client.post(URL, params={"token": generate_checkin_token(tonight.id)}, json={"name": "Gast Peter"})
    assert response.status_code == 200, response.text
    guests = await _people_named(db_session, "Gast Peter")
    assert sorted(str(g.guest_event_id) for g in guests) == sorted([str(tonight.id), str(other.id)])


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize(
    "roster", [["Meier Alex", "Meier Alex"], ["Meier Alex!"]], ids=["two-of-a-name", "unavailable"]
)
async def test_a_name_the_door_cannot_settle_sends_the_person_to_the_kp(
    client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event], roster: list[str]
):
    tonight, _ = two_events
    for index, name in enumerate(roster):
        unavailable = name.endswith("!")
        db_session.add(
            Personnel(
                id=uuid4(),
                name=name.rstrip("!"),
                kennung=str(index),
                status="unavailable" if unavailable else "available",
            )
        )
    await db_session.commit()

    response = await client.post(URL, params={"token": generate_checkin_token(tonight.id)}, json={"name": "Meier Alex"})
    assert response.status_code == 409
    assert response.json()["code"] == "checkin_guest_ask_kp"
    assert await db_session.scalar(select(func.count()).select_from(EventAttendance)) == 0


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_guest_ceiling_holds(client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event]):
    tonight, _ = two_events
    db_session.add_all(
        Personnel(id=uuid4(), name=f"Gast {i}", status="available", guest_event_id=tonight.id)
        for i in range(DOOR_GUESTS_PER_EVENT)
    )
    await db_session.commit()

    response = await client.post(URL, params={"token": generate_checkin_token(tonight.id)}, json={"name": "Gast Neu"})
    assert response.status_code == 409
    assert await _people_named(db_session, "Gast Neu") == []


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("name", ["", "   ", "x" * 101], ids=["empty", "blank", "too-long"])
async def test_the_name_is_validated(client: AsyncClient, two_events: tuple[Event, Event], name: str):
    tonight, _ = two_events
    response = await client.post(URL, params={"token": generate_checkin_token(tonight.id)}, json={"name": name})
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
async def test_only_a_live_checkin_token_opens_the_door(
    client: AsyncClient, editor_client: AsyncClient, db_session: AsyncSession, two_events: tuple[Event, Event]
):
    tonight, _ = two_events
    revoked = generate_checkin_token(tonight.id)
    assert await share_links.revoke(db_session, "checkin", tonight.id)
    await db_session.commit()

    refused = {
        "forged": "not-a-token",
        "expired": generate_link_token("checkin", tonight.id, expires_hours=-1),
        "other kind": generate_link_token("viewer", tonight.id),
        "revoked": revoked,
        "deleted Ereignis": generate_checkin_token(uuid4()),
    }
    for why, token in refused.items():
        response = await client.post(URL, params={"token": token}, json={"name": "Gast Peter"})
        assert response.status_code == 401, why

    # No token at all is a 422 – and an editor session is not a key to this route either.
    assert (await client.post(URL, json={"name": "Gast Peter"})).status_code == 422
    assert (
        await editor_client.post(URL, params={"event_id": str(tonight.id)}, json={"name": "Gast Peter"})
    ).status_code == 422
    assert await _people_named(db_session, "Gast Peter") == []
