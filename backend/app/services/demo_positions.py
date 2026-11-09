"""Fixed vehicle positions for the public demo, which has no Traccar.

Without them the demo's Lagekarte – and the website screenshots taken from it – never show a
vehicle. Only with `DEMO_MODE=true` and no Traccar configured (`demo_positions_active`), and only
for the map: `api/traccar.py` answers with them, and the poller (`services/traccar_poller.py`)
broadcasts them every 10 s so an assignment moves its vehicle. The poller's cache, the GPS
automation and the geofence never see them, so nothing changes an incident on its own.

The picture follows the board: a vehicle assigned to an open Einsatz stands at it, online;
the others stand at the Magazin, alternately online and offline – offline ones with a last
report hours ago, so the map shows its stale state too.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..config import settings as app_settings
from ..traccar import VehiclePosition, traccar_client
from .settings import get_station_coordinates

# About 25 m north-west of the Einsatz: beside its pin, not on it.
AT_INCIDENT = (0.0002, -0.0002)
# The Magazin's vehicles stand a few metres apart, close enough to count as one place.
MAGAZIN_STEP = 0.00004


def demo_positions_active() -> bool:
    """The demo serves its own positions: demo mode, and no real Traccar to ask."""
    return app_settings.demo_mode and not traccar_client.is_configured


async def demo_vehicle_positions(db: AsyncSession, now: datetime | None = None) -> list[VehiclePosition]:
    """Every vehicle at its demo spot (see the module docstring); none without Magazin coordinates."""
    now = now or datetime.now(UTC)
    magazin = await get_station_coordinates(db)
    if magazin is None:
        return []

    vehicles = (
        (
            await db.execute(
                select(models.Vehicle)
                .where(models.Vehicle.archived_at.is_(None))
                .order_by(models.Vehicle.display_order, models.Vehicle.name)
            )
        )
        .scalars()
        .all()
    )
    # Where each assigned vehicle is: its newest active assignment to an open, located Einsatz.
    rows = await db.execute(
        select(models.IncidentAssignment.resource_id, models.Incident.location_lat, models.Incident.location_lng)
        .join(models.Incident, models.Incident.id == models.IncidentAssignment.incident_id)
        .join(models.Event, models.Event.id == models.Incident.event_id)
        .where(
            models.IncidentAssignment.resource_type == "vehicle",
            models.IncidentAssignment.unassigned_at.is_(None),
            models.Incident.deleted_at.is_(None),
            models.Incident.status != "complete",
            models.Incident.location_lat.is_not(None),
            models.Event.archived_at.is_(None),
        )
        .order_by(models.IncidentAssignment.assigned_at)
    )
    at_incident = {vehicle_id: (float(lat), float(lng)) for vehicle_id, lat, lng in rows}

    positions: list[VehiclePosition] = []
    home = 0
    for device_id, vehicle in enumerate(vehicles, start=1):
        if vehicle.id in at_incident:
            lat, lng = at_incident[vehicle.id]
            lat, lng, online = lat + AT_INCIDENT[0], lng + AT_INCIDENT[1], True
        else:
            lat = magazin[0] + (home % 3) * MAGAZIN_STEP
            lng = magazin[1] + (home // 3) * MAGAZIN_STEP
            online = home % 2 == 0
            home += 1
        positions.append(
            VehiclePosition(
                device_id=device_id,
                device_name=vehicle.name,
                unique_id=f"demo-{vehicle.id}",
                status="online" if online else "offline",
                latitude=lat,
                longitude=lng,
                speed=0.0,
                course=None,
                last_update=now - (timedelta(seconds=20) if online else timedelta(hours=2, minutes=17 * device_id)),
            )
        )
    return positions
