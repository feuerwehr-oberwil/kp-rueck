"""Simulated GPS drives for Übungen (training events).

Instructors can send a vehicle on a simulated drive (to an incident or back to the
magazin) so trainees experience the full GPS pipeline — map markers, assignment
lines, distance labels, geofence notification, arrival/return prompts — without a
real vehicle on the road.

Design: simulations live in memory only (a backend restart clears them) and are
overlaid onto the Traccar position list at the single choke point every consumer
already uses (``TraccarClient.get_vehicle_positions``). Real Traccar devices and
their history are never touched; while a simulation is active for a vehicle, its
real position is masked by the simulated one.

Movement model: straight line from start to target with a realistic speed profile —
cruise (default 40 km/h), linear deceleration over the final stretch, then parked
at the target with speed 0. Positions are a pure function of elapsed time, so the
10s poll cadence needs no incremental state.
"""

import asyncio
import contextlib
import logging
import math
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..traccar import VehiclePosition

logger = logging.getLogger(__name__)

# Strong references to in-flight status broadcasts; see the create_task call in overlay().
_inflight_broadcast_tasks: set[asyncio.Task[None]] = set()

# A drive vanishes this long after it was started — nobody should have to
# remember to clean up a forgotten simulation.
MAX_LIFETIME_SECONDS = 30 * 60
# Distance over which the vehicle decelerates from cruise speed to standstill.
DECEL_ZONE_M = 150.0
# Real roads are longer than the crow flies; stretch the drive DURATION by this
# factor so straight-line drives don't feel unrealistically fast.
ROAD_FACTOR = 1.3
# Synthetic device ids live far below zero so they can never collide with Traccar.
_SIM_DEVICE_ID_BASE = -9000


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lng2 - lng1)
    y = math.sin(dlam) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlam)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


@dataclass
class SimulatedDrive:
    vehicle_id: uuid.UUID
    vehicle_name: str
    start_lat: float
    start_lng: float
    target_lat: float
    target_lng: float
    target_label: str  # e.g. "Hafenrainstrasse 4" or "Magazin"
    kind: str  # 'incident' | 'magazin'
    cruise_kmh: float
    started_at: datetime

    @property
    def total_m(self) -> float:
        """Geometric (crow-flies) length of the drawn line."""
        return _haversine_m(self.start_lat, self.start_lng, self.target_lat, self.target_lng)

    @property
    def route_m(self) -> float:
        """Pretend road length — the kinematics run over this."""
        return self.total_m * ROAD_FACTOR

    def _distance_and_speed(self, elapsed_s: float) -> tuple[float, float]:
        """Route distance travelled (m) and current speed (km/h) after ``elapsed_s``."""
        v = max(5.0, self.cruise_kmh) / 3.6  # m/s
        total = self.route_m
        decel = min(DECEL_ZONE_M, total)
        cruise_dist = total - decel
        t_cruise = cruise_dist / v
        t_decel = decel / (v / 2) if decel > 0 else 0.0  # linear ramp v -> 0

        if elapsed_s <= t_cruise:
            return v * elapsed_s, v * 3.6
        tau = elapsed_s - t_cruise
        if tau < t_decel:
            speed = v * (1 - tau / t_decel)
            dist = cruise_dist + v * tau - (v / (2 * t_decel)) * tau * tau
            return min(dist, total), speed * 3.6
        return total, 0.0

    def position_at(self, now: datetime) -> tuple[float, float, float]:
        """(lat, lng, speed_kmh) at wall-clock ``now``."""
        elapsed = max(0.0, (now - self.started_at).total_seconds())
        total = self.route_m
        if total < 1.0:
            return self.target_lat, self.target_lng, 0.0
        dist, speed = self._distance_and_speed(elapsed)
        f = min(1.0, dist / total)
        lat = self.start_lat + (self.target_lat - self.start_lat) * f
        lng = self.start_lng + (self.target_lng - self.start_lng) * f
        return lat, lng, speed

    def arrived(self, now: datetime) -> bool:
        dist, _ = self._distance_and_speed(max(0.0, (now - self.started_at).total_seconds()))
        return dist >= self.route_m

    def progress(self, now: datetime) -> float:
        total = self.route_m
        if total < 1.0:
            return 1.0
        dist, _ = self._distance_and_speed(max(0.0, (now - self.started_at).total_seconds()))
        return min(1.0, dist / total)

    def eta_seconds(self, now: datetime) -> float:
        v = max(5.0, self.cruise_kmh) / 3.6
        total = self.route_m
        decel = min(DECEL_ZONE_M, total)
        t_total = (total - decel) / v + (decel / (v / 2) if decel > 0 else 0.0)
        return max(0.0, t_total - (now - self.started_at).total_seconds())

    def expired(self, now: datetime) -> bool:
        return (now - self.started_at).total_seconds() > MAX_LIFETIME_SECONDS


class GpsSimulation:
    """In-memory registry of active simulated drives, keyed by vehicle name."""

    def __init__(self) -> None:
        self._drives: dict[str, SimulatedDrive] = {}  # key: vehicle_name.lower()
        self._lock = asyncio.Lock()

    def any_active(self) -> bool:
        return bool(self._drives)

    def list_drives(self) -> list[SimulatedDrive]:
        return list(self._drives.values())

    def current_position(self, vehicle_name: str) -> tuple[float, float] | None:
        """Last simulated position for a vehicle, if it is being simulated."""
        drive = self._drives.get(vehicle_name.lower())
        if not drive:
            return None
        lat, lng, _ = drive.position_at(datetime.now(UTC))
        return lat, lng

    async def start(self, drive: SimulatedDrive) -> None:
        async with self._lock:
            self._drives[drive.vehicle_name.lower()] = drive
        logger.info(
            "GPS simulation: %s -> %s (%.0f m at %.0f km/h)",
            drive.vehicle_name,
            drive.target_label,
            drive.total_m,
            drive.cruise_kmh,
        )
        await self._broadcast_status()

    async def set_speed(self, vehicle_name: str, speed_kmh: float) -> SimulatedDrive | None:
        """Change the cruise speed of an active drive without moving the vehicle.

        The drive is rebuilt with a back-dated ``started_at`` chosen so the
        distance already travelled stays identical under the new speed — the
        marker keeps rolling from where it is, only the pace changes.
        """
        async with self._lock:
            old = self._drives.get(vehicle_name.lower())
            if old is None:
                return None
            now = datetime.now(UTC)
            dist_done, _ = old._distance_and_speed(max(0.0, (now - old.started_at).total_seconds()))
            v = max(5.0, speed_kmh) / 3.6
            new = SimulatedDrive(
                vehicle_id=old.vehicle_id,
                vehicle_name=old.vehicle_name,
                start_lat=old.start_lat,
                start_lng=old.start_lng,
                target_lat=old.target_lat,
                target_lng=old.target_lng,
                target_label=old.target_label,
                kind=old.kind,
                cruise_kmh=speed_kmh,
                started_at=now - timedelta(seconds=dist_done / v),
            )
            self._drives[vehicle_name.lower()] = new
        logger.info("GPS simulation: %s speed -> %.0f km/h", new.vehicle_name, speed_kmh)
        await self._broadcast_status()
        return new

    async def stop(self, vehicle_name: str | None = None) -> int:
        """Stop one vehicle's drive (or all when ``vehicle_name`` is None)."""
        async with self._lock:
            if vehicle_name is None:
                removed = len(self._drives)
                self._drives.clear()
            else:
                removed = 1 if self._drives.pop(vehicle_name.lower(), None) else 0
        if removed:
            await self._broadcast_status()
        return removed

    def overlay(self, positions: list["VehiclePosition"]) -> list["VehiclePosition"]:
        """Mask real positions of simulated vehicles and append the simulated ones.

        Called from ``TraccarClient.get_vehicle_positions`` so every consumer
        (poller broadcast, automation tick, geofence notification, REST endpoint)
        sees the same picture. Also drops expired drives.
        """
        from ..traccar import VehiclePosition

        now = datetime.now(UTC)
        expired = [key for key, d in self._drives.items() if d.expired(now)]
        for key in expired:
            drive = self._drives.pop(key, None)
            if drive:
                logger.info("GPS simulation: %s expired after 30min", drive.vehicle_name)
        if expired:
            # Fire-and-forget status update; overlay() runs inside async contexts.
            # Strong reference until it finishes: asyncio keeps only a weak one, so an
            # unreferenced task can be collected mid-flight and the "drive expired"
            # broadcast is lost — leaving the Übungssteuerung showing a drive that is
            # already gone until something else triggers a status push.
            with contextlib.suppress(RuntimeError):
                task = asyncio.get_running_loop().create_task(self._broadcast_status())
                _inflight_broadcast_tasks.add(task)
                task.add_done_callback(_inflight_broadcast_tasks.discard)

        if not self._drives:
            return positions

        sim_names = set(self._drives.keys())
        result = [p for p in positions if p.device_name.lower() not in sim_names]
        for idx, drive in enumerate(self._drives.values()):
            lat, lng, speed = drive.position_at(now)
            result.append(
                VehiclePosition(
                    device_id=_SIM_DEVICE_ID_BASE - idx,
                    device_name=drive.vehicle_name,
                    unique_id=f"sim-{drive.vehicle_name.lower()}",
                    status="online",
                    latitude=lat,
                    longitude=lng,
                    speed=speed,
                    course=_bearing_deg(drive.start_lat, drive.start_lng, drive.target_lat, drive.target_lng),
                    last_update=now,
                    address=None,
                )
            )
        return result

    async def _broadcast_status(self) -> None:
        """Tell connected clients which simulations run (banner + Übungssteuerung)."""
        from ..websocket_manager import broadcast_message

        try:
            await broadcast_message(
                {
                    "type": "gps_sim_status",
                    "drives": [
                        {
                            "vehicle_id": str(d.vehicle_id),
                            "vehicle_name": d.vehicle_name,
                            "target_label": d.target_label,
                            "kind": d.kind,
                        }
                        for d in self._drives.values()
                    ],
                }
            )
        except Exception as e:  # never break position flow over a status broadcast
            logger.debug("GPS simulation status broadcast failed: %s", e)


gps_simulation = GpsSimulation()
