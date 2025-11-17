"""Divera 24/7 webhook integration API endpoints."""
import logging
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import divera as divera_crud
from ..crud import events as events_crud
from ..crud import incidents as incidents_crud
from ..database import get_db
from ..websocket_manager import broadcast_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/divera", tags=["divera"])


# Incident type mapping from Divera title keywords to IncidentType enum
INCIDENT_TYPE_MAPPING = {
    "FEUER": schemas.IncidentType.BRANDBEKAEMPFUNG,
    "BRAND": schemas.IncidentType.BRANDBEKAEMPFUNG,
    "HOCHWASSER": schemas.IncidentType.ELEMENTAREREIGNIS,
    "UNWETTER": schemas.IncidentType.ELEMENTAREREIGNIS,
    "STURM": schemas.IncidentType.ELEMENTAREREIGNIS,
    "VU": schemas.IncidentType.STRASSENRETTUNG,
    "VERKEHR": schemas.IncidentType.STRASSENRETTUNG,
    "UNFALL": schemas.IncidentType.STRASSENRETTUNG,
    "THL": schemas.IncidentType.TECHNISCHE_HILFELEISTUNG,
    "TECH": schemas.IncidentType.TECHNISCHE_HILFELEISTUNG,
    "ÖL": schemas.IncidentType.OELWEHR,
    "OELWEHR": schemas.IncidentType.OELWEHR,
    "CHEMIE": schemas.IncidentType.CHEMIEWEHR,
    "STRAHLEN": schemas.IncidentType.STRAHLENWEHR,
    "BAHN": schemas.IncidentType.EINSATZ_BAHNANLAGEN,
    "BMA": schemas.IncidentType.BMA_UNECHTE_ALARME,
    "FEHLALARM": schemas.IncidentType.BMA_UNECHTE_ALARME,
    "DIENST": schemas.IncidentType.DIENSTLEISTUNGEN,
    "TIER": schemas.IncidentType.GERETTETE_TIERE,
}


def detect_incident_type(title: str) -> schemas.IncidentType:
    """
    Detect incident type from Divera title.

    Args:
        title: Divera alarm title (e.g., "FEUER3", "THL-VERKEHR")

    Returns:
        Detected IncidentType, defaults to DIVERSE_EINSAETZE if no match
    """
    title_upper = title.upper()

    for keyword, incident_type in INCIDENT_TYPE_MAPPING.items():
        if keyword in title_upper:
            return incident_type

    # Default fallback
    return schemas.IncidentType.DIVERSE_EINSAETZE


def map_divera_priority(divera_priority: int) -> schemas.IncidentPriority:
    """
    Map Divera priority integer to IncidentPriority enum.

    Divera: 0 = low, 1 = medium, 2 = high (assumed)
    """
    if divera_priority >= 2:
        return schemas.IncidentPriority.HIGH
    elif divera_priority == 1:
        return schemas.IncidentPriority.MEDIUM
    else:
        return schemas.IncidentPriority.LOW


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def receive_divera_webhook(
    payload: schemas.DiveraWebhookPayload,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Receive Divera 24/7 webhook and store emergency.

    This endpoint receives webhooks from Divera and:
    1. Stores the emergency in divera_emergencies table
    2. Does NOT auto-attach to any Event (manual attachment via UI)
    3. Broadcasts WebSocket notification to frontend
    4. Returns 200 OK to Divera

    Note: No authentication required - Divera webhooks don't support auth headers.
    Consider IP whitelisting or webhook secret in production.
    """
    try:
        # Check if emergency already exists (deduplication)
        existing = await divera_crud.get_divera_emergency_by_divera_id(db, payload.id)
        if existing:
            logger.info(f"Duplicate Divera webhook ignored: ID {payload.id}")
            return {"status": "ok", "message": "Duplicate emergency ignored"}

        # Create new emergency
        emergency = await divera_crud.create_divera_emergency(db, payload)

        logger.info(
            f"New Divera emergency received: ID {emergency.id}, "
            f"Divera ID {emergency.divera_id}, Title: {emergency.title}"
        )

        # Broadcast WebSocket notification to frontend
        background_tasks.add_task(
            broadcast_message,
            {
                "type": "divera_emergency_received",
                "emergency": schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode='json'),
            }
        )

        return {
            "status": "ok",
            "message": "Emergency stored successfully",
            "emergency_id": str(emergency.id),
        }

    except IntegrityError as e:
        logger.error(f"Database integrity error: {e}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Emergency already exists"
        )
    except Exception as e:
        logger.error(f"Error processing Divera webhook: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing webhook"
        )


@router.get("/emergencies", response_model=schemas.DiveraEmergencyListResponse)
async def list_divera_emergencies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    attached: Optional[bool] = Query(None, description="Filter by attachment status"),
    event_id: Optional[UUID] = Query(None, description="Filter by event ID"),
    include_archived: bool = Query(False, description="Include archived emergencies"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """
    List Divera emergencies with filters.

    Query parameters:
    - attached: true = only attached, false = only unattached, null = all
    - event_id: filter by specific event
    - include_archived: include archived emergencies
    - skip/limit: pagination
    """
    emergencies = await divera_crud.get_divera_emergencies(
        db=db,
        attached=attached,
        event_id=event_id,
        include_archived=include_archived,
        skip=skip,
        limit=limit,
    )

    total = await divera_crud.count_divera_emergencies(
        db=db,
        attached=attached,
        event_id=event_id,
        include_archived=include_archived,
    )

    unattached_count = await divera_crud.count_divera_emergencies(
        db=db,
        attached=False,
        include_archived=False,
    )

    return schemas.DiveraEmergencyListResponse(
        emergencies=[schemas.DiveraEmergencyResponse.model_validate(e) for e in emergencies],
        total=total,
        unattached_count=unattached_count,
    )


@router.get("/emergencies/{emergency_id}", response_model=schemas.DiveraEmergencyResponse)
async def get_divera_emergency(
    emergency_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Get a specific Divera emergency by ID."""
    emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Divera emergency not found"
        )

    return schemas.DiveraEmergencyResponse.model_validate(emergency)


@router.post(
    "/emergencies/{emergency_id}/attach",
    response_model=schemas.IncidentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def attach_emergency_to_event(
    emergency_id: UUID,
    request_data: schemas.AttachEmergencyRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Attach a Divera emergency to an Event by creating an Incident.

    1. Fetches the Divera emergency
    2. Verifies the Event exists
    3. Creates an Incident from the emergency data
    4. Links the emergency to the Event and Incident
    5. Broadcasts WebSocket update

    Editor role required.
    """
    # Get emergency
    emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
    if not emergency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Divera emergency not found"
        )

    # Prevent re-attachment to the same event
    if emergency.attached_to_event_id == request_data.event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Emergency already attached to this event"
        )

    # Allow re-attachment to different events

    # Verify event exists
    event = await events_crud.get_event_by_id(db, request_data.event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    # Detect incident type from title
    incident_type = detect_incident_type(emergency.title)

    # Map priority
    priority = map_divera_priority(emergency.priority)

    # Create incident from emergency
    incident_create = schemas.IncidentCreate(
        event_id=request_data.event_id,
        title=emergency.title,
        type=incident_type,
        priority=priority,
        location_address=emergency.address,
        location_lat=str(emergency.latitude) if emergency.latitude else None,
        location_lng=str(emergency.longitude) if emergency.longitude else None,
        description=emergency.text,
        status=schemas.IncidentStatus.EINGEGANGEN,
    )

    # Create the incident
    incident = await incidents_crud.create_incident(
        db=db,
        incident=incident_create,
        current_user=current_user,
        request=request,
    )

    # Link emergency to event and incident
    try:
        await divera_crud.attach_emergency_to_event(
            db=db,
            emergency_id=emergency_id,
            event_id=request_data.event_id,
            incident_id=incident.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    # Convert to response schema
    incident_response = schemas.IncidentResponse.model_validate(incident)

    # Broadcast WebSocket update
    background_tasks.add_task(
        broadcast_message,
        {
            "type": "incident_created",
            "incident": incident_response.model_dump(mode='json'),
            "source": "divera",
        }
    )

    logger.info(
        f"Divera emergency {emergency_id} attached to event {request_data.event_id}, "
        f"created incident {incident.id}"
    )

    return incident_response


@router.post("/emergencies/bulk-attach", response_model=list[schemas.IncidentResponse])
async def bulk_attach_emergencies(
    request_data: schemas.BulkAttachEmergenciesRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Attach multiple Divera emergencies to an Event.

    Creates an Incident for each emergency and links them to the Event.
    Max 100 emergencies per request.

    Returns list of created Incidents.
    """
    # Verify event exists
    event = await events_crud.get_event_by_id(db, request_data.event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
        )

    created_incidents = []
    errors = []

    for emergency_id in request_data.emergency_ids:
        try:
            # Get emergency
            emergency = await divera_crud.get_divera_emergency_by_id(db, emergency_id)
            if not emergency:
                errors.append(f"Emergency {emergency_id} not found")
                continue

            # Skip if already attached to this event
            if emergency.attached_to_event_id == request_data.event_id:
                errors.append(f"Emergency {emergency_id} already attached to this event")
                continue

            # Allow re-attachment to different events

            # Detect type and priority
            incident_type = detect_incident_type(emergency.title)
            priority = map_divera_priority(emergency.priority)

            # Create incident
            incident_create = schemas.IncidentCreate(
                event_id=request_data.event_id,
                title=emergency.title,
                type=incident_type,
                priority=priority,
                location_address=emergency.address,
                location_lat=str(emergency.latitude) if emergency.latitude else None,
                location_lng=str(emergency.longitude) if emergency.longitude else None,
                description=emergency.text,
                status=schemas.IncidentStatus.EINGEGANGEN,
            )

            incident = await incidents_crud.create_incident(
                db=db,
                incident=incident_create,
                current_user=current_user,
                request=request,
            )

            # Link emergency
            await divera_crud.attach_emergency_to_event(
                db=db,
                emergency_id=emergency_id,
                event_id=request_data.event_id,
                incident_id=incident.id,
            )

            created_incidents.append(incident)

        except Exception as e:
            logger.error(f"Error attaching emergency {emergency_id}: {e}")
            errors.append(f"Emergency {emergency_id}: {str(e)}")

    if errors:
        logger.warning(f"Bulk attach completed with errors: {errors}")

    # Broadcast all created incidents
    for incident in created_incidents:
        incident_response = schemas.IncidentResponse.model_validate(incident)
        background_tasks.add_task(
            broadcast_message,
            {
                "type": "incident_created",
                "incident": incident_response.model_dump(mode='json'),
                "source": "divera",
            }
        )

    logger.info(
        f"Bulk attach completed: {len(created_incidents)} incidents created, "
        f"{len(errors)} errors"
    )

    return [schemas.IncidentResponse.model_validate(i) for i in created_incidents]


@router.delete("/emergencies/{emergency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_divera_emergency(
    emergency_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Archive a Divera emergency (soft delete).

    Editor role required.
    Note: This does not delete the linked Incident, just archives the emergency.
    """
    try:
        await divera_crud.archive_divera_emergency(db, emergency_id)
        logger.info(f"Divera emergency {emergency_id} archived by {current_user.username}")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
