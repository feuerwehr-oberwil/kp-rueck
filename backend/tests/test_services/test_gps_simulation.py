"""Tests for the simulated GPS drives (Übungssteuerung)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.services.gps_simulation import DECEL_ZONE_M, GpsSimulation, SimulatedDrive, _haversine_m
from app.traccar import VehiclePosition

START = (47.5164, 7.5618)  # magazin
TARGET = (47.5180, 7.5559)  # ~470m away


def _drive(speed: float = 40.0, started_at: datetime | None = None) -> SimulatedDrive:
    return SimulatedDrive(
        vehicle_id=uuid.uuid4(),
        vehicle_name="Pio",
        start_lat=START[0],
        start_lng=START[1],
        target_lat=TARGET[0],
        target_lng=TARGET[1],
        target_label="Testweg 1",
        kind="incident",
        cruise_kmh=speed,
        started_at=started_at or datetime.now(UTC),
    )


def test_drive_starts_at_start_and_arrives():
    t0 = datetime.now(UTC)
    d = _drive(started_at=t0)

    lat, lng, speed = d.position_at(t0)
    assert (lat, lng) == START
    assert speed > 0

    # 470m at 40 km/h with decel is well under 2 minutes.
    lat, lng, speed = d.position_at(t0 + timedelta(minutes=2))
    assert (lat, lng) == TARGET
    assert speed == 0.0
    assert d.arrived(t0 + timedelta(minutes=2))
    assert d.progress(t0 + timedelta(minutes=2)) == 1.0


def test_drive_progress_is_monotonic_and_decelerates():
    t0 = datetime.now(UTC)
    d = _drive(started_at=t0)

    last_dist = -1.0
    speeds = []
    for secs in range(0, 120, 5):
        lat, lng, speed = d.position_at(t0 + timedelta(seconds=secs))
        dist = _haversine_m(START[0], START[1], lat, lng)
        assert dist >= last_dist - 0.01
        last_dist = dist
        speeds.append(speed)

    # Cruise at the requested speed early on, slower inside the decel zone.
    assert speeds[0] == pytest.approx(40.0, abs=1.0)
    remaining_at = lambda s: d.total_m - _haversine_m(START[0], START[1], *d.position_at(t0 + timedelta(seconds=s))[:2])
    for secs in range(0, 120, 5):
        if 0 < remaining_at(secs) < DECEL_ZONE_M / 2:
            _, _, v = d.position_at(t0 + timedelta(seconds=secs))
            assert v < 40.0


def _real_pos(name: str) -> VehiclePosition:
    return VehiclePosition(
        device_id=4,
        device_name=name,
        unique_id="real",
        status="online",
        latitude=1.0,
        longitude=1.0,
        speed=0.0,
        course=None,
        last_update=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_overlay_masks_real_position_and_appends_sim():
    sim = GpsSimulation()
    await sim.start(_drive())

    result = sim.overlay([_real_pos("Pio"), _real_pos("TLF")])
    names = [p.device_name for p in result]
    assert names.count("Pio") == 1
    assert "TLF" in names
    pio = next(p for p in result if p.device_name == "Pio")
    assert pio.unique_id == "sim-pio"
    assert pio.device_id < 0
    assert pio.latitude == pytest.approx(START[0], abs=0.001)


@pytest.mark.asyncio
async def test_overlay_drops_expired_drives():
    sim = GpsSimulation()
    await sim.start(_drive(started_at=datetime.now(UTC) - timedelta(minutes=31)))

    result = sim.overlay([_real_pos("Pio")])
    assert [p.unique_id for p in result] == ["real"]
    assert not sim.any_active()


@pytest.mark.asyncio
async def test_stop_specific_and_all():
    sim = GpsSimulation()
    await sim.start(_drive())
    assert await sim.stop("PIO") == 1  # case-insensitive
    assert not sim.any_active()

    await sim.start(_drive())
    assert await sim.stop(None) == 1
    assert not sim.any_active()
