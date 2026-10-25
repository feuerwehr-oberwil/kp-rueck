"""Training GPS drive simulation API (`/training/gps-sim/*`) — see services/gps_simulation.py."""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..database import get_db
from ..models import (
    Event,
    Incident,
    IncidentAssignment,
    Vehicle,
)
from ..utils.errors import ErrorMessages

if TYPE_CHECKING:
    # Imported lazily at runtime inside the endpoints below (circular import), so the
    # annotation-only reference lives here.
    from ..services.gps_simulation import SimulatedDrive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])


# ---------------------------------------------------------------------------
# GPS drive simulation (Übungssteuerung) — see services/gps_simulation.py
# ---------------------------------------------------------------------------


class GpsSimStartRequest(BaseModel):
    vehicle_id: UUID
    target: Literal["incident", "magazin"]
    incident_id: UUID | None = None
    speed_kmh: float = 30.0


class GpsSimStopRequest(BaseModel):
    vehicle_id: UUID | None = None  # None stops all drives


class GpsSimSpeedRequest(BaseModel):
    vehicle_id: UUID
    speed_kmh: float


class GpsSimDriveResponse(BaseModel):
    vehicle_id: UUID
    vehicle_name: str
    target_label: str
    kind: str
    progress: float
    eta_seconds: float
    speed_kmh: float
    started_at: datetime


def _drive_response(drive: "SimulatedDrive", now: datetime) -> GpsSimDriveResponse:
    return GpsSimDriveResponse(
        vehicle_id=drive.vehicle_id,
        vehicle_name=drive.vehicle_name,
        target_label=drive.target_label,
        kind=drive.kind,
        progress=drive.progress(now),
        eta_seconds=drive.eta_seconds(now),
        speed_kmh=drive.cruise_kmh,
        started_at=drive.started_at,
    )


@router.get("/gps-sim/", response_model=list[GpsSimDriveResponse])
async def list_gps_simulations(current_user: CurrentUser) -> list[GpsSimDriveResponse]:
    """List active simulated drives."""
    from ..services.gps_simulation import gps_simulation

    now = datetime.now(UTC)
    return [_drive_response(d, now) for d in gps_simulation.list_drives()]


@router.post("/gps-sim/start", response_model=GpsSimDriveResponse)
async def start_gps_simulation(
    request: GpsSimStartRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> GpsSimDriveResponse:
    """Start a simulated GPS drive for a vehicle (training use).

    The simulated positions feed the exact same pipeline as real Traccar data,
    so trainees get the real deal: map movement, distance labels, geofence
    notification and the arrival/return prompts.
    """
    from ..services.gps_simulation import SimulatedDrive, gps_simulation
    from ..services.settings import get_station_coordinates
    from ..services.traccar_poller import traccar_poller
    from ..traccar import traccar_client

    if settings.demo_mode:
        raise HTTPException(status_code=403, detail="Im Demo-Modus nicht verfügbar")

    vehicle = await db.get(Vehicle, request.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)

    # Drives to a training incident are always allowed — an open Ernstfall
    # event elsewhere does not lock the Übungssteuerung. The only target-side
    # rail is below: you can only drive to incidents of a training event.

    # Resolve the target
    if request.target == "incident":
        if not request.incident_id:
            raise HTTPException(status_code=400, detail="incident_id fehlt")
        incident = await db.get(Incident, request.incident_id)
        if not incident or incident.deleted_at is not None:
            raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)
        event = await db.get(Event, incident.event_id)
        if not event or not event.training_flag:
            raise HTTPException(status_code=400, detail="Nur Einsätze aus Übungen können angefahren werden")
        if incident.location_lat is None or incident.location_lng is None:
            raise HTTPException(status_code=400, detail="Einsatz hat keine Koordinaten")
        target = (float(incident.location_lat), float(incident.location_lng))
        target_label = incident.location_address or incident.title or "Einsatz"
    else:
        station = await get_station_coordinates(db)
        if station is None:
            raise HTTPException(
                status_code=400,
                detail="Magazin-Koordinaten fehlen (Einstellungen → Allgemein)",
            )
        target = station
        target_label = "Magazin"

    # Start position: current simulated position > (for returns) the assigned
    # incident's location > real GPS > magazin > firestation
    start = gps_simulation.current_position(vehicle.name)
    if start is None and request.target == "magazin":
        # A returning vehicle conceptually starts at the incident it is still
        # assigned to — its REAL tracker usually sits parked at the magazin,
        # which would make the return drive an 8-metre no-op.
        row = (
            await db.execute(
                select(Incident.location_lat, Incident.location_lng)
                .join(IncidentAssignment, IncidentAssignment.incident_id == Incident.id)
                .where(IncidentAssignment.resource_type == "vehicle")
                .where(IncidentAssignment.resource_id == vehicle.id)
                .where(IncidentAssignment.unassigned_at.is_(None))
                .where(Incident.deleted_at.is_(None))
                .where(Incident.location_lat.isnot(None))
                .where(Incident.location_lng.isnot(None))
                .order_by(IncidentAssignment.assigned_at.desc())
                .limit(1)
            )
        ).first()
        if row:
            start = (float(row[0]), float(row[1]))
    if start is None:
        try:
            for p in await traccar_client.get_vehicle_positions():
                if p.device_name.lower() == vehicle.name.lower():
                    start = (p.latitude, p.longitude)
                    break
        except Exception:
            start = None
    if start is None:
        # Both pairs in one question — see get_station_coordinates.
        start = await get_station_coordinates(db) or (47.51637699933488, 7.561800450458299)

    drive = SimulatedDrive(
        vehicle_id=vehicle.id,
        vehicle_name=vehicle.name,
        start_lat=start[0],
        start_lng=start[1],
        target_lat=target[0],
        target_lng=target[1],
        target_label=target_label,
        kind=request.target,
        cruise_kmh=max(10.0, min(100.0, request.speed_kmh)),
        started_at=datetime.now(UTC),
    )
    await gps_simulation.start(drive)
    # Make sure positions actually flow, even without a real Traccar server.
    await traccar_poller.start_polling()

    return _drive_response(drive, datetime.now(UTC))


@router.post("/gps-sim/speed", response_model=GpsSimDriveResponse)
async def set_gps_simulation_speed(
    request: GpsSimSpeedRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> GpsSimDriveResponse:
    """Change the cruise speed of a vehicle's active simulated drive."""
    from ..services.gps_simulation import gps_simulation

    vehicle = await db.get(Vehicle, request.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)

    drive = await gps_simulation.set_speed(vehicle.name, max(10.0, min(100.0, request.speed_kmh)))
    if drive is None:
        raise HTTPException(status_code=404, detail="Keine aktive Fahrt für dieses Fahrzeug")
    return _drive_response(drive, datetime.now(UTC))


@router.post("/gps-sim/stop", response_model=None)
async def stop_gps_simulation(
    request: GpsSimStopRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Stop one vehicle's simulated drive, or all of them."""
    from ..services.gps_simulation import gps_simulation

    vehicle_name = None
    if request.vehicle_id is not None:
        vehicle = await db.get(Vehicle, request.vehicle_id)
        if not vehicle:
            raise HTTPException(status_code=404, detail=ErrorMessages.VEHICLE_NOT_FOUND)
        vehicle_name = vehicle.name

    stopped = await gps_simulation.stop(vehicle_name)
    return {"stopped": stopped}
