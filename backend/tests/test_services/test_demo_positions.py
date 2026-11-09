"""The public demo's fixed vehicle positions: crews out stand at their Einsatz, the rest at the
Magazin, and only demo mode without a Traccar serves them."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, IncidentAssignment, Vehicle
from app.services.demo_positions import AT_INCIDENT, demo_vehicle_positions
from app.services.settings import update_setting

MAGAZIN = (47.5164, 7.5618)


async def _fleet(db: AsyncSession, incident: Incident) -> None:
    """TLF out at `incident`; Pio, Trawa and Mawa at home."""
    for order, name in enumerate(["TLF", "Pio", "Trawa", "Mawa"], start=1):
        vehicle = Vehicle(id=uuid4(), name=name, type="MTW", status="available", display_order=order)
        db.add(vehicle)
        if name == "TLF":
            db.add(IncidentAssignment(incident_id=incident.id, resource_type="vehicle", resource_id=vehicle.id))
    await update_setting(db, "firestation_latitude", str(MAGAZIN[0]), None)
    await update_setting(db, "firestation_longitude", str(MAGAZIN[1]), None)
    await db.commit()


@pytest.mark.asyncio
async def test_crews_out_stand_at_their_einsatz_the_rest_at_the_magazin(db_session, test_incident):
    await _fleet(db_session, test_incident)
    now = datetime(2026, 11, 10, 19, 0, tzinfo=UTC)

    by_name = {p.device_name: p for p in await demo_vehicle_positions(db_session, now)}

    tlf = by_name["TLF"]
    assert (tlf.status, tlf.latitude, tlf.longitude) == (
        "online",
        pytest.approx(float(test_incident.location_lat) + AT_INCIDENT[0]),
        pytest.approx(float(test_incident.location_lng) + AT_INCIDENT[1]),
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
async def test_only_demo_mode_serves_them(editor_client: AsyncClient, db_session, test_incident, monkeypatch):
    await _fleet(db_session, test_incident)

    status = await editor_client.get("/api/traccar/status")
    assert status.json()["configured"] is False

    monkeypatch.setattr("app.config.settings.demo_mode", True)
    assert (await editor_client.get("/api/traccar/status")).json()["configured"] is True
    positions = (await editor_client.get("/api/traccar/positions")).json()
    assert sorted(p["device_name"] for p in positions) == ["Mawa", "Pio", "TLF", "Trawa"]
    assert (await editor_client.get("/api/traccar/trails")).json() == []
