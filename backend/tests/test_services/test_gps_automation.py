"""Tests for the GPS-driven status automation service (plan 10).

Covers the master/rule gating, the silent arrival auto-advance (Rule A) with its hard
anti-jitter safeguards (debounce count, freshness window, speed gate, one-shot,
gap-reset), and the confirm-release prompt (Rule B).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, IncidentAssignment, Setting, StatusTransition, User, Vehicle
from app.services import gps_automation


@dataclass
class FakePos:
    """Minimal stand-in for traccar.VehiclePosition."""

    device_name: str
    latitude: float
    longitude: float
    speed: float | None
    last_update: datetime


# Incident location used across tests (matches test fixtures' Basel coords).
INC_LAT = 47.5596
INC_LNG = 7.5886
STATION_LAT = 47.5000
STATION_LNG = 7.6000


@pytest_asyncio.fixture(autouse=True)
def _reset_state():
    """Each test starts with empty debounce stores."""
    gps_automation._state.arrival.clear()
    gps_automation._state.returns.clear()
    yield
    gps_automation._state.arrival.clear()
    gps_automation._state.returns.clear()


async def _set(db: AsyncSession, key: str, value: str) -> None:
    db.add(Setting(key=key, value=value))
    await db.commit()


async def _enable_arrival(db: AsyncSession, *, silent: bool = True) -> None:
    await _set(db, "gps.automation_enabled", "true")
    await _set(db, "gps.rule_arrival_enabled", "true")
    # Default behaviour is confirm-by-default; most existing tests assert the silent
    # auto-advance path, so they opt into it explicitly.
    await _set(db, "gps.rule_arrival_silent", "true" if silent else "false")
    await _set(db, "geofence_radius_meters", "200")
    await _set(db, "gps.debounce_count", "3")
    await _set(db, "gps.freshness_seconds", "60")
    await _set(db, "gps.min_dwell_seconds", "60")
    await _set(db, "gps.speed_gate_kmh", "5")


async def _enable_return(db: AsyncSession) -> None:
    await _set(db, "gps.automation_enabled", "true")
    await _set(db, "gps.rule_return_enabled", "true")
    await _set(db, "gps.station_lat", str(STATION_LAT))
    await _set(db, "gps.station_lng", str(STATION_LNG))
    await _set(db, "gps.station_radius_meters", "120")
    await _set(db, "gps.debounce_count", "3")
    await _set(db, "gps.freshness_seconds", "60")
    await _set(db, "gps.min_dwell_seconds", "60")
    await _set(db, "gps.speed_gate_kmh", "5")


@pytest_asyncio.fixture
async def disponiert_incident(db_session: AsyncSession, test_user: User, test_event: Event) -> Incident:
    incident = Incident(
        id=uuid.uuid4(),
        title="Test Brand",
        type="brandbekaempfung",
        priority="high",
        location_address="Hauptstrasse 1",
        location_lat=INC_LAT,
        location_lng=INC_LNG,
        status="disponiert",
        event_id=test_event.id,
        created_by=test_user.id,
    )
    db_session.add(incident)
    await db_session.commit()
    await db_session.refresh(incident)
    return incident


@pytest_asyncio.fixture
async def assigned_vehicle(db_session: AsyncSession, disponiert_incident: Incident, test_user: User):
    vehicle = Vehicle(id=uuid.uuid4(), name="TLF-1", type="TLF", status="available")
    db_session.add(vehicle)
    await db_session.flush()
    assignment = IncidentAssignment(
        id=uuid.uuid4(),
        incident_id=disponiert_incident.id,
        resource_type="vehicle",
        resource_id=vehicle.id,
        assigned_by=test_user.id,
    )
    db_session.add(assignment)
    await db_session.commit()
    await db_session.refresh(vehicle)
    await db_session.refresh(assignment)
    return vehicle, assignment


def _fresh_at_incident(now: datetime, speed: float = 0.0) -> list[FakePos]:
    return [FakePos("TLF-1", INC_LAT, INC_LNG, speed, now)]


def _fresh_at_station(now: datetime, speed: float = 0.0) -> list[FakePos]:
    return [FakePos("TLF-1", STATION_LAT, STATION_LNG, speed, now)]


async def _status(db: AsyncSession, incident_id) -> str:
    result = await db.execute(select(Incident.status).where(Incident.id == incident_id))
    return result.scalar_one()


class _Clock:
    """Controllable wall-clock for the automation, so we can simulate dwell time.

    Each tick, the GPS fix is timestamped at the clock's current value (a realistic
    fresh fix), and the clock advances between ticks to simulate seconds passing.
    """

    def __init__(self, start: datetime):
        self.t = start

    def now(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += timedelta(seconds=seconds)


# ---------------------------------------------------------------------------
# Rule A — arrival auto-advance
# ---------------------------------------------------------------------------


async def _tick(db, clock: _Clock, positions, advance: float = 30.0):
    """Run one automation tick at the clock's current time, then advance the clock."""
    with patch("app.services.gps_automation._now", clock.now):
        await gps_automation.run_automation_tick(db, positions)
    clock.advance(advance)


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_arrival_advances_after_n_fixes(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    await _enable_arrival(db_session)
    clock = _Clock(datetime.now(UTC))

    # Two confirming fixes within 30s: not yet enough (need N=3 spanning >=60s).
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=30)
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"

    # Third fix past the 60s span -> fires.
    await _tick(db_session, clock, _fresh_at_incident(clock.now()))
    assert await _status(db_session, disponiert_incident.id) == "einsatz"

    # A status transition attributed to the system actor exists.
    tx = await db_session.execute(
        select(StatusTransition).where(StatusTransition.incident_id == disponiert_incident.id)
    )
    transitions = list(tx.scalars().all())
    assert any(t.to_status == "einsatz" and t.notes == gps_automation.ARRIVAL_NOTE for t in transitions)
    actor = await db_session.execute(select(User).where(User.id == gps_automation.GPS_SYSTEM_USER_ID))
    assert actor.scalar_one().username == gps_automation.GPS_SYSTEM_USERNAME


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_arrival_confirm_default_prompts_without_advancing(
    _bc, bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    """Default (silent=false): arrival emits a confirm prompt and does NOT change status."""
    vehicle, _assignment = assigned_vehicle
    await _enable_arrival(db_session, silent=False)
    clock = _Clock(datetime.now(UTC))

    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=30)
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    bc_msg.assert_not_called()
    await _tick(db_session, clock, _fresh_at_incident(clock.now()))

    # Prompt broadcast once; status untouched (operator must confirm).
    bc_msg.assert_awaited_once()
    payload = bc_msg.await_args.args[0]
    assert payload["type"] == "gps_arrival_prompt"
    assert payload["incident_id"] == str(disponiert_incident.id)
    assert payload["vehicle_name"] == "TLF-1"
    assert await _status(db_session, disponiert_incident.id) == "disponiert"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_arrival_silent_opt_in_advances(
    _bc, bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    """Opt-in (silent=true): arrival advances disponiert -> einsatz with no prompt."""
    await _enable_arrival(db_session, silent=True)
    clock = _Clock(datetime.now(UTC))
    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    assert await _status(db_session, disponiert_incident.id) == "einsatz"
    bc_msg.assert_not_called()


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_one_shot_does_not_refire(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle, test_user: User
):
    """After auto-advancing once, the incident must not be re-acted on."""
    await _enable_arrival(db_session)
    clock = _Clock(datetime.now(UTC))
    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    assert await _status(db_session, disponiert_incident.id) == "einsatz"

    # Operator drags it back to disponiert (reversibility). The latch is still set, so
    # automation must NOT re-advance even though the vehicle is still on site.
    disponiert_incident.status = "disponiert"
    await db_session.commit()
    for _ in range(4):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_stale_fix_resets_debounce(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    await _enable_arrival(db_session)
    clock = _Clock(datetime.now(UTC))

    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=30)
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=30)
    # A stale fix (last_update 5 min old) must NOT count and must reset the counter.
    stale = [FakePos("TLF-1", INC_LAT, INC_LNG, 0.0, clock.now() - timedelta(minutes=5))]
    await _tick(db_session, clock, stale, advance=30)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"

    # Missing position (empty list) also resets.
    await _tick(db_session, clock, [], advance=30)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"

    # After the reset it takes a full fresh streak again.
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=30)
    await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"
    await _tick(db_session, clock, _fresh_at_incident(clock.now()))
    assert await _status(db_session, disponiert_incident.id) == "einsatz"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_moving_vehicle_does_not_advance(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    await _enable_arrival(db_session)
    clock = _Clock(datetime.now(UTC))
    # In radius but driving (speed > gate) -> never confirms.
    for _ in range(4):
        await _tick(db_session, clock, _fresh_at_incident(clock.now(), speed=30.0), advance=40)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_disabled_master_switch_noop(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    # Rule enabled but master off -> nothing happens.
    await _set(db_session, "gps.automation_enabled", "false")
    await _set(db_session, "gps.rule_arrival_enabled", "true")
    clock = _Clock(datetime.now(UTC))
    for _ in range(4):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=40)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_training_event_included(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle, test_event: Event
):
    # Training events are deliberately NOT excluded — they're the natural place
    # to exercise the GPS rules (Übungen with real vehicles in the field).
    await _enable_arrival(db_session)
    test_event.training_flag = True
    await db_session.commit()
    clock = _Clock(datetime.now(UTC))
    for _ in range(4):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=40)
    assert await _status(db_session, disponiert_incident.id) == "einsatz"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
async def test_sparse_parked_fixes_still_fire(
    bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    """Regression (2026-07-06 field test): a parked Traccar client throttles to one fix
    every ~30-100s. With freshness decoupled from dwell, ticks that re-see the SAME
    still-fresh fix must neither reset the counter nor double-count, and two fixes 90s
    apart must satisfy count=2/dwell=40."""
    vehicle, assignment = assigned_vehicle
    await _set(db_session, "gps.automation_enabled", "true")
    await _set(db_session, "gps.rule_return_enabled", "true")
    await _set(db_session, "gps.station_lat", str(STATION_LAT))
    await _set(db_session, "gps.station_lng", str(STATION_LNG))
    await _set(db_session, "gps.station_radius_meters", "120")
    await _set(db_session, "gps.debounce_count", "2")
    await _set(db_session, "gps.freshness_seconds", "180")
    await _set(db_session, "gps.min_dwell_seconds", "40")
    await _set(db_session, "gps.speed_gate_kmh", "10")

    clock = _Clock(datetime.now(UTC))
    first_fix = _fresh_at_station(clock.now())

    # Fix 1 at t0; the tracker then goes quiet. The tick at t0+45 re-sees the SAME fix
    # (still fresh under 180s) — count must stay at 1, no reset, no double-count.
    await _tick(db_session, clock, first_fix, advance=45)
    await _tick(db_session, clock, first_fix, advance=35)
    bc_msg.assert_not_called()

    # Fix 2 arrives at t0+80 (past dwell=40) and the next tick sees it -> fires.
    await _tick(db_session, clock, _fresh_at_station(clock.now()))
    bc_msg.assert_awaited_once()
    assert bc_msg.await_args.args[0]["type"] == "gps_release_prompt"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
async def test_return_skips_completed_incident(
    bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    # Operator already closed the incident out -> no release modal, only the
    # regular bell notification path.
    await _enable_return(db_session)
    disponiert_incident.status = "abschluss"
    await db_session.commit()
    clock = _Clock(datetime.now(UTC))
    for _ in range(4):
        await _tick(db_session, clock, _fresh_at_station(clock.now()), advance=40)
    bc_msg.assert_not_called()


# ---------------------------------------------------------------------------
# Rule B — return-to-station prompt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
async def test_return_emits_prompt_not_release(
    bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle
):
    vehicle, assignment = assigned_vehicle
    await _enable_return(db_session)
    clock = _Clock(datetime.now(UTC))

    await _tick(db_session, clock, _fresh_at_station(clock.now()), advance=30)
    await _tick(db_session, clock, _fresh_at_station(clock.now()), advance=35)
    bc_msg.assert_not_called()
    await _tick(db_session, clock, _fresh_at_station(clock.now()))

    # Prompt broadcast once, with the assignment to release; assignment still ACTIVE.
    bc_msg.assert_awaited_once()
    payload = bc_msg.await_args.args[0]
    assert payload["type"] == "gps_release_prompt"
    assert payload["assignment_id"] == str(assignment.id)
    assert payload["vehicle_name"] == "TLF-1"

    fresh = await db_session.execute(
        select(IncidentAssignment).where(IncidentAssignment.id == assignment.id)
    )
    assert fresh.scalar_one().unassigned_at is None  # never silent-released


# ---------------------------------------------------------------------------
# Rule A — clustered-stop nearest-single-match guard (plan 12, Aufträge)
# ---------------------------------------------------------------------------

# A second route stop ~111 m north of the first (delta-lat 0.0010 * 111_320 m).
# Both sit inside the 200 m arrival radius from a position on the first stop.
INC2_LAT = INC_LAT + 0.0010
INC2_LNG = INC_LNG


async def _add_second_stop(
    db: AsyncSession, event: Event, user: User, vehicle: Vehicle, *, lat: float = INC2_LAT, lng: float = INC2_LNG
) -> Incident:
    """Create a second disponiert stop and assign the SAME vehicle to it.

    Models one squad ("Auftrag") assigned across multiple route stops.
    """
    incident = Incident(
        id=uuid.uuid4(),
        title="Test Brand 2",
        type="brandbekaempfung",
        priority="high",
        location_address="Hauptstrasse 3",
        location_lat=lat,
        location_lng=lng,
        status="disponiert",
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.flush()
    db.add(
        IncidentAssignment(
            id=uuid.uuid4(),
            incident_id=incident.id,
            resource_type="vehicle",
            resource_id=vehicle.id,
            assigned_by=user.id,
        )
    )
    await db.commit()
    await db.refresh(incident)
    return incident


def _fresh_at_second(now: datetime, speed: float = 0.0) -> list[FakePos]:
    return [FakePos("TLF-1", INC2_LAT, INC2_LNG, speed, now)]


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_clustered_stops_only_nearest_advances_silent(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle, test_event: Event, test_user: User
):
    """Silent mode: two in-radius stops of one vehicle -> only the NEARER advances."""
    vehicle, _assignment = assigned_vehicle
    second = await _add_second_stop(db_session, test_event, test_user, vehicle)
    await _enable_arrival(db_session, silent=True)
    clock = _Clock(datetime.now(UTC))

    # Position sits exactly on the first stop -> it is the nearest of the two.
    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)

    assert await _status(db_session, disponiert_incident.id) == "einsatz"
    assert await _status(db_session, second.id) == "disponiert"

    # The farther stop's debounce never latched: once the vehicle sits on IT (now
    # the only in-radius disponiert stop), it advances normally on a later tick.
    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_second(clock.now()), advance=35)
    assert await _status(db_session, second.id) == "einsatz"


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_message", new_callable=AsyncMock)
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_clustered_stops_only_nearest_prompts_default(
    _bc, bc_msg, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle, test_event: Event, test_user: User
):
    """Default mode: two in-radius stops -> exactly ONE arrival prompt (the nearer)."""
    vehicle, _assignment = assigned_vehicle
    second = await _add_second_stop(db_session, test_event, test_user, vehicle)
    await _enable_arrival(db_session, silent=False)
    clock = _Clock(datetime.now(UTC))

    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)

    # Exactly one prompt, for the nearer stop; neither status changed.
    bc_msg.assert_awaited_once()
    assert bc_msg.await_args.args[0]["type"] == "gps_arrival_prompt"
    assert bc_msg.await_args.args[0]["incident_id"] == str(disponiert_incident.id)
    assert await _status(db_session, disponiert_incident.id) == "disponiert"
    assert await _status(db_session, second.id) == "disponiert"

    # The farther stop did not latch: it prompts later when the vehicle sits on it.
    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_second(clock.now()), advance=35)
    assert bc_msg.await_count == 2
    assert bc_msg.await_args.args[0]["incident_id"] == str(second.id)


@pytest.mark.asyncio
@patch("app.services.gps_automation.broadcast_incident_update", new_callable=AsyncMock)
async def test_clustered_guard_noop_for_single_in_radius(
    _bc, db_session: AsyncSession, disponiert_incident: Incident, assigned_vehicle, test_event: Event, test_user: User
):
    """Guard is a no-op when only one of the vehicle's stops is in radius.

    A vehicle with two assigned stops, but the second is far outside the arrival
    radius -> the single in-radius case behaves exactly as before (nearer fires).
    """
    vehicle, _assignment = assigned_vehicle
    # ~2.2 km north -> well outside the 200 m radius.
    far = await _add_second_stop(db_session, test_event, test_user, vehicle, lat=INC_LAT + 0.02, lng=INC_LNG)
    await _enable_arrival(db_session, silent=True)
    clock = _Clock(datetime.now(UTC))

    for _ in range(3):
        await _tick(db_session, clock, _fresh_at_incident(clock.now()), advance=35)

    assert await _status(db_session, disponiert_incident.id) == "einsatz"
    assert await _status(db_session, far.id) == "disponiert"
