"""Divera 24/7 webhook integration API endpoints."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import divera as divera_crud
from ..middleware.rate_limit import RateLimits, limiter
from ..crud import events as events_crud
from ..crud import incidents as incidents_crud
from ..crud import personnel as personnel_crud
from ..database import get_db
from ..services.divera_members import build_sync_preview, execute_sync, fetch_divera_members
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_incident_update, broadcast_message, get_divera_poller_stats

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


def infer_priority_from_text(title: str, text: str | None = None) -> schemas.IncidentPriority:
    """
    Infer incident priority from title and text content.

    HIGH priority keywords indicate life-threatening or critical situations:
    - Fire/Brand emergencies
    - BMA (building fire alarms)
    - Person rescue situations
    - Gas leaks
    - Chemical hazards
    - Medical emergencies

    Everything else defaults to MEDIUM (we're dealing with emergencies, not routine tasks).

    Args:
        title: Incident title (e.g., "Wohnungsbrand", "BMA Schulhaus")
        text: Optional incident description/text

    Returns:
        IncidentPriority.HIGH for critical situations, MEDIUM otherwise
    """
    # Combine title and text for keyword search
    combined = f"{title} {text or ''}".upper()

    # HIGH priority keywords - life-threatening or critical situations
    high_priority_keywords = [
        # Fire emergencies
        "BRAND",
        "FEUER",
        "FEUERALARM",
        "VOLLBRAND",
        "RAUCH",
        "FLAMMEN",
        # Building fire alarms
        "BMA",
        "BRANDMELDEANLAGE",
        "BRANDMELDER",
        "RAUCHMELDER",
        # Person in danger / rescue (specific phrases to avoid false positives)
        "PERSON IN",  # Person in Lift, Person in Gefahr
        "PERSON IM",  # Person im Wasser
        "EINGEKLEMMT",
        "EINGESCHLOSSEN",
        "ABSTURZ",  # Person abgestürzt
        "VERMISST",
        "BEWUSSTLOS",
        "VERLETZT",
        # Traffic accidents with people
        "VU",  # Verkehrsunfall
        "VERKEHRSUNFALL",
        # Gas / Chemical hazards
        "GAS",
        "GASGERUCH",
        "GASAUSTRITT",
        "CHEMIE",
        "CHEMIKALIEN",
        "GEFAHRGUT",
        "GEFAHRSTOFF",
        # Medical emergencies
        "MED USTÜ",  # Medizinische Unterstützung
        "MED.",  # Med. Notfall
        "MEDIZINISCH",
        "REANIMATION",
        "NOTARZT",
        "RETTUNGSDIENST",
        # Explosions
        "EXPLOSION",
        "DETONATION",
        # Building collapse
        "EINSTURZ",
        "EINGESTÜRZT",
        # Lift/elevator emergencies
        "LIFT",
        "AUFZUG",
        "FAHRSTUHL",
    ]

    for keyword in high_priority_keywords:
        if keyword in combined:
            return schemas.IncidentPriority.HIGH

    # Default to MEDIUM for all other emergencies
    return schemas.IncidentPriority.MEDIUM


@router.post("/webhook", status_code=status.HTTP_200_OK)
@limiter.limit(RateLimits.WEBHOOK)
async def receive_divera_webhook(
    payload: schemas.DiveraWebhookPayload,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request = None,
):
    """
    Receive Divera 24/7 webhook and store emergency.

    This endpoint receives webhooks from Divera and:
    1. Validates webhook secret (query param or X-Webhook-Secret header)
    2. Stores the emergency in divera_emergencies table
    3. Does NOT auto-attach to any Event (manual attachment via UI)
    4. Broadcasts WebSocket notification to frontend
    5. Returns 200 OK to Divera
    """
    # Validate webhook secret
    from ..services.settings import get_setting

    webhook_secret = await get_setting(db, "alarm_webhook_secret")
    if webhook_secret and webhook_secret != "CHANGE_ME_IN_PRODUCTION":
        import secrets as _secrets

        provided_secret = (
            request.query_params.get("secret", "")
            if request
            else ""
        ) or (
            request.headers.get("X-Webhook-Secret", "")
            if request
            else ""
        )
        if not provided_secret or not _secrets.compare_digest(provided_secret, webhook_secret):
            logger.warning("Divera webhook rejected: invalid or missing secret")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
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
                "emergency": schemas.DiveraEmergencyResponse.model_validate(emergency).model_dump(mode="json"),
            },
        )

        return {
            "status": "ok",
            "message": "Emergency stored successfully",
            "emergency_id": str(emergency.id),
        }

    except IntegrityError as e:
        logger.error(f"Database integrity error: {e}")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Emergency already exists")
    except Exception as e:
        logger.error(f"Error processing Divera webhook: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error processing webhook")


@router.get("/emergencies", response_model=schemas.DiveraEmergencyListResponse)
async def list_divera_emergencies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    attached: bool | None = Query(None, description="Filter by attachment status"),
    event_id: UUID | None = Query(None, description="Filter by event ID"),
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Divera emergency not found")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Divera emergency not found")

    # Prevent re-attachment to the same event
    if emergency.attached_to_event_id == request_data.event_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Emergency already attached to this event")

    # Allow re-attachment to different events

    # Verify event exists
    event = await events_crud.get_event_by_id(db, request_data.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Detect incident type from title
    incident_type = detect_incident_type(emergency.title)

    # Infer priority from title and text content
    priority = infer_priority_from_text(emergency.title, emergency.text)

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
        logger.warning("Failed to attach emergency %s to event: %s", emergency_id, e)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ErrorMessages.INVALID_REQUEST)

    # Convert to response schema
    incident_response = schemas.IncidentResponse.model_validate(incident)

    # Broadcast WebSocket update for instant board refresh
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    logger.info(
        f"Divera emergency {emergency_id} attached to event {request_data.event_id}, created incident {incident.id}"
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

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

            # Detect type and infer priority from text
            incident_type = detect_incident_type(emergency.title)
            priority = infer_priority_from_text(emergency.title, emergency.text)

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

    # Broadcast all created incidents for instant board refresh
    for incident in created_incidents:
        incident_response = schemas.IncidentResponse.model_validate(incident)
        background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    logger.info(f"Bulk attach completed: {len(created_incidents)} incidents created, {len(errors)} errors")

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
        logger.warning("Failed to archive emergency %s: %s", emergency_id, e)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ErrorMessages.NOT_FOUND)


@router.get("/personnel-sync/preview", response_model=schemas.DiveraSyncPreview)
async def get_personnel_sync_preview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Preview personnel sync from Divera.

    Fetches current members from Divera API, compares with existing personnel,
    and returns a categorized diff (new, updated, unchanged, not_in_divera).

    Editor role required. Divera access key must be configured.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personnel sync is disabled in demo mode",
        )

    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured. Set DIVERA_ACCESS_KEY in settings.",
        )

    try:
        divera_members = await fetch_divera_members()
    except Exception as e:
        logger.error(f"Failed to fetch Divera members: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch members from Divera: {e}",
        )

    existing = await personnel_crud.get_all_personnel(db)
    preview = build_sync_preview(divera_members, existing)

    return schemas.DiveraSyncPreview(
        new=[schemas.DiveraSyncPreviewItem(**item) for item in preview["new"]],
        unchanged=[schemas.DiveraSyncPreviewItem(**item) for item in preview["unchanged"]],
        not_in_divera=[schemas.DiveraSyncPreviewItem(**item) for item in preview["not_in_divera"]],
    )


@router.post("/personnel-sync/execute", response_model=schemas.DiveraSyncResult)
async def execute_personnel_sync(
    request_data: schemas.DiveraSyncExecute,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Execute personnel sync from Divera.

    Fetches current members from Divera, compares with DB, and applies changes.
    Optionally removes personnel not found in Divera.

    Editor role required. Divera access key must be configured.
    """
    if settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Personnel sync is disabled in demo mode",
        )

    if not settings.divera_access_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Divera access key not configured. Set DIVERA_ACCESS_KEY in settings.",
        )

    try:
        divera_members = await fetch_divera_members()
    except Exception as e:
        logger.error(f"Failed to fetch Divera members: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch members from Divera: {e}",
        )

    existing = await personnel_crud.get_all_personnel(db)
    preview = build_sync_preview(divera_members, existing)

    result = await execute_sync(
        db=db,
        preview=preview,
        remove_stale=request_data.remove_stale,
        current_user=current_user,
        request=request,
    )

    logger.info(
        f"Divera personnel sync completed: "
        f"{result['created']} created, {result['deleted']} deleted, "
        f"{result['unchanged']} unchanged"
    )

    return schemas.DiveraSyncResult(**result)


@router.get("/polling/status")
async def get_polling_status(
    current_user: CurrentUser,
):
    """
    Get Divera polling status.

    Returns information about the polling fallback mechanism:
    - Whether polling is configured (access key set)
    - Whether polling is currently active (users connected)
    - Last poll time
    - Poll and error counts
    """
    stats = get_divera_poller_stats()
    if stats is None:
        return {
            "configured": False,
            "message": "Divera polling service not available",
        }
    return stats
