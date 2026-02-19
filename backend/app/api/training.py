"""Training automation API endpoints."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..database import get_db
from ..models import EmergencyTemplate, Event, TrainingLocation
from ..schemas import (
    EmergencyTemplateResponse,
    GenerateEmergencyRequest,
    IncidentResponse,
    TrainingLocationResponse,
)
from ..services.training import generate_training_emergency
from ..websocket_manager import broadcast_incident_update

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/events/{event_id}/generate/", response_model=list[IncidentResponse])
async def generate_emergencies(
    event_id: UUID,
    request: GenerateEmergencyRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually generate training emergencies.

    - **category**: 'normal', 'critical', or null for random
    - **count**: Number to generate (1-10, for burst mode)
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Übungsmodus ist im Demo-Modus nicht verfügbar",
        )

    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Can only generate emergencies for training events"
        )

    # Validate count
    if request.count < 1 or request.count > 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Count must be between 1 and 10")

    # Validate category
    if request.category and request.category not in ["normal", "critical"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'")

    # Generate emergencies
    incidents = await generate_training_emergency(db, event_id, category=request.category, count=request.count)

    # Convert to response models and broadcast WebSocket updates
    responses = []
    for incident in incidents:
        incident_response = IncidentResponse.model_validate(incident)
        responses.append(incident_response)
        # Broadcast WebSocket update for each created incident
        background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return responses


@router.get("/templates/", response_model=list[EmergencyTemplateResponse])
async def list_templates(current_user: CurrentUser, category: str | None = None, db: AsyncSession = Depends(get_db)):
    """List all emergency templates, optionally filtered by category."""
    query = select(EmergencyTemplate).where(EmergencyTemplate.is_active)

    if category:
        if category not in ["normal", "critical"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Category must be 'normal' or 'critical'"
            )
        query = query.where(EmergencyTemplate.category == category)

    result = await db.execute(query)
    templates = result.scalars().all()

    return [EmergencyTemplateResponse.model_validate(t) for t in templates]


@router.get("/locations/", response_model=list[TrainingLocationResponse])
async def list_locations(current_user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """List all training locations."""
    result = await db.execute(select(TrainingLocation).where(TrainingLocation.is_active))
    locations = result.scalars().all()

    return [TrainingLocationResponse.model_validate(loc) for loc in locations]
