"""Training automation API endpoints."""

import random
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import personnel_checkin as checkin_crud
from ..crud import reko as reko_crud
from ..database import get_db
from ..models import EmergencyTemplate, Event, EventAttendance, Incident, Personnel, TrainingLocation
from ..schemas import (
    EmergencyTemplateResponse,
    GenerateEmergencyRequest,
    IncidentResponse,
    RekoReportResponse,
    RekoReportUpdate,
    SimulateCheckinRequest,
    SimulateCheckinResponse,
    TrainingLocationResponse,
)
from ..services.tokens import generate_form_token
from ..services.training import generate_training_emergency
from ..services.training_simulation_data import generate_reko_report_data
from ..websocket_manager import broadcast_incident_update, broadcast_personnel_update

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


# ============================================
# Training Simulation Endpoints
# ============================================


@router.post("/events/{event_id}/simulate/checkin", response_model=SimulateCheckinResponse)
async def simulate_checkin(
    event_id: UUID,
    request: SimulateCheckinRequest,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Simulate personnel check-in for a training event.

    Randomly selects unchecked personnel and checks them in.
    """
    if settings.demo_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nicht im Demo-Modus verfügbar")

    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")

    # Validate count
    count = max(1, min(50, request.count))

    # Get available personnel
    all_personnel = await db.execute(
        select(Personnel).where(Personnel.availability != "unavailable").order_by(Personnel.name.asc())
    )
    personnel_list = list(all_personnel.scalars().all())

    # Get already checked-in personnel for this event
    attendance_result = await db.execute(
        select(EventAttendance).where(EventAttendance.event_id == event_id, EventAttendance.checked_in == True)  # noqa: E712
    )
    checked_in_ids = {att.personnel_id for att in attendance_result.scalars().all()}

    # Filter to unchecked personnel
    unchecked = [p for p in personnel_list if p.id not in checked_in_ids]

    # Select random subset
    to_checkin = random.sample(unchecked, min(count, len(unchecked)))

    # Check them in
    checked_in_names = []
    for person in to_checkin:
        result = await checkin_crud.check_in_personnel(db, event_id, person.id)
        if result:
            checked_in_names.append(result.name)
            background_tasks.add_task(
                broadcast_personnel_update,
                {"id": str(person.id), "name": person.name, "checked_in": True},
                "checkin",
            )

    return SimulateCheckinResponse(
        checked_in=checked_in_names,
        total_checked_in=len(checked_in_ids) + len(checked_in_names),
        total_available=len(personnel_list),
    )


@router.post("/events/{event_id}/simulate/reko/{incident_id}", response_model=RekoReportResponse)
async def simulate_reko(
    event_id: UUID,
    incident_id: UUID,
    current_user: CurrentEditor,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Simulate a reko report submission for a training incident.

    Marks arrival, generates random report data, and submits it.
    Triggers the same status transitions and notifications as a real submission.
    """
    if settings.demo_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nicht im Demo-Modus verfügbar")

    # Verify event exists and is training
    event = await db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if not event.training_flag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only available for training events")

    # Verify incident belongs to event
    incident = await db.get(Incident, incident_id)
    if not incident or incident.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found in this event")

    if incident.status != "reko":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Einsatz muss im Status 'reko' sein (aktuell: '{incident.status}')",
        )

    # Generate token and mark arrival
    token = generate_form_token(str(incident_id), "reko")
    await reko_crud.mark_reko_arrived(db, incident_id, token)

    # Get or create report
    report = await reko_crud.get_or_create_reko_report(db, incident_id, token)

    # Generate and apply random reko data based on incident type and title
    reko_data = generate_reko_report_data(incident.type, title=incident.title)
    update_data = RekoReportUpdate(**reko_data)
    updated = await reko_crud.update_reko_report(db, report.id, update_data, submit=True)

    # Refresh incident to get current state
    await db.refresh(incident)

    # Process post-submission side effects (status transition, priority bump, notification)
    await reko_crud.process_reko_submission(db, incident, updated)

    # Refresh incident again for response
    await db.refresh(incident)

    # Build response
    response_data = RekoReportResponse.model_validate(updated)
    response_data.incident_title = incident.title
    response_data.incident_location = incident.location_address
    response_data.incident_type = incident.type
    response_data.incident_description = incident.description
    response_data.incident_contact = incident.contact

    # Broadcast updates
    incident_response = IncidentResponse.model_validate(incident)
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")

    return response_data
