"""Viewer API endpoints for read-only event access."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor
from ..crud import events as events_crud
from ..crud import incidents as incidents_crud
from ..database import get_db
from ..services.tokens import generate_viewer_token, validate_viewer_token

router = APIRouter(prefix="/viewer", tags=["viewer"])


@router.post("/generate-link", response_model=dict)
async def generate_viewer_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for viewer access"),
):
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
):
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

    return {
        "event": schemas.EventResponse.model_validate(event).model_dump(mode="json"),
        "incidents": [schemas.IncidentResponse.model_validate(i).model_dump(mode="json") for i in incidents],
    }
