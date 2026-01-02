"""Traccar GPS tracking API endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.traccar import traccar_client, VehiclePosition
from app.config import settings

router = APIRouter(prefix="/traccar", tags=["traccar"])


class TraccarStatusResponse(BaseModel):
    """Response for Traccar status endpoint."""
    configured: bool
    url: Optional[str] = None


class VehiclePositionResponse(BaseModel):
    """Response for a single vehicle position."""
    device_id: int
    device_name: str
    unique_id: str
    status: str
    latitude: float
    longitude: float
    speed: Optional[float] = None  # km/h
    course: Optional[float] = None  # degrees
    last_update: datetime
    address: Optional[str] = None


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
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch positions from Traccar: {str(e)}",
        )
