"""Incident API endpoints."""
import asyncio
from datetime import datetime
from typing import Annotated, Optional
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from ..auth.dependencies import CurrentEditor, CurrentUser
from ..crud import incidents as crud
from ..crud import events as events_crud
from ..database import get_db

router = APIRouter(prefix="/incidents", tags=["incidents"])


async def trigger_sync_background():
    """Trigger immediate sync in background (event-based sync).

    When an incident is created/updated locally, we push changes TO Railway.
    """
    try:
        from ..services.sync_service import create_sync_service
        from ..services.settings import get_setting_value

        # Get a new database session for background task
        async for db in get_db():
            try:
                # Check Railway URL from database settings
                railway_url = await get_setting_value(db, "railway_database_url", "")
                if not railway_url:
                    print("Background sync skipped: No Railway database URL configured")
                    return

                sync_service = await create_sync_service(db)

                # Check Railway health
                railway_healthy = await sync_service.check_railway_health()
                if not railway_healthy:
                    print("Background sync skipped: Railway unreachable")
                    return

                # Push local changes to Railway (event-based)
                result = await sync_service.sync_to_railway()
                if result.success:
                    print(f"Event-based sync to Railway successful: {sum(result.records_synced.values())} records")
                else:
                    print(f"Event-based sync to Railway failed: {result.errors}")
            finally:
                break
    except Exception as e:
        # Log error but don't fail the incident creation
        print(f"Background sync failed: {e}")


@router.get("/", response_model=list[schemas.IncidentResponse])
async def list_incidents(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    event_id: uuid.UUID,  # Required: filter by event
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=100, le=500),
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


@router.post(
    "/", response_model=schemas.IncidentResponse, status_code=status.HTTP_201_CREATED
)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found"
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

    return new_incident


@router.patch("/{incident_id}", response_model=schemas.IncidentResponse)
async def update_incident(
    incident_id: uuid.UUID,
    incident_update: schemas.IncidentUpdate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentEditor,
    expected_updated_at: Optional[datetime] = None,
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
        raise HTTPException(status_code=409, detail=str(e))  # Conflict

    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    return incident


@router.post("/{incident_id}/status", response_model=schemas.IncidentResponse)
async def update_status(
    incident_id: uuid.UUID,
    status_update: schemas.StatusTransitionCreate,
    request: Request,
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

    return incident


@router.get(
    "/{incident_id}/history", response_model=list[schemas.StatusTransitionResponse]
)
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
