"""Public alarm-intake API endpoints.

Token-gated alarm creation for phone operators / walk-ins who have no login and
no knowledge of the rest of the system. An editor generates a per-event link
(``/intake/generate-link``); anyone with the link can read the event context and
create alarms via ``?token=``. Created alarms are flagged ``source="intake"`` so
operators can verify them on the board.
"""

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentEditor
from ..config import settings
from ..crud import events as events_crud
from ..crud import incidents as crud
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..services import incident_display
from ..services.tokens import generate_alarm_token, validate_alarm_token
from ..websocket_manager import broadcast_incident_update
from .incidents import trigger_sync_background

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intake", tags=["intake"])


@router.post("/generate-link", response_model=dict)
async def generate_alarm_link(
    request: Request,
    current_user: CurrentEditor,  # Editor only
    event_id: uuid.UUID = Query(..., description="Event ID for alarm intake"),
):
    """
    Generate a public alarm-intake link with QR code (editor only).

    Returns a shareable link scoped to a specific event. Anyone with the link can
    create alarms without logging in. Long-lived (30 days) for the phone desk.
    """
    token = generate_alarm_token(event_id)
    link = f"/alarm?token={token}"

    base_url = str(request.base_url).rstrip("/")

    return {
        "token": token,
        "link": link,
        "full_url": f"{base_url}{link}",
        "qr_code_data": link,  # Frontend generates the QR code from this
    }


@router.get("/context", response_model=dict)
async def get_intake_context(
    token: str = Query(..., description="Access token from generated link"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get minimal event context for the public intake form.

    No authentication required — uses token validation. Lets the page show
    "Alarm erfassen — {event name}" and gate on load.
    """
    event_id = validate_alarm_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    event = await events_crud.get_event_by_id(db, event_id)
    if not event or event.archived_at is not None:
        raise HTTPException(status_code=404, detail="Event not found")

    return {
        "event": {
            "id": str(event.id),
            "name": event.name,
            "training_flag": event.training_flag,
        }
    }


@router.post("/alarm", response_model=dict, status_code=status.HTTP_201_CREATED)
@limiter.limit(RateLimits.INTAKE)
async def create_intake_alarm(
    incident: schemas.PublicIncidentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    token: str = Query(..., description="Access token from generated link"),
):
    """
    Create an alarm from the public intake form (no authentication, token only).

    Validates the token, enforces the demo cap, creates the incident flagged as
    intake, then broadcasts and syncs exactly like the authenticated create path.
    """
    event_id = validate_alarm_token(token)
    if not event_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Verify event exists and is active
    event = await events_crud.get_event_by_id(db, event_id)
    if not event or event.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Demo mode: cap incidents per event at 50 (same as the authenticated create path)
    if settings.demo_mode:
        count_result = await db.execute(
            select(sa_func.count()).select_from(models.Incident).where(models.Incident.event_id == event_id)
        )
        event_incidents = count_result.scalar() or 0
        if event_incidents >= 50:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Anzahl Einsätze (50) erreicht. Die Demo wird regelmässig zurückgesetzt.",
            )

    new_incident = await crud.create_public_incident(
        db=db,
        event_id=event_id,
        incident=incident,
        request=request,
    )

    # Trigger immediate sync in background (event-based sync)
    background_tasks.add_task(trigger_sync_background)

    # Broadcast WebSocket update so the board updates live
    incident_response = await incident_display.incident_with_display(db, new_incident)
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return {"id": str(new_incident.id)}
