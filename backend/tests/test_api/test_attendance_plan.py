"""Planned von/bis on the Appell – «kommt um 20:00» / «geht um 22:00» (feedback 19.11.2026, #3).

The plan sits beside the attendance record and never writes it: two doors set it like a tick
(the board's editor session, the check-in link's token), /feld lets the person set their own,
and 15' before a checked-in person's «geht um» the bell rings once.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, EventAttendance, Personnel
from app.services import notification_service
from app.services.tokens import generate_link_token
from tests.conftest import feld_device_token


@pytest_asyncio.fixture
async def plan_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Sturm", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    return event


@pytest_asyncio.fixture
async def person(db_session: AsyncSession) -> Personnel:
    row = Personnel(id=uuid4(), name="Baumann Michael", role="Wm", status="available")
    db_session.add(row)
    await db_session.commit()
    return row


def _at(minutes: int) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


async def _row(db: AsyncSession, event: Event, person: Personnel) -> EventAttendance | None:
    """The row as the database has it now (the API wrote it in its own session)."""
    return await db.scalar(
        select(EventAttendance)
        .where(EventAttendance.event_id == event.id, EventAttendance.personnel_id == person.id)
        .execution_options(populate_existing=True)
    )


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_link_sets_a_plan_for_somebody_not_here_and_they_still_read_absent(
    client: AsyncClient, db_session: AsyncSession, plan_event: Event, person: Personnel
):
    token = generate_link_token("checkin", plan_event.id)
    response = await client.put(
        f"/api/personnel/check-in/{person.id}/plan?token={token}", json={"planned_from": _at(30)}
    )
    assert response.status_code == 200, response.text
    assert response.json()["planned_from"] is not None
    assert response.json()["checked_in"] is False

    # A row for the plan alone: not «gegangen», not counted as come.
    row = await _row(db_session, plan_event, person)
    assert row is not None and row.checked_in_at is None and row.checked_out_at is None
    stats = (await client.get(f"/api/personnel/check-in/stats?token={token}")).json()
    assert (stats["checked_in"], stats["left"]) == (0, 0)
    listed = (await client.get(f"/api/personnel/check-in/list?token={token}")).json()["personnel"]
    assert next(p for p in listed if p["id"] == str(person.id))["planned_from"] is not None


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_board_patches_one_end_clears_with_null_and_refuses_a_backwards_plan(
    editor_client: AsyncClient, plan_event: Event, person: Personnel
):
    url = f"/api/personnel/check-in/{person.id}/plan?event_id={plan_event.id}"
    assert (await editor_client.put(url, json={"planned_from": _at(10), "planned_until": _at(120)})).status_code == 200

    only_until = (await editor_client.put(url, json={"planned_until": _at(180)})).json()
    assert only_until["planned_from"] is not None, "a key left out stays"

    assert (await editor_client.put(url, json={"planned_until": _at(5)})).status_code == 400
    assert (await editor_client.put(url, json={"planned_until": "2026-11-19T22:00:00"})).status_code == 422

    cleared = (await editor_client.put(url, json={"planned_from": None, "planned_until": None})).json()
    assert (cleared["planned_from"], cleared["planned_until"]) == (None, None)

    roster = (await editor_client.get(f"/api/personnel/?event_id={plan_event.id}")).json()
    assert next(p for p in roster if p["id"] == str(person.id))["planned_until"] is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_first_arrival_keeps_the_plan_a_return_after_leaving_drops_it(
    editor_client: AsyncClient, db_session: AsyncSession, plan_event: Event, person: Personnel
):
    base = f"/api/personnel/check-in/{person.id}"
    door = f"event_id={plan_event.id}"
    await editor_client.put(f"{base}/plan?{door}", json={"planned_until": _at(120)})
    await editor_client.post(f"{base}/in?{door}")
    row = await _row(db_session, plan_event, person)
    assert row is not None and row.checked_in and row.planned_until is not None

    await editor_client.post(f"{base}/out?{door}")
    await editor_client.post(f"{base}/in?{door}")
    row = await _row(db_session, plan_event, person)
    assert row is not None and row.checked_in and row.planned_until is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_feld_sets_only_its_own_plan_and_reads_it_back(
    client: AsyncClient, db_session: AsyncSession, plan_event: Event, person: Personnel
):
    token = await feld_device_token(db_session, plan_event.id, person.id)
    response = await client.put(f"/api/feld/attendance/{person.id}/plan?token={token}", json={"planned_until": _at(90)})
    assert response.status_code == 200, response.text
    feed = (await client.get(f"/api/feld/assignments/{person.id}?token={token}")).json()
    assert feed["planned_until"] is not None and feed["checked_in"] is False

    other = Personnel(id=uuid4(), name="Frei Marc", role="Wm", status="available")
    db_session.add(other)
    await db_session.commit()
    refused = await client.put(f"/api/feld/attendance/{other.id}/plan?token={token}", json={"planned_until": _at(90)})
    assert refused.status_code == 403

    backwards = await client.put(
        f"/api/feld/attendance/{person.id}/plan?token={token}", json={"planned_from": _at(120)}
    )
    assert backwards.status_code == 400
    assert backwards.json()["code"] == "feld_plan_invalid"


@pytest.mark.asyncio
async def test_the_bell_rings_15_minutes_before_once_and_resolves_on_check_out(
    db_session: AsyncSession, plan_event: Event, person: Personnel
):
    later = Personnel(id=uuid4(), name="Gerber Elias", role="Kpl", status="available")
    gone = Personnel(id=uuid4(), name="Weber Martin", role="Sdt", status="available")
    db_session.add_all([later, gone])
    await db_session.commit()
    now = datetime.now(UTC)
    db_session.add_all(
        [
            EventAttendance(
                event_id=plan_event.id,
                personnel_id=person.id,
                checked_in=True,
                checked_in_at=now - timedelta(hours=2),
                planned_until=now + timedelta(minutes=10),
            ),
            # 30' away: not yet.
            EventAttendance(
                event_id=plan_event.id,
                personnel_id=later.id,
                checked_in=True,
                checked_in_at=now - timedelta(hours=1),
                planned_until=now + timedelta(minutes=30),
            ),
            # Already went home: nothing to say.
            EventAttendance(
                event_id=plan_event.id,
                personnel_id=gone.id,
                checked_in=False,
                checked_in_at=now - timedelta(hours=3),
                checked_out_at=now - timedelta(hours=1),
                planned_until=now + timedelta(minutes=5),
            ),
        ]
    )
    await db_session.commit()

    async def leaving() -> list[tuple]:
        """One tick of the watch: (id, name, dismissed, severity, message) per leaving row."""
        rows = await notification_service.evaluate_notifications(db_session, plan_event.id)
        seen = [
            (n.id, n.params["name"], n.dismissed, n.severity, n.message) for n in rows if n.type == "personnel_leaving"
        ]
        await db_session.commit()
        return seen

    first = await leaving()
    assert [(name, dismissed, severity) for _, name, dismissed, severity, _ in first] == [
        ("Baumann Michael", False, "info")
    ]
    message = first[0][4]
    assert message.startswith("Geht um ") and message.endswith(": Baumann Michael")

    # The next tick rings nothing new.
    assert [row[0] for row in await leaving()] == [first[0][0]]

    attendance = await _row(db_session, plan_event, person)
    assert attendance is not None
    attendance.checked_in = False
    attendance.checked_out_at = datetime.now(UTC)
    await db_session.commit()
    after = await leaving()
    assert [row[2] for row in after] == [True], "checked out: the row resolves itself"
