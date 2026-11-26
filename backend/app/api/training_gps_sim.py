"""Training GPS drive simulation API (`/training/gps-sim/*`) — see services/gps_simulation.py."""

import logging
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import (
    Vehicle,
)
from ..schemas.training import GpsSimStopped
from ..services.gps_simulation import DriveKind
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


class GpsSimStopRequest(BaseModel):
    vehicle_id: UUID | None = None  # None stops all drives


class GpsSimDriveResponse(BaseModel):
    vehicle_id: UUID
    vehicle_name: str
    target_label: str
    kind: DriveKind
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

    now = gps_simulation.clock()
    return [_drive_response(d, now) for d in gps_simulation.list_drives()]


@router.post("/gps-sim/stop", response_model=GpsSimStopped)
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
