"""Viewer API endpoints for read-only event access."""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import assignments as assignments_crud
from ..crud import events as events_crud
from ..crud import groups as groups_crud
from ..crud import incidents as incidents_crud
from ..crud import materials as materials_crud
from ..crud import personnel as personnel_crud
from ..crud import special_functions as special_functions_crud
from ..crud import vehicles as vehicles_crud
from ..database import get_db
from ..services import incident_display
from ..services.gps_simulation import gps_simulation
from ..services.tokens import generate_viewer_token, validate_viewer_token
from ..traccar import traccar_client
from .special_functions import _enrich_assignments

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/viewer", tags=["viewer"])


async def _viewer_vehicle_positions() -> list[dict[str, Any]]:
    """Current GPS positions for the read-only display, best-effort.

    Returns [] instead of raising when Traccar is unconfigured or unreachable,
    so a shared display never fails to load because GPS is down.
    """
    if not traccar_client.is_configured and not gps_simulation.any_active():
        return []
    try:
        positions = await traccar_client.get_vehicle_positions()
        return [
            {
                "device_id": p.device_id,
                "device_name": p.device_name,
                "unique_id": p.unique_id,
                "status": p.status,
                "latitude": p.latitude,
                "longitude": p.longitude,
                "speed": p.speed,
                "course": p.course,
                "last_update": p.last_update.isoformat() if p.last_update else None,
                "address": p.address,
            }
            for p in positions
        ]
    except Exception as e:  # GPS is optional for the display
        logger.warning("Viewer GPS positions unavailable: %s", e)
        return []


@router.post("/generate-link", response_model=dict)
async def generate_viewer_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for viewer access"),
) -> dict[str, str]:
    """
    Generate viewer link (editor only).

    Returns shareable link for read-only access to an event's incidents.
    Anyone with this link can view the current state without logging in.
    """
    token = generate_viewer_token(event_id)
    link = f"/viewer?token={token}"

    # Get base URL from request
    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend will generate QR code from this
    }


@router.get("/data", response_model=dict)
async def get_viewer_data(
    token: str = Query(..., description="Access token from generated link"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Get read-only event data for viewer.

    No authentication required - uses token validation.
    Returns event info and all incidents for the event.
    """
    event_id = validate_viewer_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Get event information
    event = await events_crud.get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all incidents for the event
    incidents = await incidents_crud.get_incidents(db, event_id=event_id)
    groups = await groups_crud.list_groups_by_event(db, event_id)

    # Checked-in roster for this event (same scoping as the logged-in display),
    # plus materials/vehicles and live GPS. Assignments + special functions let
    # the client derive event-scoped availability (assigned vs. available) —
    # the raw Personnel.status field never reflects incident assignments.
    personnel = await personnel_crud.get_all_personnel(db, checked_in_only=True, event_id=event_id)
    materials = await materials_crud.get_all_materials(db)
    vehicles = await vehicles_crud.get_all_vehicles(db)
    vehicle_positions = await _viewer_vehicle_positions()
    assignments = await assignments_crud.get_assignments_by_event(db, event_id)
    special_functions = await _enrich_assignments(
        db, await special_functions_crud.get_event_special_functions(db, event_id)
    )

    return {
        "event": schemas.EventResponse.model_validate(event).model_dump(mode="json"),
        "incidents": [i.model_dump(mode="json") for i in await incident_display.incidents_with_display(db, incidents)],
        "groups": [group.model_dump(mode="json") for group in groups],
        "personnel": [schemas.Personnel.model_validate(p).model_dump(mode="json") for p in personnel],
        "materials": [schemas.Material.model_validate(m).model_dump(mode="json") for m in materials],
        "vehicles": [schemas.Vehicle.model_validate(v).model_dump(mode="json") for v in vehicles],
        "vehicle_positions": vehicle_positions,
        "assignments": {
            str(incident_id): [a.model_dump(mode="json") for a in assignment_list]
            for incident_id, assignment_list in assignments.items()
        },
        "special_functions": [sf.model_dump(mode="json") for sf in special_functions],
    }
