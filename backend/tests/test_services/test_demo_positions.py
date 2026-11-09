"""The public demo's fixed vehicle positions: crews out stand at their Einsatz, the rest at the
Magazin; only demo mode without a Traccar serves them, and only to the map – never to the GPS
automation."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Incident, IncidentAssignment, Vehicle
from app.services import traccar_poller as poller_module
from app.services.demo_positions import AT_INCIDENT, demo_vehicle_positions
from app.services.settings import update_setting
from app.services.traccar_poller import TraccarPoller

MAGAZIN = (47.5164, 7.5618)
EINSATZ = (47.5096, 7.5583)


async def _board(db: AsyncSession) -> None:
    """One open Einsatz with TLF on it; Pio, Trawa and Mawa at home."""
    event = Event(id=uuid4(), name="Demo", training_flag=False)
    incident = Incident(
        id=uuid4(),
        event_id=event.id,
        title="Keller unter Wasser",
        type="elementarereignis",
        priority="medium",
        status="enroute",
        location_lat=EINSATZ[0],
        location_lng=EINSATZ[1],
    )
    db.add_all([event, incident])
    await db.flush()
    for order, name in enumerate(["TLF", "Pio", "Trawa", "Mawa"], start=1):
        vehicle = Vehicle(id=uuid4(), name=name, type="MTW", status="available", display_order=order)
        db.add(vehicle)
        if name == "TLF":
            db.add(IncidentAssignment(incident_id=incident.id, resource_type="vehicle", resource_id=vehicle.id))
    await update_setting(db, "firestation_latitude", str(MAGAZIN[0]), None)
    await update_setting(db, "firestation_longitude", str(MAGAZIN[1]), None)
    await db.commit()


@pytest.mark.asyncio
async def test_crews_out_stand_at_their_einsatz_the_rest_at_the_magazin(db_session):
    await _board(db_session)
    now = datetime(2026, 11, 10, 19, 0, tzinfo=UTC)

    by_name = {p.device_name: p for p in await demo_vehicle_positions(db_session, now)}

    tlf = by_name["TLF"]
    assert (tlf.status, tlf.latitude, tlf.longitude) == (
        "online",
        pytest.approx(EINSATZ[0] + AT_INCIDENT[0]),
        pytest.approx(EINSATZ[1] + AT_INCIDENT[1]),
    )
    # Home: a few metres around the Magazin, alternately online and offline.
    assert [by_name[n].status for n in ("Pio", "Trawa", "Mawa")] == ["online", "offline", "online"]
    for name in ("Pio", "Trawa", "Mawa"):
        assert by_name[name].latitude == pytest.approx(MAGAZIN[0], abs=0.0002)
    # An offline vehicle's last report is hours old, so the map shows it as stale.
    assert now - by_name["Trawa"].last_update > timedelta(hours=2)


@pytest.mark.asyncio
async def test_no_positions_without_a_magazin(db_session, test_vehicle):
    assert await demo_vehicle_positions(db_session) == []


@pytest.mark.asyncio
async def test_only_demo_mode_serves_them(editor_client: AsyncClient, db_session, monkeypatch):
    await _board(db_session)

    status = await editor_client.get("/api/traccar/status")
    assert status.json()["configured"] is False

    monkeypatch.setattr("app.config.settings.demo_mode", True)
    assert (await editor_client.get("/api/traccar/status")).json()["configured"] is True
    positions = (await editor_client.get("/api/traccar/positions")).json()
    assert sorted(p["device_name"] for p in positions) == ["Mawa", "Pio", "TLF", "Trawa"]
    assert (await editor_client.get("/api/traccar/trails")).json() == []


@pytest.mark.asyncio
async def test_the_poller_pushes_them_to_the_map_but_never_to_the_automation(session_factory, monkeypatch):
    """With the socket up the map does not poll: an assignment moves its vehicle only through
    the poller's broadcast. The automation (geofence, status changes) must not see the demo."""
    async with session_factory() as db:
        await _board(db)
    monkeypatch.setattr("app.config.settings.demo_mode", True)
    monkeypatch.setattr("app.database.async_session_maker", session_factory)
    monkeypatch.setattr(poller_module, "POSITIONS_INTERVAL_SECONDS", 0)
    poller = TraccarPoller()
    broadcast: list[list[dict]] = []
    automated: list[list] = []

    async def record_broadcast(data: list[dict]) -> None:
        broadcast.append(data)
        poller._should_poll = False  # one round

    async def record_automation(positions: list) -> None:
        automated.append(positions)

    monkeypatch.setattr("app.websocket_manager.broadcast_vehicle_positions", record_broadcast)
    monkeypatch.setattr(poller, "_run_automation", record_automation)
    poller._should_poll = True
    await poller._poll_positions()

    assert sorted(p["device_name"] for p in broadcast[0]) == ["Mawa", "Pio", "TLF", "Trawa"]
    assert automated == [[]]
    assert poller.cached_positions() == []
