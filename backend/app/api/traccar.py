"""Traccar GPS tracking API endpoints."""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import settings
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
async def get_traccar_status() -> TraccarStatusResponse:
    """Get Traccar configuration status."""
    return TraccarStatusResponse(
        configured=traccar_client.is_configured,
        url=settings.traccar_url if traccar_client.is_configured else None,
    )


@router.get("/positions", response_model=list[VehiclePositionResponse])
async def get_vehicle_positions() -> list[VehiclePositionResponse]:
    """Get current GPS positions of all tracked vehicles."""
    if not traccar_client.is_configured:
        raise HTTPException(
            status_code=503,
            detail="Traccar is not configured. Set TRACCAR_URL and TRACCAR_TOKEN environment variables.",
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
        )


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
    minutes: int = Query(default=30, ge=5, le=120, description="Trail duration in minutes"),
) -> list[VehicleTrailResponse]:
    """Get recent position history (breadcrumb trails) for all tracked vehicles."""
    if not traccar_client.is_configured:
        raise HTTPException(status_code=503, detail="Traccar is not configured")

    try:
        now = datetime.now(UTC)
        from_time = now - timedelta(minutes=minutes)

        devices = await traccar_client.get_devices()

        # Get history for each device
        trails: list[VehicleTrailResponse] = []
        for device in devices:
            try:
                positions = await traccar_client.get_position_history(
                    device.id, from_time, now
                )
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
        raise HTTPException(status_code=502, detail="GPS-Tracking-Service momentan nicht erreichbar")
