"""The Regie: state, «Jetzt», «Halten», Mitspieler, pause/tempo and the Autopilot tick."""

from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, FeldDeviceClaim, Incident, IncidentAssignment, Personnel, User, Vehicle
from app.services.gps_simulation import SimulatedDrive, gps_simulation
from app.services.training_regie import autopilot_tick

pytestmark = [pytest.mark.asyncio, pytest.mark.api]


@pytest_asyncio.fixture
async def training_event(db_session: AsyncSession) -> Event:
    event = Event(id=uuid4(), name="Übung Regie", training_flag=True)
    db_session.add(event)
    await db_session.commit()
    return event


@pytest_asyncio.fixture(autouse=True)
async def clean_gps() -> AsyncGenerator[None, None]:
    """The drive registry is process-global: leave it empty and running."""
    yield
    await gps_simulation.stop()
    gps_simulation.paused_at = None


async def _reko_incident(db: AsyncSession, event: Event, title: str, minutes_ago: int = 10) -> Incident:
    incident = Incident(
        id=uuid4(),
        event_id=event.id,
        title=title,
        type="brandbekaempfung",
        priority="medium",
        status="reko",
        location_address=f"{title} 1",
        created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
    )
    db.add(incident)
    await db.commit()
    return incident


async def _make_mitspieler(db: AsyncSession, event: Event, incident: Incident) -> None:
    person = Personnel(id=uuid4(), name="Muster Hans", role="Gruppenführer", status="available")
    db.add(person)
    await db.flush()
    db.add(IncidentAssignment(id=uuid4(), incident_id=incident.id, resource_type="personnel", resource_id=person.id))
    db.add(FeldDeviceClaim(event_id=event.id, personnel_id=person.id))
    await db.commit()


def _incident(state: dict, incident: Incident) -> dict:
    return next(i for i in state["incidents"] if i["incident_id"] == str(incident.id))


async def test_state_shows_the_next_step_with_its_due_time(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    reko = await _reko_incident(db_session, training_event, "Rebgasse")

    response = await editor_client.get(f"/api/training/events/{training_event.id}/regie")
    assert response.status_code == 200
    state = response.json()
    assert state["autopilot"] is False and state["tempo"] == "normal"
    assert state["gps_available"] is True and state["magazin_configured"] is False
    [step] = _incident(state, reko)["steps"]
    assert step["key"] == "reko_arrived"
    assert step["due_at"] is not None and step["rolling"] is False


async def test_a_non_training_event_is_refused(editor_client: AsyncClient, db_session: AsyncSession):
    event = Event(id=uuid4(), name="Ernstfall", training_flag=False)
    db_session.add(event)
    await db_session.commit()
    assert (await editor_client.get(f"/api/training/events/{event.id}/regie")).status_code == 400


async def test_held_and_mitspieler_incidents_are_not_scheduled(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    held = await _reko_incident(db_session, training_event, "Haltweg")
    played = await _reko_incident(db_session, training_event, "Feldweg")
    await _make_mitspieler(db_session, training_event, played)

    response = await editor_client.put(
        f"/api/training/events/{training_event.id}/regie/hold/{held.id}", json={"held": True}
    )
    assert response.status_code == 200
    state = response.json()
    assert _incident(state, held)["held"] is True
    assert _incident(state, held)["steps"][0]["due_at"] is None
    assert _incident(state, played)["mitspieler"] is True
    assert _incident(state, played)["steps"][0]["due_at"] is None


async def test_a_step_runs_now_and_a_stale_one_is_409(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    reko = await _reko_incident(db_session, training_event, "Rebgasse")
    url = f"/api/training/events/{training_event.id}/regie/step/{reko.id}"

    response = await editor_client.post(url, json={"key": "reko_arrived"})
    assert response.status_code == 200
    state = response.json()
    assert _incident(state, reko)["steps"][0]["key"] == "reko_report"
    assert state["history"][0]["text"] == "Reko vor Ort · Rebgasse 1"
    assert state["history"][0]["by"] == "trainer"

    # The page was behind: the crew already arrived.
    response = await editor_client.post(url, json={"key": "reko_arrived"})
    assert response.status_code == 409


async def test_pause_freezes_drives_and_tempo_repaces_them(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event
):
    await gps_simulation.start(
        SimulatedDrive(
            vehicle_id=uuid4(),
            vehicle_name="Pio",
            start_lat=47.5164,
            start_lng=7.5618,
            target_lat=47.5180,
            target_lng=7.5559,
            target_label="Testweg 1",
            kind="incident",
            cruise_kmh=40.0,
            started_at=datetime.now(UTC) - timedelta(seconds=10),
        )
    )
    url = f"/api/training/events/{training_event.id}/regie"

    response = await editor_client.put(url, json={"paused": True})
    assert response.status_code == 200
    assert response.json()["paused_at"] is not None
    assert gps_simulation.paused_at is not None
    frozen = gps_simulation.current_position("Pio")

    await editor_client.put(url, json={"tempo": "sturm"})
    assert gps_simulation.list_drives()[0].cruise_kmh == 80.0
    assert gps_simulation.current_position("Pio") == pytest.approx(frozen)

    response = await editor_client.put(url, json={"paused": False})
    assert response.json()["paused_at"] is None
    assert gps_simulation.paused_at is None


async def test_the_autopilot_runs_due_steps_but_not_held_or_mitspieler(
    editor_client: AsyncClient, db_session: AsyncSession, training_event: Event, test_editor: User
):
    due = await _reko_incident(db_session, training_event, "Rebgasse")
    fresh = await _reko_incident(db_session, training_event, "Neuweg", minutes_ago=0)
    held = await _reko_incident(db_session, training_event, "Haltweg")
    played = await _reko_incident(db_session, training_event, "Feldweg")
    await _make_mitspieler(db_session, training_event, played)
    base = f"/api/training/events/{training_event.id}/regie"
    await editor_client.put(f"{base}/hold/{held.id}", json={"held": True})

    assert await autopilot_tick(db_session) == 0  # Autopilot still off

    await editor_client.put(base, json={"autopilot": True})
    assert await autopilot_tick(db_session) == 1

    state = (await editor_client.get(base)).json()
    assert state["history"][0] == {**state["history"][0], "text": "Reko vor Ort · Rebgasse 1", "by": "autopilot"}
    assert state["started_at"] is not None
    assert _incident(state, due)["steps"][0]["key"] == "reko_report"
    for untouched in (fresh, held, played):
        assert _incident(state, untouched)["steps"][0]["key"] == "reko_arrived"

    # Paused, nothing runs – not even what has fallen due meanwhile.
    await editor_client.put(base, json={"paused": True})
    await editor_client.put(f"{base}/hold/{held.id}", json={"held": False})
    assert await autopilot_tick(db_session) == 0


async def test_an_inject_writes_vorhin(editor_client: AsyncClient, db_session: AsyncSession, training_event: Event):
    vehicle = Vehicle(id=uuid4(), name="TLF 1", type="TLF", status="available", display_order=1)
    incident = await _reko_incident(db_session, training_event, "Rebgasse")
    db_session.add(vehicle)
    await db_session.flush()
    db_session.add(
        IncidentAssignment(id=uuid4(), incident_id=incident.id, resource_type="vehicle", resource_id=vehicle.id)
    )
    await db_session.commit()

    response = await editor_client.post(
        f"/api/training/events/{training_event.id}/simulate/vehicle-breakdown/{incident.id}"
    )
    assert response.status_code == 200
    state = (await editor_client.get(f"/api/training/events/{training_event.id}/regie")).json()
    assert state["history"][0]["text"] == "Fahrzeug fällt aus · TLF 1 · Rebgasse 1"
    assert state["history"][0]["by"] == "trainer"
