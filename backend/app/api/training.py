"""Training automation API: generate and dispatch exercise alarms, the template and location lists.

The Übungssteuerung's injects live in `training_simulate.py`, the GPS drive simulator in
`training_gps_sim.py` – same `/training` prefix, one router each.
"""

import logging
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..database import get_db
from ..models import (
    EmergencyTemplate,
    Event,
    TrainingLocation,
)
from ..schemas import (
    EmergencyTemplateResponse,
    GenerateEmergencyRequest,
    IncidentResponse,
    ManualDispatchRequest,
    TrainingLocationResponse,
)
from ..services import incident_display
from ..services.training import (
    TrainingGenerator,
    generate_training_emergency,
)
from ..utils.errors import ErrorMessages
from ..websocket_manager import (
    broadcast_incident_update,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/events/{event_id}/generate/", response_model=list[IncidentResponse])
async def generate_emergencies(
    event_id: UUID,
    request: GenerateEmergencyRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> list[IncidentResponse]:
    """
    Manually generate training emergencies.

    - **category**: 'normal', 'critical', or null for random
    - **count**: Number to generate (1-10, for burst mode)
    """
    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)

    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Alarme können nur in Übungen erzeugt werden"
        )

    # Validate count
    if request.count < 1 or request.count > 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anzahl muss zwischen 1 und 10 liegen")

    # Validate category
    if request.category and request.category not in ["normal", "critical"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.CATEGORY_INVALID)

    # Validate source
    if request.source not in ["operator", "intake"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quelle muss 'operator' oder 'intake' sein")

    # Generate emergencies. If the training template/location pool was never seeded
    # the generator raises ValueError — surface that as a clean 503 (with CORS headers,
    # so the browser shows the message instead of an opaque NetworkError) rather than a 500.
    # The request schema types `category` as a plain `str | None` (API contract), the
    # generator wants the Literal — the check above is what makes them the same thing.
    category = cast(Literal["normal", "critical"] | None, request.category)

    try:
        incidents = await generate_training_emergency(
            db, event_id, category=category, count=request.count, source=request.source
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Keine Übungs-Szenarien vorhanden. Bitte zuerst die Übungsdaten seeden.",
        ) from exc

    # Convert to response models and broadcast WebSocket updates
    responses = []
    for incident in incidents:
        incident_response = await incident_display.incident_with_display(db, incident)
        responses.append(incident_response)
        # Broadcast WebSocket update for each created incident
        background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return responses


@router.post("/events/{event_id}/dispatch/", response_model=IncidentResponse)
async def manual_dispatch(
    event_id: UUID,
    request: ManualDispatchRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> IncidentResponse:
    """Trainer-driven dispatch: place a specific template at a specific location.

    Unlike `/generate/` (random template, random location), the trainer picks
    both — useful to inject a known scenario at a known address for exercise
    realism (e.g. "BMA Schulhaus" at the actual local school).
    """
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.EVENT_NOT_FOUND)
    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alarme können nur in Übungen ausgelöst werden",
        )

    template = await db.get(EmergencyTemplate, request.template_id)
    if not template or not template.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alarmvorlage nicht gefunden")

    generator = TrainingGenerator(db)

    if request.location_id is not None:
        location = await db.get(TrainingLocation, request.location_id)
        if not location or not location.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Übungsort nicht gefunden")
        incident = await generator.dispatch_specific(event_id, template, location=location)
    else:
        # Ad-hoc map pin path — validator guarantees these fields are set.
        # S101 suppressed: narrows the Optionals for the call below; the validator guarantees it.
        assert request.latitude is not None and request.longitude is not None and request.address  # noqa: S101
        incident = await generator.dispatch_specific(
            event_id,
            template,
            location_override=(request.address, request.latitude, request.longitude),
        )

    response = await incident_display.incident_with_display(db, incident)
    background_tasks.add_task(broadcast_incident_update, response.model_dump(mode="json"), "create")
    return response


@router.get("/templates/", response_model=list[EmergencyTemplateResponse])
async def list_templates(
    current_user: CurrentUser, category: str | None = None, db: AsyncSession = Depends(get_db)
) -> list[EmergencyTemplateResponse]:
    """List all emergency templates, optionally filtered by category."""
    query = select(EmergencyTemplate).where(EmergencyTemplate.is_active)

    if category:
        if category not in ["normal", "critical"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.CATEGORY_INVALID)
        query = query.where(EmergencyTemplate.category == category)

    result = await db.execute(query)
    templates = result.scalars().all()

    return [EmergencyTemplateResponse.model_validate(t) for t in templates]


@router.get("/locations/", response_model=list[TrainingLocationResponse])
async def list_locations(
    current_user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> list[TrainingLocationResponse]:
    """List all training locations."""
    result = await db.execute(select(TrainingLocation).where(TrainingLocation.is_active))
    locations = result.scalars().all()

    return [TrainingLocationResponse.model_validate(loc) for loc in locations]
