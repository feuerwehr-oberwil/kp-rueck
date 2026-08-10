"""Plan 26 §8.1 — the board can produce every row the check-in link can, and vice versa.

The rule: a login-less link is an input channel, not the home of its data. Until now
`event_attendance` had exactly one writer, the phone. These tests pin down that it now has
two, that they write the *same* row, and that the only difference between them is which
provenance column carries a user id.

**The field door is asserted first, on purpose.** Bolting a session onto a route that used
to be `token: str = Query(...)` is precisely the change that can lock a crew out of the
check-in link at 03:00, and a suite that tested only the new door would not notice.
"""

import uuid
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.models import (
    AuditLog,
    Event,
    EventAttendance,
    Incident,
    IncidentAssignment,
    Personnel,
    User,
)
from app.services.tokens import generate_checkin_token

PASSWORD = "testpassword1234"


# ============================================
# Fixtures
# ============================================


@pytest_asyncio.fixture
async def parity_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Parity Ereignis", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def other_event(db_session: AsyncSession) -> Event:
    """A second Ereignis that must never be touched by a write aimed at the first."""
    event = Event(id=uuid4(), name="Nachbar Ereignis", training_flag=False, created_at=datetime.now(UTC))
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    return event


@pytest_asyncio.fixture
async def crew(db_session: AsyncSession) -> list[Personnel]:
    """Four available people plus one who is unavailable."""
    people = [
        Personnel(id=uuid4(), name=f"Alpha {i}", role="atemschutz", status="available") for i in range(4)
    ]
    people.append(Personnel(id=uuid4(), name="Zulu Krank", role="atemschutz", status="unavailable"))
    for person in people:
        db_session.add(person)
    await db_session.commit()
    for person in people:
        await db_session.refresh(person)
    return people


@pytest_asyncio.fixture
def parity_token(parity_event: Event) -> str:
    return generate_checkin_token(parity_event.id)


@pytest_asyncio.fixture
async def parity_viewer_client(client: AsyncClient, db_session: AsyncSession) -> AsyncClient:
    """A really logged-in viewer.

    The shared `viewer_client` fixture overrides the `get_current_user` *dependency*, and
    these routes resolve the user by hand (token-or-session), so the override would never
    fire. A real cookie is the only way to test the 403.
    """
    viewer = User(
        id=uuid4(),
        username="parity_viewer",
        password_hash=hash_password(PASSWORD),
        role="viewer",
    )
    db_session.add(viewer)
    await db_session.commit()

    login = await client.post("/api/auth/login", data={"username": "parity_viewer", "password": PASSWORD})
    assert login.status_code == 200, login.text
    return client


async def _attendance(
    db: AsyncSession, event_id: uuid.UUID, personnel_id: uuid.UUID
) -> EventAttendance | None:
    result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id,
            EventAttendance.personnel_id == personnel_id,
        )
    )
    return result.scalar_one_or_none()


# ============================================
# 1. The field door still works — first, always
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_field_token_still_checks_people_in_and_out(
    client: AsyncClient, parity_token: str, parity_event: Event, crew: list[Personnel], db_session: AsyncSession
):
    """The phone's path, unchanged. If this breaks, a crew cannot check in at all."""
    person = crew[0]

    response = await client.post(f"/api/personnel/check-in/{person.id}/in?token={parity_token}")
    assert response.status_code == 200, response.text
    assert response.json()["checked_in"] is True

    listed = await client.get(f"/api/personnel/check-in/list?token={parity_token}")
    assert listed.status_code == 200
    assert listed.json()["event_name"] == parity_event.name

    stats = await client.get(f"/api/personnel/check-in/stats?token={parity_token}")
    assert stats.status_code == 200
    assert stats.json()["checked_in"] == 1

    out = await client.post(f"/api/personnel/check-in/{person.id}/out?token={parity_token}")
    assert out.status_code == 200
    assert out.json()["checked_in"] is False

    row = await _attendance(db_session, parity_event.id, person.id)
    assert row is not None
    assert row.checked_in_by_user_id is None
    assert row.checked_out_by_user_id is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_field_token_is_still_rejected_when_invalid(client: AsyncClient, crew: list[Personnel]):
    response = await client.post(f"/api/personnel/check-in/{crew[0].id}/in?token=nonsense")
    assert response.status_code == 401


# ============================================
# 2. The board door writes the same row
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_editor_check_in_writes_the_same_row_but_signed(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    parity_event: Event,
    crew: list[Personnel],
    test_editor: User,
):
    """Byte-identical to a token-written row, except `checked_in_by_user_id`."""
    field_person, board_person = crew[0], crew[1]
    token = generate_checkin_token(parity_event.id)

    field = await editor_client.post(f"/api/personnel/check-in/{field_person.id}/in?token={token}")
    board = await editor_client.post(
        f"/api/personnel/check-in/{board_person.id}/in?event_id={parity_event.id}"
    )
    assert field.status_code == 200, field.text
    assert board.status_code == 200, board.text

    field_row = await _attendance(db_session, parity_event.id, field_person.id)
    board_row = await _attendance(db_session, parity_event.id, board_person.id)
    assert field_row is not None and board_row is not None

    assert board_row.checked_in is field_row.checked_in is True
    assert board_row.checked_in_at is not None and field_row.checked_in_at is not None
    assert board_row.checked_out_at is field_row.checked_out_at is None
    assert board_row.event_id == field_row.event_id

    # The one difference, in both directions.
    assert field_row.checked_in_by_user_id is None
    assert board_row.checked_in_by_user_id == test_editor.id


@pytest.mark.asyncio
@pytest.mark.api
async def test_editor_check_out_is_a_full_undo(
    editor_client: AsyncClient, db_session: AsyncSession, parity_event: Event, crew: list[Personnel], test_editor: User
):
    person = crew[0]
    await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")
    response = await editor_client.post(f"/api/personnel/check-in/{person.id}/out?event_id={parity_event.id}")
    assert response.status_code == 200, response.text

    rows = (
        (
            await db_session.execute(
                select(EventAttendance).where(EventAttendance.personnel_id == person.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1, "check-out must update the row, not orphan a second one"
    row = rows[0]
    assert row.checked_in is False
    assert row.checked_out_at is not None
    assert row.checked_out_by_user_id == test_editor.id


# ============================================
# 3. Exactly one door per request
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("leg", ["in", "out"])
async def test_neither_token_nor_event_id_is_422(
    editor_client: AsyncClient, crew: list[Personnel], leg: str
):
    response = await editor_client.post(f"/api/personnel/check-in/{crew[0].id}/{leg}")
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.api
@pytest.mark.parametrize("leg", ["in", "out"])
async def test_both_token_and_event_id_is_422(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    parity_event: Event,
    other_event: Event,
    crew: list[Personnel],
    leg: str,
):
    """A stale token must not be able to outvote the event the operator chose.

    So "both" is refused rather than resolved in either direction — and nothing is
    written to *either* Ereignis while the ambiguity stands.
    """
    foreign_token = generate_checkin_token(other_event.id)
    response = await editor_client.post(
        f"/api/personnel/check-in/{crew[0].id}/{leg}?token={foreign_token}&event_id={parity_event.id}"
    )
    assert response.status_code == 422

    assert await _attendance(db_session, parity_event.id, crew[0].id) is None
    assert await _attendance(db_session, other_event.id, crew[0].id) is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_a_token_only_ever_writes_its_own_event(
    client: AsyncClient, db_session: AsyncSession, parity_event: Event, other_event: Event, crew: list[Personnel]
):
    """The token carries the event. There is no way to aim it somewhere else."""
    token = generate_checkin_token(other_event.id)
    response = await client.post(f"/api/personnel/check-in/{crew[0].id}/in?token={token}")
    assert response.status_code == 200

    assert await _attendance(db_session, other_event.id, crew[0].id) is not None
    assert await _attendance(db_session, parity_event.id, crew[0].id) is None


# ============================================
# 4. The three states, end to end
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_the_cycle_runs_absent_present_left_present(
    editor_client: AsyncClient, db_session: AsyncSession, parity_event: Event, crew: list[Personnel]
):
    """`nicht anwesend → anwesend → gegangen → anwesend`.

    The third click checks the person back in rather than clearing the row: the DELETE
    that would make the cycle a true loop is deliberately not built in this phase, so a
    mis-click is correctable to "anwesend" and not to "never came". Documented gap.
    """
    person = crew[0]

    # nicht anwesend: no row at all
    assert await _attendance(db_session, parity_event.id, person.id) is None

    # → anwesend
    await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")
    row = await _attendance(db_session, parity_event.id, person.id)
    assert row is not None
    await db_session.refresh(row)
    assert row.checked_in is True
    assert row.checked_in_at is not None
    assert row.checked_out_at is None

    # → gegangen
    await editor_client.post(f"/api/personnel/check-in/{person.id}/out?event_id={parity_event.id}")
    await db_session.refresh(row)
    assert row.checked_in is False
    assert row.checked_in_at is not None, "somebody who left is not somebody who never came"
    assert row.checked_out_at is not None

    # → anwesend again (the third click, in its shipped form)
    await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")
    await db_session.refresh(row)
    assert row.checked_in is True


# ============================================
# 5. Unavailable is refused through both doors
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_unavailable_person_is_refused_from_both_channels(
    editor_client: AsyncClient, parity_event: Event, crew: list[Personnel]
):
    unavailable = crew[-1]
    assert unavailable.status == "unavailable"
    token = generate_checkin_token(parity_event.id)

    field = await editor_client.post(f"/api/personnel/check-in/{unavailable.id}/in?token={token}")
    board = await editor_client.post(
        f"/api/personnel/check-in/{unavailable.id}/in?event_id={parity_event.id}"
    )
    assert field.status_code == 400
    assert board.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_board_list_can_show_unavailable_people_the_phone_hides(
    editor_client: AsyncClient, parity_event: Event, crew: list[Personnel]
):
    """The board must not silently drop a name; it shows it disabled with the reason."""
    token = generate_checkin_token(parity_event.id)

    phone = await editor_client.get(f"/api/personnel/check-in/list?token={token}")
    board = await editor_client.get(
        f"/api/personnel/check-in/list?event_id={parity_event.id}&include_unavailable=true"
    )
    assert phone.status_code == 200 and board.status_code == 200

    phone_names = {p["name"] for p in phone.json()["personnel"]}
    board_names = {p["name"] for p in board.json()["personnel"]}
    assert "Zulu Krank" not in phone_names
    assert "Zulu Krank" in board_names


# ============================================
# 6. The assignment guard: warn on the board, block on the phone
# ============================================


@pytest_asyncio.fixture
async def assigned_person(
    db_session: AsyncSession, parity_event: Event, crew: list[Personnel], test_editor: User
) -> Personnel:
    """A checked-in person who is also assigned to an incident of this Ereignis."""
    person = crew[0]
    incident = Incident(
        id=uuid4(),
        event_id=parity_event.id,
        title="Keller unter Wasser",
        type="elementarereignis",
        location_address="Hauptstrasse 12",
        priority="medium",
        status="active",
        created_by=test_editor.id,
    )
    db_session.add(incident)
    await db_session.flush()
    db_session.add(
        IncidentAssignment(
            id=uuid4(),
            incident_id=incident.id,
            resource_type="personnel",
            resource_id=person.id,
            assigned_at=datetime.now(UTC),
        )
    )
    db_session.add(
        EventAttendance(
            id=uuid4(),
            event_id=parity_event.id,
            personnel_id=person.id,
            checked_in=True,
            checked_in_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return person


@pytest.mark.asyncio
@pytest.mark.api
async def test_phone_still_blocks_check_out_of_an_assigned_person(
    editor_client: AsyncClient, parity_event: Event, assigned_person: Personnel
):
    """The phone cannot release an assignment, so a block is the only honest answer."""
    token = generate_checkin_token(parity_event.id)
    response = await editor_client.post(f"/api/personnel/check-in/{assigned_person.id}/out?token={token}")
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.api
async def test_board_checks_an_assigned_person_out_and_leaves_the_assignment(
    editor_client: AsyncClient, db_session: AsyncSession, parity_event: Event, assigned_person: Personnel
):
    """Warn, don't block — and never release the assignment behind the operator's back."""
    response = await editor_client.post(
        f"/api/personnel/check-in/{assigned_person.id}/out?event_id={parity_event.id}"
    )
    assert response.status_code == 200, response.text
    assert response.json()["checked_in"] is False
    assert response.json()["is_assigned"] is True

    still_assigned = await db_session.execute(
        select(IncidentAssignment).where(
            IncidentAssignment.resource_id == assigned_person.id,
            IncidentAssignment.unassigned_at.is_(None),
        )
    )
    assert still_assigned.scalars().first() is not None


# ============================================
# 7. Alle abmelden
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_out_all_sends_the_present_home_and_leaves_the_departed_alone(
    editor_client: AsyncClient, db_session: AsyncSession, parity_event: Event, crew: list[Personnel]
):
    present_a, present_b, already_gone, never_came = crew[0], crew[1], crew[2], crew[3]

    for person in (present_a, present_b, already_gone):
        await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")
    await editor_client.post(f"/api/personnel/check-in/{already_gone.id}/out?event_id={parity_event.id}")

    gone_row = await _attendance(db_session, parity_event.id, already_gone.id)
    assert gone_row is not None
    original_departure = gone_row.checked_out_at

    response = await editor_client.post(f"/api/personnel/check-in/event/{parity_event.id}/out-all")
    assert response.status_code == 200, response.text
    assert {p["name"] for p in response.json()} == {present_a.name, present_b.name}

    for person in (present_a, present_b):
        row = await _attendance(db_session, parity_event.id, person.id)
        assert row is not None
        await db_session.refresh(row)
        assert row.checked_in is False
        assert row.checked_out_at is not None

    await db_session.refresh(gone_row)
    assert gone_row.checked_out_at == original_departure, "a departure time must not be rewritten"

    # It is not a clear, and it does not invent a row for somebody who never came.
    assert await _attendance(db_session, parity_event.id, never_came.id) is None


@pytest.mark.asyncio
@pytest.mark.api
async def test_out_all_writes_one_audit_entry_per_person(
    editor_client: AsyncClient, db_session: AsyncSession, parity_event: Event, crew: list[Personnel]
):
    """A loop, not a bulk UPDATE — a single "34 people" row is not a roll-call."""
    people = crew[:3]
    for person in people:
        await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")

    await editor_client.post(f"/api/personnel/check-in/event/{parity_event.id}/out-all")

    entries = (
        (
            await db_session.execute(
                select(AuditLog).where(AuditLog.action_type == "check_out", AuditLog.resource_type == "personnel")
            )
        )
        .scalars()
        .all()
    )
    logged = {entry.resource_id for entry in entries if (entry.changes_json or {}).get("bulk")}
    assert logged == {person.id for person in people}


@pytest.mark.asyncio
@pytest.mark.api
async def test_out_all_never_reaches_another_event(
    editor_client: AsyncClient,
    db_session: AsyncSession,
    parity_event: Event,
    other_event: Event,
    crew: list[Personnel],
):
    person = crew[0]
    await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}")
    await editor_client.post(f"/api/personnel/check-in/{person.id}/in?event_id={other_event.id}")

    await editor_client.post(f"/api/personnel/check-in/event/{parity_event.id}/out-all")

    neighbour = await _attendance(db_session, other_event.id, person.id)
    assert neighbour is not None
    await db_session.refresh(neighbour)
    assert neighbour.checked_in is True


@pytest.mark.asyncio
@pytest.mark.api
async def test_out_all_on_an_empty_event_is_a_no_op(editor_client: AsyncClient, parity_event: Event):
    response = await editor_client.post(f"/api/personnel/check-in/event/{parity_event.id}/out-all")
    assert response.status_code == 200
    assert response.json() == []


# ============================================
# 8. Viewers may read the roll-call, never write it
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_is_forbidden_on_every_board_door(
    parity_viewer_client: AsyncClient, parity_event: Event, crew: list[Personnel]
):
    person = crew[0]
    check_in = await parity_viewer_client.post(
        f"/api/personnel/check-in/{person.id}/in?event_id={parity_event.id}"
    )
    check_out = await parity_viewer_client.post(
        f"/api/personnel/check-in/{person.id}/out?event_id={parity_event.id}"
    )
    out_all = await parity_viewer_client.post(f"/api/personnel/check-in/event/{parity_event.id}/out-all")

    assert check_in.status_code == 403
    assert check_out.status_code == 403
    assert out_all.status_code == 403


@pytest.mark.asyncio
@pytest.mark.api
async def test_viewer_may_still_read_the_roll_call(parity_viewer_client: AsyncClient, parity_event: Event):
    """Watching the roll-call is not editing it — the wall display does exactly this."""
    listed = await parity_viewer_client.get(f"/api/personnel/check-in/list?event_id={parity_event.id}")
    assert listed.status_code == 200


@pytest.mark.asyncio
@pytest.mark.api
async def test_board_door_without_any_session_is_401(client: AsyncClient, parity_event: Event, crew: list[Personnel]):
    response = await client.post(f"/api/personnel/check-in/{crew[0].id}/in?event_id={parity_event.id}")
    assert response.status_code == 401


# ============================================
# 9. The header's three numbers
# ============================================


@pytest.mark.asyncio
@pytest.mark.api
async def test_stats_count_present_left_and_roster(
    editor_client: AsyncClient, parity_event: Event, crew: list[Personnel]
):
    """`{present} anwesend · {left} gegangen · {total} Mannschaft`.

    "gegangen" is people who came and went — not everybody who is simply not here.
    """
    present, left = crew[0], crew[1]
    await editor_client.post(f"/api/personnel/check-in/{present.id}/in?event_id={parity_event.id}")
    await editor_client.post(f"/api/personnel/check-in/{left.id}/in?event_id={parity_event.id}")
    await editor_client.post(f"/api/personnel/check-in/{left.id}/out?event_id={parity_event.id}")

    stats = await editor_client.get(f"/api/personnel/check-in/stats?event_id={parity_event.id}")
    assert stats.status_code == 200
    body = stats.json()
    assert body["checked_in"] == 1
    assert body["left"] == 1
    assert body["total_available"] == 4  # the unavailable person is not Mannschaft here
