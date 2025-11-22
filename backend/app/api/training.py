"""Training automation API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from ..database import get_db
from ..schemas import (
    GenerateEmergencyRequest,
    IncidentResponse,
    EmergencyTemplateResponse,
    TrainingLocationResponse,
)
from ..services.training import generate_training_emergency
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..models import Event, EmergencyTemplate, TrainingLocation

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/events/{event_id}/generate/", response_model=list[IncidentResponse])
async def generate_emergencies(
    event_id: UUID,
    request: GenerateEmergencyRequest,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually generate training emergencies.

    - **category**: 'normal', 'critical', or null for random
    - **count**: Number to generate (1-10, for burst mode)
    """
    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    if not event.training_flag:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only generate emergencies for training events"
        )

    # Validate count
    if request.count < 1 or request.count > 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Count must be between 1 and 10"
        )

    # Validate category
    if request.category and request.category not in ['normal', 'critical']:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category must be 'normal' or 'critical'"
        )

    # Generate emergencies
    incidents = await generate_training_emergency(
        db,
        event_id,
        category=request.category,
        count=request.count
    )

    return [IncidentResponse.model_validate(inc) for inc in incidents]


@router.get("/templates/", response_model=list[EmergencyTemplateResponse])
async def list_templates(
    current_user: CurrentUser,
    category: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    """List all emergency templates, optionally filtered by category."""
    query = select(EmergencyTemplate).where(EmergencyTemplate.is_active == True)

    if category:
        if category not in ['normal', 'critical']:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category must be 'normal' or 'critical'"
            )
        query = query.where(EmergencyTemplate.category == category)

    result = await db.execute(query)
    templates = result.scalars().all()

    return [EmergencyTemplateResponse.model_validate(t) for t in templates]


@router.get("/locations/", response_model=list[TrainingLocationResponse])
async def list_locations(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db)
):
    """List all training locations."""
    result = await db.execute(
        select(TrainingLocation).where(TrainingLocation.is_active == True)
    )
    locations = result.scalars().all()

    return [TrainingLocationResponse.model_validate(loc) for loc in locations]
