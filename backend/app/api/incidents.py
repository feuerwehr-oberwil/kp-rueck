"""Incident API endpoints."""

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func as sa_func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..config import settings
from ..crud import events as events_crud
from ..crud import incidents as crud
from ..database import get_db
from ..utils.errors import ErrorMessages
from ..websocket_manager import broadcast_incident_update

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["incidents"])


async def trigger_sync_background():
    """Trigger immediate sync in background (event-based sync).

    When an incident is created/updated locally, we push changes TO Railway.
    """
    try:
        from ..services.settings import get_setting_value
        from ..services.sync_service import create_sync_service

        # Get a new database session for background task
        async for db in get_db():
            try:
                # Check Railway URL from database settings
                railway_url = await get_setting_value(db, "railway_database_url", "")
                if not railway_url:
                    logger.debug("Background sync skipped: No Railway database URL configured")
                    return

                sync_service = await create_sync_service(db)

                # Check Railway health
                railway_healthy = await sync_service.check_railway_health()
                if not railway_healthy:
                    logger.debug("Background sync skipped: Railway unreachable")
                    return

                # Push local changes to Railway (event-based)
                result = await sync_service.sync_to_railway()
                if result.success:
                    logger.info(
                        "Event-based sync to Railway successful: %d records", sum(result.records_synced.values())
                    )
                else:
                    logger.warning("Event-based sync to Railway failed: %s", result.errors)
            finally:
                break
    except Exception as e:
        # Log error but don't fail the incident creation
        logger.error("Background sync failed: %s", e)


@router.get("/", response_model=list[schemas.IncidentResponse])
async def list_incidents(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    event_id: uuid.UUID,  # Required: filter by event
    status: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    """
    List incidents for a specific event.

    Args:
        event_id: Event ID to filter incidents (required)
        status: Optional status filter
        skip: Pagination offset
        limit: Max number of results (max 500)
    """
    incidents = await crud.get_incidents(
        db=db,
        event_id=event_id,
        skip=skip,
        limit=limit,
        status=status,
    )
    return incidents


@router.get("/{incident_id}", response_model=schemas.IncidentResponse)
async def get_incident(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Get incident by ID."""
    incident = await crud.get_incident(db, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("/", response_model=schemas.IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(
    incident: schemas.IncidentCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Create new incident (editor only).

    Verifies that the event exists before creating the incident.
    Triggers immediate sync (event-based) after creation.
    """
    # Verify event exists
    event = await events_crud.get_event_by_id(db, incident.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # Demo mode: cap total incidents at 30
    if settings.demo_mode:
        count_result = await db.execute(select(sa_func.count()).select_from(models.Incident))
        total_incidents = count_result.scalar() or 0
        if total_incidents >= 30:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Demo-Modus: Maximale Anzahl Einsätze (30) erreicht. Die Demo wird regelmässig zurückgesetzt.",
            )

    # Create incident
    new_incident = await crud.create_incident(
        db=db,
        incident=incident,
        current_user=current_user,
        request=request,
    )

    # Trigger immediate sync in background (event-based sync)
    background_tasks.add_task(trigger_sync_background)

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = schemas.IncidentResponse.model_validate(new_incident)

    # Broadcast WebSocket update
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "create")

    return incident_response


@router.patch("/{incident_id}", response_model=schemas.IncidentResponse)
async def update_incident(
    incident_id: uuid.UUID,
    incident_update: schemas.IncidentUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    expected_updated_at: datetime | None = None,
):
    """
    Update incident (editor only).

    Supports optimistic locking via expected_updated_at query param.
    """
    try:
        incident = await crud.update_incident(
            db=db,
            incident_id=incident_id,
            incident_update=incident_update,
            current_user=current_user,
            request=request,
            expected_updated_at=expected_updated_at,
        )
    except ValueError as e:
        logger.warning("Incident update conflict for %s: %s", incident_id, e)
        raise HTTPException(status_code=409, detail=ErrorMessages.CONFLICT)

    if not incident:
        raise HTTPException(status_code=404, detail=ErrorMessages.INCIDENT_NOT_FOUND)

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = schemas.IncidentResponse.model_validate(incident)

    # Broadcast WebSocket update
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")

    return incident_response


@router.post("/{incident_id}/status", response_model=schemas.IncidentResponse)
async def update_status(
    incident_id: uuid.UUID,
    status_update: schemas.StatusTransitionCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Update incident status (Kanban drag-and-drop).

    Creates status_transitions record.
    """
    incident = await crud.update_incident_status(
        db=db,
        incident_id=incident_id,
        new_status=status_update.to_status.value,
        current_user=current_user,
        request=request,
        notes=status_update.notes,
    )

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Convert SQLAlchemy model to Pydantic for response and WebSocket broadcast
    incident_response = schemas.IncidentResponse.model_validate(incident)

    # Broadcast WebSocket update for status change
    background_tasks.add_task(broadcast_incident_update, incident_response.model_dump(mode="json"), "update")

    return incident_response


@router.get("/{incident_id}/history", response_model=list[schemas.StatusTransitionResponse])
async def get_status_history(
    incident_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Get status transition history for incident."""
    return await crud.get_incident_status_history(db, incident_id)


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: uuid.UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """Delete incident (hard delete for training, soft delete for live)."""
    success = await crud.delete_incident(
        db=db,
        incident_id=incident_id,
        current_user=current_user,
        request=request,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Incident not found")

    # Broadcast WebSocket update for deletion
    background_tasks.add_task(broadcast_incident_update, {"id": str(incident_id)}, "delete")


@router.post("/{incident_id}/transfer", response_model=schemas.TransferAssignmentsResponse)
async def transfer_assignments(
    incident_id: uuid.UUID,
    transfer_request: schemas.TransferAssignmentsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
):
    """
    Transfer all active assignments from this incident to another incident (editor only).

    This will:
    1. Move all personnel, vehicle, and material assignments
    2. Block if any resource is already assigned to target
    3. Log the transfer action
    4. Broadcast WebSocket updates
    """
    from ..crud import assignments as assignment_crud

    try:
        result = await assignment_crud.transfer_assignments(
            db=db,
            source_incident_id=incident_id,
            target_incident_id=transfer_request.target_incident_id,
            current_user=current_user,
            request=request,
        )
    except ValueError as e:
        # Handle validation errors (no assignments, conflicts, etc.)
        # Log the actual error for debugging
        logger.warning("Assignment transfer failed for incident %s: %s", incident_id, e)
        error_str = str(e).lower()
        if "not found" in error_str:
            raise HTTPException(status_code=404, detail=ErrorMessages.NOT_FOUND)
        elif "already assigned" in error_str or "conflict" in error_str:
            raise HTTPException(status_code=409, detail=ErrorMessages.RESOURCE_ALREADY_ASSIGNED)
        else:
            raise HTTPException(status_code=400, detail=ErrorMessages.INVALID_REQUEST)

    # Get event_id for WebSocket broadcast
    incident_result = await db.execute(select(crud.Incident).where(crud.Incident.id == incident_id))
    incident = incident_result.scalar_one()
    event_id = incident.event_id

    # Broadcast WebSocket update
    from ..websocket_manager import broadcast_message

    background_tasks.add_task(
        broadcast_message,
        data={
            "type": "assignments_transferred",
            "source_incident_id": str(incident_id),
            "target_incident_id": str(transfer_request.target_incident_id),
            "assignment_ids": [str(aid) for aid in result["assignment_ids"]],
            "count": result["transferred_count"],
            "event_id": str(event_id),
        },
        room="operations",
    )

    return schemas.TransferAssignmentsResponse(
        transferred_count=result["transferred_count"],
        assignment_ids=result["assignment_ids"],
        message=f"{result['transferred_count']} Ressourcen übertragen",
    )
