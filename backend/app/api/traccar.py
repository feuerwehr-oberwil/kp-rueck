"""Traccar GPS tracking API endpoints.

Every route here requires an authenticated session. These responses are the live
positions, resolved street addresses and movement history of the brigade's appliances —
i.e. where the fire service is right now — and `deploy/Caddyfile` proxies `/api/*`
straight to this app, so an unauthenticated route here is readable by anyone who knows
the station's domain. Until 2026-07 all three were open.

The wall display and the viewer link do NOT come through here: they are token-scoped and
receive positions as data (`api/viewer.py::_viewer_vehicle_positions`, surfaced to the map
as `positionsOverride`). `components/map-view.tsx` already described this endpoint as
"auth-only Traccar" — that assumption is now true.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.services.demo_positions import demo_positions_active, demo_vehicle_positions
from app.services.gps_simulation import gps_simulation
from app.traccar import traccar_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/traccar", tags=["traccar"])


class TraccarStatusResponse(BaseModel):
    """Response for Traccar status endpoint."""

    configured: bool
    url: str | None = None


class VehiclePositionResponse(BaseModel):
    """Response for a single vehicle position."""

    device_id: int
    device_name: str
    unique_id: str
    status: str
    latitude: float
    longitude: float
    speed: float | None = None  # km/h
    course: float | None = None  # degrees
    last_update: datetime
    address: str | None = None


@router.get("/status", response_model=TraccarStatusResponse)
async def get_traccar_status(current_user: CurrentUser) -> TraccarStatusResponse:
    """Get Traccar configuration status.

    Reports configured=true while a GPS simulation runs so the map subscribes to
    position updates even on installations without a real Traccar server – and on the
    public demo, which serves fixed positions (`services/demo_positions.py`).
    """
    return TraccarStatusResponse(
        configured=traccar_client.is_configured or gps_simulation.any_active() or demo_positions_active(),
        url=settings.traccar_url if traccar_client.is_configured else None,
    )


@router.get("/positions", response_model=list[VehiclePositionResponse])
async def get_vehicle_positions(
    current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
) -> list[VehiclePositionResponse]:
    """Get current GPS positions of all tracked vehicles."""
    if demo_positions_active():
        # A training drive started on the demo moves its vehicle off the fixed spot.
        positions = gps_simulation.overlay(await demo_vehicle_positions(db))
        return [VehiclePositionResponse(**p.model_dump()) for p in positions]
    if not traccar_client.is_configured and not gps_simulation.any_active():
        raise HTTPException(
            status_code=503,
            detail="Traccar ist nicht konfiguriert (TRACCAR_URL und TRACCAR_TOKEN setzen).",
        )

    try:
        positions = await traccar_client.get_vehicle_positions()
        return [
            VehiclePositionResponse(
                device_id=p.device_id,
                device_name=p.device_name,
                unique_id=p.unique_id,
                status=p.status,
                latitude=p.latitude,
                longitude=p.longitude,
                speed=p.speed,
                course=p.course,
                last_update=p.last_update,
                address=p.address,
            )
            for p in positions
        ]
    except Exception as e:
        logger.error("Failed to fetch positions from Traccar: %s", e)
        raise HTTPException(
            status_code=502,
            detail="GPS-Tracking-Service momentan nicht erreichbar",
        ) from e


class TrailPointResponse(BaseModel):
    """A single point in a vehicle's breadcrumb trail."""

    latitude: float
    longitude: float
    speed: float | None = None
    timestamp: datetime


class VehicleTrailResponse(BaseModel):
    """Breadcrumb trail for a vehicle."""

    device_id: int
    device_name: str
    points: list[TrailPointResponse]


@router.get("/trails", response_model=list[VehicleTrailResponse])
async def get_vehicle_trails(
    current_user: CurrentUser,
    minutes: int = Query(default=30, ge=5, le=120, description="Trail duration in minutes"),
) -> list[VehicleTrailResponse]:
    """Get recent position history (breadcrumb trails) for all tracked vehicles."""
    if demo_positions_active():
        return []  # The demo's vehicles stand still.
    if not traccar_client.is_configured:
        raise HTTPException(status_code=503, detail="Traccar ist nicht konfiguriert")

    try:
        now = datetime.now(UTC)
        from_time = now - timedelta(minutes=minutes)

        devices = await traccar_client.get_devices()

        # Get history for each device
        trails: list[VehicleTrailResponse] = []
        for device in devices:
            try:
                positions = await traccar_client.get_position_history(device.id, from_time, now)
                if not positions:
                    continue

                points = [
                    TrailPointResponse(
                        latitude=p.latitude,
                        longitude=p.longitude,
                        speed=p.speed * 1.852 if p.speed is not None else None,
                        timestamp=p.deviceTime,
                    )
                    for p in positions
                ]

                trails.append(
                    VehicleTrailResponse(
                        device_id=device.id,
                        device_name=device.name,
                        points=points,
                    )
                )
            except Exception as e:
                logger.debug("Failed to get trail for device %s: %s", device.name, e)
                continue

        return trails
    except Exception as e:
        logger.error("Failed to fetch vehicle trails: %s", e)
        raise HTTPException(status_code=502, detail="GPS-Tracking-Service momentan nicht erreichbar") from e
