"""Tests for the Reko assignment CRUD layer — the BOARD's side of Reko.

`app.crud.reko_assignment` has no HTTP surface of its own (that's `api/reko.py`,
covered by `tests/test_api/test_reko.py`); these tests exercise its four
functions directly against the database: the open/done personnel summary, a
single reko person's incident list (what `/transfer-rekos` reads to decide
what to move), unassigning, and the available-personnel-with-distance query
that backs the assignment picker.
"""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.reko_assignment import (
    _haversine_m,
    get_available_reko_personnel_for_incident,
    get_reko_assignments_for_personnel,
    get_reko_personnel_for_event,
    unassign_reko_personnel_from_incident,
)
from app.models import (
    Event,
    EventSpecialFunction,
    Incident,
    IncidentAssignment,
    Personnel,
    RekoReport,
    User,
)

# ============================================
# Helpers
# ============================================


async def _make_incident(
    db: AsyncSession,
    event: Event,
    user: User,
    title: str,
    *,
    lat: float | None = 47.5,
    lng: float | None = 7.5,
    status: str = "incoming",
    position: int = 0,
) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="brandbekaempfung",
        priority="high",
        location_address="Teststrasse 1",
        location_lat=lat,
        location_lng=lng,
        status=status,
        event_id=event.id,
        created_by=user.id,
        position=position,
    )
    db.add(incident)
    await db.commit()
    return incident


async def _assign(
    db: AsyncSession, incident: Incident, personnel: Personnel, *, purpose: str = "reko"
) -> IncidentAssignment:
    assignment = IncidentAssignment(
        id=uuid4(),
        incident_id=incident.id,
        resource_type="personnel",
        resource_id=personnel.id,
        purpose=purpose,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)
    return assignment


async def _complete_reko(db: AsyncSession, incident: Incident, personnel: Personnel) -> None:
    db.add(
        RekoReport(
            id=uuid4(),
            incident_id=incident.id,
            token="t",
            is_draft=False,
            submitted_by_personnel_id=personnel.id,
        )
    )
    await db.commit()


async def _grant_reko(db: AsyncSession, event: Event, personnel: Personnel) -> None:
    db.add(
        EventSpecialFunction(
            id=uuid4(),
            event_id=event.id,
            personnel_id=personnel.id,
            function_type="reko",
        )
    )
    await db.commit()


async def _make_personnel(db: AsyncSession, name: str) -> Personnel:
    personnel = Personnel(id=uuid4(), name=name, role="Reko", status="available")
    db.add(personnel)
    await db.commit()
    await db.refresh(personnel)
    return personnel


# ============================================
# get_reko_personnel_for_event
# ============================================


@pytest.mark.asyncio
async def test_open_vs_done_counts(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """An active assignment to an incident with a completed reko counts as done, not open."""
    await _grant_reko(db_session, test_event, test_personnel)

    # One incident still open, one already "Beendet" (completed reko)
    open_incident = await _make_incident(db_session, test_event, test_user, "Offen")
    done_incident = await _make_incident(db_session, test_event, test_user, "Beendet")
    await _assign(db_session, open_incident, test_personnel)
    await _assign(db_session, done_incident, test_personnel)
    await _complete_reko(db_session, done_incident, test_personnel)

    result = await get_reko_personnel_for_event(db_session, test_event.id)

    assert len(result) == 1
    person = result[0]
    assert person["open_count"] == 1
    assert person["done_count"] == 1
    assert person["assignment_count"] == 2


@pytest.mark.asyncio
async def test_all_done_has_zero_open(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """A reko person whose only assignment is completed shows 0 open, 1 done."""
    await _grant_reko(db_session, test_event, test_personnel)

    done_incident = await _make_incident(db_session, test_event, test_user, "Beendet")
    await _assign(db_session, done_incident, test_personnel)
    await _complete_reko(db_session, done_incident, test_personnel)

    result = await get_reko_personnel_for_event(db_session, test_event.id)

    assert result[0]["open_count"] == 0
    assert result[0]["done_count"] == 1


@pytest.mark.asyncio
async def test_soft_deleted_incident_is_invisible_to_the_summary(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """A deleted incident must not inflate a reko person's counts.

    The board soft-deletes rather than hard-deletes (`deleted_at`), and the
    incident query filters it out explicitly — the assignment row itself is
    untouched, so this is the one guard standing between a deleted card and a
    reko person who still looks busy because of it.
    """
    await _grant_reko(db_session, test_event, test_personnel)

    incident = await _make_incident(db_session, test_event, test_user, "Geloescht")
    await _assign(db_session, incident, test_personnel)
    incident.deleted_at = incident.created_at
    await db_session.commit()

    result = await get_reko_personnel_for_event(db_session, test_event.id)

    person = result[0]
    assert person["assignment_count"] == 0
    assert person["open_count"] == 0


@pytest.mark.asyncio
async def test_event_with_no_reko_personnel_summarises_to_nothing(db_session: AsyncSession, test_event: Event):
    """No `event_special_functions` rows of type 'reko' at all — the summary must
    not error out looking up assignments for a personnel list that is empty."""
    result = await get_reko_personnel_for_event(db_session, test_event.id)

    assert result == []


# ============================================
# get_reko_assignments_for_personnel
# ============================================


@pytest.mark.asyncio
async def test_non_reko_personnel_gets_nothing(db_session: AsyncSession, test_event: Event, test_personnel: Personnel):
    """Unknown/non-reko personnel: no `event_special_functions` row means an empty
    list, not an error — this is the guard the `/transfer-rekos` endpoint relies
    on before it ever touches an assignment."""
    result = await get_reko_assignments_for_personnel(db_session, test_event.id, test_personnel.id)

    assert result == []


@pytest.mark.asyncio
async def test_reko_person_with_no_incidents_in_the_event_gets_nothing(
    db_session: AsyncSession, test_event: Event, test_personnel: Personnel
):
    """Reko-flagged, but the event has no incidents at all yet."""
    await _grant_reko(db_session, test_event, test_personnel)

    result = await get_reko_assignments_for_personnel(db_session, test_event.id, test_personnel.id)

    assert result == []


@pytest.mark.asyncio
async def test_assignments_are_scoped_to_their_own_event(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """A reko person's incidents in one event must not leak into a query for
    another — the guarantee a transfer between two people relies on, since a
    transfer is always scoped to a single `event_id`."""
    other_event = Event(id=uuid4(), name="Anderes Ereignis", training_flag=False)
    db_session.add(other_event)
    await db_session.commit()

    await _grant_reko(db_session, test_event, test_personnel)
    incident = await _make_incident(db_session, test_event, test_user, "Im ersten Ereignis")
    await _assign(db_session, incident, test_personnel)

    result = await get_reko_assignments_for_personnel(db_session, other_event.id, test_personnel.id)

    assert result == []


@pytest.mark.asyncio
async def test_active_assignment_without_report_is_active_and_incomplete(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    await _grant_reko(db_session, test_event, test_personnel)
    incident = await _make_incident(db_session, test_event, test_user, "Laufend")
    assignment = await _assign(db_session, incident, test_personnel)

    result = await get_reko_assignments_for_personnel(db_session, test_event.id, test_personnel.id)

    assert len(result) == 1
    row = result[0]
    assert row["incident_id"] == incident.id
    assert row["assignment_id"] == assignment.id
    assert row["is_active_assignment"] is True
    assert row["has_completed_reko"] is False


@pytest.mark.asyncio
async def test_submitted_and_released_incident_shows_as_historical(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """Submitting a reko unassigns the person, but the incident must stay visible
    (as done, not active) — the whole reason the function unions active
    assignments with reko-reported incidents instead of reading assignments
    alone."""
    await _grant_reko(db_session, test_event, test_personnel)
    incident = await _make_incident(db_session, test_event, test_user, "Abgeschlossen")
    await _assign(db_session, incident, test_personnel)
    await _complete_reko(db_session, incident, test_personnel)
    assert await unassign_reko_personnel_from_incident(db_session, incident.id, test_personnel.id)

    result = await get_reko_assignments_for_personnel(db_session, test_event.id, test_personnel.id)

    assert len(result) == 1
    row = result[0]
    assert row["is_active_assignment"] is False
    assert row["has_completed_reko"] is True
    assert row["assignment_id"] is None


@pytest.mark.asyncio
async def test_sort_puts_active_before_historical_then_incomplete_before_done_then_by_board_position(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """The reko person must see the same priority order the operator arranged on
    the kanban board: active work first, incomplete before already-reported
    within that, then the board's own manual order."""
    await _grant_reko(db_session, test_event, test_personnel)

    # Active, incomplete, high (late) board position.
    active_incomplete_late = await _make_incident(db_session, test_event, test_user, "A", position=5)
    await _assign(db_session, active_incomplete_late, test_personnel)

    # Active, incomplete, lower (earlier) board position — should sort first.
    active_incomplete_early = await _make_incident(db_session, test_event, test_user, "B", position=2)
    await _assign(db_session, active_incomplete_early, test_personnel)

    # Still actively assigned, but already reported — sorts after the incomplete
    # active ones despite an even lower board position.
    active_done = await _make_incident(db_session, test_event, test_user, "C", position=1)
    await _assign(db_session, active_done, test_personnel)
    await _complete_reko(db_session, active_done, test_personnel)

    # Released and reported — historical, sorts last no matter the position.
    historical_done = await _make_incident(db_session, test_event, test_user, "D", position=0)
    await _assign(db_session, historical_done, test_personnel)
    await _complete_reko(db_session, historical_done, test_personnel)
    await unassign_reko_personnel_from_incident(db_session, historical_done.id, test_personnel.id)

    result = await get_reko_assignments_for_personnel(db_session, test_event.id, test_personnel.id)

    assert [row["incident_id"] for row in result] == [
        active_incomplete_early.id,
        active_incomplete_late.id,
        active_done.id,
        historical_done.id,
    ]
    # The sort-only helper keys must never leak into the response.
    assert all("_position" not in row and "_created_at" not in row for row in result)


# ============================================
# unassign_reko_personnel_from_incident
# ============================================


@pytest.mark.asyncio
async def test_unassign_releases_the_active_assignment(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    incident = await _make_incident(db_session, test_event, test_user, "Freizugeben")
    assignment = await _assign(db_session, incident, test_personnel)

    assert await unassign_reko_personnel_from_incident(db_session, incident.id, test_personnel.id) is True

    refreshed = await db_session.get(IncidentAssignment, assignment.id)
    assert refreshed.unassigned_at is not None


@pytest.mark.asyncio
async def test_unassign_unknown_personnel_returns_false(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """No matching assignment — unknown personnel, or personnel that was simply
    never assigned here — fails soft rather than raising."""
    incident = await _make_incident(db_session, test_event, test_user, "Niemand zugewiesen")

    assert await unassign_reko_personnel_from_incident(db_session, incident.id, uuid4()) is False
    # And the caller's own personnel, but never actually assigned to it.
    assert await unassign_reko_personnel_from_incident(db_session, incident.id, test_personnel.id) is False


@pytest.mark.asyncio
async def test_unassign_is_not_repeatable(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """Calling it twice must not "succeed" twice — the second call finds no
    active assignment left and reports that honestly."""
    incident = await _make_incident(db_session, test_event, test_user, "Doppelt")
    await _assign(db_session, incident, test_personnel)

    assert await unassign_reko_personnel_from_incident(db_session, incident.id, test_personnel.id) is True
    assert await unassign_reko_personnel_from_incident(db_session, incident.id, test_personnel.id) is False


# ============================================
# get_available_reko_personnel_for_incident
# ============================================


@pytest.mark.asyncio
async def test_unknown_incident_returns_nothing(db_session: AsyncSession):
    available, currently_assigned_id = await get_available_reko_personnel_for_incident(db_session, uuid4())

    assert available == []
    assert currently_assigned_id is None


@pytest.mark.asyncio
async def test_event_with_no_reko_personnel_returns_nothing(db_session: AsyncSession, test_incident: Incident):
    available, currently_assigned_id = await get_available_reko_personnel_for_incident(db_session, test_incident.id)

    assert available == []
    assert currently_assigned_id is None


@pytest.mark.asyncio
async def test_currently_assigned_id_reflects_the_active_reko_assignment(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """The picker needs to know who already holds the one Reko slot on this
    incident, so an operator swapping them can see who is being replaced."""
    await _grant_reko(db_session, test_event, test_personnel)
    incident = await _make_incident(db_session, test_event, test_user, "Ziel")
    await _assign(db_session, incident, test_personnel)

    _, currently_assigned_id = await get_available_reko_personnel_for_incident(db_session, incident.id)

    assert currently_assigned_id == test_personnel.id


@pytest.mark.asyncio
async def test_distance_sorts_the_nearest_person_first_among_equally_loaded(
    db_session: AsyncSession, test_user: User, test_event: Event
):
    """Least open work first, then closest — with open_count tied at one each,
    distance is what breaks the tie."""
    target = await _make_incident(db_session, test_event, test_user, "Zielobjekt", lat=47.5596, lng=7.5886)

    near = await _make_incident(db_session, test_event, test_user, "Nahes Ereignis", lat=47.5600, lng=7.5890)
    far = await _make_incident(db_session, test_event, test_user, "Fernes Ereignis", lat=47.0, lng=7.0)

    near_person = await _make_personnel(db_session, "Nah")
    await _grant_reko(db_session, test_event, near_person)
    await _assign(db_session, near, near_person)

    far_person = await _make_personnel(db_session, "Fern")
    await _grant_reko(db_session, test_event, far_person)
    await _assign(db_session, far, far_person)

    available, _ = await get_available_reko_personnel_for_incident(db_session, target.id)

    by_id = {p["personnel_id"]: p for p in available}
    assert by_id[near_person.id]["distance_source"] == "open"
    assert by_id[far_person.id]["distance_source"] == "open"
    assert by_id[near_person.id]["distance_m"] < by_id[far_person.id]["distance_m"]
    assert [p["personnel_id"] for p in available] == [near_person.id, far_person.id]


@pytest.mark.asyncio
async def test_distance_is_the_minimum_across_a_persons_open_assignments(
    db_session: AsyncSession, test_user: User, test_event: Event
):
    """A person open on several incidents is compared by their CLOSEST one, not
    an arbitrary or first one — they would drive from wherever is nearest."""
    target = await _make_incident(db_session, test_event, test_user, "Zielobjekt", lat=47.5596, lng=7.5886)
    near = await _make_incident(db_session, test_event, test_user, "Nahes Ereignis", lat=47.5600, lng=7.5890)
    far = await _make_incident(db_session, test_event, test_user, "Fernes Ereignis", lat=47.0, lng=7.0)

    person = await _make_personnel(db_session, "Beidseitig im Einsatz")
    await _grant_reko(db_session, test_event, person)
    await _assign(db_session, far, person)
    await _assign(db_session, near, person)

    available, _ = await get_available_reko_personnel_for_incident(db_session, target.id)

    assert available[0]["distance_m"] == _haversine_m(47.5596, 7.5886, 47.5600, 7.5890)


@pytest.mark.asyncio
async def test_open_count_outranks_distance(db_session: AsyncSession, test_user: User, test_event: Event):
    """A closer but busier person must still sort behind a farther, idle one —
    load-balancing beats proximity."""
    target = await _make_incident(db_session, test_event, test_user, "Zielobjekt", lat=47.5596, lng=7.5886)
    nearby = await _make_incident(db_session, test_event, test_user, "Nahes Ereignis", lat=47.5600, lng=7.5890)

    busy_but_close = await _make_personnel(db_session, "Beschaeftigt")
    await _grant_reko(db_session, test_event, busy_but_close)
    await _assign(db_session, nearby, busy_but_close)

    idle_unknown_location = await _make_personnel(db_session, "Frei")
    await _grant_reko(db_session, test_event, idle_unknown_location)

    available, _ = await get_available_reko_personnel_for_incident(db_session, target.id)

    assert [p["personnel_id"] for p in available] == [idle_unknown_location.id, busy_but_close.id]
    by_id = {p["personnel_id"]: p for p in available}
    assert by_id[idle_unknown_location.id]["distance_m"] is None


@pytest.mark.asyncio
async def test_distance_falls_back_to_the_last_assignment_when_nothing_is_open(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """With no open assignment, the best proxy for "where are they" is their most
    recent one, even though it has since been released."""
    target = await _make_incident(db_session, test_event, test_user, "Zielobjekt", lat=47.5596, lng=7.5886)
    previous = await _make_incident(db_session, test_event, test_user, "Voriges Ereignis", lat=47.55, lng=7.58)

    await _grant_reko(db_session, test_event, test_personnel)
    await _assign(db_session, previous, test_personnel)
    await unassign_reko_personnel_from_incident(db_session, previous.id, test_personnel.id)

    available, _ = await get_available_reko_personnel_for_incident(db_session, target.id)

    assert len(available) == 1
    assert available[0]["distance_source"] == "last"
    assert available[0]["distance_m"] == _haversine_m(47.5596, 7.5886, 47.55, 7.58)


@pytest.mark.asyncio
async def test_target_without_coordinates_yields_no_distances(
    db_session: AsyncSession, test_user: User, test_event: Event, test_personnel: Personnel
):
    """An incident with no address geocoded yet must not crash the picker — it
    just can't rank by distance, so everybody comes back with `None`."""
    elsewhere = await _make_incident(db_session, test_event, test_user, "Irgendwo", lat=47.5, lng=7.5)
    await _grant_reko(db_session, test_event, test_personnel)
    await _assign(db_session, elsewhere, test_personnel)

    target = await _make_incident(db_session, test_event, test_user, "Ohne Koordinaten", lat=None, lng=None)

    available, _ = await get_available_reko_personnel_for_incident(db_session, target.id)

    assert len(available) == 1
    assert available[0]["distance_m"] is None
    assert available[0]["distance_source"] is None


# ============================================
# _haversine_m
# ============================================


def test_haversine_returns_a_rounded_integer_of_metres():
    """Sanity-check the distance primitive everything above depends on: zero for
    an identical point, and a plausible, rounded (not truncated) figure for two
    points a known ~69 km apart (Basel to Bern, straight-line)."""
    assert _haversine_m(47.5596, 7.5886, 47.5596, 7.5886) == 0

    basel_to_bern = _haversine_m(47.5596, 7.5886, 46.9480, 7.4474)
    assert isinstance(basel_to_bern, int)
    assert 65_000 < basel_to_bern < 72_000
